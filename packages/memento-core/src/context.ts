/**
 * 서버 컨텍스트 모듈
 * @memento/core: createToolContext 등 export
 */

import type Database from 'better-sqlite3';
import type { ServerServices } from './bootstrap.js';
import type { ToolContext } from './tools/types.js';

export interface ServerContext {
  db: Database.Database;
  services: ServerServices;
  /** HTTP/MCP 요청별 에이전트 식별자 (미설정 시 ToolContext.agentId 생략) */
  agentId?: string;
}

export function createServerContext(
  db: Database.Database,
  services: ServerServices
): ServerContext {
  return { db, services };
}

export function createToolContext(serverContext: ServerContext): ToolContext;
export function createToolContext(db: Database.Database, services: ServerServices): ToolContext;
export function createToolContext(
  serverContextOrDb: ServerContext | Database.Database,
  services?: ServerServices
): ToolContext {
  if (services !== undefined) {
    const db = serverContextOrDb as Database.Database;
    const serverContext = createServerContext(db, services);
    return createToolContextFromServerContext(serverContext);
  }
  const serverContext = serverContextOrDb as ServerContext;
  return createToolContextFromServerContext(serverContext);
}

function createToolContextFromServerContext(serverContext: ServerContext): ToolContext {
  return {
    db: serverContext.db,
    ...(serverContext.agentId ? { agentId: serverContext.agentId } : {}),
    services: {
      searchEngine: serverContext.services.searchEngine,
      hybridSearchEngine: serverContext.services.hybridSearchEngine,
      vectorSearchEngine: serverContext.services.vectorSearchEngine,
      embeddingService: serverContext.services.embeddingService,
      forgettingPolicyService: serverContext.services.forgettingPolicyService,
      performanceMonitor: serverContext.services.performanceMonitor,
      databaseOptimizer: serverContext.services.databaseOptimizer,
      errorLoggingService: serverContext.services.errorLoggingService,
      consolidationScoreService: serverContext.services.consolidationScoreService,
      writeCoalescingManager: serverContext.services.writeCoalescingManager,
      anchorManager: serverContext.services.anchorManager,
      relationGraph: serverContext.services.relationGraph,
      failureDetector: serverContext.services.failureDetector,
      reflexionWorker: serverContext.services.reflexionWorker,
      metaMemoryService: serverContext.services.metaMemoryService,
      batchScheduler: serverContext.services.batchScheduler,
      introspectionScanCache: serverContext.services.introspectionScanCache,
      telemetryService: serverContext.services.telemetryService
    }
  };
}
