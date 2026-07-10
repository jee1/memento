/**
 * Recall Tool - 기억 검색 도구
 * 하이브리드 검색을 통한 고성능 기억 검색
 */

import { createHash } from 'crypto';
import { mementoConfig } from '../../../shared/config/index.js';
import {
  isMemoryItemType,
  type MemorySearchFilters,
  type MemoryType,
  type MemoryTypeRequest,
} from '../../../shared/types/index.js';
import type { VersionFilterType } from '../../../shared/types/procedural-versioning.js';
import { validateTypeParam } from '../../../shared/utils/type-param-validator.js';
import { BaseTool } from '../../../tools/base-tool.js';
import type { ToolContext, ToolResult } from '../../../tools/types.js';
import { recallTelemetryRetrievalStrategy } from './recall-tool-telemetry.js';
import { RECALL_TOOL_INPUT_SCHEMA } from './recall-tool-definition.js';
import { recallCoreMemoryDirect, recallVaultMemoryDirect } from './recall-tool-direct.js';
import { finalizeMemoryItemRecallEnvelope } from './recall-tool-envelope.js';
import type { RecallToolHost } from './recall-tool-host.js';
import { runMemoryItemPostSearchPipeline } from './recall-tool-post-search.js';
import { RecallSchema, type RecallParams } from './recall-tool-schema.js';
import { executeHybridOrTextSearchForMemoryItem } from './recall-tool-search-execution.js';

export type {
  AnchorSetMetadata,
  NeighborMemoryItem,
  RecallResultItem,
  RecallResponseMetadata,
  RecallResponse
} from './recall-tool-types.js';
export type { RecallParams };

/**
 * 호출자 입력값 문제(type/query 누락, memory_types 오용 등)로 인한 거절.
 * 서버측 결함이 아니므로 error 대신 warn으로 로깅해 log-issue-monitor의
 * 즉시 이슈 등록(IMMEDIATE_SEVERITIES) 대상에서 제외한다.
 */
class RecallInputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecallInputValidationError';
  }
}

function isRecallInputValidationError(error: unknown): error is Error {
  return (
    error instanceof RecallInputValidationError ||
    (error instanceof Error && error.name === 'ZodError')
  );
}

export class RecallTool extends BaseTool {
  constructor() {
    super('recall', '관련 기억을 검색합니다', RECALL_TOOL_INPUT_SCHEMA);
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
        importance_min: _importance_min,
        importance_max: _importance_max,
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
        neighbors_similarity_threshold,
        version_filter,
        version_series_id,
        version_number,
        include_version_chain,
        include_diff_with,
        owner_id: owner_id_filter,
        process_id: process_id_filter,
        session_id: session_id_filter,
        project_id: project_id_filter,
        include_score_breakdown
      } = RecallSchema.parse(params);

      const effectiveAutoSetAnchor = auto_set_anchor ?? mementoConfig.autoSetAnchorDefault;

      const actualTriggerContext = triggerContext || trigger_context;

      const typeParamMode = mementoConfig.typeParamMode;
      const originalTypeProvided = !!type;
      let validatedType = type;
      const hasMemoryTypesFilter = Array.isArray(memory_types) && memory_types.length > 0;

