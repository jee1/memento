/**
 * Recall Tool - 기억 검색 도구
 * 하이브리드 검색을 통한 고성능 기억 검색
 */

import { z } from 'zod';
import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';
import { CommonSchemas } from '../../../tools/types.js';
import { isMemoryItemType, type MemoryTypeRequest, type MemoryType, type EmbeddingProvider } from '../../../shared/types/index.js';
import { CoreMemoryRepository } from '../repositories/core-memory-repository.js';
import { CoreMemoryService } from '../services/core-memory-service.js';
import { CoreMemoryCacheService } from '../services/core-memory-cache-service.js';
import { KnowledgeVaultRepository } from '../repositories/knowledge-vault-repository.js';
import { KnowledgeVaultService } from '../services/knowledge-vault-service.js';
import { validateTypeParam } from '../../../shared/utils/type-param-validator.js';
import { mementoConfig } from '../../../shared/config/index.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import type { ConsolidationScoreService } from '../../../infrastructure/consolidation-score-service.js';
import type { WriteCoalescingManager } from '../../../shared/utils/write-coalescing.js';
import { MemoryNeighborService } from '../services/memory-neighbor-service.js';
import { getVectorSearchEngine } from '../../search/algorithms/vector-search-engine.js';
import { MemoryEmbeddingService } from '../services/memory-embedding-service.js';
import type { NeighborMemory } from '../services/memory-neighbor-service.js';

/**
 * 앵커 설정 메타데이터 타입
 */
export interface AnchorSetMetadata {
  memory_id: string;
  slot: 'A';
  agent_id: string;
}

/**
 * 이웃 기억 항목 타입
 */
export interface NeighborMemoryItem {
  id: string;
  content: string;
  similarity: number;
  [key: string]: any; // 추가 필드 허용
}

/**
 * Recall 응답 항목 타입 (neighbors 필드 포함)
 * 
 * @property neighbors - 이웃 기억 배열 (optional)
 *   - include_neighbors=true이고 상위 neighbors_limit개 결과에만 포함됨
 *   - neighbors_limit보다 많은 결과는 neighbors 필드가 없음 (undefined)
 *   - 이웃 기억 조회 실패 시 빈 배열 []로 설정됨
 */
export interface RecallResultItem {
  memory_id: string;
  id?: string;
  content: string;
  type: string;
  importance: number;
  created_at: string;
  final_score: number;
  neighbors?: NeighborMemoryItem[]; // optional: neighbors_limit보다 많은 결과는 필드 없음
  [key: string]: any; // 추가 필드 허용
}

/**
 * Recall 응답 메타데이터 타입
 * 
 * @property anchor_set - 앵커 설정 정보 (auto_set_anchor=true일 때만 설정)
 *   - 성공 시: {memory_id, slot: "A", agent_id} 객체
 *   - 실패/건너뜀/비활성화 시: null
 * @property anchor_set_error - 앵커 설정 실패 여부 (optional)
 *   - anchor_set=null이고 anchor_set_error=true: 앵커 설정 실패
 * @property anchor_set_skipped - 앵커 설정 건너뜀 여부 (optional)
 *   - anchor_set=null이고 anchor_set_skipped=true: 앵커 설정 건너뜀 (pinned 앵커 보호 등)
 * @property anchor_set_skipped_reason - 앵커 설정 건너뜀 사유 (optional)
 *   - "pinned_anchor_protected": 슬롯 A에 pinned 앵커가 있어서 보호됨
 */
export interface RecallResponseMetadata {
  anchor_set: AnchorSetMetadata | null;
  anchor_set_error?: boolean;
  anchor_set_skipped?: boolean;
  anchor_set_skipped_reason?: string;
  [key: string]: any; // 추가 필드 허용
}

/**
 * Recall 응답 타입
 * 
 * @example 앵커 설정 성공 + 이웃 기억 포함
 * ```json
 * {
 *   "items": [
 *     {
 *       "memory_id": "mem_12345",
 *       "content": "검색 결과 내용",
 *       "type": "episodic",
 *       "importance": 0.8,
 *       "created_at": "2024-01-01T00:00:00Z",
 *       "final_score": 0.95,
 *       "neighbors": [
 *         {
 *           "id": "mem_67890",
 *           "content": "관련 기억 내용",
 *           "similarity": 0.85
 *         }
 *       ]
 *     },
 *     {
 *       "memory_id": "mem_11111",
 *       "content": "두 번째 결과",
 *       "neighbors": []
 *     },
 *     {
 *       "memory_id": "mem_22222",
 *       "content": "세 번째 결과 (neighbors_limit 초과로 neighbors 필드 없음)"
 *     }
 *   ],
 *   "total_count": 3,
 *   "query_time": 150,
 *   "search_type": "hybrid",
 *   "metadata": {
 *     "anchor_set": {
 *       "memory_id": "mem_12345",
 *       "slot": "A",
 *       "agent_id": "default"
 *     }
 *   }
 * }
 * ```
 * 
 * @example 앵커 설정 실패
 * ```json
 * {
 *   "items": [...],
 *   "metadata": {
 *     "anchor_set": null,
 *     "anchor_set_error": true
 *   }
 * }
 * ```
 * 
 * @example 앵커 설정 건너뜀 (pinned 앵커 보호)
 * ```json
 * {
 *   "items": [...],
 *   "metadata": {
 *     "anchor_set": null,
 *     "anchor_set_skipped": true,
 *     "anchor_set_skipped_reason": "pinned_anchor_protected"
 *   }
 * }
 * ```
 * 
 * @example 앵커 설정 비활성화
 * ```json
 * {
 *   "items": [...],
 *   "metadata": {
 *     "anchor_set": null
 *   }
 * }
 * ```
 * 
 * @example 이웃 기억 미포함 (include_neighbors=false)
 * ```json
 * {
 *   "items": [
 *     {
 *       "memory_id": "mem_12345",
 *       "content": "검색 결과",
 *       "neighbors": undefined  // neighbors 필드 없음
 *     }
 *   ]
 * }
 * ```
 */
export interface RecallResponse {
  items: RecallResultItem[];
  total_count: number;
  query_time: number;
  search_type: string;
  metadata?: RecallResponseMetadata;
  [key: string]: any; // 추가 필드 허용
}

/**
 * Provider 필터 정규화 유틸리티
 * 빈 배열인 경우 undefined로 변환하여 모든 provider 검색을 의미
 * 
 * @param providerFilter - 원본 provider 필터 (빈 배열 가능)
 * @returns 정규화된 provider 필터 (undefined 또는 비어있지 않은 배열)
 */
function normalizeProviderFilter(providerFilter: EmbeddingProvider[] | undefined): EmbeddingProvider[] | undefined {
  return providerFilter && providerFilter.length > 0 ? providerFilter : undefined;
}

