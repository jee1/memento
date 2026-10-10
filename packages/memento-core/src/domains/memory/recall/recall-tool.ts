/**
 * Recall Tool - 기억 검색 도구
 * 하이브리드 검색을 통한 고성능 기억 검색
 */

import { createHash } from 'crypto';
import { mementoConfig } from '../../../shared/config/index.js';
import { ToolInputValidationError } from '../../../shared/errors/tool-input-validation-error.js';
import type { MemoryType, MemoryTypeRequest } from '../../../shared/types/memory.types.js';
import type { VersionFilterType } from '../../../shared/types/procedural-versioning.js';
import type { MemorySearchFilters } from '../../../shared/types/search.types.js';
import { isMemoryItemType } from '../../../shared/utils/type-guards.js';
import { validateTypeParam } from '../../../shared/utils/type-param-validator.js';
import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';
import { resolveCallerAgentId } from '../../../tools/caller-scope.js';
import { recallTelemetryRetrievalStrategy } from './recall-tool-telemetry.js';
import { RECALL_TOOL_INPUT_SCHEMA } from './recall-tool-definition.js';
import { recallCoreMemoryDirect, recallVaultMemoryDirect } from './recall-tool-direct.js';
import { finalizeMemoryItemRecallEnvelope } from './recall-tool-envelope.js';
import type { RecallToolHost } from './recall-tool-host.js';
import { runMemoryItemPostSearchPipeline } from './recall-tool-post-search.js';
import { RecallSchema, type RecallParams } from './recall-tool-schema.js';
import { executeHybridOrTextSearchForMemoryItem } from './recall-tool-search-execution.js';

export type {
  RecallResultItem,
  RecallResponse
} from './recall-tool-types.js';

/**
 * 호출자 입력값 문제(type/query 누락, memory_types 오용 등)로 인한 거절.
 * 서버측 결함이 아니므로 error 대신 warn으로 로깅해 log-issue-monitor의
 * 즉시 이슈 등록(IMMEDIATE_SEVERITIES) 대상에서 제외한다.
 * MCP 경계에서는 ToolInputValidationError → JSON-RPC -32602.
 */
function isRecallInputValidationError(error: unknown): error is Error {
  return (
    error instanceof ToolInputValidationError ||
    (error instanceof Error && error.name === 'ToolInputValidationError') ||
    (error instanceof Error && error.name === 'ZodError')
  );
}

export class RecallTool extends BaseTool {
  constructor() {
    super(
      'recall',
      '관련 기억을 검색합니다. 응답의 filters_applied 는 요청 에코가 아니라 텍스트·벡터 두 레인 모두에 실제로 적용된 필터입니다.',
      RECALL_TOOL_INPUT_SCHEMA
    );
  }

  /** 추출 모듈에 BaseTool protected 메서드를 public RecallToolHost로 전달 */
  private get host(): RecallToolHost {
    return {
      logInfo: (message, additionalData) => this.logInfo(message, additionalData),
      logWarning: (message, additionalData) => this.logWarning(message, additionalData),
      logError: (error, context, additionalData) => this.logError(error, context, additionalData),
      validateService: (service, serviceName) => this.validateService(service, serviceName),
      createSuccessResult: (data) => this.createSuccessResult(data),
    };
  }

  async handle(params: RecallParams, context: ToolContext): Promise<ToolResult> {
    const startTime = Date.now();
    this.logInfo('Recall 도구 호출됨', { params });

    try {
      const parsed = RecallSchema.parse(params);
      const { query, type, key, agent_id, memory_types } = parsed;

      // #1188: memory_types 만 준 호출은 memory_types 로 검색한다. 기본 타입은 둘 다 없을 때만.
      if (!type && !(Array.isArray(memory_types) && memory_types.length > 0)) {
        const typeValidation = validateTypeParam(undefined, 'recall');

        if (!typeValidation.isValid) {
          throw new ToolInputValidationError(typeValidation.message || "type 파라미터는 필수입니다.");
        }
      }

      this.logInfo('파라미터 파싱 완료', {
        query,
        type,
        key,
        agent_id,
        memory_types,
        tags: parsed.tags,
        privacy_scope: parsed.privacy_scope,
        limit: parsed.limit,
        vector_weight: parsed.vector_weight,
        text_weight: parsed.text_weight,
        enable_hybrid: parsed.enable_hybrid,
        provider_filter: parsed.provider_filter
      });

      this.validateDatabase(context);

      const searchStartTime = Date.now();
      const agentId = resolveCallerAgentId(context, agent_id || 'default');

      if (type === 'core') {
        return await recallCoreMemoryDirect(this.host, agentId, key, query, memory_types, searchStartTime, startTime, context);
      }
      if (type === 'vault') {
        return await recallVaultMemoryDirect(this.host, agentId, key, query, memory_types, searchStartTime, startTime, context);
      }
      return await this.recallMemoryItems(parsed, params, context, { agentId, startTime, searchStartTime });
    } catch (error) {
      await this.reportFailure(error, params, context, startTime);
      throw toRecallError(error);
    }
  }