      if (!type) {
        if (hasMemoryTypesFilter) {
          validatedType = 'episodic' as MemoryTypeRequest;
        } else {
          const typeValidation = validateTypeParam(undefined, typeParamMode, 'recall');

          if (!typeValidation.isValid) {
            throw new RecallInputValidationError(typeValidation.message || "type 파라미터는 필수입니다.");
          }

          if (typeValidation.message && (typeParamMode === 'warn' || typeParamMode === 'deprecate')) {
            this.logWarning(typeValidation.message);
          }

          if (typeValidation.defaultType) {
            validatedType = typeValidation.defaultType as MemoryTypeRequest;
          }
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

      this.validateDatabase(context);

      const searchStartTime = Date.now();
      const agentId = agent_id || 'default';

      if (validatedType === 'core') {
        return await recallCoreMemoryDirect(this.host, agentId, key, query, memory_types, searchStartTime, startTime, context);
      }
      if (validatedType === 'vault') {
        return await recallVaultMemoryDirect(this.host, agentId, key, query, memory_types, searchStartTime, startTime, context);
      }
      {
        if (!query) {
          throw new RecallInputValidationError("query 파라미터는 필수입니다 (type='core' 또는 'vault'가 아닌 경우)");
        }

        this.validateString(query, '검색 쿼리', 1000);
        this.validateNumber(limit, '결과 제한', 1, 100);

        this.validateService(context.services.hybridSearchEngine, '하이브리드 검색 엔진');

        if (originalTypeProvided && memory_types && memory_types.length > 0) {
          this.logWarning('type 파라미터와 memory_types를 동시에 사용했습니다. type 파라미터를 우선 적용하고 memory_types는 무시합니다.', {
            type: validatedType,
            memory_types
          });
        }

        let filteredMemoryTypes: MemoryTypeRequest[] | undefined;
        if (validatedType) {
          filteredMemoryTypes = [validatedType];
          if (!originalTypeProvided && memory_types && memory_types.length > 0) {
            this.logWarning('type 파라미터가 미지정되어 기본값이 적용되었지만, memory_types도 제공되었습니다. 기본 타입을 우선 적용하고 memory_types는 무시합니다.', {
              default_type: validatedType,
              memory_types
            });
          }
        } else {
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
              throw new RecallInputValidationError("memory_types 배열에 유효한 타입이 없습니다. 'core'와 'vault'는 memory_types에서 사용할 수 없습니다. 단일 type 파라미터를 사용하여 Core/Vault를 조회하세요.");
            }
          }

          const validMemoryTypes = filteredMemoryTypes.filter((t): t is MemoryType => isMemoryItemType(t));
          if (validMemoryTypes.length === 0) {
            throw new RecallInputValidationError("memory_types 배열에 유효한 타입이 없습니다.");
          }
          filteredMemoryTypes = validMemoryTypes;
        }

        const finalMemoryTypes: MemoryType[] | undefined = filteredMemoryTypes && filteredMemoryTypes.length > 0
          ? (filteredMemoryTypes as MemoryType[])
          : undefined;
        const filters: MemorySearchFilters = {
          type: finalMemoryTypes,
          tags,
          privacy_scope,
          time_from,
          time_to,
          pinned,
          has_reflection_notes: params.has_reflection_notes,
          workflow_name,
          skill_name,
          version_filter: version_filter as VersionFilterType | undefined,
          version_series_id,
          version_number,
          include_version_chain,
          include_diff_with,
          owner_id: owner_id_filter,
          process_id: process_id_filter,
          session_id: session_id_filter
        };

        const vectorWeight = vector_weight ?? 0.6;
        const textWeight = text_weight ?? 0.4;
        const enableHybrid = enable_hybrid ?? true;
        const includeMetadata = include_metadata ?? true;
        const wantScoreBreakdown = includeMetadata && include_score_breakdown === true;

        const totalWeight = vectorWeight + textWeight;
        const normalizedVectorWeight = totalWeight > 0 ? vectorWeight / totalWeight : 0.6;
        const normalizedTextWeight = totalWeight > 0 ? textWeight / totalWeight : 0.4;

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
          provider_filter,
          match_trigger_conditions,
          actualTriggerContext,
          wantScoreBreakdown,
          useHybridRecall,
          enableHybrid,
          searchStartTime,
          retrievalStrategy,
          queryHash
        });

        const { searchItems, processedResults } = await runMemoryItemPostSearchPipeline(this.host, context, searchResult, {
          query,
          version_filter,
          version_series_id,
          version_number,
          include_version_chain,
          include_diff_with,
          owner_id_filter,
          process_id_filter,
          session_id_filter,
          project_id_filter,
          match_trigger_conditions,
          actualTriggerContext,
          includeMetadata,
          return_format
        });

        return await finalizeMemoryItemRecallEnvelope(this.host, context, {
          agentId,
          query,
          searchItems,
          processedResults,
          searchResult,
          executionTime,
          startTime,
          searchStartTime,
          enableHybrid,
          includeMetadata,
          auto_set_anchor: effectiveAutoSetAnchor,
          include_neighbors,
          neighbors_limit,
          neighbors_per_item,
          neighbors_similarity_threshold,
          filters,
          normalizedVectorWeight,
          normalizedTextWeight,
          retrievalStrategy,
          queryHash
        });
      }

    } catch (error) {
      if (isRecallInputValidationError(error)) {
        this.logWarning('Recall 도구 실행 실패 (입력 검증)', { params, error: error.message });
      } else {
        this.logError(error as Error, 'Recall 도구 실행 실패', { params });
      }

      const executionTime = Date.now() - startTime;
      await this.handleFailure(
        error instanceof Error ? error : new Error(String(error)),
        params,
        context,
        executionTime
      );

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
}
