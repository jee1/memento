/**
 * Recall 도구 Zod 스키마 및 파생 타입 (recall-tool.ts에서 분리, #350).
 */

import { z } from 'zod';
import type { EmbeddingProvider } from '../../../shared/types/index.js';
import { CommonSchemas } from '../../../tools/types.js';
import type { HybridSearchEngine } from '../../search/algorithms/hybrid-search-engine.js';
import type { SearchEngine } from '../../search/algorithms/search-engine.js';
import { recallTelemetryRetrievalStrategy } from './recall-tool-telemetry.js';

/**
 * Provider 필터 정규화 유틸리티
 * 빈 배열인 경우 undefined로 변환하여 모든 provider 검색을 의미
 *
 * @param providerFilter - 원본 provider 필터 (빈 배열 가능)
 * @returns 정규화된 provider 필터 (undefined 또는 비어있지 않은 배열)
 */
export function normalizeProviderFilter(
  providerFilter: EmbeddingProvider[] | undefined
): EmbeddingProvider[] | undefined {
  return providerFilter && providerFilter.length > 0 ? providerFilter : undefined;
}

/** hybrid vs text-only 검색 엔진 반환형 공통 처리용 */
export type RecallHybridOrTextSearchResult =
  | Awaited<ReturnType<HybridSearchEngine['search']>>
  | Awaited<ReturnType<SearchEngine['search']>>;

export type RecallTelemetryRetrievalStrategy = ReturnType<typeof recallTelemetryRetrievalStrategy>;

export const RecallSchema = z
  .object({
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
    context: z.record(z.string(), z.unknown()).optional(), // 구조화된 컨텍스트 정보 (trigger_conditions 매칭용, 예: {tool_name, error_type, params})
    trigger_context: z.record(z.string(), z.unknown()).optional(), // context의 별칭 (하위 호환성)
    return_format: z.enum(['full', 'steps_only']).optional().default('full'),
    limit: CommonSchemas.Limit,
    vector_weight: z.number().min(0).max(1).optional(),
    text_weight: z.number().min(0).max(1).optional(),
    enable_hybrid: z.boolean().optional(),
    include_metadata: z.boolean().optional(),
    provider_filter: z.array(z.enum(['tfidf', 'lightweight', 'minilm', 'openai', 'gemini'] as const)).optional(),
    // 자동 앵커 설정 및 이웃 기억 포함 파라미터
    auto_set_anchor: z.boolean().optional(),
    include_neighbors: z.boolean().optional().default(false),
    neighbors_limit: z.number().min(1).max(10).optional().default(3),
    neighbors_per_item: z.number().min(1).max(50).optional().default(5),
    neighbors_similarity_threshold: z.number().min(0).max(1).optional().default(0.8),
    // Procedural Version Management (Issue #57 Phase 2)
    version_filter: z.enum(['latest_only', 'all_versions', 'specific_version']).optional(),
    version_series_id: z.string().optional(),
    version_number: z.number().int().min(1).optional(),
    include_version_chain: z.boolean().optional(),
    /** 다중 에이전트: 소유자 ID 필터 (단일 또는 배열). 미설정 시 전체 조회 */
    owner_id: z.union([z.string(), z.array(z.string())]).optional(),
    /** Memori Attribution: 프로세스 ID 필터 (Issue #87) */
    process_id: z.union([z.string(), z.array(z.string())]).optional(),
    /** Memori Attribution: 세션 ID 필터 (Issue #87) */
    session_id: z.union([z.string(), z.array(z.string())]).optional(),
    /** Project-scoped Memory: 프로젝트 ID 필터 (Issue #81) */
    project_id: z
      .string()
      .max(200)
      .optional()
      .describe('이 project_id로 저장된 기억만 검색. 미지정 시 전체 검색'),
    include_diff_with: z.string().optional(), // 'previous' 또는 비교할 메모리 id
    include_score_breakdown: z.boolean().optional().default(false)
  })
  .refine(
    (data) => {
      // 조건부 필수 검증
      if (data.type === 'core' || data.type === 'vault') {
        // query는 선택적 (없어도 됨)
        return true;
      } else {
        // memory_types만 제공되고 type이 없는 경우, query는 선택적
        // (memory_types로 필터링만 할 수 있음)
        if (!data.type && data.memory_types && data.memory_types.length > 0) {
          // memory_types가 제공되었고, core/vault가 아닌 경우 query는 선택적
          // 단, core/vault만 있는 경우는 query가 필요 없음 (하지만 이미 위에서 처리됨)
          const hasNonCoreVaultTypes = data.memory_types.some((t) => t !== 'core' && t !== 'vault');
          if (!hasNonCoreVaultTypes) {
            // core/vault만 있으면 query 불필요
            return true;
          }
          // core/vault가 아닌 타입이 있으면 query 필수
          if (!data.query) {
            return false;
          }
        } else {
          // type이 있거나 memory_types가 없는 경우, query 필수
          if (!data.query) {
            return false;
          }
        }
      }
      return true;
    },
    {
      message:
        "type='core' 또는 'vault'가 아닌 경우 query 파라미터는 필수입니다 (memory_types만 제공된 경우에도 core/vault가 아닌 타입이 있으면 query 필수)"
    }
  );

/** Recall 도구 파라미터 타입 (Zod 스키마 추론) */
export type RecallParams = z.infer<typeof RecallSchema>;
