/**
 * @memento/core - 라이브러리 진입점
 * createMementoCore로 DB·서비스 초기화 후 서버/앱에서 ToolContext·getToolRegistry 사용.
 */

import { initializeDatabase, closeDatabase as closeDb } from './infrastructure/database/database/init.js';
import { initializeServices } from './bootstrap.js';
import { validateAndNormalizeDbPath } from './shared/utils/db-path.js';

export interface MementoCoreOptions {
  dbPath: string;
  config?: Partial<Record<string, unknown>>;
}

export interface MementoCoreInstance {
  db: import('better-sqlite3').Database;
  services: import('./bootstrap.js').ServerServices;
}

/**
 * Core 인스턴스 생성 (DB 초기화 + 서비스 부트스트랩).
 * 서버는 반환된 db, services로 createToolContext(db, services) 및 getToolRegistry() 사용.
 * dbPath는 검증·정규화 후 사용된다 (규칙: shared/utils/db-path.ts).
 */
export async function createMementoCore(options: MementoCoreOptions): Promise<MementoCoreInstance> {
  const dbPath = validateAndNormalizeDbPath(options.dbPath);
  const db = await initializeDatabase(dbPath);
  const services = await initializeServices(db);
  return { db, services };
}

/** DB 연결 종료 (서버 종료 시 호출) */
export function closeDatabase(db: import('better-sqlite3').Database): void {
  closeDb(db);
}

export { createToolContext, createServerContext } from './context.js';
export { getToolRegistry, executeTool, resolveTelemetryOwnerId } from './tools/index.js';
export { initializeServices } from './bootstrap.js';
export type { ServerServices } from './bootstrap.js';
export type { ServerContext } from './context.js';

// --- shared (설정·유틸·타입) re-export (서버 thin화용) ---
export { mementoConfig, validateConfig } from './shared/config/index.js';
export {
  isHttpBindHostRemotelyReachable,
  canonicalizeHttpBindHostForListen,
  formatHttpBindHostForUrl,
  getMementoHttpSecurityStartupViolationMessage,
  MementoHttpSecurityStartupError
} from './shared/http/http-bind-policy.js';
export { DatabaseUtils } from './shared/utils/database.js';
export { ensureMemoryReviewCandidateSchema } from './shared/utils/ensure-memory-review-candidate-schema.js';
export {
  selectMemoryReviewCandidates,
  selectionWindowLimit
} from './domains/memory/services/memory-review-candidate-selection-service.js';
export { parseMemoryReviewSelectionEnv } from './domains/memory/services/memory-review-candidate-selection-env.js';
export type {
  MemoryReviewStaleAnchorKind as StaleAnchorKind,
  MemoryReviewCandidateSourceRow as SourceRow,
  MemoryReviewCandidateScoreBreakdown as ScoreBreakdown,
  MemoryReviewCandidateSelectionItem as SelectionItem,
  MemoryReviewCandidateSelectionThresholds as Thresholds,
  MemoryReviewCandidateSelectionOptions as Options
} from './domains/memory/services/memory-review-candidate-selection.types.js';
export {
  upsertPendingMemoryReviewCandidates,
  getMemoryReviewCandidateById,
  listMemoryReviewCandidates,
  markMemoryReviewCandidateReviewed,
  markMemoryReviewCandidateDismissed,
  markMemoryReviewCandidateExpired,
} from './domains/memory/services/memory-review-candidate-persistence-service.js';
export {
  computeMemoryReviewQueueHealthLive,
  recordMemoryReviewQueueHealthSnapshot,
  listMemoryReviewQueueHealthSnapshots,
  maybeRecordMemoryReviewQueueHealthSnapshot,
  memoryReviewQueueHealthSnapshotTableReady,
} from './domains/memory/services/memory-review-queue-health-service.js';
export type {
  MemoryReviewQueueHealthLive,
  ReviewQueueWindowCounts,
  MemoryReviewQueueHealthSnapshotRow,
} from './domains/memory/services/memory-review-queue-health-service.js';
export type {
  MemoryReviewCandidateStatus,
  MemoryReviewCandidateRow,
  UpsertPendingMemoryReviewCandidateInput,
  UpsertPendingMemoryReviewCandidatesResult,
  ListMemoryReviewCandidatesQuery,
} from './domains/memory/services/memory-review-candidate-persistence.types.js';
export {
  MemoryReviewCandidateError,
  MEMORY_REVIEW_CANDIDATE_NOT_FOUND,
  MEMORY_REVIEW_CANDIDATE_NOT_ACTIONABLE,
} from './domains/memory/services/memory-review-candidate-persistence-error.js';
export {
  parseAdminMemoryItemIdParam,
  getAdminMemoryItemPreviewById,
} from './domains/memory/services/admin-memory-item-preview-service.js';
export type { AdminMemoryItemPreview } from './domains/memory/services/admin-memory-item-preview-service.js';
export { logger } from './shared/utils/logger.js';
export { loggingRateLimiter } from './shared/utils/logging-rate-limiter.js';
export { withErrorHandling } from './shared/utils/error-handling.js';
export type { MemoryItem } from './shared/types/index.js';
export type { IErrorLoggingService } from './shared/interfaces/error-logging.interface.js';
export { ErrorSeverity, ErrorCategory } from './shared/types/error-types.js';
export type { AppErrorContract } from './shared/types/error-types.js';
export { getBatchScheduler, resetBatchScheduler } from './infrastructure/scheduler/batch-scheduler.js';