const RecallSchema = z.object({
  // query를 optional로 변경 (조건부 필수는 refine에서 처리)
  query: z.string().min(1, 'Query cannot be empty').optional(),
  // 새 파라미터 추가
  type: CommonSchemas.MemoryType.optional(), // 확장된 MemoryTypeRequest 사용
  key: z.string().optional(),
  agent_id: z.string().optional().default('default'),
  // 기존 파라미터 유지
  memory_types: z.array(CommonSchemas.MemoryType).optional(),
  tags: z.array(z.string()).optional(),
  privacy_scope: z.array(CommonSchemas.PrivacyScope).optional(),
  time_from: z.string().optional(),
  time_to: z.string().optional(),
  pinned: z.boolean().optional(),
  importance_min: z.number().min(0).max(1).optional(),
  importance_max: z.number().min(0).max(1).optional(),
  has_reflection_notes: z.boolean().optional(), // reflection_notes IS NOT NULL 필터링
  // Procedural Memory Enhancement (v7.0) 필드
  workflow_name: z.string().optional(),
  skill_name: z.string().optional(),
  match_trigger_conditions: z.boolean().optional().default(false),
  context: z.record(z.any()).optional(), // 구조화된 컨텍스트 정보 (trigger_conditions 매칭용, 예: {tool_name, error_type, params})
  trigger_context: z.record(z.any()).optional(), // context의 별칭 (하위 호환성)
  return_format: z.enum(['full', 'steps_only']).optional().default('full'),
  limit: CommonSchemas.Limit,
  vector_weight: z.number().min(0).max(1).optional(),
  text_weight: z.number().min(0).max(1).optional(),
  enable_hybrid: z.boolean().optional(),
  include_metadata: z.boolean().optional(),
  provider_filter: z.array(z.enum(['tfidf', 'lightweight', 'minilm', 'openai', 'gemini'] as const)).optional(),
  // 자동 앵커 설정 및 이웃 기억 포함 파라미터
  auto_set_anchor: z.boolean().optional().default(false),
  include_neighbors: z.boolean().optional().default(false),
  neighbors_limit: z.number().min(1).max(10).optional().default(3),
  neighbors_per_item: z.number().min(1).max(50).optional().default(5),
  neighbors_similarity_threshold: z.number().min(0).max(1).optional().default(0.8)
}).refine((data) => {
  // 조건부 필수 검증
  if (data.type === 'core' || data.type === 'vault') {
    // query는 선택적 (없어도 됨)
    return true;
  } else {
    // 나머지 타입은 query 필수
    if (!data.query) {
      return false;
    }
  }
  return true;
}, {
  message: "type='core' 또는 'vault'가 아닌 경우 query 파라미터는 필수입니다"
});

