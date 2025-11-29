/**
 * Remember Tool - 기억 저장 도구
 */

import { z } from 'zod';
import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';
import { CommonSchemas } from '../../../tools/types.js';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { MemoryNeighborService } from '../services/memory-neighbor-service.js';
import { getVectorSearchEngine } from '../../search/algorithms/vector-search-engine.js';
import { MemoryEmbeddingService } from '../services/memory-embedding-service.js';
import { isMemoryItemType, type MemoryTypeRequest } from '../../../../shared/types/types/index.js';
import { CoreMemoryRepository } from '../repositories/core-memory-repository.js';
import { CoreMemoryService } from '../services/core-memory-service.js';
import { CoreMemoryCacheService } from '../services/core-memory-cache-service.js';
import { KnowledgeVaultRepository } from '../repositories/knowledge-vault-repository.js';
import { KnowledgeVaultService } from '../services/knowledge-vault-service.js';
import { validateTypeParam } from '../../../../shared/utils/type-param-validator.js';
import { mementoConfig } from '../../../../shared/config/index.js';
import type { ConsolidationScoreService } from '../../../services/consolidation-score-service.js';
import { RelationExtractor } from '../../relation/services/relation-extractor.js';
import type { MemoryItem } from '../../../../shared/types/types/index.js';
import { validateReflectionNotes, formatValidationErrors } from '../../../../shared/utils/reflection-notes-schema.js';
import { mergeReflectionNotes, serializeReflectionNotes, type ExistingReflectionNotes } from '../../../../shared/utils/reflection-notes-merge.js';

/**
 * 기존 reflection_notes 조회 결과 타입
 */
interface ExistingReflectionNotesResult {
  exists: boolean;
  type: 'null' | 'object' | 'array';
  value: null | any | any[];
  rawValue: string | null;
}

const RememberSchema = z.object({
  content: CommonSchemas.Content,
  type: CommonSchemas.MemoryType.optional(), // optional - validateTypeParam에서 기본값 처리
  // Core Memory / Knowledge Vault용 필드
  key: CommonSchemas.Key.optional(),
  value: CommonSchemas.Value.optional(),
  always_load: CommonSchemas.AlwaysLoad,
  immutable: CommonSchemas.Immutable,
  // Procedural Memory용 필드
  task_goal: CommonSchemas.TaskGoal,
  steps: CommonSchemas.Steps,
  reflection_notes: CommonSchemas.ReflectionNotes,
  // 기존 필드 유지
  tags: CommonSchemas.Tags,
  importance: CommonSchemas.Importance.default(0.5),
  source: CommonSchemas.Source,
  privacy_scope: CommonSchemas.PrivacyScope.default('private'),
}).refine((data) => {
  // 조건부 필수 검증
  if (data.type === 'core' || data.type === 'vault') {
    // type='core' 또는 'vault'일 때는 key, value 필수
    if (!data.key || !data.value) {
      return false;
    }
  } else {
    // 나머지 타입은 content 필수
    if (!data.content) {
      return false;
    }
  }
  return true;
}, {
  message: "type='core' 또는 'vault'일 때는 key, value가 필수이고, 나머지는 content가 필수입니다"
});