// --- 도메인·인프라 re-export (서버 thin화용) ---
export { getVectorSearchEngine } from './domains/search/algorithms/vector-search-engine.js';
export { MemoryNeighborService, MemoryNotFoundError } from './domains/memory/services/memory-neighbor-service.js';
export { ErrorLoggingService } from './domains/monitoring/services/error-logging-service.js';
export { getPerformanceMonitor } from './domains/monitoring/services/performance-monitor.js';
export { QualityAssuranceService } from './domains/monitoring/services/quality-assurance/quality-assurance-service.js';
export { QualityThresholdManager } from './domains/monitoring/services/quality-assurance/quality-threshold-manager.js';
export { PIIMasker } from './shared/utils/pii-masker.js';
export { SchemaVersionManager } from './infrastructure/database/database/migration/schema-version-manager.js';
export { MigrationDetector } from './infrastructure/database/database/migration/migration-detector.js';
export { createRelationGraph } from './infrastructure/relation-graph-factory.js';
export { RelationExtractor } from './domains/relation/services/relation-extractor.js';
export {
  RelationQualityValidator,
  type ExpectedRelation,
  type ExtractedRelation,
} from './domains/relation/services/relation-quality-validator.js';
export { RelationEngineSchemaMigration } from './infrastructure/database/database/migration/migrations/005-relation-engine-schema.js';
export { ExtractRelationsTool } from './domains/relation/tools/extract-relations-tool.js';
export { GetRelationsTool } from './domains/relation/tools/get-relations-tool.js';
export { AddRelationTool } from './domains/relation/tools/add-relation-tool.js';
export { RemoveRelationTool } from './domains/relation/tools/remove-relation-tool.js';
export { VisualizeRelationsTool } from './domains/relation/tools/visualize-relations-tool.js';
export { ExtractTriplesTool } from './domains/relation/tools/extract-triples-tool.js';
export { RestoreAnchorsTool } from './domains/anchor/tools/restore-anchors-tool.js';
export { ConvertEpisodicToSemanticTool } from './domains/memory/tools/convert-episodic-to-semantic-tool.js';
export { GetMetaMemoryStatsTool } from './domains/monitoring/tools/get-meta-memory-stats-tool.js';
export { GetIntrospectionSummaryTool } from './domains/memory/tools/get-introspection-summary-tool.js';
export { FeedbackTool } from './domains/memory/tools/feedback-tool.js';
export { IntrospectionScanCache } from './domains/memory/services/introspection-scan-cache.js';
export { MigrateEmbeddingsTool } from './tools/migrate-embeddings-tool.js';
export {
  SleepConsolidationService,
  ConsolidationAlreadyRunningError
} from './domains/consolidation/index.js';
export type { SleepConsolidationRunResult } from './shared/types/consolidation.types.js';
export type { SleepConsolidationServiceDeps } from './domains/consolidation/index.js';

// 개인 지식 Agent (in-process CLI·예시 앱용)
export {
  PersonalKnowledgeAgentService,
  DeterministicMockLlmAdapter,
  ToolContextKnowledgeContextAdapter,
  ToolContextRememberPersistenceAdapter,
  PersonalAgentLlmError,
  isPersonalAgentLlmError,
  parsePersonalAgentLlmEnv,
  createPersonalAgentLlmPort,
  OpenAiChatLlmAdapter,
  GeminiChatLlmAdapter,
  OllamaChatLlmAdapter,
} from './domains/personal-agent/index.js';
export type {
  PersonalKnowledgeAgentDeps,
  KnowledgeCandidate,
  PersonalKnowledgePersistItemResult,
  PersonalAgentLlmErrorCode,
  ParsedPersonalAgentLlmEnv,
  ParsePersonalAgentLlmEnvKeys,
  CreatePersonalAgentLlmPortDeps,
  ILLMPort,
  OpenAiChatLlmAdapterOptions,
  GeminiChatLlmAdapterOptions,
  OllamaChatLlmAdapterOptions,
} from './domains/personal-agent/index.js';