export class RecallTool extends BaseTool {
  constructor() {
    super(
      'recall',
      '관련 기억을 검색합니다',
      {
        type: 'object',
        properties: {
          query: { 
            type: 'string', 
            description: '검색 쿼리 (type이 core 또는 vault가 아닌 경우 필수)' 
          },
          type: { 
            type: 'string', 
            enum: ['working', 'episodic', 'semantic', 'procedural', 'core', 'vault'],
            description: '단일 메모리 타입 지정 (선택사항)'
          },
          key: { 
            type: 'string', 
            description: 'Core/Vault 조회 시 특정 키 지정 (선택사항)' 
          },
          agent_id: { 
            type: 'string', 
            description: '에이전트 ID (Core/Vault 조회 시 사용, 기본값: "default")' 
          },
          memory_types: { 
            type: 'array', 
            items: { type: 'string', enum: ['working', 'episodic', 'semantic', 'procedural', 'core', 'vault'] },
            description: '기억 타입 필터 (선택사항, type 파라미터와 동시 사용 시 type 우선). core/vault는 자동으로 제거됩니다.'
          },
          tags: { 
            type: 'array', 
            items: { type: 'string' },
            description: '태그 필터 (선택사항)'
          },
          privacy_scope: { 
            type: 'array', 
            items: { type: 'string', enum: ['private', 'team', 'public'] },
            description: '프라이버시 범위 필터 (선택사항)'
          },
          time_from: { 
            type: 'string', 
            description: '시작 시간 (ISO 8601 형식, 선택사항)'
          },
          time_to: { 
            type: 'string', 
            description: '종료 시간 (ISO 8601 형식, 선택사항)'
          },
          pinned: { 
            type: 'boolean',
            description: '핀된 기억만 검색 (선택사항)'
          },
          importance_min: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: '최소 중요도 (선택사항)'
          },
          importance_max: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: '최대 중요도 (0-1, 선택사항)'
          },
          has_reflection_notes: {
            type: 'boolean',
            description: 'reflection_notes가 있는 메모리만 조회 (true: IS NOT NULL, false: IS NULL, 선택사항)'
          },
          // Procedural Memory Enhancement (v7.0) 필드
          workflow_name: {
            type: 'string',
            description: '프로세스 이름으로 필터링 (선택사항)'
          },
          skill_name: {
            type: 'string',
            description: '기술/능력 이름으로 필터링 (선택사항)'
          },
          match_trigger_conditions: {
            type: 'boolean',
            default: false,
            description: 'trigger_conditions 매칭 여부 (기본값: false)'
          },
          return_format: {
            type: 'string',
            enum: ['full', 'steps_only'],
            default: 'full',
            description: '반환 형식 선택: full (모든 필드), steps_only (steps만 반환)'
          },
          limit: { 
            type: 'number', 
            minimum: 1, 
            maximum: 100, 
            default: 10,
            description: '최대 결과 수'
          },
          vector_weight: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            default: 0.6,
            description: '벡터 검색 가중치 (선택사항)'
          },
          text_weight: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            default: 0.4,
            description: '텍스트 검색 가중치 (선택사항)'
          },
          enable_hybrid: {
            type: 'boolean',
            default: true,
            description: '하이브리드 검색 사용 여부 (선택사항)'
          },
          include_metadata: {
            type: 'boolean',
            default: true,
            description: '메타데이터 포함 여부 (선택사항)'
          },
          provider_filter: {
            type: 'array',
            items: { type: 'string', enum: ['tfidf', 'lightweight', 'minilm', 'openai', 'gemini'] },
            description: '검색할 임베딩 provider 필터 (선택사항, 미지정 시 모든 provider 검색)'
          },
          auto_set_anchor: {
            type: 'boolean',
            default: false,
            description: '가장 관련성 높은 기억(첫 번째 결과)을 슬롯 A에 자동으로 앵커로 설정 (기본값: false)'
          },
          include_neighbors: {
            type: 'boolean',
            default: false,
            description: '검색 결과의 상위 항목에 대해 이웃 기억을 자동으로 포함 (기본값: false)'
          },
          neighbors_limit: {
            type: 'number',
            minimum: 1,
            maximum: 10,
            default: 3,
            description: '이웃 기억을 포함할 상위 결과의 개수 (각 결과당 이웃 개수는 neighbors_per_item으로 제어, 기본값: 3)'
          },
          neighbors_per_item: {
            type: 'number',
            minimum: 1,
            maximum: 50,
            default: 5,
            description: '각 검색 결과 항목당 조회할 이웃 기억의 최대 개수 (기본값: 5)'
          },
          neighbors_similarity_threshold: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            default: 0.8,
            description: '이웃 기억 조회 시 유사도 임계값 (이 값 이상인 기억만 반환, 기본값: 0.8)'
          }
        },
        required: [] // 조건부 필수는 런타임 검증 (RecallSchema.refine()에서 처리)
      }
    );
  }

  async handle(params: any, context: ToolContext): Promise<ToolResult> {
    const startTime = Date.now();
    this.logInfo('Recall 도구 호출됨', { params });
    
    try {
      // 파라미터 검증 및 파싱
      const { 
        query, 
        type,
        key,
        agent_id,
        memory_types, 
        tags, 
        privacy_scope, 
        time_from, 
        time_to, 
        pinned, 
        importance_min, 
        importance_max,
        workflow_name,
        skill_name,
        match_trigger_conditions,
        context: triggerContext,
        trigger_context,
        return_format,
        limit, 
        vector_weight, 
        text_weight, 
        enable_hybrid, 
        include_metadata,
        provider_filter,
        auto_set_anchor,
        include_neighbors,
        neighbors_limit,
        neighbors_per_item,
        neighbors_similarity_threshold
      } = RecallSchema.parse(params);
      
      // trigger_context가 제공되면 context로 사용 (하위 호환성)
      const actualTriggerContext = triggerContext || trigger_context;
      
      // type 파라미터 롤아웃 모드 검증
      // PRD 요구사항: Phase 1/2에서는 type 파라미터가 없으면 항상 경고/Deprecated 메시지를 띄워야 함
      // memory_types만 있어도 경고를 띄워야 하므로, type이 없으면 항상 검증 수행
      const typeParamMode = mementoConfig.typeParamMode;
      const originalTypeProvided = !!type; // 원래 type 파라미터가 제공되었는지 추적
      let validatedType = type;
      
      // type 파라미터가 없는 경우 항상 검증 수행 (memory_types로 우회 불가)
      if (!type) {
        const typeValidation = validateTypeParam(undefined, typeParamMode, 'recall');
        
        // error 모드에서는 에러 발생
        if (!typeValidation.isValid) {
          throw new Error(typeValidation.message || "type 파라미터는 필수입니다.");
        }
        
        // warn/deprecate 모드에서는 경고/Deprecation 메시지 출력
        // memory_types가 있어도 경고는 항상 출력되어야 함
        if (typeValidation.message) {
          if (typeParamMode === 'warn') {
            this.logWarning(typeValidation.message);
          } else if (typeParamMode === 'deprecate') {
            this.logWarning(typeValidation.message);
          }
        }
        
        // 기본값 설정 (일관성을 위해 항상 설정)
        // memory_types가 있어도 기본 타입을 설정하되, 나중에 memory_types를 사용할 때는 무시됨
        if (typeValidation.defaultType) {
          validatedType = typeValidation.defaultType as MemoryTypeRequest;
        }
      }
      
      this.logInfo('파라미터 파싱 완료', { 
        query, 
        type: validatedType,
        key,
        agent_id,
        memory_types, 
        tags, 
        privacy_scope, 
        limit, 
        vector_weight, 
        text_weight, 
        enable_hybrid,
        provider_filter
      });
      
      // 데이터베이스 연결 확인
      this.validateDatabase(context);
      
      const searchStartTime = Date.now();
      const agentId = agent_id || 'default';
      
      // type 파라미터에 따른 분기 처리
      if (validatedType === 'core') {
        // Core Memory 조회
        if (query) {
          this.logWarning('type="core"일 때 query 파라미터는 무시됩니다', { query });
        }
        if (memory_types && memory_types.length > 0) {
          this.logWarning('type="core"일 때 memory_types 파라미터는 무시됩니다', { memory_types });
        }
        
        const coreMemoryRepository = new CoreMemoryRepository(context.db!);
        const { getCoreMemoryCache } = await import('../services/core-memory-cache-service.js');
        const coreMemoryCache = getCoreMemoryCache();
        const coreMemoryService = new CoreMemoryService(coreMemoryRepository, coreMemoryCache);
        
        let records;
        if (key) {
          // 특정 키 조회
          const record = await coreMemoryService.findByKey(agentId, key);
          records = record ? [record] : [];
        } else {
          // 전체 Core Memory 조회
          records = await coreMemoryService.findByAgentId(agentId);
        }
        
        const executionTime = Date.now() - searchStartTime;
        const processedResults = records.map(record => ({
          memory_id: record.core_id,
          type: 'core',
          key: record.key,
          value: record.value,
          always_load: record.always_load,
          origin_source: record.origin_source ? JSON.parse(record.origin_source) : null,
          created_at: record.created_at,
          updated_at: record.updated_at
        }));
        
        return this.createSuccessResult({
          items: processedResults,
          total_count: processedResults.length,
          query_time: executionTime,
          search_type: 'direct'
        });
      } else if (validatedType === 'vault') {
        // Knowledge Vault 조회
        if (query) {
          this.logWarning('type="vault"일 때 query 파라미터는 무시됩니다', { query });
        }
        if (memory_types && memory_types.length > 0) {
          this.logWarning('type="vault"일 때 memory_types 파라미터는 무시됩니다', { memory_types });
        }
        
        const knowledgeVaultRepository = new KnowledgeVaultRepository(context.db!);
        const knowledgeVaultService = new KnowledgeVaultService(knowledgeVaultRepository);
        
        let records;
        if (key) {
          // 특정 키 조회 (활성 버전만)
          const record = await knowledgeVaultService.findActiveByKey(agentId, key);
          records = record ? [record] : [];
        } else {
          // 전체 Vault 조회 (활성 버전만)
          records = await knowledgeVaultService.findActiveByAgentId(agentId);
        }
        
        const executionTime = Date.now() - searchStartTime;
        const processedResults = records.map(record => ({
          memory_id: record.vault_id,
          type: 'vault',
          key: record.key,
          value: record.value,
          immutable: record.immutable,
          version: record.version,
          origin_source: record.origin_source ? JSON.parse(record.origin_source) : null,
          created_at: record.created_at,
          updated_at: record.updated_at
        }));
        
        return this.createSuccessResult({
          items: processedResults,
          total_count: processedResults.length,
          query_time: executionTime,
          search_type: 'direct'
        });
      } else {
        // 기존 memory_item 검색 로직
        // query 필수 검증
        if (!query) {
          throw new Error("query 파라미터는 필수입니다 (type='core' 또는 'vault'가 아닌 경우)");
        }
        
        // 입력 검증
        this.validateString(query, '검색 쿼리', 1000);
        this.validateNumber(limit, '결과 제한', 1, 100);
        
        // 하이브리드 검색 엔진 확인
        this.validateService(context.services.hybridSearchEngine, '하이브리드 검색 엔진');
        
        // type과 memory_types 동시 사용 시 경고
        // 원래 type 파라미터가 제공되었는지 확인 (기본값이 아닌 경우)
        if (originalTypeProvided && memory_types && memory_types.length > 0) {
          this.logWarning('type 파라미터와 memory_types를 동시에 사용했습니다. type 파라미터를 우선 적용하고 memory_types는 무시합니다.', {
            type: validatedType,
            memory_types
          });
        }
        
        // memory_types 배열 전처리 ('core'/'vault' 제거)
        // validatedType이 존재하면 항상 [validatedType]로 시작 (기본값 포함)
        // originalTypeProvided가 false이고 memory_types가 제공되면 둘 다 고려하되, validatedType 우선
        let filteredMemoryTypes: MemoryTypeRequest[] | undefined;
        if (validatedType) {
          // validatedType이 있으면 항상 사용 (기본값이든 명시적 값이든)
          filteredMemoryTypes = [validatedType];
          // originalTypeProvided가 false이고 memory_types도 제공되면 경고
          if (!originalTypeProvided && memory_types && memory_types.length > 0) {
            this.logWarning('type 파라미터가 미지정되어 기본값이 적용되었지만, memory_types도 제공되었습니다. 기본 타입을 우선 적용하고 memory_types는 무시합니다.', {
              default_type: validatedType,
              memory_types
            });
          }
        } else {
          // validatedType이 없으면 memory_types 사용
          filteredMemoryTypes = memory_types;
        }
        if (filteredMemoryTypes && filteredMemoryTypes.length > 0) {
          const invalidTypes = filteredMemoryTypes.filter(t => t === 'core' || t === 'vault');
          if (invalidTypes.length > 0) {
            this.logWarning('memory_types 배열에서 core/vault는 memory_item 검색에 사용할 수 없습니다. 자동으로 제거합니다.', {
              invalid_types: invalidTypes,
              original_memory_types: filteredMemoryTypes,
              suggestion: 'Core/Vault 조회는 단일 type 파라미터를 사용하세요.'
            });
            filteredMemoryTypes = filteredMemoryTypes.filter(t => t !== 'core' && t !== 'vault') as MemoryTypeRequest[];
            if (filteredMemoryTypes.length === 0) {
              throw new Error("memory_types 배열에 유효한 타입이 없습니다. 'core'와 'vault'는 memory_types에서 사용할 수 없습니다. 단일 type 파라미터를 사용하여 Core/Vault를 조회하세요.");
            }
          }
          
          // 타입 가드 적용: MemoryTypeRequest[] -> MemoryType[]
          const validMemoryTypes = filteredMemoryTypes.filter((t): t is MemoryType => isMemoryItemType(t));
          if (validMemoryTypes.length === 0) {
            throw new Error("memory_types 배열에 유효한 타입이 없습니다.");
          }
          filteredMemoryTypes = validMemoryTypes;
        }
        
        // agent_id 파라미터 무시 경고
        if (agent_id) {
          this.logWarning('memory_item 검색 시 agent_id 파라미터는 무시됩니다', { agent_id });
        }
        
        // 필터 객체 재구성
        const filters = {
          type: filteredMemoryTypes,
          tags,
          privacy_scope,
          time_from,
          time_to,
          pinned,
          importance_min,
          importance_max,
          has_reflection_notes: params.has_reflection_notes,
          // Procedural Memory Enhancement (v7.0) 필터
          workflow_name,
          skill_name
        };
        
        // 검색 옵션 설정
        const vectorWeight = vector_weight ?? 0.6;
        const textWeight = text_weight ?? 0.4;
        const enableHybrid = enable_hybrid ?? true;
        const includeMetadata = include_metadata ?? true;
        
        // 가중치 정규화
        const totalWeight = vectorWeight + textWeight;
        const normalizedVectorWeight = totalWeight > 0 ? vectorWeight / totalWeight : 0.6;
        const normalizedTextWeight = totalWeight > 0 ? textWeight / totalWeight : 0.4;
        
        let searchResult;
        
        try {
          if (enableHybrid && context.services.hybridSearchEngine.isEmbeddingAvailable()) {
            // 하이브리드 검색 (텍스트 + 벡터)
            this.logInfo('하이브리드 검색 실행', { 
              query, 
              vectorWeight: normalizedVectorWeight, 
              textWeight: normalizedTextWeight 
            });
            
            // provider_filter는 zod 스키마에서 이미 EmbeddingProvider[] 타입으로 파싱됨
            // 빈 배열인 경우 undefined로 처리하여 모든 provider 검색
            const providerFilter = normalizeProviderFilter(provider_filter);
            
            searchResult = await context.services.hybridSearchEngine.search(context.db, {
              query,
              filters,
              limit,
              vectorWeight: normalizedVectorWeight,
              textWeight: normalizedTextWeight,
              provider_filter: providerFilter,
              match_trigger_conditions: match_trigger_conditions,
              context: actualTriggerContext // 구조화된 컨텍스트 정보 전달
            });
          } else {
            // 텍스트 검색만 사용
            if (!context.services.searchEngine) {
              throw new Error('텍스트 검색 엔진을 사용할 수 없습니다');
            }
            
            this.logInfo('텍스트 검색 실행', { query });
            
            searchResult = await context.services.searchEngine.search(context.db, {
              query,
              filters,
              limit
            });
          }
        } catch (searchError) {
          this.logError(searchError as Error, '검색 실행 중 오류', { query, enableHybrid });
          throw new Error(`검색 실행 실패: ${(searchError as Error).message}`);
        }
        
        const executionTime = Date.now() - searchStartTime;
        
        // 검색 결과 가져오기
        let searchItems = searchResult?.items || [];
        
        // trigger_conditions 매칭 필터링 (match_trigger_conditions=true일 때)
        if (match_trigger_conditions && searchItems.length > 0) {
          searchItems = this.filterByTriggerConditions(searchItems, query, actualTriggerContext);
        }
        
        // Consolidation Score System 업데이트 (기능 플래그 확인)
        if (mementoConfig.consolidationScoreEnabled && context.services.consolidationScoreService && searchItems.length > 0) {
          await this.updateConsolidationScoreMetadata(
            context.db!,
            context.services.consolidationScoreService,
            context.services.writeCoalescingManager,
            searchItems
          );
        }
        
        // 결과 후처리 - searchResult가 undefined인 경우 처리
        const processedResults = this.processSearchResults(searchItems, includeMetadata, return_format);
        
        // 자동 앵커 설정 처리 (auto_set_anchor=true이고 검색 결과가 있을 때)
        let anchorSetResult: {
          success: boolean;
          anchor_set: AnchorSetMetadata | null;
          error?: boolean;
          skipped?: boolean;
          skipped_reason?: string;
        } | null = null;
        
        if (auto_set_anchor && searchItems.length > 0) {
          anchorSetResult = await this.handleAutoSetAnchor(searchItems, agentId, context);
        }
        
        // 자동 이웃 기억 포함 처리 (include_neighbors=true이고 검색 결과가 있을 때)
        let neighborsResults: NeighborMemory[][] = [];
        
        if (include_neighbors && searchItems.length > 0) {
          neighborsResults = await this.handleIncludeNeighbors(
            searchItems,
            neighbors_limit,
            neighbors_per_item,
            neighbors_similarity_threshold,
            context
          );
          
          // 검색 결과 항목에 neighbors 필드 추가
          // neighbors_limit보다 많은 결과는 neighbors 필드 없음 (handleIncludeNeighbors가 상위 neighbors_limit개만 처리)
          for (let i = 0; i < Math.min(neighborsResults.length, processedResults.length); i++) {
            processedResults[i].neighbors = neighborsResults[i];
          }
        }
        
        this.logInfo('검색 완료', { 
          resultCount: processedResults.length, 
          executionTime,
          searchType: enableHybrid ? 'hybrid' : 'text'
        });
        
        // 메타데이터 구성 (앵커 설정 결과 포함)
        const metadata: RecallResponseMetadata = {
          anchor_set: anchorSetResult?.anchor_set || null
        };
        
        // 앵커 설정 실패 시
        if (anchorSetResult && anchorSetResult.error) {
          metadata.anchor_set_error = true;
        }
        
        // 앵커 설정 건너뜀 시
        if (anchorSetResult && anchorSetResult.skipped) {
          metadata.anchor_set_skipped = true;
          metadata.anchor_set_skipped_reason = anchorSetResult.skipped_reason;
        }
        
        return this.createSuccessResult({
          items: processedResults,
          total_count: searchResult?.total_count || processedResults.length,
          query_time: executionTime,
          search_type: enableHybrid ? 'hybrid' : 'text',
          vector_search_available: context.services.hybridSearchEngine?.isEmbeddingAvailable() || false,
          filters_applied: this.getAppliedFilters(filters),
          search_options: {
            vector_weight: normalizedVectorWeight,
            text_weight: normalizedTextWeight,
            enable_hybrid: enableHybrid
          },
          metadata
        });
      }
      
    } catch (error) {
      this.logError(error as Error, 'Recall 도구 실행 실패', { params });
      
      // 실패 감지 훅 호출
      const executionTime = Date.now() - startTime;
      await this.handleFailure(
        error instanceof Error ? error : new Error(String(error)),
        params,
        context,
        executionTime
      );
      
      // 사용자 친화적인 에러 메시지 반환
      if (error instanceof Error) {
        if (error.message.includes('validation')) {
          throw new Error(`입력 검증 실패: ${error.message}`);
        } else if (error.message.includes('database')) {
          throw new Error(`데이터베이스 오류: ${error.message}`);
        } else if (error.message.includes('search')) {
          throw new Error(`검색 오류: ${error.message}`);
        }
      }
      
      throw error;
    }
  }

  /**
   * trigger_conditions로 필터링
   * match_trigger_conditions=true일 때, 현재 컨텍스트와 trigger_conditions가 매칭되는 항목만 반환
   * 
   * PRD 요구사항: 구조화된 컨텍스트(예: tool_name, error_type, params)와 JSON 매칭
   * 구조화된 컨텍스트가 제공되면 이를 우선 사용하고, 없으면 쿼리 텍스트를 사용
   * 
   * @param items 검색 결과 항목 배열
   * @param query 검색 쿼리 (컨텍스트로 사용, fallback)
   * @param context 구조화된 컨텍스트 정보 (우선 사용)
   * @returns 필터링된 항목 배열
   */
  private filterByTriggerConditions(items: any[], query?: string, triggerContext?: Record<string, any>): any[] {
    const queryText = query?.toLowerCase() || '';
    
    return items.filter(item => {
      // trigger_conditions가 없는 항목은 제외
      if (!item.trigger_conditions) {
        return false;
      }
      
      try {
        // JSON 파싱 시도
        const parsed = typeof item.trigger_conditions === 'string'
          ? JSON.parse(item.trigger_conditions)
          : item.trigger_conditions;
        
        // 객체인지 확인 (배열이나 null이 아닌 경우)
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          return false;
        }
        
        // 구조화된 컨텍스트가 제공된 경우: 키-값 기반 정확 매칭
        // 모든 키/값 쌍이 매칭되어야 함 (첫 번째 키만 맞으면 통과하는 문제 수정)
        if (triggerContext && Object.keys(triggerContext).length > 0) {
          // trigger_conditions의 모든 키-값 쌍이 컨텍스트와 매칭되는지 확인
          for (const [key, value] of Object.entries(parsed)) {
            const contextValue = triggerContext[key];
            
            // trigger_conditions에 있는 키가 컨텍스트에 없으면 매칭 실패
            if (contextValue === undefined) {
              return false;
            }
            
            // 값이 객체인 경우 재귀적으로 비교
            if (typeof value === 'object' && typeof contextValue === 'object' && value !== null && contextValue !== null) {
              // 중첩 객체 매칭: context의 값이 trigger_conditions의 값과 부분적으로 일치하는지 확인
              const valueStr = JSON.stringify(value).toLowerCase();
              const contextStr = JSON.stringify(contextValue).toLowerCase();
              if (!(valueStr.includes(contextStr) || contextStr.includes(valueStr))) {
                // 하나라도 매칭되지 않으면 실패
                return false;
              }
            } else {
              // 단순 값 매칭: 문자열로 변환하여 비교
              const valueStr = String(value).toLowerCase();
              const contextStr = String(contextValue).toLowerCase();
              if (!(valueStr === contextStr || valueStr.includes(contextStr) || contextStr.includes(valueStr))) {
                // 하나라도 매칭되지 않으면 실패
                return false;
              }
            }
          }
          // 모든 키/값 쌍이 매칭됨
          return true;
        }
        
        // 구조화된 컨텍스트가 없는 경우: 쿼리 텍스트 기반 매칭 (fallback)
        if (queryText) {
          // 키 매칭: tool_name, error_type, params 등 구조화된 필드명과 매칭
          const triggerKeys = Object.keys(parsed).map(k => k.toLowerCase());
          const triggerValues = Object.values(parsed).map(v => String(v).toLowerCase());
          
          // 키 또는 값 중 하나라도 쿼리와 매칭되면 통과
          const keyMatch = triggerKeys.some(k => k.includes(queryText) || queryText.includes(k));
          const valueMatch = triggerValues.some(v => v.includes(queryText) || queryText.includes(v));
          return keyMatch || valueMatch;
        }
        
        // 쿼리와 컨텍스트가 모두 없으면 매칭 기준이 없으므로 필터링
        // PRD: "현재 컨텍스트와 매칭" 요구사항 - 매칭 기준이 없으면 통과하지 않음
        return false;
      } catch (error) {
        // JSON 파싱 실패 시 제외
        return false;
      }
    });
  }

  /**
   * 검색 결과 후처리
   */
  private processSearchResults(items: any[], includeMetadata: boolean, returnFormat: 'full' | 'steps_only' = 'full'): any[] {
    return items.map(item => {
      const processed: any = {
        memory_id: item.id || item.memory_id, // 통일된 필드명 사용
        id: item.id, // 하위 호환성을 위해 유지
        content: item.content,
        type: item.type,
        importance: item.importance,
        created_at: item.created_at,
        final_score: item.finalScore || item.score || 0
      };

      if (includeMetadata) {
        processed.last_accessed = item.last_accessed;
        processed.pinned = item.pinned;
        processed.tags = item.tags;
        processed.source = item.source;
        processed.privacy_scope = item.privacy_scope;
        
        // origin_source 필드 추가 (JSON 파싱)
        if (item.origin_source) {
          try {
            processed.origin_source = typeof item.origin_source === 'string' 
              ? JSON.parse(item.origin_source) 
              : item.origin_source;
          } catch (error) {
            // JSON 파싱 실패 시 원본 문자열 반환
            processed.origin_source = item.origin_source;
          }
        }
        
        // Procedural Memory 전용 필드 추가
        if (item.type === 'procedural') {
          processed.task_goal = item.task_goal || null;
          processed.steps = item.steps || null;
          
          // Procedural Memory Enhancement (v7.0) 필드 추가
          processed.workflow_name = item.workflow_name || null;
          processed.skill_name = item.skill_name || null;
          processed.trigger_conditions = item.trigger_conditions || null;
          
          // reflection_notes 필드 추가 (JSON 파싱)
          if (item.reflection_notes) {
            try {
              // reflection_notes JSON 파싱 (문자열 → 객체/배열 변환)
              processed.reflection_notes = typeof item.reflection_notes === 'string'
                ? JSON.parse(item.reflection_notes)
                : item.reflection_notes;
            } catch (error) {
              // JSON 파싱 실패 시 원본 문자열 반환
              processed.reflection_notes = item.reflection_notes;
            }
          } else {
            processed.reflection_notes = null;
          }
          
          // return_format='steps_only'일 때 steps만 반환
          if (returnFormat === 'steps_only') {
            // steps만 포함하고 나머지 필드는 제거
            return {
              memory_id: processed.memory_id,
              id: processed.id,
              steps: processed.steps
            };
          }
        }
        
        if (item.textScore !== undefined) {
          processed.text_score = item.textScore;
        }
        if (item.vectorScore !== undefined) {
          processed.vector_score = item.vectorScore;
        }
        if (item.recall_reason) {
          processed.recall_reason = item.recall_reason;
        }
        
        // Consolidation Score 포함 (기능 플래그 활성화 시)
        if (mementoConfig.consolidationScoreEnabled && item.consolidation_score !== undefined) {
          processed.consolidation_score = item.consolidation_score;
        }
      }

      return processed;
    });
  }

  /**
   * 적용된 필터 정보 반환
   */
  private getAppliedFilters(filters?: any): any {
    if (!filters) return {};
    
    const applied: any = {};
    
    if (filters.type && filters.type.length > 0) {
      applied.type = filters.type;
    }
    if (filters.tags && filters.tags.length > 0) {
      applied.tags = filters.tags;
    }
    if (filters.privacy_scope && filters.privacy_scope.length > 0) {
      applied.privacy_scope = filters.privacy_scope;
    }
    if (filters.time_from) {
      applied.time_from = filters.time_from;
    }
    if (filters.time_to) {
      applied.time_to = filters.time_to;
    }
    if (filters.pinned !== undefined) {
      applied.pinned = filters.pinned;
    }
    if (filters.importance_min !== undefined) {
      applied.importance_min = filters.importance_min;
    }
    if (filters.importance_max !== undefined) {
      applied.importance_max = filters.importance_max;
    }
    if (filters.has_reflection_notes !== undefined) {
      applied.has_reflection_notes = filters.has_reflection_notes;
    }
    
    return applied;
  }

  /**
   * 자동 앵커 설정 처리
   * 가장 관련성 높은 기억(첫 번째 결과)을 슬롯 A에 앵커로 설정
   * 
   * @param searchItems - 검색 결과 항목 배열
   * @param agentId - 에이전트 ID
   * @param context - 도구 컨텍스트
   * @returns 앵커 설정 결과 (성공/실패/건너뜀 상태 포함)
   */
  private async handleAutoSetAnchor(
    searchItems: any[],
    agentId: string,
    context: ToolContext
  ): Promise<{
    success: boolean;
    anchor_set: AnchorSetMetadata | null;
    error?: boolean;
    skipped?: boolean;
    skipped_reason?: string;
  }> {
    // 검색 결과가 없으면 앵커 설정 불가
    if (!searchItems || searchItems.length === 0) {
      return {
        success: false,
        anchor_set: null
      };
    }

    // 첫 번째 결과의 memory_id 가져오기
    const topMemory = searchItems[0];
    const memoryId = topMemory.id || topMemory.memory_id;
    
    if (!memoryId) {
      this.logWarning('검색 결과에 memory_id가 없어 앵커 설정을 건너뜁니다', { topMemory });
      return {
        success: false,
        anchor_set: null,
        error: true
      };
    }

    // AnchorManager 서비스 확인
    if (!context.services.anchorManager) {
      this.logWarning('AnchorManager 서비스가 없어 앵커 설정을 건너뜁니다');
      return {
        success: false,
        anchor_set: null,
        error: true
      };
    }

    try {
      // 슬롯 A의 앵커 조회 및 pinned 상태 확인 (memory_item 테이블과 조인)
      const slotAAnchor = await context.services.anchorManager.getAnchor(agentId, 'A');
      
      if (slotAAnchor && typeof slotAAnchor === 'object' && 'memory_id' in slotAAnchor) {
        // pinned 상태 확인 (memory_item 테이블과 조인)
        const anchorMemory = context.db!.prepare(`
          SELECT pinned FROM memory_item WHERE id = ?
        `).get(slotAAnchor.memory_id) as { pinned: number | boolean } | undefined;

        const isPinned = anchorMemory && (anchorMemory.pinned === 1 || anchorMemory.pinned === true);

        // 슬롯 A에 pinned 앵커가 있으면 건너뛰기 (보호 정책)
        if (isPinned) {
          this.logInfo('슬롯 A에 pinned 앵커가 있어 앵커 설정을 건너뜁니다', {
            agent_id: agentId,
            existing_memory_id: slotAAnchor.memory_id
          });
          return {
            success: false,
            anchor_set: null,
            skipped: true,
            skipped_reason: 'pinned_anchor_protected'
          };
        }

        // 슬롯 A에 일반 앵커가 있으면 슬롯 B로 이동
        const slotBAnchor = await context.services.anchorManager.getAnchor(agentId, 'B');
        
        if (slotBAnchor && typeof slotBAnchor === 'object' && 'memory_id' in slotBAnchor) {
          // 슬롯 B의 pinned 상태 확인
          const slotBMemory = context.db!.prepare(`
            SELECT pinned FROM memory_item WHERE id = ?
          `).get(slotBAnchor.memory_id) as { pinned: number | boolean } | undefined;

          const slotBIsPinned = slotBMemory && (slotBMemory.pinned === 1 || slotBMemory.pinned === true);

          if (slotBIsPinned) {
            this.logWarning('슬롯 B의 pinned 앵커가 덮어써집니다', {
              agent_id: agentId,
              old_memory_id: slotBAnchor.memory_id,
              new_memory_id: slotAAnchor.memory_id
            });
          }

          // 슬롯 B에 앵커가 있으면 슬롯 C로 이동
          const slotCAnchor = await context.services.anchorManager.getAnchor(agentId, 'C');
          let slotCWasPinned = false;
          
          if (slotCAnchor && typeof slotCAnchor === 'object' && 'memory_id' in slotCAnchor) {
            // 슬롯 C의 pinned 상태 확인
            const slotCMemory = context.db!.prepare(`
              SELECT pinned FROM memory_item WHERE id = ?
            `).get(slotCAnchor.memory_id) as { pinned: number | boolean } | undefined;

            const slotCIsPinned = slotCMemory && (slotCMemory.pinned === 1 || slotCMemory.pinned === true);

            if (slotCIsPinned) {
              this.logWarning('슬롯 C의 pinned 앵커가 제거됩니다', {
                agent_id: agentId,
                old_memory_id: slotCAnchor.memory_id
              });
              slotCWasPinned = true;
            }

            // 슬롯 C에 앵커가 있으면 제거
            await context.services.anchorManager.clearAnchor(agentId, 'C');
          }

          // 슬롯 C에 pinned 앵커가 있었던 경우, 슬롯 B의 앵커를 슬롯 C로 이동하지 않음
          // (슬롯 C는 비워둠)
          if (!slotCWasPinned) {
            // 슬롯 B의 기존 앵커를 슬롯 C로 이동 (슬롯 B를 비우기 위해)
            // 먼저 슬롯 B를 제거한 후 슬롯 C에 설정
            const slotBMemoryId = slotBAnchor.memory_id;
            await context.services.anchorManager.clearAnchor(agentId, 'B');
            await context.services.anchorManager.setAnchor(agentId, slotBMemoryId, 'C');
          } else {
            // 슬롯 C에 pinned 앵커가 있었던 경우, 슬롯 B의 앵커는 제거됨
            await context.services.anchorManager.clearAnchor(agentId, 'B');
          }
        }

        // 슬롯 A의 앵커를 슬롯 B로 이동
        // 먼저 슬롯 A를 제거한 후 슬롯 B에 설정
        const slotAMemoryId = slotAAnchor.memory_id;
        await context.services.anchorManager.clearAnchor(agentId, 'A');
        await context.services.anchorManager.setAnchor(agentId, slotAMemoryId, 'B');
      }

      // 새로운 기억을 슬롯 A에 설정
      await context.services.anchorManager.setAnchor(agentId, memoryId, 'A');

      this.logInfo('앵커가 자동으로 설정되었습니다', {
        agent_id: agentId,
        memory_id: memoryId,
        slot: 'A'
      });

      return {
        success: true,
        anchor_set: {
          memory_id: memoryId,
          slot: 'A',
          agent_id: agentId
        }
      };
    } catch (error) {
      // 앵커 설정 실패 시 경고만 로그하고 검색 결과는 정상 반환
      this.logError(error as Error, '앵커 자동 설정 실패', {
        agent_id: agentId,
        memory_id: memoryId
      });
      
      return {
        success: false,
        anchor_set: null,
        error: true
      };
    }
  }

  /**
   * 자동 이웃 기억 포함 처리
   * 검색 결과의 상위 항목에 대해 이웃 기억을 자동으로 포함
   * 
   * @param searchItems - 검색 결과 항목 배열
   * @param neighborsLimit - 이웃 기억을 포함할 상위 결과의 개수
   * @param neighborsPerItem - 각 검색 결과 항목당 조회할 이웃 기억의 최대 개수
   * @param neighborsSimilarityThreshold - 이웃 기억 조회 시 유사도 임계값
   * @param context - 도구 컨텍스트
   * @returns 각 검색 결과 항목에 대한 이웃 기억 배열 (순서 보존)
   */
  private async handleIncludeNeighbors(
    searchItems: any[],
    neighborsLimit: number,
    neighborsPerItem: number,
    neighborsSimilarityThreshold: number,
    context: ToolContext
  ): Promise<NeighborMemory[][]> {
    // 검색 결과가 없으면 빈 배열 반환
    if (!searchItems || searchItems.length === 0) {
      return [];
    }

    // 상위 neighbors_limit개 결과 추출 (검색 결과 개수보다 작으면 검색 결과 개수로 제한)
    const topResults = searchItems.slice(0, Math.min(neighborsLimit, searchItems.length));

    // MemoryNeighborService 인스턴스 생성
    let neighborService: MemoryNeighborService;
    try {
      const vectorSearchEngine = getVectorSearchEngine();
      const embeddingService = context.services.embeddingService || new MemoryEmbeddingService();
      neighborService = new MemoryNeighborService(vectorSearchEngine, embeddingService);
      neighborService.setDatabase(context.db!);
    } catch (error) {
      this.logError(error as Error, 'MemoryNeighborService 초기화 실패', {});
      // 서비스 초기화 실패 시 빈 배열 반환
      return new Array(topResults.length).fill([]);
    }

    // 각 상위 결과에 대해 이웃 기억 조회를 병렬 처리
    const neighborPromises = topResults.map(async (item, index) => {
      const memoryId = item.id || item.memory_id;
      
      if (!memoryId) {
        this.logWarning('검색 결과에 memory_id가 없어 이웃 기억 조회를 건너뜁니다', { item });
        return { index, neighbors: [] };
      }

      try {
        // 개별 이웃 기억 조회에 타임아웃 적용 (각 조회당 최대 2초)
        const timeoutPromise = new Promise<{ index: number; neighbors: NeighborMemory[] }>((_, reject) => {
          setTimeout(() => reject(new Error('Timeout')), 2000);
        });

        const neighborPromise = neighborService.getNeighbors(memoryId, {
          limit: neighborsPerItem,
          similarity_threshold: neighborsSimilarityThreshold
        }).then(result => ({
          index,
          neighbors: result.neighbors
        }));

        const result = await Promise.race([neighborPromise, timeoutPromise]);
        return result;
      } catch (error) {
        // 타임아웃 또는 에러 발생 시 빈 배열 반환
        if (error instanceof Error && error.message === 'Timeout') {
          this.logWarning('이웃 기억 조회 타임아웃', { memoryId, index });
        } else {
          this.logError(error as Error, '이웃 기억 조회 실패', { memoryId, index });
        }
        return { index, neighbors: [] };
      }
    });

    // 전체 요청 타임아웃 적용 (2.5초, 부분 성공 결과 반환)
    let timeoutId: NodeJS.Timeout | null = null;
    const timeoutPromise = new Promise<Array<{ index: number; neighbors: NeighborMemory[] }>>((resolve) => {
      timeoutId = setTimeout(() => {
        // 타임아웃 시 현재까지 완료된 결과만 반환
        Promise.allSettled(neighborPromises).then(results => {
          resolve(results.map((r, idx) => 
            r.status === 'fulfilled' 
              ? r.value 
              : { index: idx, neighbors: [] } // 원래 인덱스 유지
          ));
        });
      }, 2500); // 전체 타임아웃: 2.5초
    });

    try {
      const allNeighbors = await Promise.race([
        Promise.all(neighborPromises),
        timeoutPromise
      ]);

      // 타임아웃 취소
      if (timeoutId) clearTimeout(timeoutId);

      // 결과를 원래 순서로 정렬 (인덱스 기준)
      const sortedNeighbors = allNeighbors
        .sort((a, b) => a.index - b.index)
        .map(r => r.neighbors);

      return sortedNeighbors;
    } catch (error) {
      // 타임아웃 취소
      if (timeoutId) clearTimeout(timeoutId);
      
      // 타임아웃 시에도 부분 완료 결과는 반환됨 (timeoutPromise에서 처리)
      // 완료된 결과만 반환
      const settledResults = await Promise.allSettled(neighborPromises);
      return settledResults.map((r, idx) => 
        r.status === 'fulfilled' 
          ? r.value.neighbors 
          : [] // 실패한 항목은 빈 배열
      );
    }
  }

  /**
   * 검색 쿼리 검증
   */
  private validateQuery(query: string): void {
    if (!query || query.trim().length === 0) {
      throw new Error('검색 쿼리는 비어있을 수 없습니다');
    }
    
    if (query.length > 1000) {
      throw new Error('검색 쿼리가 너무 깁니다 (최대 1000자)');
    }
    
    // 특수 문자 검증
    const dangerousPatterns = [
      /<script/i,
      /javascript:/i,
      /on\w+\s*=/i
    ];
    
    for (const pattern of dangerousPatterns) {
      if (pattern.test(query)) {
        throw new Error('검색 쿼리에 허용되지 않는 문자가 포함되어 있습니다');
      }
    }
  }

  /**
   * 필터 검증
   */
  private validateFilters(filters?: any): void {
    if (!filters) return;
    
    // 시간 범위 검증
    if (filters.time_from && filters.time_to) {
      const fromDate = new Date(filters.time_from);
      const toDate = new Date(filters.time_to);
      
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        throw new Error('유효하지 않은 시간 형식입니다');
      }
      
      if (fromDate > toDate) {
        throw new Error('시작 시간은 종료 시간보다 이전이어야 합니다');
      }
    }
    
    // 중요도 범위 검증
    if (filters.importance_min !== undefined && filters.importance_max !== undefined) {
      if (filters.importance_min > filters.importance_max) {
        throw new Error('최소 중요도는 최대 중요도보다 작거나 같아야 합니다');
      }
    }
  }

  /**
   * Consolidation Score 메타데이터 업데이트
   * 검색 결과로 반환된 메모리들의 recall_count, last_accessed_at, g_value 업데이트
   * Write Coalescing을 사용하여 I/O 부하를 줄입니다.
   * 
   * @param db 데이터베이스 연결
   * @param consolidationScoreService Consolidation Score 서비스
   * @param writeCoalescingManager Write Coalescing Manager (선택적)
   * @param searchItems 검색 결과 아이템 배열
   */
  private async updateConsolidationScoreMetadata(
    db: any,
    consolidationScoreService: ConsolidationScoreService,
    writeCoalescingManager: WriteCoalescingManager | undefined,
    searchItems: any[]
  ): Promise<void> {
    if (!searchItems || searchItems.length === 0) {
      return;
    }

    try {
      const now = new Date();
      const nowISO = now.toISOString();

      // 각 검색 결과에 대해 업데이트
      for (const item of searchItems) {
        const memoryId = item.id || item.memory_id;
        if (!memoryId) {
          continue; // ID가 없으면 스킵
        }

        try {
          // 기존 메모리 정보 조회 (recall_count, last_accessed_at, g_value, created_at, type, pinned)
          const memory = DatabaseUtils.get(
            db,
            `SELECT 
              recall_count, 
              last_accessed_at, 
              g_value, 
              created_at, 
              type, 
              pinned 
            FROM memory_item 
            WHERE id = ?`,
            [memoryId]
          ) as {
            recall_count: number;
            last_accessed_at: string | null;
            g_value: number | null;
            created_at: string;
            type: MemoryType;
            pinned: boolean | number;
          } | undefined;

          if (!memory) {
            this.logWarning(`메모리를 찾을 수 없습니다: ${memoryId}`);
            continue;
          }

          // recall_count 증가
          const newRecallCount = (memory.recall_count || 0) + 1;

          // 경과 시간 계산 (last_accessed_at이 있으면 사용, 없으면 created_at 사용)
          const lastAccessedAt = memory.last_accessed_at 
            ? new Date(memory.last_accessed_at) 
            : new Date(memory.created_at);
          const timeElapsed = consolidationScoreService.calculateTimeElapsed(
            lastAccessedAt,
            new Date(memory.created_at),
            now
          );

          // g_value 업데이트
          const newGValue = consolidationScoreService.updateGValueForRecall({
            previousGValue: memory.g_value,
            timeElapsed
          });

          // consolidation_score 계산
          const scoreResult = consolidationScoreService.calculateScore({
            recallCount: newRecallCount,
            lastAccessedAt: now,
            createdAt: new Date(memory.created_at),
            gValue: newGValue,
            type: memory.type,
            pinned: memory.pinned === 1 || memory.pinned === true
          });

          // Write Coalescing 사용 여부 확인
          if (writeCoalescingManager) {
            // 버퍼에 추가 (주기적으로 flush됨)
            writeCoalescingManager.addWrite({
              memoryId,
              fields: {
                recall_count: newRecallCount,
                last_accessed_at: nowISO,
                g_value: newGValue,
                consolidation_score: scoreResult.score
              }
            });
          } else {
            // Write Coalescing이 없으면 즉시 업데이트
            DatabaseUtils.run(
              db,
              `UPDATE memory_item 
               SET 
                 recall_count = ?,
                 last_accessed_at = ?,
                 g_value = ?,
                 consolidation_score = ?
               WHERE id = ?`,
              [newRecallCount, nowISO, newGValue, scoreResult.score, memoryId]
            );
          }

        } catch (error) {
          // 개별 메모리 업데이트 실패해도 다른 메모리는 계속 업데이트
          this.logWarning(`메모리 업데이트 실패 (${memoryId})`, {
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    } catch (error) {
      // 전체 업데이트 실패해도 검색 결과는 정상 반환
      this.logError(error as Error, 'Consolidation Score 메타데이터 업데이트 실패', {
        itemCount: searchItems.length
      });
    }
  }
}