export class RememberTool extends BaseTool {
  constructor() {
    super(
      'remember',
      '새로운 기억을 저장합니다',
      {
        type: 'object',
        properties: {
          content: { 
            type: 'string', 
            description: '저장할 내용 (type이 core/vault가 아닐 때 필수)'
          },
          type: { 
            type: 'string', 
            enum: ['working', 'episodic', 'semantic', 'procedural', 'core', 'vault'],
            description: '기억 타입',
            default: 'episodic'
          },
          // Core Memory / Knowledge Vault용 필드
          key: { 
            type: 'string', 
            description: 'Core Memory 또는 Knowledge Vault의 키 (type이 core/vault일 때 필수)'
          },
          value: { 
            type: 'string', 
            description: 'Core Memory 또는 Knowledge Vault의 값 (type이 core/vault일 때 필수)'
          },
          always_load: { 
            type: 'boolean', 
            description: '서버 시작 시 자동 로드 여부 (Core Memory용, 기본값: false)',
            default: false
          },
          immutable: { 
            type: 'boolean', 
            description: '불변 데이터 여부 (Knowledge Vault용, 기본값: true)',
            default: true
          },
          // Procedural Memory용 필드
          task_goal: { 
            type: 'string', 
            description: '작업 목표 (Procedural Memory용)'
          },
          steps: { 
            type: 'string', 
            description: '단계별 절차 (JSON 배열 문자열, Procedural Memory용)'
          },
          reflection_notes: { 
            type: 'string', 
            description: 'Reflexion 기록 (JSON 객체 문자열, Procedural Memory용)'
          },
          // 기존 필드 유지
          tags: { 
            type: 'array', 
            items: { type: 'string' },
            description: '태그 목록'
          },
          importance: { 
            type: 'number', 
            minimum: 0, 
            maximum: 1,
            description: '중요도 (0-1)',
            default: 0.5
          },
          source: { type: 'string', description: '출처' },
          privacy_scope: { 
            type: 'string', 
            enum: ['private', 'team', 'public'],
            description: '프라이버시 범위',
            default: 'private'
          }
        },
        required: [] // 조건부 필수는 Zod 스키마에서 검증
      }
    );
  }

  /**
   * reflection_notes 파라미터의 JSON 형식 및 스키마 검증
   * 단일 객체 또는 배열 형식 모두 허용
   * 
   * @param reflectionNotes - 검증할 reflection_notes 문자열
   * @throws Error - JSON 형식이 유효하지 않거나 스키마 검증 실패 시
   */
  private validateReflectionNotesJson(reflectionNotes: string): void {
    const validationResult = validateReflectionNotes(reflectionNotes);
    
    if (!validationResult.isValid) {
      const errorMessage = formatValidationErrors(validationResult);
      throw new Error(`reflection_notes 스키마 검증 실패:\n${errorMessage}`);
    }
  }

  /**
   * 같은 task_goal을 가진 기존 procedural memory 레코드의 reflection_notes 조회
   * 
   * @param db - 데이터베이스 인스턴스
   * @param taskGoal - 작업 목표
   * @returns 기존 reflection_notes 조회 결과
   */
  private async getExistingReflectionNotes(
    db: any,
    taskGoal: string | null | undefined
  ): Promise<ExistingReflectionNotesResult> {
    // task_goal이 제공되지 않은 경우 조회 불가
    if (!taskGoal) {
      return {
        exists: false,
        type: 'null',
        value: null,
        rawValue: null
      };
    }

    try {
      // 같은 task_goal을 가진 가장 최근 procedural memory 레코드 조회
      const existingRecord = DatabaseUtils.get(
        db,
        `SELECT reflection_notes FROM memory_item 
         WHERE type = 'procedural' AND task_goal = ? 
         ORDER BY created_at DESC LIMIT 1`,
        [taskGoal]
      );

      if (!existingRecord || !existingRecord.reflection_notes) {
        return {
          exists: false,
          type: 'null',
          value: null,
          rawValue: null
        };
      }

      // reflection_notes 파싱 및 타입 확인
      return this.parseReflectionNotes(existingRecord.reflection_notes);
    } catch (error) {
      // 조회 실패 시 빈 결과 반환
      this.logWarning(`기존 reflection_notes 조회 실패: ${error instanceof Error ? error.message : String(error)}`);
      return {
        exists: false,
        type: 'null',
        value: null,
        rawValue: null
      };
    }
  }

