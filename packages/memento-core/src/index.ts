/**
 * @memento/core - 라이브러리 진입점
 * createMementoCore로 DB·서비스 초기화 후 서버/앱에서 ToolContext·getToolRegistry 사용.
 */

import { initializeDatabase, closeDatabase as closeDb } from './infrastructure/database/database/init.js';
import { initializeServices } from './bootstrap.js';
import { getToolRegistry } from './tools/index.js';
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
export { getToolRegistry } from './tools/index.js';
export { initializeServices } from './bootstrap.js';
export type { ServerServices } from './bootstrap.js';
export type { ServerContext } from './context.js';

// --- shared (설정·유틸·타입) re-export (서버 thin화용) ---
export { mementoConfig, validateConfig } from './shared/config/index.js';
export { DatabaseUtils } from './shared/utils/database.js';
export { logger } from './shared/utils/logger.js';
export { loggingRateLimiter } from './shared/utils/logging-rate-limiter.js';
export { withErrorHandling } from './shared/utils/error-handling.js';
export type { MemoryItem } from './shared/types/index.js';
export type { IErrorLoggingService } from './shared/interfaces/error-logging.interface.js';
export { ErrorSeverity, ErrorCategory } from './shared/types/error-types.js';
export type { AppErrorContract } from './shared/types/error-types.js';
export { getBatchScheduler } from './infrastructure/scheduler/batch-scheduler.js';

// --- 도메인·인프라 re-export (서버 thin화용) ---
export { getVectorSearchEngine } from './domains/search/algorithms/vector-search-engine.js';
export { MemoryNeighborService, MemoryNotFoundError } from './domains/memory/services/memory-neighbor-service.js';
export { ErrorLoggingService } from './domains/monitoring/services/error-logging-service.js';
export { getPerformanceMonitor } from './domains/monitoring/services/performance-monitor.js';
export { QualityAssuranceService } from './domains/monitoring/services/quality-assurance/quality-assurance-service.js';
export { QualityThresholdManager } from './domains/monitoring/services/quality-assurance/quality-threshold-manager.js';
export { createRelationGraph } from './infrastructure/relation-graph-factory.js';
export { RelationExtractor } from './domains/relation/services/relation-extractor.js';
export { ExtractRelationsTool } from './domains/relation/tools/extract-relations-tool.js';
export { GetRelationsTool } from './domains/relation/tools/get-relations-tool.js';
export { AddRelationTool } from './domains/relation/tools/add-relation-tool.js';
export { RemoveRelationTool } from './domains/relation/tools/remove-relation-tool.js';
export { VisualizeRelationsTool } from './domains/relation/tools/visualize-relations-tool.js';
export { RestoreAnchorsTool } from './domains/anchor/tools/restore-anchors-tool.js';
export { ConvertEpisodicToSemanticTool } from './domains/memory/tools/convert-episodic-to-semantic-tool.js';
export { GetMetaMemoryStatsTool } from './domains/monitoring/tools/get-meta-memory-stats-tool.js';
export { MigrateEmbeddingsTool } from './tools/migrate-embeddings-tool.js';

// 타입·인터페이스 re-export (서버/앱에서 사용)
export type { ToolContext, ToolResult } from './tools/types.js';
export type { RecallResultItem } from './domains/memory/tools/recall-tool.js';
