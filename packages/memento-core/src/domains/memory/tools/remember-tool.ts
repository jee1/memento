/**
 * Remember Tool - 기억 저장 도구
 *
 * 즉시 저장 (Issue #89): 메모리 항목은 DB에 append-only로 저장된 직후 응답을 반환한다.
 * Triple 추출·콘솔리데이션 등 augmentation은 BatchScheduler 워커에서 비동기 수행되며,
 * 호출자는 augmentation 완료를 기다리지 않는다.
 */

import type Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { z } from 'zod';
import { mementoConfig } from '../../../shared/config/index.js';
import type { MemoryItem } from '../../../shared/types/index.js';
import { isMemoryItemType,type MemoryTypeRequest } from '../../../shared/types/index.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { isTestEnvironment } from '../../../shared/utils/environment-check.js';
import { mergeReflectionNotes,serializeReflectionNotes,type ExistingReflectionNotes } from '../../../shared/utils/reflection-notes-merge.js';
import { formatValidationErrors,validateReflectionNotes,type ReflectionNote } from '../../../shared/utils/reflection-notes-schema.js';
import { toDbRelationType } from '../../../shared/utils/relation-type-converter.js';
import { validateProceduralMemoryFields,validateTypeParam } from '../../../shared/utils/type-param-validator.js';
import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext,ToolResult } from '../../../tools/types.js';
import { CommonSchemas } from '../../../tools/types.js';
import { UnifiedEmbeddingService } from '../../embedding/services/unified-embedding-service.js';
import { RelationExtractor } from '../../relation/services/relation-extractor.js';
import { getVectorSearchEngine } from '../../search/algorithms/vector-search-engine.js';
import { KnowledgeVaultRepository } from '../repositories/knowledge-vault-repository.js';
import { CoreMemoryService } from '../services/core-memory-service.js';
import { KnowledgeVaultService } from '../services/knowledge-vault-service.js';
import { MemoryNeighborService } from '../services/memory-neighbor-service.js';
import { getNextVersionNumber } from '../services/procedural-versioning.js';
// AriGraph Pipeline
import type { TripleExtractionResult } from '../../../shared/types/triple-extraction.js';
import { TripleExtractionService } from '../../relation/services/triple-extraction/triple-extraction-service.js';
import { SemanticMemoryUpdateService } from '../services/semantic-memory/semantic-memory-update-service.js';

/**
 * 기존 reflection_notes 조회 결과 타입
 */
const RELATION_GRAPH_UNAVAILABLE_ERROR = 'relation_graph_unavailable';
const SEMANTIC_UPDATE_FAILED_ERROR = 'semantic_update_failed';