  /**
   * reflection_notes 문자열을 파싱하고 타입 확인
   * NULL, 단일 객체, 배열 케이스 처리
   * 
   * @param reflectionNotes - 파싱할 reflection_notes 문자열
   * @returns 파싱 결과
   */
  private parseReflectionNotes(reflectionNotes: string | null): ExistingReflectionNotesResult {
    if (!reflectionNotes || reflectionNotes.trim() === '') {
      return {
        exists: true,
        type: 'null',
        value: null,
        rawValue: null
      };
    }

    try {
      const parsed = JSON.parse(reflectionNotes);

      if (Array.isArray(parsed)) {
        return {
          exists: true,
          type: 'array',
          value: parsed,
          rawValue: reflectionNotes
        };
      }

      if (typeof parsed === 'object' && parsed !== null) {
        return {
          exists: true,
          type: 'object',
          value: parsed,
          rawValue: reflectionNotes
        };
      }

      // 객체나 배열이 아닌 경우
      return {
        exists: true,
        type: 'null',
        value: null,
        rawValue: reflectionNotes
      };
    } catch (error) {
      // 파싱 실패 시 원본 문자열 반환
      this.logWarning(`reflection_notes 파싱 실패: ${error instanceof Error ? error.message : String(error)}`);
      return {
        exists: true,
        type: 'null',
        value: null,
        rawValue: reflectionNotes
      };
    }
  }

