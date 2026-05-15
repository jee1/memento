/**
 * Admin 라우터
 * /admin/* 엔드포인트 처리
 * Phase 1.2: http-server.ts 리팩토링 — 하위 모듈에 라우트 등록 위임
 */

import { Router } from 'express';
import type Database from 'better-sqlite3';
import type { ServerServices } from '../bootstrap.js';
import { registerAdminRelationRoutes } from './admin/admin-relations.routes.js';
import { registerAdminTelemetryRoutes } from './admin/admin-telemetry.routes.js';
import { registerAdminGraphRoute } from './admin/admin-graph.routes.js';
import { registerAdminEmbeddingMapRoute } from './admin/admin-embedding-map.routes.js';
import { registerAdminStatsAndHealthRoutes } from './admin/admin-stats-and-health.routes.js';
import { registerAdminMemoryReviewRoutes } from './admin/admin-memory-review.routes.js';
import { registerAdminBatchRoutes } from './admin/admin-batch.routes.js';
import { registerAdminRuntimePerformanceRoutes } from './admin/admin-runtime-performance.routes.js';
import { registerAdminToolRoutes } from './admin/admin-tools.routes.js';
import { registerAdminProjectMemoryRoutes } from './admin/admin-project-memory.routes.js';
import { registerAdminEvolutionDemoRoutes } from './admin/admin-evolution-demo.routes.js';

export type { GraphNode, GraphEdge, GraphFilter, GraphResponse } from './admin/admin-graph-response.js';

/**
 * Admin 라우터 생성
 */
export function createAdminRouter(
  db: Database.Database | null,
  serverServices: ServerServices | null
): Router {
  const router = Router();

  registerAdminStatsAndHealthRoutes(router, db, serverServices);
  registerAdminMemoryReviewRoutes(router, db);
  registerAdminBatchRoutes(router, db, serverServices);
  registerAdminRuntimePerformanceRoutes(router);

  registerAdminRelationRoutes(router, db);
  registerAdminToolRoutes(router, db, serverServices);
  registerAdminProjectMemoryRoutes(router, db);

  registerAdminTelemetryRoutes(router, db, serverServices);
  registerAdminGraphRoute(router, db);
  registerAdminEmbeddingMapRoute(router, db);
  registerAdminEvolutionDemoRoutes(router);

  return router;
}