interface ExistingReflectionNotesResult {
  exists: boolean;
  type: 'null' | 'object' | 'array';
  value: null | ReflectionNote | ReflectionNote[];
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
  // Multi-agent ownership (Issue #57 Phase 2 D)
  owner_id: z.string().optional(),
  // Memori Attribution (Issue #87)
  process_id: z.string().optional(),
  session_id: z.string().optional(),
  // Project-scoped memory (Issue #81)
  project_id: z.string().max(200).optional()
    .describe('프로젝트 식별자. 동일 project_id로 저장한 기억끼리 recall/memory_injection 시 필터링 가능'),
  // Fact metadata (Issue #88): semantic 표준 메타
  num_times: z.number().int().min(1).optional(),
  last_mentioned_at: z.string().datetime().optional(),
  source_session_id: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
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

/** Remember 도구 파라미터 타입 (Zod 스키마 추론) */
export type RememberParams = z.infer<typeof RememberSchema>;

/** memory_item SELECT row 공통 형태 (getMemoryById, getExistingMemoriesForRelationExtraction) */
interface MemoryItemRow {
  id: string;
  type: string;
  content: string;
  importance: number;
  privacy_scope: string;
  created_at: string;
  last_accessed?: string | null;
  pinned: number | boolean;
  tags?: string | null;
  source?: string | null;
  embedding?: string | null;
  /** sleep consolidation 등 — 컬럼 없으면 undefined */
  is_consolidated?: number | boolean | null;
}

/** Procedural 기존 레코드 조회용 (MemoryItem + 메타/버전 필드) */
type ProceduralMemoryItem = MemoryItem & {
  recall_count?: number;
  g_value?: number;
  last_accessed_at?: Date;
  version_series_id?: string;
  version?: number;
  consolidation_score?: number;
};

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
            description: `기억 타입. 각 타입의 의미와 사용 시점:
- 'working': 현재 처리 중인 정보 (48시간 TTL, 세션 종료 시 episodic으로 전환). 예: "현재 버그 수정 작업 진행 중"
- 'episodic': 사건과 경험 기록 (90일 TTL, 핀 고정 시 무기한). 예: "오늘 회의에서 결정한 사항", "작업 완료 기록"
- 'semantic': 지식과 사실 (무기한 보존). 예: "React Hooks 사용법", "에러 해결 방법", "코드 패턴"
- 'procedural': 방법과 절차 (무기한 보존). 예: "PRD 기반 작업 목록 생성 절차", "배포 절차"
- 'core': 에이전트 정체성, 규칙, 지침 (무기한 보존, key-value 형식, always_load 옵션 지원). 예: "나는 도움이 되는 어시스턴트다", "코딩 스타일 규칙"
- 'vault': 불변 지식, 사실 (무기한 보존, key-value 형식, immutable 옵션 지원). 예: "빛의 속도는 299,792,458 m/s", "수학 공식"
기본값: 'episodic'`,
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
    db: Database.Database,
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
      ) as { reflection_notes?: string | null } | undefined;

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
          value: parsed as ReflectionNote[],
          rawValue: reflectionNotes
        };
      }

      if (typeof parsed === 'object' && parsed !== null) {
        return {
          exists: true,
          type: 'object',
          value: parsed as ReflectionNote,
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

  async handle(params: RememberParams, context: ToolContext): Promise<ToolResult> {
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
        privacy_scope,
        owner_id: owner_id_param,
        process_id: process_id_param,
        session_id: session_id_param,
        project_id: project_id_param,
        num_times: num_times_param,
        last_mentioned_at: last_mentioned_at_param,
        source_session_id: source_session_id_param,
        confidence: confidence_param
      } = RememberSchema.parse(params);

    const ownerId = owner_id_param ?? context.agentId ?? null;
    const processId = process_id_param ?? context.processId ?? null;
    const sessionId = session_id_param ?? context.sessionId ?? null;
    // Fact metadata (Issue #88): semantic 저장 시 사용, 기본값으로 recall 가중 가능
    const numTimes = num_times_param ?? 1;
    const sourceSessionId = source_session_id_param ?? sessionId;
    const confidenceVal = confidence_param ?? null;

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

      const ch = createHash('sha256').update(`${key}:${value}`).digest('hex').slice(0, 16);
      const since24hCore = new Date(Date.now() - 86_400_000).toISOString();
      const isDupCore =
        context.services?.telemetryService?.hasPriorWriteWithContentHash(ownerId, ch, since24hCore) ??
        false;
      // memory_item 경로와 동일: 쓰기 시도 전에 requested 기록(실패 시 completed 부재로 상관 추적 가능)
      context.services?.telemetryService?.record({
        eventType: 'memory.write.requested',
        outcome: 'success',
        extraData: { memory_type: 'core', content_hash: ch }
      });

      const record = await coreMemoryService.create({
        agent_id,
        key,
        value,
        always_load: always_load || false,
        origin_source
      });
      context.services?.telemetryService?.record({
        eventType: 'memory.write.completed',
        outcome: 'success',
        latencyMs: Date.now() - startTime,
        extraData: {
          memory_type: 'core',
          memory_id: record.core_id,
          content_hash: ch,
          is_duplicate: isDupCore
        }
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

      const vch = createHash('sha256').update(`${key}:${value}`).digest('hex').slice(0, 16);
      const since24hVault = new Date(Date.now() - 86_400_000).toISOString();
      const isDupVault =
        context.services?.telemetryService?.hasPriorWriteWithContentHash(ownerId, vch, since24hVault) ??
        false;
      context.services?.telemetryService?.record({
        eventType: 'memory.write.requested',
        outcome: 'success',
        extraData: { memory_type: 'vault', content_hash: vch }
      });

      const record = await knowledgeVaultService.create({
        agent_id,
        key,
        value,
        immutable: immutable !== false, // 기본값 true
        origin_source
      });
      context.services?.telemetryService?.record({
        eventType: 'memory.write.completed',
        outcome: 'success',
        latencyMs: Date.now() - startTime,
        extraData: {
          memory_type: 'vault',
          memory_id: record.vault_id,
          content_hash: vch,
          is_duplicate: isDupVault
        }
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

      const contentHash = createHash('sha256').update(content).digest('hex').slice(0, 16);
      context.services?.telemetryService?.record({
        eventType: 'memory.write.requested',
        outcome: 'success',
        extraData: { memory_type: type, content_hash: contentHash }
      });

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
              existingReflectionNotes.type === 'object' ? { type: 'object', value: existingReflectionNotes.value as ReflectionNote } :
              { type: 'array', value: (existingReflectionNotes.value ?? []) as ReflectionNote[] };

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
      let existingMemory: ProceduralMemoryItem | null = null;
      
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
          const recallCount = isUpdate && existingMemory && existingMemory.recall_count !== undefined
            ? existingMemory.recall_count + 1  // 기존 값에 1 증가
            : 1; // 새 메모리는 항상 1 (PRD 정책: 생성 시 recall_count=1)
          const gValue = isUpdate && existingMemory && existingMemory.g_value !== undefined
            ? existingMemory.g_value  // 기존 값 보존
            : (mementoConfig.consolidationScoreEnabled ? 1.0 : null); // 새 메모리는 1.0 또는 null
          const lastAccessedAt = isUpdate && existingMemory && existingMemory.last_accessed_at
            ? new Date(existingMemory.last_accessed_at).toISOString()  // 기존 값 보존
            : (mementoConfig.consolidationScoreEnabled ? createdAt : null); // 새 메모리는 created_at 또는 null
          // Fact metadata (Issue #88): semantic 최근 언급 시각
          const lastMentionedAt = last_mentioned_at_param ?? (isUpdate ? new Date().toISOString() : createdAt);

          // incremental 모드일 때 steps 병합
          let finalSteps = steps || null;
          if (isUpdate && update_mode === 'incremental' && existingMemory && existingMemory.steps && steps) {
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
                consolidation_score = ?,
                owner_id = ?,
                process_id = ?,
                session_id = ?,
                num_times = ?,
                last_mentioned_at = ?,
                source_session_id = ?,
                confidence = ?
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
              ownerId,
              processId,
              sessionId,
              numTimes,
              lastMentionedAt,
              sourceSessionId,
              confidenceVal,
              id
            ]);
          } else {
            // Procedural 버전 필드: versioned 모드면 기존 시리즈 이어받고, 아니면 1과 자기 id (Issue #57)
            const proceduralVersion = type === 'procedural' && existingMemory && update_mode === 'versioned'
              ? getNextVersionNumber(context.db!, existingMemory.version_series_id ?? existingMemory.id)
              : (type === 'procedural' ? 1 : null);
            const proceduralVersionSeriesId = type === 'procedural' && existingMemory && update_mode === 'versioned'
              ? (existingMemory.version_series_id ?? existingMemory.id)
              : (type === 'procedural' ? id : null);

            // INSERT 쿼리
            await DatabaseUtils.run(context.db!, `
              INSERT INTO memory_item (
                id, type, content, importance, privacy_scope, tags, source, origin_source,
                task_goal, steps, reflection_notes,
                workflow_name, skill_name, trigger_conditions,
                created_at,
                recall_count, last_accessed_at, g_value, consolidation_score,
                version, version_series_id, owner_id, process_id, session_id, project_id,
                num_times, last_mentioned_at, source_session_id, confidence
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
              consolidationScore,
              proceduralVersion,
              proceduralVersionSeriesId,
              ownerId,
              processId,
              sessionId,
              project_id_param ?? null,
              numTimes,
              lastMentionedAt,
              sourceSessionId,
              confidenceVal
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
                    const vectorSearchEngine = context.services?.vectorSearchEngine ?? getVectorSearchEngine();
                    const neighborService = new MemoryNeighborService(
                      vectorSearchEngine,
                      embeddingServiceRef,
                      dbRef
                    );
                    
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

              // 즉시 저장 완료. 이하 augmentation(Triple 추출)은 워커에서 비동기 수행 (Issue #89).
              // PRD 4.1, 5.3: AriGraph Pipeline - Triple 추출 및 Semantic Memory 생성
              // type='episodic'이고 enable_triple_extraction=true일 때만 실행
              // JobQueue를 통해 비동기로 실행 (Episodic Memory 저장은 블로킹하지 않음)
              if (savedMemoryType === 'episodic' && enable_triple_extraction !== false) {
                try {
                  // BatchScheduler의 JobQueue에 Triple 추출 작업 등록 (context 주입, 없으면 스킵)
                  const batchScheduler = context.services?.batchScheduler;
                  if (!batchScheduler) {
                    this.logWarning('배치 스케줄러를 사용할 수 없어 Triple 추출 작업을 등록하지 않습니다.', {
                      memory_id: savedMemoryId
                    });
                  } else {
                  const jobName = `triple_extraction_${savedMemoryId}`;
                  
                  // Triple 추출 작업 함수 정의
                  const tripleExtractionJob = async () => {
                    let semanticUpdateStarted = false;
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
                        // 데이터베이스 연결이 유효하지 않으면 Triple 추출은 불가능하지만,
                        // 상태 업데이트는 시도 (연결이 복구되었을 수 있음)
                        try {
                          await DatabaseUtils.run(dbRef, `
                            UPDATE memory_item SET
                              triple_extracted = ?,
                              triple_extracted_status = ?,
                              triple_extraction_metadata = ?
                            WHERE id = ?
                          `, [
                            0,  // triple_extracted=false
                            'failed',  // triple_extracted_status='failed'
                            JSON.stringify({
                              failureReason: 'db_connection_error',
                              retry_count: 1,
                              last_attempt: new Date().toISOString(),
                              error_message: dbError instanceof Error ? dbError.message : String(dbError)
                            }),
                            savedMemoryId
                          ]);
                        } catch (updateError) {
                          // 상태 업데이트도 실패하면 로그만 출력
                          this.logWarning('데이터베이스 연결 실패 상태 업데이트 실패', {
                            memory_id: savedMemoryId,
                            error: updateError instanceof Error ? updateError.message : String(updateError)
                          });
                        }
                        return;
                      }

                      if (dbValid) {
                        const statusResult = DatabaseUtils.run(dbRef, `
                          UPDATE memory_item SET
                            triple_extracted_status = ?,
                            triple_extraction_metadata = ?
                          WHERE id = ? AND (triple_extracted_status IS NULL OR triple_extracted_status = '')
                        `, [
                          'in_progress',
                          JSON.stringify({
                            started_at: new Date().toISOString()
                          }),
                          savedMemoryId
                        ]);

                        if (statusResult.changes === 0) {
                          this.logInfo('Triple 추출 작업이 이미 진행 중이거나 완료되었습니다', {
                            memory_id: savedMemoryId
                          });
                          return;
                        }

                        // Triple 추출 서비스 초기화
                        const tripleExtractionService = new TripleExtractionService();
                        
                        // Triple 추출 (비동기, 실패해도 메모리 저장은 성공)
                        // extractTriples는 항상 TripleExtractionResult를 반환하므로 에러가 발생하지 않음
                        // 하지만 초기화 실패 등으로 인해 llm_unavailable 결과가 반환될 수 있음
                        let extractionResult;
                        try {
                          extractionResult = await tripleExtractionService.extractTriples(
                            content,
                            {},
                            savedMemoryId
                          );
                        } catch (extractError) {
                          // extractTriples가 에러를 throw한 경우 (예상치 못한 에러)
                          // 실패 결과 생성
                          extractionResult = {
                            triples: [],
                            extractionInfo: {
                              steps: {
                                canonicalization: false,
                                entityLinking: false
                              },
                              failureReason: 'llm_api_error' as const
                            }
                          } satisfies TripleExtractionResult;
                        }

                        // Triple이 추출된 경우 Semantic Memory 생성/업데이트
                        if (extractionResult.triples.length > 0) {
                          semanticUpdateStarted = true;
                          // MemoryEmbeddingService는 generateEmbedding을 노출하지 않음 — 내부 UnifiedEmbeddingService 사용
                          const unifiedEmbeddingService: UnifiedEmbeddingService = embeddingServiceRef
                            ? embeddingServiceRef.getUnifiedEmbeddingService()
                            : new UnifiedEmbeddingService();
                          const relationGraph = context.services.relationGraph;
                          if (!relationGraph) {
                            throw new Error(RELATION_GRAPH_UNAVAILABLE_ERROR);
                          }

                          const semanticMemoryUpdateService = new SemanticMemoryUpdateService(
                            dbRef,
                            relationGraph,
                            unifiedEmbeddingService
                          );

                          const _updateResult = await semanticMemoryUpdateService.updateSemanticMemory(
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
                              WHERE target_id = ? AND relation_type = 'extracted_from'
                            `, [savedMemoryId]) as Array<{ confidence?: number | null }>;
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
                            `, [savedMemoryId]) as { triple_extraction_metadata?: string } | undefined;
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
                      const errorMessage = error instanceof Error ? error.message : String(error);
                      const failureReason = errorMessage === RELATION_GRAPH_UNAVAILABLE_ERROR
                        ? 'relation_graph_unavailable'
                        : errorMessage.includes('database connection')
                          ? 'db_connection_error'
                          : semanticUpdateStarted
                            ? SEMANTIC_UPDATE_FAILED_ERROR
                            : 'llm_api_error';

                      // Triple 추출 실패해도 메모리 저장은 성공했으므로 경고만 출력
                      this.logWarning(`Triple 추출 실패 (${savedMemoryId})`, {
                        failure_reason: failureReason,
                        error: errorMessage
                      });
                      
                      // PRD 5.5, 5.5a, 5.6: 에러 발생 시에도 상태 업데이트
                      // 에러 발생 시: triple_extracted=false, triple_extracted_status='failed'
                      try {
                        // 데이터베이스 연결이 유효한지 확인
                        await new Promise<void>((resolve, reject) => {
                          try {
                            DatabaseUtils.get(dbRef, 'SELECT 1');
                            resolve();
                          } catch (dbError) {
                            reject(dbError);
                          }
                        });
                        
                        // 데이터베이스 연결이 유효하면 상태 업데이트
                        
                        // 기존 metadata에서 retry_count 가져오기 (있는 경우)
                        let retryCount = 0;
                        try {
                          const existing = DatabaseUtils.get(dbRef, `
                            SELECT triple_extraction_metadata FROM memory_item WHERE id = ?
                          `, [savedMemoryId]) as { triple_extraction_metadata?: string } | undefined;
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
                          last_attempt: new Date().toISOString(),
                          error_message: error instanceof Error ? error.message : String(error)
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
                      } catch (updateError) {
                        // 상태 업데이트 실패는 로그만 출력 (이미 에러 상황이므로)
                        this.logWarning('Triple 추출 실패 상태 업데이트 실패', {
                          memory_id: savedMemoryId,
                          error: updateError instanceof Error ? updateError.message : String(updateError)
                        });
                      }
                    }
                  };

                  if (isTestEnvironment()) {
                    this.logInfo('테스트 환경: Triple 추출 작업을 즉시 실행합니다', {
                      memory_id: savedMemoryId,
                      job_name: jobName
                    });

                    try {
                      await tripleExtractionJob();
                    } catch (directError) {
                      this.logWarning('Triple 추출 작업 즉시 실행 실패', {
                        memory_id: savedMemoryId,
                        error: directError instanceof Error ? directError.message : String(directError)
                      });
                    }
                    return;
                  }

                  // JobQueue에 작업 등록 (우선순위: 5, 중간 우선순위). Issue #89: 폴백 제거 — 순수 비동기만 사용.
                  const added = batchScheduler.addJob(jobName, tripleExtractionJob, 5, 0);
                  if (added) {
                    this.logInfo('Triple 추출 작업이 JobQueue에 등록되었습니다', {
                      memory_id: savedMemoryId,
                      job_name: jobName
                    });
                  } else {
                    const status = batchScheduler.getStatus();
                    const alreadyQueued = batchScheduler.isJobQueued(jobName);
                    const alreadyRunning = batchScheduler.isJobRunning(jobName);

                    this.logWarning('Triple 추출 작업이 JobQueue에 등록되지 않았습니다 (중복 또는 큐 가득참)', {
                      memory_id: savedMemoryId,
                      job_name: jobName,
                      scheduler_running: status.isRunning,
                      already_queued: Boolean(alreadyQueued),
                      already_running: Boolean(alreadyRunning)
                    });

                    if (!alreadyQueued && !alreadyRunning) {
                      try {
                        await tripleExtractionJob();
                      } catch (fallbackError) {
                        this.logWarning('Triple 추출 작업 직접 실행 실패', {
                          memory_id: savedMemoryId,
                          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
                        });
                      }
                    }
                  }
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

        const since24h = new Date(Date.now() - 86_400_000).toISOString();
        const isDuplicate =
          context.services?.telemetryService?.hasPriorWriteWithContentHash(
            ownerId,
            contentHash,
            since24h
          ) ?? false;
        context.services?.telemetryService?.record({
          eventType: 'memory.write.completed',
          outcome: 'success',
          latencyMs: Date.now() - startTime,
          extraData: {
            memory_type: type,
            memory_id: id,
            content_hash: contentHash,
            is_duplicate: isDuplicate
          }
        });

        let similarity_warning: { count: number; similar_ids: string[] } | undefined;
        try {
          const embSvc = context.services?.embeddingService;
          if (embSvc?.isAvailable()) {
            const vecEng = context.services?.vectorSearchEngine ?? getVectorSearchEngine();
            vecEng.initialize(context.db!);
            const unified = embSvc.getUnifiedEmbeddingService();
            const qEmb = await unified.generateEmbedding(content);
            if (qEmb?.embedding && Array.isArray(qEmb.embedding)) {
              const prov = unified.getCurrentProviderName() ?? 'tfidf';
              const hits = await vecEng.search(
                qEmb.embedding,
                { limit: 8, threshold: 0.85, types: [type] },
                prov
              );
              const sameOwner = hits.filter(h => {
                if (h.memory_id === id) {
                  return false;
                }
                const row = DatabaseUtils.get(
                  context.db!,
                  `SELECT owner_id FROM memory_item WHERE id = ?`,
                  [h.memory_id]
                ) as { owner_id: string | null } | undefined;
                const o = row?.owner_id ?? null;
                return String(o ?? '') === String(ownerId ?? '');
              });
              if (sameOwner.length > 0) {
                similarity_warning = {
                  count: sameOwner.length,
                  similar_ids: sameOwner.map(s => s.memory_id)
                };
              }
            }
          }
        } catch {
          /* FR-008: 유사도 경고 실패 시에도 저장은 성공 */
        }

        return this.createSuccessResult({
          memory_id: id,
          type: type,
          message: `기억이 저장되었습니다: ${id}`,
          embedding_created: context.services.embeddingService?.isAvailable() || false,
          ...(similarity_warning ? { similarity_warning } : {})
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
    db: Database.Database,
    workflow_name: string | null | undefined,
    skill_name: string | null | undefined
  ): Promise<ProceduralMemoryItem | null> {
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
          recall_count, last_accessed_at, g_value, consolidation_score,
          version, version_series_id
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
      const r = row as MemoryItemRow & Record<string, unknown>;
      return {
        id: r.id,
        type: r.type as MemoryItem['type'],
        content: r.content,
        importance: r.importance,
        privacy_scope: r.privacy_scope as MemoryItem['privacy_scope'],
        created_at: new Date(r.created_at),
        last_accessed: r.last_accessed ? new Date(r.last_accessed) : undefined,
        pinned: Boolean(r.pinned),
        tags: r.tags ? JSON.parse(r.tags) : undefined,
        source: r.source || undefined,
        task_goal: (r as Record<string, unknown>).task_goal as string | undefined,
        steps: (r as Record<string, unknown>).steps as string | undefined,
        reflection_notes: (r as Record<string, unknown>).reflection_notes as string | undefined,
        workflow_name: (r as Record<string, unknown>).workflow_name as string | undefined,
        skill_name: (r as Record<string, unknown>).skill_name as string | undefined,
        trigger_conditions: (r as Record<string, unknown>).trigger_conditions as string | undefined,
        recall_count: (r as Record<string, unknown>).recall_count as number | undefined,
        g_value: (r as Record<string, unknown>).g_value as number | undefined,
        last_accessed_at: (r as Record<string, unknown>).last_accessed_at != null ? new Date((r as Record<string, unknown>).last_accessed_at as string) : undefined,
        version: (r as Record<string, unknown>).version as number | undefined,
        version_series_id: (r as Record<string, unknown>).version_series_id as string | undefined,
        consolidation_score: (r as Record<string, unknown>).consolidation_score as number | undefined
      } as ProceduralMemoryItem;
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
    db: Database.Database,
    excludeId: string,
    limit: number = 100
  ): Promise<MemoryItem[]> {
    try {
      const rows = await DatabaseUtils.all(db, `
        SELECT 
          id, type, content, importance, privacy_scope, 
          created_at, last_accessed, pinned, tags, source, embedding,
          is_consolidated
        FROM memory_item
        WHERE id != ? -- 새로 저장된 기억 제외
        ORDER BY created_at DESC
        LIMIT ?
      `, [excludeId, limit]) as MemoryItemRow[];

      return rows.map((row: MemoryItemRow): MemoryItem => ({
        id: row.id,
        type: row.type as MemoryItem['type'],
        content: row.content,
        importance: row.importance,
        privacy_scope: row.privacy_scope as MemoryItem['privacy_scope'],
        created_at: new Date(row.created_at),
        last_accessed: row.last_accessed ? new Date(row.last_accessed) : undefined,
        pinned: Boolean(row.pinned),
        tags: row.tags ? JSON.parse(row.tags) : undefined,
        source: row.source || undefined,
        embedding: row.embedding ? JSON.parse(row.embedding) : undefined,
        ...(row.is_consolidated !== undefined && row.is_consolidated !== null
          ? { isConsolidated: Boolean(row.is_consolidated) }
          : {})
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
  private async getMemoryById(db: Database.Database, id: string): Promise<MemoryItem | null> {
    try {
      const row = await DatabaseUtils.get(db, `
        SELECT 
          id, type, content, importance, privacy_scope, 
          created_at, last_accessed, pinned, tags, source, embedding,
          is_consolidated
        FROM memory_item
        WHERE id = ?
      `, [id]) as MemoryItemRow | undefined;

      if (!row) {
        return null;
      }

      return {
        id: row.id,
        type: row.type as MemoryItem['type'],
        content: row.content,
        importance: row.importance,
        privacy_scope: row.privacy_scope as MemoryItem['privacy_scope'],
        created_at: new Date(row.created_at),
        last_accessed: row.last_accessed ? new Date(row.last_accessed) : undefined,
        pinned: Boolean(row.pinned),
        tags: row.tags ? JSON.parse(row.tags) : undefined,
        source: row.source || undefined,
        embedding: row.embedding ? JSON.parse(row.embedding) : undefined,
        ...(row.is_consolidated !== undefined && row.is_consolidated !== null
          ? { isConsolidated: Boolean(row.is_consolidated) }
          : {})
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