  async handle(params: any, context: ToolContext): Promise<ToolResult> {
    const startTime = Date.now();
    try {
      const { 
        content, 
        type: rawType, 
        key, 
        value, 
        always_load, 
        immutable, 
        task_goal, 
        steps, 
        reflection_notes,
        tags, 
        importance, 
        source, 
        privacy_scope 
      } = RememberSchema.parse(params);
    
    // type 파라미터 롤아웃 모드 검증
    const typeParamMode = mementoConfig.typeParamMode;
    const typeValidation = validateTypeParam(rawType, typeParamMode, 'remember');
    
    // 에러 모드인 경우 에러 발생
    if (!typeValidation.isValid) {
      throw new Error(typeValidation.message || "type 파라미터는 필수입니다.");
    }
    
    // 경고/Deprecation 메시지 출력
    if (typeValidation.message) {
      if (typeParamMode === 'warn') {
        this.logWarning(typeValidation.message);
      } else if (typeParamMode === 'deprecate') {
        this.logWarning(typeValidation.message);
      }
    }
    
    // type 파라미터 결정 (제공된 값 또는 기본값)
    const type = (rawType || typeValidation.defaultType || 'episodic') as MemoryTypeRequest;
    
    // reflection_notes JSON 검증 (type='procedural'이고 reflection_notes가 제공된 경우에만)
    if (type === 'procedural' && reflection_notes !== undefined && reflection_notes !== null) {
      this.validateReflectionNotesJson(reflection_notes);
    }
    
    // 데이터베이스 연결 확인
    this.validateDatabase(context);

    // origin_source 생성 (JSON 형식)
    const origin_source = JSON.stringify({
      tool: 'remember',
      caller: 'user',
      timestamp: new Date().toISOString(),
      context: {
        type,
        has_content: !!content,
        has_key: !!key,
        has_value: !!value,
        type_param_mode: typeParamMode,
        type_was_defaulted: !rawType
      }
    });

    // type에 따른 분기 처리
    if (type === 'core') {
      // Core Memory 저장
      if (!key || !value) {
        throw new Error("type='core'일 때는 key와 value가 필수입니다");
      }

      const coreMemoryRepository = new CoreMemoryRepository(context.db!);
      const { getCoreMemoryCache } = await import('../services/core-memory-cache-service.js');
      const coreMemoryCache = getCoreMemoryCache();
      const coreMemoryService = new CoreMemoryService(coreMemoryRepository, coreMemoryCache);

      const agent_id = 'default'; // TODO: 향후 context에서 가져오기

      const record = await coreMemoryService.create({
        agent_id,
        key,
        value,
        always_load: always_load || false,
        origin_source
      });

      return this.createSuccessResult({
        memory_id: record.core_id,
        type: 'core',
        key: record.key,
        value: record.value,
        always_load: record.always_load,
        message: `Core Memory가 저장되었습니다: ${record.core_id}`
      });
    } else if (type === 'vault') {
      // Knowledge Vault 저장
      if (!key || !value) {
        throw new Error("type='vault'일 때는 key와 value가 필수입니다");
      }

      const knowledgeVaultRepository = new KnowledgeVaultRepository(context.db!);
      const knowledgeVaultService = new KnowledgeVaultService(knowledgeVaultRepository);

      const agent_id = 'default'; // TODO: 향후 context에서 가져오기

      const record = await knowledgeVaultService.create({
        agent_id,
        key,
        value,
        immutable: immutable !== false, // 기본값 true
        origin_source
      });

      return this.createSuccessResult({
        memory_id: record.vault_id,
        type: 'vault',
        key: record.key,
        value: record.value,
        immutable: record.immutable,
        message: `Knowledge Vault가 저장되었습니다: ${record.vault_id}`
      });
    } else {
      // 기존 memory_item 저장 (episodic, semantic, procedural, working)
      if (!content) {
        throw new Error("type이 'core' 또는 'vault'가 아닐 때는 content가 필수입니다");
      }

      // 타입 가드로 검증
      if (!isMemoryItemType(type)) {
        throw new Error(`Invalid memory type: ${type}`);
      }

      // reflection_notes 처리
      // type='procedural'이고 reflection_notes가 제공된 경우 기존 reflection_notes 조회 및 병합
      // non-procedural 타입에서는 reflection_notes를 무시 (PRD: "Procedural Memory에서만 사용 가능")
      let finalReflectionNotes: string | null = null;
      if (type === 'procedural' && reflection_notes !== undefined && reflection_notes !== null) {
        // procedural 타입: 기존 reflection_notes 조회 및 병합
        finalReflectionNotes = reflection_notes;
        const existingReflectionNotes = await this.getExistingReflectionNotes(context.db!, task_goal);
        
        // 기존 reflection_notes가 있는 경우 병합
        if (existingReflectionNotes.exists) {
          try {
            // 병합 유틸리티 함수 사용
            const existing: ExistingReflectionNotes = 
              existingReflectionNotes.type === 'null' ? { type: 'null', value: null } :
              existingReflectionNotes.type === 'object' ? { type: 'object', value: existingReflectionNotes.value } :
              { type: 'array', value: existingReflectionNotes.value };

            const mergeResult = mergeReflectionNotes(existing, reflection_notes);
            
            // 병합 결과를 JSON 문자열로 변환
            finalReflectionNotes = serializeReflectionNotes(mergeResult.merged);
            
            // 경고 메시지 처리
            if (mergeResult.warnings.length > 0) {
              mergeResult.warnings.forEach(warning => {
                this.logWarning(`reflection_notes 병합 경고: ${warning}`);
              });
            }
            
            if (mergeResult.removedCount > 0) {
              this.logWarning(
                `reflection_notes 크기 제한으로 인해 ${mergeResult.removedCount}개 항목이 제거되었습니다`
              );
            }
          } catch (error) {
            // 병합 실패 시 에러 처리
            const errorMessage = error instanceof Error ? error.message : String(error);
            
            // 단일 객체 크기 초과 같은 경우는 에러를 던짐 (검증 단계에서 이미 처리되어야 하지만 안전장치)
            if (errorMessage.includes('최대') && errorMessage.includes('바이트')) {
              throw new Error(
                `reflection_notes 크기 제한 초과: ${errorMessage}. ` +
                `단일 객체는 최대 10KB, 전체 필드는 최대 1MB를 초과할 수 없습니다.`
              );
            }
            
            // 기타 병합 실패 시 원본 reflection_notes 사용 (경고 로그)
            this.logWarning(
              `reflection_notes 병합 실패, 원본 값 사용: ${errorMessage}. ` +
              `기존 reflection_notes는 유지되고 새 reflection_notes만 저장됩니다.`
            );
          }
        }
      }
      // non-procedural 타입에서는 reflection_notes를 무시 (null로 설정)

      // UUID 생성 (임시로 간단한 ID 사용)
      const id = `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      try {
        // 메모리 저장 (트랜잭션 사용)
        await DatabaseUtils.runTransaction(context.db!, async () => {
          // Consolidation Score System 초기화 값 설정
          const createdAt = new Date().toISOString();
          const recallCount = mementoConfig.consolidationScoreEnabled ? 1 : 0; // 기능 활성화 시 1, 비활성화 시 0
          const gValue = mementoConfig.consolidationScoreEnabled ? 1.0 : null; // 기능 활성화 시 1.0, 비활성화 시 NULL
          const lastAccessedAt = mementoConfig.consolidationScoreEnabled ? createdAt : null; // 기능 활성화 시 created_at과 동일, 비활성화 시 NULL

          // consolidation_score 계산 (기능 활성화 시)
          let consolidationScore: number | null = null;
          if (mementoConfig.consolidationScoreEnabled && context.services.consolidationScoreService) {
            const scoreResult = context.services.consolidationScoreService.calculateScore({
              recallCount: 1,
              lastAccessedAt: new Date(createdAt),
              createdAt: new Date(createdAt),
              gValue: 1.0,
              type: type,
              pinned: false
            });
            consolidationScore = scoreResult.score;
          }

          await DatabaseUtils.run(context.db!, `
            INSERT INTO memory_item (
              id, type, content, importance, privacy_scope, tags, source, origin_source, 
              task_goal, steps, reflection_notes, created_at,
              recall_count, last_accessed_at, g_value, consolidation_score
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            id, 
            type, 
            content, 
            importance, 
            privacy_scope, 
            tags ? JSON.stringify(tags) : null, 
            source || null,
            origin_source,
            task_goal || null,
            steps || null,
            finalReflectionNotes,
            createdAt,
            recallCount,
            lastAccessedAt,
            gValue,
            consolidationScore
          ]);
        });
        