  /** memory_item 하이브리드/텍스트 검색 → 후처리 → 응답 봉투 */
  private async recallMemoryItems(
    parsed: ParsedRecallParams,
    params: RecallParams,
    context: ToolContext,
    timing: { agentId: string; startTime: number; searchStartTime: number }
  ): Promise<ToolResult> {
    const { query, limit } = parsed;
    if (!query) {
      throw new ToolInputValidationError("query 파라미터는 필수입니다 (type='core' 또는 'vault'가 아닌 경우)");
    }

    this.validateString(query, '검색 쿼리', 1000);
    this.validateNumber(limit, '결과 제한', 1, 100);

    this.validateService(context.services.hybridSearchEngine, '하이브리드 검색 엔진');

    const filters = buildRecallSearchFilters(parsed, this.resolveMemoryItemTypes(parsed), params.has_reflection_notes);

    const enableHybrid = parsed.enable_hybrid ?? true;
    const includeMetadata = parsed.include_metadata ?? true;
    const wantScoreBreakdown = includeMetadata && parsed.include_score_breakdown === true;
    const { normalizedVectorWeight, normalizedTextWeight } = normalizeRecallWeights(parsed.vector_weight, parsed.text_weight);
    const actualTriggerContext = parsed.context || parsed.trigger_context;

    const queryHash = createHash('sha256').update(query).digest('hex').slice(0, 16);
    const useHybridRecall = Boolean(
      enableHybrid && context.services.hybridSearchEngine?.isEmbeddingAvailable()
    );
    const retrievalStrategy = recallTelemetryRetrievalStrategy(
      useHybridRecall,
      normalizedVectorWeight,
      normalizedTextWeight
    );
    const { searchResult, executionTime } = await executeHybridOrTextSearchForMemoryItem(this.host, context, {
      query,
      filters,
      limit,
      normalizedVectorWeight,
      normalizedTextWeight,
      provider_filter: parsed.provider_filter,
      match_trigger_conditions: parsed.match_trigger_conditions,
      actualTriggerContext,
      wantScoreBreakdown,
      useHybridRecall,
      enableHybrid,
      searchStartTime: timing.searchStartTime,
      retrievalStrategy,
      queryHash
    });

    const { searchItems, processedResults } = await runMemoryItemPostSearchPipeline(this.host, context, searchResult, {
      query,
      version_filter: parsed.version_filter,
      version_series_id: parsed.version_series_id,
      version_number: parsed.version_number,
      include_version_chain: parsed.include_version_chain,
      include_diff_with: parsed.include_diff_with,
      owner_id_filter: parsed.owner_id,
      process_id_filter: parsed.process_id,
      session_id_filter: parsed.session_id,
      project_id_filter: parsed.project_id,
      tags_filter: parsed.tags,
      match_trigger_conditions: parsed.match_trigger_conditions,
      actualTriggerContext,
      includeMetadata,
      return_format: parsed.return_format
    });

    return await finalizeMemoryItemRecallEnvelope(this.host, context, {
      agentId: timing.agentId,
      query,
      searchItems,
      processedResults,
      searchResult,
      executionTime,
      startTime: timing.startTime,
      searchStartTime: timing.searchStartTime,
      enableHybrid,
      includeMetadata,
      auto_set_anchor: parsed.auto_set_anchor ?? mementoConfig.autoSetAnchorDefault,
      include_neighbors: parsed.include_neighbors,
      neighbors_limit: parsed.neighbors_limit,
      neighbors_per_item: parsed.neighbors_per_item,
      neighbors_similarity_threshold: parsed.neighbors_similarity_threshold,
      filters,
      normalizedVectorWeight,
      normalizedTextWeight,
      retrievalStrategy,
      queryHash
    });
  }

