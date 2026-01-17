/**
 * Remember Tool - 기억 저장 도구
 */

import { z } from 'zod';
import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';
import { CommonSchemas } from '../../../tools/types.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { MemoryNeighborService } from '../services/memory-neighbor-service.js';
import { getVectorSearchEngine } from '../../search/algorithms/vector-search-engine.js';
import { MemoryEmbeddingService } from '../services/memory-embedding-service.js';
import { UnifiedEmbeddingService } from '../../embedding/services/unified-embedding-service.js';
import { isMemoryItemType, type MemoryTypeRequest } from '../../../shared/types/index.js';
import type { CoreMemoryRepository } from '../repositories/core-memory-repository.interface.js';
import { CoreMemoryService } from '../services/core-memory-service.js';
import { CoreMemoryCacheService } from '../services/core-memory-cache-service.js';
import { KnowledgeVaultRepository } from '../repositories/knowledge-vault-repository.js';
import { KnowledgeVaultService } from '../services/knowledge-vault-service.js';
import { validateTypeParam } from '../../../shared/utils/type-param-validator.js';
import { mementoConfig } from '../../../shared/config/index.js';
import type { ConsolidationScoreService } from '../../../infrastructure/consolidation-score-service.js';
import { RelationExtractor } from '../../relation/services/relation-extractor.js';
import type { MemoryItem } from '../../../shared/types/index.js';
import { validateReflectionNotes, formatValidationErrors } from '../../../shared/utils/reflection-notes-schema.js';
import { mergeReflectionNotes, serializeReflectionNotes, type ExistingReflectionNotes } from '../../../shared/utils/reflection-notes-merge.js';
import { validateProceduralMemoryFields } from '../../../shared/utils/type-param-validator.js';
import { toDbRelationType } from '../../../shared/utils/relation-type-converter.js';
// AriGraph Pipeline
import { TripleExtractionService } from '../../../services/triple-extraction/triple-extraction-service.js';
import { SemanticMemoryUpdateService } from '../../../services/semantic-memory/semantic-memory-update-service.js';
import { getBatchScheduler } from '../../../infrastructure/scheduler/batch-scheduler.js';

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
  // Procedural Memory Enhancement (v7.0) 필드
  workflow_name: CommonSchemas.WorkflowName,
  skill_name: CommonSchemas.SkillName,
  trigger_conditions: CommonSchemas.TriggerConditions,
  update_mode: CommonSchemas.UpdateMode,
  // AriGraph Pipeline 필드
  enable_triple_extraction: CommonSchemas.EnableTripleExtraction,
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
          // Procedural Memory Enhancement (v7.0) 필드
          workflow_name: { 
            type: 'string', 
            description: '프로세스 이름 (예: "데이터 마이그레이션", "API 배포")'
          },
          skill_name: { 
            type: 'string', 
            description: '기술/능력 이름 (예: "스키마 백업", "데이터 검증")'
          },
          trigger_conditions: { 
            type: 'string', 
            description: '트리거 조건 (JSON 객체 문자열)'
          },
          update_mode: { 
            type: 'string', 
            enum: ['replace', 'incremental', 'versioned'],
            description: '업데이트 모드: replace (교체), incremental (증분), versioned (버전 관리)'
          },
          // AriGraph Pipeline 필드
          enable_triple_extraction: { 
            type: 'boolean', 
            description: 'Triple 추출 활성화 여부 (기본값: true). type="episodic"일 때만 적용됩니다.',
            default: true
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
        workflow_name,
        skill_name,
        trigger_conditions,
        update_mode,
        enable_triple_extraction,
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
    
    // Procedural Memory Enhancement (v7.0) 필드 검증
    // type='procedural'일 때만 검증 (다른 타입에서는 무시)
    if (type === 'procedural') {
      try {
        validateProceduralMemoryFields({
          workflow_name,
          skill_name,
          trigger_conditions
        });
      } catch (error) {
        throw new Error(`Procedural Memory 필드 검증 실패: ${error instanceof Error ? error.message : String(error)}`);
      }
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

      const { createCoreMemoryRepository } = await import('../../../infrastructure/database/factories/core-memory-repository.factory.js');
      const coreMemoryRepository = createCoreMemoryRepository(context.db!);
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

      // 업데이트 모드 처리: 기존 procedural memory 조회
      // 
      // 정책:
      // 1. update_mode가 지정된 경우:
      //    - 'replace' 또는 'incremental': 기존 레코드를 찾아 업데이트
      //    - 'versioned': 기존 레코드를 찾아 버전 관계를 추가하되 새 레코드 생성
      // 2. update_mode가 없는 경우:
      //    - 기존 메모리를 찾지 않고 항상 새로 저장 (기존 메모리와 무관)
      //    - 이는 명시적으로 update_mode를 지정하지 않으면 덮어쓰지 않는다는 의도
      //    - 동일 workflow_name/skill_name이 있어도 별도의 메모리로 저장됨
      //
      // 참고: 자동 연동(reflexion-worker) 시에는 기본적으로 incremental 모드를 사용
      let existingMemoryId: string | null = null;
      let existingMemory: any | null = null;
      
      if (type === 'procedural' && update_mode) {
        // 모든 업데이트 모드에서 기존 레코드 찾기 (versioned 모드도 포함)
        existingMemory = await this.findExistingProceduralMemory(
          context.db!,
          workflow_name,
          skill_name
        );
        
        // replace 또는 incremental 모드일 때만 기존 ID 사용
        // versioned 모드는 항상 새 ID를 생성해야 함
        if (existingMemory && update_mode !== 'versioned') {
          existingMemoryId = existingMemory.id;
        }
      }
      // update_mode가 없으면 existingMemory는 null로 유지 (항상 새로 저장)

      // UUID 생성 (임시로 간단한 ID 사용)
      // replace 또는 incremental 모드이고 기존 레코드가 있는 경우 기존 ID 사용
      // versioned 모드는 항상 새 ID 생성
      const id = existingMemoryId || `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      try {
        // 메모리 저장 (트랜잭션 사용)
        await DatabaseUtils.runTransaction(context.db!, async () => {
          // 업데이트 모드 처리
          // replace 또는 incremental 모드이고 기존 레코드가 있는 경우 UPDATE
          // update_mode가 없으면 항상 새로 저장 (기존 메모리가 있어도 덮어쓰지 않음)
          // 그 외에는 INSERT
          const isUpdate = existingMemory && update_mode && (update_mode === 'replace' || update_mode === 'incremental');

          // Consolidation Score System 초기화 값 설정
          const createdAt = new Date().toISOString();
          // 기존 메모리가 있고 업데이트 모드인 경우 기존 값 보존, 없으면 기본값 사용
          // update_mode가 없으면 항상 새로 저장하므로 기본값 사용
          // PRD에 따라 새 메모리는 항상 recall_count=1로 초기화 (생성을 첫 번째 '접근'으로 간주)
          const recallCount = isUpdate && existingMemory?.recall_count !== undefined
            ? existingMemory.recall_count + 1  // 기존 값에 1 증가
            : 1; // 새 메모리는 항상 1 (PRD 정책: 생성 시 recall_count=1)
          const gValue = isUpdate && existingMemory?.g_value !== undefined
            ? existingMemory.g_value  // 기존 값 보존
            : (mementoConfig.consolidationScoreEnabled ? 1.0 : null); // 새 메모리는 1.0 또는 null
          const lastAccessedAt = isUpdate && existingMemory?.last_accessed_at
            ? new Date(existingMemory.last_accessed_at).toISOString()  // 기존 값 보존
            : (mementoConfig.consolidationScoreEnabled ? createdAt : null); // 새 메모리는 created_at 또는 null
          
          // incremental 모드일 때 steps 병합
          let finalSteps = steps || null;
          if (isUpdate && update_mode === 'incremental' && existingMemory.steps && steps) {
            try {
              const existingSteps = JSON.parse(existingMemory.steps);
              const newSteps = JSON.parse(steps);
              
              // 배열 병합 (중복 제거는 하지 않음, 사용자가 명시적으로 추가한 것으로 간주)
              const mergedSteps = Array.isArray(existingSteps) && Array.isArray(newSteps)
                ? [...existingSteps, ...newSteps]
                : newSteps; // 병합 실패 시 새 steps 사용
              
              finalSteps = JSON.stringify(mergedSteps);
            } catch (error) {
              // 병합 실패 시 새 steps 사용
              this.logWarning('steps 병합 실패, 새 steps 사용', {
                error: error instanceof Error ? error.message : String(error)
              });
            }
          }

          // consolidation_score 계산 (기능 활성화 시)
          let consolidationScore: number | null = null;
          if (mementoConfig.consolidationScoreEnabled && context.services.consolidationScoreService) {
            const scoreResult = context.services.consolidationScoreService.calculateScore({
              recallCount: recallCount,  // 위에서 계산한 recallCount 사용
              lastAccessedAt: lastAccessedAt ? new Date(lastAccessedAt) : new Date(createdAt),
              createdAt: isUpdate && existingMemory?.created_at ? new Date(existingMemory.created_at) : new Date(createdAt),
              gValue: gValue ?? 1.0,  // 위에서 계산한 gValue 사용 (없으면 1.0)
              type: type,
              pinned: isUpdate && existingMemory?.pinned ? Boolean(existingMemory.pinned) : false
            });
            consolidationScore = scoreResult.score;
          }

          if (isUpdate) {
            // UPDATE 쿼리
            await DatabaseUtils.run(context.db!, `
              UPDATE memory_item SET
                content = ?,
                importance = ?,
                privacy_scope = ?,
                tags = ?,
                source = ?,
                origin_source = ?,
                task_goal = ?,
                steps = ?,
                reflection_notes = ?,
                workflow_name = ?,
                skill_name = ?,
                trigger_conditions = ?,
                recall_count = ?,
                last_accessed_at = ?,
                g_value = ?,
                consolidation_score = ?
              WHERE id = ?
            `, [
              content,
              importance,
              privacy_scope,
              tags ? JSON.stringify(tags) : null,
              source || null,
              origin_source,
              task_goal || null,
              finalSteps,
              finalReflectionNotes,
              workflow_name || null,
              skill_name || null,
              trigger_conditions || null,
              recallCount,
              lastAccessedAt,
              gValue,
              consolidationScore,
              id
            ]);
          } else {
            // INSERT 쿼리
            await DatabaseUtils.run(context.db!, `
              INSERT INTO memory_item (
                id, type, content, importance, privacy_scope, tags, source, origin_source, 
                task_goal, steps, reflection_notes, 
                workflow_name, skill_name, trigger_conditions,
                created_at,
                recall_count, last_accessed_at, g_value, consolidation_score
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
              finalSteps,
              finalReflectionNotes,
              workflow_name || null,
              skill_name || null,
              trigger_conditions || null,
              createdAt,
              recallCount,
              lastAccessedAt,
              gValue,
              consolidationScore
            ]);

            // versioned 모드일 때 memory_link에 'version_of' 관계 추가
            if (update_mode === 'versioned' && existingMemory) {
              try {
                const dbRelationType = toDbRelationType('VERSION_OF');
                await DatabaseUtils.run(context.db!, `
                  INSERT INTO memory_link (source_id, target_id, relation_type)
                  VALUES (?, ?, ?)
                `, [id, existingMemory.id, dbRelationType]);
              } catch (error) {
                // 관계 추가 실패는 경고만 출력 (메모리 저장은 성공)
                this.logWarning('버전 관계 추가 실패', {
                  source_id: id,
                  target_id: existingMemory.id,
                  error: error instanceof Error ? error.message : String(error)
                });
              }
            }
          }
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

              // PRD 4.1, 5.3: AriGraph Pipeline - Triple 추출 및 Semantic Memory 생성
              // type='episodic'이고 enable_triple_extraction=true일 때만 실행
              // JobQueue를 통해 비동기로 실행 (Episodic Memory 저장은 블로킹하지 않음)
              if (savedMemoryType === 'episodic' && enable_triple_extraction !== false) {
                try {
                  // BatchScheduler의 JobQueue에 Triple 추출 작업 등록
                  const batchScheduler = getBatchScheduler();
                  const jobName = `triple_extraction_${savedMemoryId}`;
                  
                  // Triple 추출 작업 함수 정의
                  const tripleExtractionJob = async () => {
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
                        this.logWarning('데이터베이스 연결이 유효하지 않아 Triple 추출을 건너뜁니다', { 
                          memory_id: savedMemoryId,
                          error: dbError instanceof Error ? dbError.message : String(dbError)
                        });
                        return;
                      }

                      if (dbValid) {
                        // Triple 추출 서비스 초기화
                        const tripleExtractionService = new TripleExtractionService();
                        
                        // Triple 추출 (비동기, 실패해도 메모리 저장은 성공)
                        const extractionResult = await tripleExtractionService.extractTriples(
                          content,
                          {},
                          savedMemoryId
                        );

                        // Triple이 추출된 경우 Semantic Memory 생성/업데이트
                        if (extractionResult.triples.length > 0) {
                          // MemoryEmbeddingService는 내부적으로 UnifiedEmbeddingService를 사용하므로,
                          // 타입 단언을 사용하여 UnifiedEmbeddingService로 변환
                          // 실제로는 MemoryEmbeddingService가 UnifiedEmbeddingService를 래핑하고 있음
                          const unifiedEmbeddingService: UnifiedEmbeddingService = embeddingServiceRef
                            ? (embeddingServiceRef as unknown as UnifiedEmbeddingService)
                            : new UnifiedEmbeddingService();
                          const semanticMemoryUpdateService = new SemanticMemoryUpdateService(
                            dbRef,
                            unifiedEmbeddingService,
                            context.services.relationGraph
                          );

                          const updateResult = await semanticMemoryUpdateService.updateSemanticMemory(
                            extractionResult,
                            {
                              episodicMemoryId: savedMemoryId,
                              episodicImportance: importance || 0.5
                            }
                          );

                          // PRD 5.5, 5.5a, 5.6: Triple 추출 성공 시 상태 업데이트
                          // 성공 시: triple_extracted=true, triple_extracted_status='success'
                          // 이전 실패 기록 초기화 후 성공 정보로 갱신
                          const confidenceValues: number[] = [];
                          // memory_relation에서 confidence 값 수집 (각 triple별로 저장됨)
                          try {
                            const relations = DatabaseUtils.all(dbRef, `
                              SELECT confidence FROM memory_relation
                              WHERE source_id = ? AND relation_type = 'extracted_from'
                            `, [savedMemoryId]);
                            for (const rel of relations) {
                              if (rel.confidence !== null && rel.confidence !== undefined) {
                                confidenceValues.push(rel.confidence);
                              }
                            }
                          } catch (err) {
                            // confidence 수집 실패해도 계속 진행
                            this.logWarning('Confidence 수집 실패', {
                              memory_id: savedMemoryId,
                              error: err instanceof Error ? err.message : String(err)
                            });
                          }

                          const confidenceAvg = confidenceValues.length > 0
                            ? confidenceValues.reduce((sum, c) => sum + c, 0) / confidenceValues.length
                            : null;

                          const metadata = {
                            triple_count: extractionResult.triples.length,
                            ...(confidenceAvg !== null && { confidence_avg: confidenceAvg }),
                            extracted_at: new Date().toISOString()
                          };

                          await DatabaseUtils.run(dbRef, `
                            UPDATE memory_item SET
                              triple_extracted = ?,
                              triple_extracted_status = ?,
                              triple_extraction_metadata = ?
                            WHERE id = ?
                          `, [
                            1,  // triple_extracted=true (SQLite에서는 INTEGER로 저장)
                            'success',  // triple_extracted_status='success'
                            JSON.stringify(metadata),  // 성공 정보로 갱신 (이전 실패 기록 초기화)
                            savedMemoryId
                          ]);

                          this.logInfo('Triple 추출 및 Semantic Memory 생성 완료', {
                            memory_id: savedMemoryId,
                            triple_count: extractionResult.triples.length,
                            confidence_avg: confidenceAvg
                          });
                        } else {
                          // PRD 5.5, 5.5a, 5.6: Triple 추출 실패 시 상태 업데이트
                          // 실패 시: triple_extracted=false, triple_extracted_status='failed'
                          // 실패 정보 저장 (failureReason, retry_count, last_attempt)
                          const failureReason = extractionResult.extractionInfo.failureReason || 'no_triple';
                          
                          // 기존 metadata에서 retry_count 가져오기 (있는 경우)
                          let retryCount = 0;
                          try {
                            const existing = DatabaseUtils.get(dbRef, `
                              SELECT triple_extraction_metadata FROM memory_item WHERE id = ?
                            `, [savedMemoryId]);
                            if (existing?.triple_extraction_metadata) {
                              const existingMeta = JSON.parse(existing.triple_extraction_metadata);
                              retryCount = (existingMeta.retry_count || 0) + 1;
                            } else {
                              retryCount = 1;
                            }
                          } catch (err) {
                            retryCount = 1;
                          }

                          const metadata = {
                            failureReason,
                            retry_count: retryCount,
                            last_attempt: new Date().toISOString()
                          };

                          await DatabaseUtils.run(dbRef, `
                            UPDATE memory_item SET
                              triple_extracted = ?,
                              triple_extracted_status = ?,
                              triple_extraction_metadata = ?
                            WHERE id = ?
                          `, [
                            0,  // triple_extracted=false (SQLite에서는 INTEGER로 저장)
                            'failed',  // triple_extracted_status='failed'
                            JSON.stringify(metadata),  // 실패 정보 저장
                            savedMemoryId
                          ]);

                          this.logInfo('Triple 추출 완료 (Triple 없음)', {
                            memory_id: savedMemoryId,
                            failure_reason: failureReason,
                            retry_count: retryCount
                          });
                        }
                      }
                    } catch (error) {
                      // Triple 추출 실패해도 메모리 저장은 성공했으므로 경고만 출력
                      this.logWarning(`Triple 추출 실패 (${savedMemoryId})`, {
                        error: error instanceof Error ? error.message : String(error)
                      });
                    }
                  };

                  // JobQueue에 작업 등록 (우선순위: 5, 중간 우선순위)
                  const added = batchScheduler.addJob(jobName, tripleExtractionJob, 5, 0);
                  if (added) {
                    this.logInfo('Triple 추출 작업이 JobQueue에 등록되었습니다', {
                      memory_id: savedMemoryId,
                      job_name: jobName
                    });
                  } else {
                    this.logWarning('Triple 추출 작업이 JobQueue에 등록되지 않았습니다 (중복 또는 큐 가득참)', {
                      memory_id: savedMemoryId,
                      job_name: jobName
                    });
                  }
                } catch (error) {
                  // JobQueue 등록 실패해도 메모리 저장은 성공했으므로 경고만 출력
                  this.logWarning(`Triple 추출 작업 등록 실패 (${savedMemoryId})`, {
                    error: error instanceof Error ? error.message : String(error)
                  });
                }
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
        const errorWithCode = error as { code?: string };
        if (errorWithCode.code === 'SQLITE_BUSY') {
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
   * 기존 procedural memory 조회
   * workflow_name과 skill_name으로 기존 레코드를 찾습니다.
   * 
   * @param db 데이터베이스 연결
   * @param workflow_name 프로세스 이름
   * @param skill_name 기술/능력 이름
   * @returns 기존 procedural memory 레코드 또는 null
   */
  private async findExistingProceduralMemory(
    db: any,
    workflow_name: string | null | undefined,
    skill_name: string | null | undefined
  ): Promise<any | null> {
    // workflow_name과 skill_name이 모두 제공되어야 함
    if (!workflow_name || !skill_name) {
      return null;
    }

    try {
      const row = await DatabaseUtils.get(db, `
        SELECT 
          id, type, content, importance, privacy_scope, 
          created_at, last_accessed, pinned, tags, source,
          task_goal, steps, reflection_notes,
          workflow_name, skill_name, trigger_conditions,
          recall_count, last_accessed_at, g_value, consolidation_score
        FROM memory_item
        WHERE type = 'procedural'
          AND workflow_name = ?
          AND skill_name = ?
        ORDER BY created_at DESC
        LIMIT 1
      `, [workflow_name, skill_name]);

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
        task_goal: row.task_goal || undefined,
        steps: row.steps || undefined,
        reflection_notes: row.reflection_notes || undefined,
        workflow_name: row.workflow_name || undefined,
        skill_name: row.skill_name || undefined,
        trigger_conditions: row.trigger_conditions || undefined,
        recall_count: row.recall_count ?? undefined,
        last_accessed_at: row.last_accessed_at ? new Date(row.last_accessed_at) : undefined,
        g_value: row.g_value ?? undefined,
        consolidation_score: row.consolidation_score ?? undefined
      };
    } catch (error) {
      this.logWarning('기존 procedural memory 조회 실패', {
        workflow_name,
        skill_name,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
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