        // 메모리 저장 완료 후 임베딩 생성, 인접 기억 갱신, 관계 추출 (비동기, 실패해도 메모리 저장은 성공)
        // 데이터베이스 참조를 미리 저장하여 비동기 콜백에서 안전하게 사용
        const dbRef = context.db;
        const embeddingServiceRef = context.services.embeddingService;
        const savedMemoryId = id; // 클로저에서 사용할 수 있도록 저장
        const savedMemoryType = type; // 클로저에서 사용할 수 있도록 저장
        
        if (dbRef) {
          // 비동기 작업을 별도로 실행 (fire-and-forget 패턴)
          // 메모리 저장 응답은 즉시 반환하고, 임베딩/인접 기억 갱신/관계 추출은 백그라운드에서 처리
          (async () => {
            try {
              // 트랜잭션이 완전히 커밋되도록 짧은 지연
              await new Promise(resolve => setTimeout(resolve, 100));
              
              // 데이터베이스 연결이 여전히 유효한지 확인 (간단한 쿼리로 테스트)
              // DatabaseUtils.get은 동기 함수이지만, 비동기 컨텍스트에서 안전하게 실행하기 위해 Promise로 감싸서 await
              try {
                await new Promise<void>((resolve, reject) => {
                  try {
                    DatabaseUtils.get(dbRef, 'SELECT 1');
                    resolve();
                  } catch (error) {
                    reject(error);
                  }
                });
              } catch (dbError) {
                this.logWarning('데이터베이스 연결이 유효하지 않아 백그라운드 작업을 건너뜁니다', { 
                  memory_id: savedMemoryId,
                  error: dbError instanceof Error ? dbError.message : String(dbError)
                });
                return;
              }
              
              // 임베딩 생성 (embeddingService가 사용 가능한 경우에만)
              let embeddingResult = null;
              if (embeddingServiceRef?.isAvailable()) {
                try {
                  embeddingResult = await embeddingServiceRef.createAndStoreEmbedding(dbRef, savedMemoryId, content, savedMemoryType);
                } catch (error) {
                  // 임베딩 생성 실패해도 메모리 저장은 성공했으므로 경고만 출력
                  this.logWarning(`임베딩 생성 실패 (${savedMemoryId})`, {
                    error: error instanceof Error ? error.message : String(error)
                  });
                }
              }
              
              // PRD 3.1-3.3: 인접 기억 갱신 (임베딩이 생성된 경우에만)
              if (embeddingResult && embeddingServiceRef) {
                try {
                  // 데이터베이스 연결 재확인
                  let dbValid = false;
                  try {
                    await new Promise<void>((resolve, reject) => {
                      try {
                        DatabaseUtils.get(dbRef, 'SELECT 1');
                        resolve();
                      } catch (error) {
                        reject(error);
                      }
                    });
                    dbValid = true;
                  } catch (dbError) {
                    this.logWarning('데이터베이스 연결이 유효하지 않아 인접 기억 갱신을 건너뜁니다', { 
                      memory_id: savedMemoryId,
                      error: dbError instanceof Error ? dbError.message : String(dbError)
                    });
                  }

                  if (dbValid) {
                    const vectorSearchEngine = getVectorSearchEngine();
                    const neighborService = new MemoryNeighborService(
                      vectorSearchEngine,
                      embeddingServiceRef
                    );
                    
                    neighborService.setDatabase(dbRef);
                    
                    // 인접 기억 갱신 (기본 유사도 임계값: 0.8)
                    const neighborIds = await neighborService.updateNeighborsForNewMemory(savedMemoryId, 0.8);
                    
                    if (neighborIds.length > 0) {
                      this.logInfo('인접 기억 갱신 완료', {
                        memory_id: savedMemoryId,
                        neighbor_count: neighborIds.length
                      });
                    }
                  }
                } catch (error) {
                  // 인접 기억 갱신 실패해도 메모리 저장은 성공했으므로 경고만 출력
                  this.logWarning(`인접 기억 갱신 실패 (${savedMemoryId})`, {
                    error: error instanceof Error ? error.message : String(error)
                  });
                }
              }

              // PRD 2.12: 관계 추출 트리거 (비동기 배치 처리)
              // 임베딩 생성 여부와 관계없이 관계 추출 수행 (규칙 기반 추출은 임베딩 불필요)
              try {
                // 데이터베이스 연결 재확인
                let dbValid = false;
                try {
                  await new Promise<void>((resolve, reject) => {
                    try {
                      DatabaseUtils.get(dbRef, 'SELECT 1');
                      resolve();
                    } catch (error) {
                      reject(error);
                    }
                  });
                  dbValid = true;
                } catch (dbError) {
                  this.logWarning('데이터베이스 연결이 유효하지 않아 관계 추출을 건너뜁니다', { 
                    memory_id: savedMemoryId,
                    error: dbError instanceof Error ? dbError.message : String(dbError)
                  });
                }

                if (dbValid) {
                  // 기존 기억들 조회 (최근 100개로 제한하여 성능 최적화)
                  const existingMemories = await this.getExistingMemoriesForRelationExtraction(dbRef, savedMemoryId, 100);
                  
                  if (existingMemories.length > 0) {
                    // 새로 저장된 기억 정보 조회
                    const newMemory = await this.getMemoryById(dbRef, savedMemoryId);
                    
                    if (newMemory) {
                      // RelationExtractor를 사용하여 관계 추출
                      const relationExtractor = new RelationExtractor();
                      
                      // 비동기 배치 처리로 관계 추출
                      // immediate: true로 설정하여 캐싱 활성화
                      const candidates = await relationExtractor.extractRelations(
                        newMemory,
                        existingMemories,
                        {
                          method: 'hybrid',
                          minConfidence: 0.5,
                          candidateLimit: 30, // MiniLM 필터링을 위한 제한
                          immediate: true // 캐싱 활성화
                        }
                      );

                      if (candidates.length > 0) {
                        this.logInfo('관계 추출 완료', {
                          memory_id: savedMemoryId,
                          relation_count: candidates.length,
                          relations: candidates.map(c => ({
                            target_id: c.target_id,
                            relation_type: c.relation_type,
                            confidence: c.confidence,
                            method: c.method
                          }))
                        });

                        // TODO: PRD 3.0에서 RelationGraph가 구현되면 여기서 관계를 저장
                        // const relationGraph = new RelationGraph(dbRef);
                        // for (const candidate of candidates) {
                        //   await relationGraph.addRelation(candidate);
                        // }
                      } else {
                        this.logInfo('관계 추출 완료 (관계 없음)', {
                          memory_id: savedMemoryId
                        });
                      }
                    }
                  }
                }
              } catch (error) {
                // 관계 추출 실패해도 메모리 저장은 성공했으므로 경고만 출력
                this.logWarning(`관계 추출 실패 (${savedMemoryId})`, {
                  error: error instanceof Error ? error.message : String(error)
                });
              }
            } catch (error) {
              // 백그라운드 작업 실패해도 메모리 저장은 성공했으므로 경고만 출력
              this.logWarning(`백그라운드 작업 실패 (${savedMemoryId})`, {
                error: error instanceof Error ? error.message : String(error)
              });
            }
          })().catch((error) => {
            // 예상치 못한 에러 처리
            this.logWarning(`백그라운드 작업 실패 (${savedMemoryId})`, {
              error: error instanceof Error ? error.message : String(error)
            });
          });
        }
        