// 타입·인터페이스 re-export (서버/앱에서 사용)
export type { ToolContext, ToolResult, ToolDefinition } from './tools/types.js';
export type { TelemetryPeriod, EventType } from './domains/telemetry/types/telemetry.types.js';
export { TelemetryService } from './domains/telemetry/services/telemetry-service.js';
export { TelemetryRepository } from './domains/telemetry/repositories/telemetry-repository.js';
export { TelemetryEventsMigration } from './infrastructure/database/database/migration/migrations/027-telemetry-events.js';
export { TelemetryDailyMetricsMigration } from './infrastructure/database/database/migration/migrations/028-telemetry-daily-metrics.js';
export { MetaMemoryStatsSchemaMigration } from './infrastructure/database/database/migration/migrations/011-meta-memory-stats-schema.js';
export { MemoryReviewCandidateSchemaMigration } from './infrastructure/database/database/migration/migrations/033-memory-review-candidate-schema.js';
export { ReviewQueueHealthSnapshotMigration } from './infrastructure/database/database/migration/migrations/034-review-queue-health-snapshot.js';
export { AgentIntegrationSchemaMigration } from './infrastructure/database/database/migration/migrations/035-agent-integration-schema.js';
export { SqliteAgentIntegrationRepository } from './infrastructure/database/repositories/sqlite-agent-integration-repository.js';
export {
  AgentIntegrationError,
  AgentLifecycleService,
} from './domains/agent-integration/services/agent-lifecycle-service.js';
export {
  AgentSessionSummaryService,
  buildAgentSessionSummary,
} from './domains/agent-integration/services/agent-session-summary-service.js';
export type {
  AgentIntegrationReasonCode,
  AgentLifecycleServiceOptions,
  AgentSessionSummarizer,
} from './domains/agent-integration/services/agent-lifecycle-service.js';
export type {
  AgentSessionSummaryResult,
  AgentSessionSummaryServiceOptions,
  AgentSummaryTelemetryEvent,
} from './domains/agent-integration/services/agent-session-summary-service.js';
export type {
  AgentCaptureStatus,
  AgentEventType,
  AgentObservation,
  AgentSession,
  AgentSessionStatus,
  CaptureResult,
  MemoryProvenance,
  ObservationPage,
  PersistedAgentEventInput,
  ProvenanceTrace,
} from './domains/agent-integration/types.js';
export { AgentContextRecallService } from './domains/agent-integration/services/agent-context-recall-service.js';
export {
  AgentContextInjectionService,
  summarizeAgentInjectionTelemetry,
} from './domains/agent-integration/services/agent-context-injection-service.js';
export type {
  AgentContextInjectionBundle,
  AgentContextInjectionFailureReason,
  AgentContextInjectionRequest,
  AgentContextInjectionServiceOptions,
  AgentContextInjectionTrigger,
  AgentInjectionBuiltTelemetryEvent,
  AgentInjectionTelemetryEvent,
  AgentInjectionTelemetrySummary,
  AgentInjectionUsageTelemetryEvent,
} from './domains/agent-integration/services/agent-context-injection-service.js';
export type {
  AgentContextCandidate,
  AgentContextRecallRequest,
  AgentContextRecallResult,
  AgentContextRecallServiceOptions,
  AgentContextRecallSource,
  AgentContextScope,
  AgentContextScopeLevel,
  AgentContextSourceResult,
  AgentContextStatus,
  AgentTokenEstimator,
  ExcludedAgentContextItem,
  SelectedAgentContextItem,
} from './domains/agent-integration/services/agent-context-recall-service.js';
export { SqliteHybridAgentContextSource } from './domains/agent-integration/services/sqlite-hybrid-agent-context-source.js';
export type { SqliteHybridAgentContextSourceOptions } from './domains/agent-integration/services/sqlite-hybrid-agent-context-source.js';

export type { RecallResultItem } from './domains/memory/tools/recall-tool.js';

// Evolution demo (Issue #341, #396)
export {
  listEvolutionDemoScenarios,
  getEvolutionDemoSnapshot,
  EvolutionDemoNotFoundError,
  EVOLUTION_DEMO_SCENARIO_IDS,
  EvolutionDemoMemorySummarySchema,
  EvolutionDemoEpisodicSourceSchema,
  EvolutionDemoSemanticResultSchema,
  EvolutionDemoSearchComparisonSchema,
  EvolutionDemoSnapshotSchema,
  EvolutionDemoPointSchema,
  EvolutionDemoScenarioSchema,
  EvolutionDemoScenarioCatalogSchema,
} from './domains/evolution-demo/index.js';
export type {
  EvolutionDemoMemorySummary,
  EvolutionDemoEpisodicSource,
  EvolutionDemoSemanticResult,
  EvolutionDemoSearchComparison,
  EvolutionDemoSnapshot,
  EvolutionDemoPoint,
  EvolutionDemoScenario,
  EvolutionDemoScenarioCatalog,
} from './domains/evolution-demo/index.js';