  /**
   * memory_item 검색에 쓸 타입 목록. type 이 있으면 type 만, 없으면 memory_types.
   * memory_types 의 core/vault 는 경고 후 제거하고, 남는 유효 타입이 없으면 입력 오류.
   */
  private resolveMemoryItemTypes(parsed: ParsedRecallParams): MemoryType[] | undefined {
    const { type, memory_types } = parsed;
    if (type && memory_types && memory_types.length > 0) {
      this.logWarning('type 파라미터와 memory_types를 동시에 사용했습니다. type 파라미터를 우선 적용하고 memory_types는 무시합니다.', {
        type,
        memory_types
      });
    }

    const requested: MemoryTypeRequest[] | undefined = type ? [type] : memory_types;
    if (!requested || requested.length === 0) return undefined;

    const invalidTypes = requested.filter(t => t === 'core' || t === 'vault');
    if (invalidTypes.length > 0) {
      this.logWarning('memory_types 배열에서 core/vault는 memory_item 검색에 사용할 수 없습니다. 자동으로 제거합니다.', {
        invalid_types: invalidTypes,
        original_memory_types: requested,
        suggestion: 'Core/Vault 조회는 단일 type 파라미터를 사용하세요.'
      });
      if (requested.length === invalidTypes.length) {
        throw new ToolInputValidationError("memory_types 배열에 유효한 타입이 없습니다. 'core'와 'vault'는 memory_types에서 사용할 수 없습니다. 단일 type 파라미터를 사용하여 Core/Vault를 조회하세요.");
      }
    }

    const validMemoryTypes = requested.filter((t): t is MemoryType => isMemoryItemType(t));
    if (validMemoryTypes.length === 0) {
      throw new ToolInputValidationError("memory_types 배열에 유효한 타입이 없습니다.");
    }
    return validMemoryTypes;
  }

  private async reportFailure(error: unknown, params: RecallParams, context: ToolContext, startTime: number): Promise<void> {
    if (isRecallInputValidationError(error)) {
      this.logWarning('Recall 도구 실행 실패 (입력 검증)', { params, error: error.message });
    } else {
      this.logError(error as Error, 'Recall 도구 실행 실패', { params });
    }

    await this.handleFailure(
      error instanceof Error ? error : new Error(String(error)),
      params,
      context,
      Date.now() - startTime
    );
  }
}

type ParsedRecallParams = ReturnType<typeof RecallSchema.parse>;

function buildRecallSearchFilters(
  parsed: ParsedRecallParams,
  memoryTypes: MemoryType[] | undefined,
  hasReflectionNotes: RecallParams['has_reflection_notes']
): MemorySearchFilters {
  return {
    type: memoryTypes,
    tags: parsed.tags,
    privacy_scope: parsed.privacy_scope,
    time_from: parsed.time_from,
    time_to: parsed.time_to,
    pinned: parsed.pinned,
    importance_min: parsed.importance_min,
    importance_max: parsed.importance_max,
    has_reflection_notes: hasReflectionNotes,
    workflow_name: parsed.workflow_name,
    skill_name: parsed.skill_name,
    version_filter: parsed.version_filter as VersionFilterType | undefined,
    version_series_id: parsed.version_series_id,
    version_number: parsed.version_number,
    include_version_chain: parsed.include_version_chain,
    include_diff_with: parsed.include_diff_with,
    owner_id: parsed.owner_id,
    process_id: parsed.process_id,
    session_id: parsed.session_id,
    project_id: parsed.project_id
  };
}

/** vector/text 가중치를 합이 1 이 되게 정규화한다. 합이 0 이하면 기본 0.6/0.4. */
function normalizeRecallWeights(
  vectorWeight = 0.6,
  textWeight = 0.4
): { normalizedVectorWeight: number; normalizedTextWeight: number } {
  const totalWeight = vectorWeight + textWeight;
  if (totalWeight <= 0) return { normalizedVectorWeight: 0.6, normalizedTextWeight: 0.4 };
  return { normalizedVectorWeight: vectorWeight / totalWeight, normalizedTextWeight: textWeight / totalWeight };
}

/**
 * 메시지에 validation/database/search 가 들어간 오류는 접두어를 붙인 새 Error 로 감싼다.
 * 원래 오류 클래스는 사라진다 (기존 동작 유지, #1312).
 */
function toRecallError(error: unknown): unknown {
  if (!(error instanceof Error)) return error;
  if (error.message.includes('validation')) return new Error(`입력 검증 실패: ${error.message}`);
  if (error.message.includes('database')) return new Error(`데이터베이스 오류: ${error.message}`);
  if (error.message.includes('search')) return new Error(`검색 오류: ${error.message}`);
  return error;
}