        return this.createSuccessResult({
          memory_id: id,
          type: type,
          message: `기억이 저장되었습니다: ${id}`,
          embedding_created: context.services.embeddingService?.isAvailable() || false
        });
      } catch (error) {
        // 데이터베이스 락 문제인 경우 WAL 체크포인트 시도
        if ((error as any).code === 'SQLITE_BUSY') {
          try {
            await DatabaseUtils.checkpointWAL(context.db);
          } catch (checkpointError) {
            // WAL 체크포인트 실패
          }
        }
        
        // 실패 감지 훅 호출
        const executionTime = Date.now() - startTime;
        await this.handleFailure(
          error instanceof Error ? error : new Error(String(error)),
          params,
          context,
          executionTime
        );
        
        throw error;
      }
    }
    } catch (error) {
      // 최상위 에러 처리 (내부 catch에서 처리되지 않은 에러)
      const executionTime = Date.now() - startTime;
      await this.handleFailure(
        error instanceof Error ? error : new Error(String(error)),
        params,
        context,
        executionTime
      );
      throw error;
    }
  }

  /**
   * 관계 추출을 위한 기존 기억들 조회
   * 
   * @param db 데이터베이스 연결
   * @param excludeId 제외할 기억 ID (새로 저장된 기억)
   * @param limit 조회할 기억 수 제한
   * @returns 기존 기억 목록
   */
  private async getExistingMemoriesForRelationExtraction(
    db: any,
    excludeId: string,
    limit: number = 100
  ): Promise<MemoryItem[]> {
    try {
      const rows = await DatabaseUtils.all(db, `
        SELECT 
          id, type, content, importance, privacy_scope, 
          created_at, last_accessed, pinned, tags, source, embedding
        FROM memory_item
        WHERE id != ? -- 새로 저장된 기억 제외
        ORDER BY created_at DESC
        LIMIT ?
      `, [excludeId, limit]);

      return rows.map((row: any) => ({
        id: row.id,
        type: row.type,
        content: row.content,
        importance: row.importance,
        privacy_scope: row.privacy_scope,
        created_at: new Date(row.created_at),
        last_accessed: row.last_accessed ? new Date(row.last_accessed) : undefined,
        pinned: Boolean(row.pinned),
        tags: row.tags ? JSON.parse(row.tags) : undefined,
        source: row.source || undefined,
        embedding: row.embedding ? JSON.parse(row.embedding) : undefined
      }));
    } catch (error) {
      this.logWarning('기존 기억 조회 실패', {
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }

  /**
   * ID로 기억 조회
   * 
   * @param db 데이터베이스 연결
   * @param id 기억 ID
   * @returns 기억 정보
   */
  private async getMemoryById(db: any, id: string): Promise<MemoryItem | null> {
    try {
      const row = await DatabaseUtils.get(db, `
        SELECT 
          id, type, content, importance, privacy_scope, 
          created_at, last_accessed, pinned, tags, source, embedding
        FROM memory_item
        WHERE id = ?
      `, [id]);

      if (!row) {
        return null;
      }

      return {
        id: row.id,
        type: row.type,
        content: row.content,
        importance: row.importance,
        privacy_scope: row.privacy_scope,
        created_at: new Date(row.created_at),
        last_accessed: row.last_accessed ? new Date(row.last_accessed) : undefined,
        pinned: Boolean(row.pinned),
        tags: row.tags ? JSON.parse(row.tags) : undefined,
        source: row.source || undefined,
        embedding: row.embedding ? JSON.parse(row.embedding) : undefined
      };
    } catch (error) {
      this.logWarning('기억 조회 실패', {
        memory_id: id,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }
}
