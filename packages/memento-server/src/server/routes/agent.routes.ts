import type Database from 'better-sqlite3';
import { Router } from 'express';
import { buildRouterCtx } from './agent.routes.context.js';
import {
  handleCaptureSessionEvent,
  handlePostObservationsIngest,
  handlePostSessions,
  handlePostTranscriptsImport,
} from './agent.routes.ingest.js';
import {
  handlePostPersonalPersistApproved,
  handlePostPersonalRun,
} from './agent.routes.personal.js';
import {
  handleApproveCandidate,
  handleGetPromotionCandidates,
  handlePostRetentionEnforce,
  handleRejectCandidate,
} from './agent.routes.promotions.js';
import {
  handleGetProvenance,
  handleGetProvenanceDetail,
  handlePostProvenance,
} from './agent.routes.provenance.js';
import {
  handleDeleteSession,
  handleGetInjectionMetrics,
  handleGetSessionById,
  handleGetSessionExport,
  handleGetSessionInjections,
  handleGetSessionObservations,
  handleGetSessions,
  handleGetSessionsAggregate,
  handlePostInjectionUsage,
} from './agent.routes.sessions.js';
import {
  handleGetCapabilities,
  handleGetOperationsStatus,
} from './agent.routes.status.js';
import type { AgentRouterOptions } from './agent.routes.types.js';

export type { AgentRouterOptions } from './agent.routes.types.js';

export function createAgentRouter(
  db: Database.Database | null,
  options: AgentRouterOptions = {},
): Router {
  const router = Router();
  const ctx = buildRouterCtx(db, options);

  router.get('/capabilities', (_req, res) => handleGetCapabilities(_req, res, ctx));
  router.get('/sessions', (req, res) => handleGetSessions(req, res, ctx));
  router.get('/sessions/aggregate', (_req, res) => handleGetSessionsAggregate(_req, res, ctx));
  router.get('/operations/status', (req, res) => handleGetOperationsStatus(req, res, ctx));
  router.post('/personal\\:run', (req, res) => handlePostPersonalRun(req, res, ctx));
  router.post('/personal\\:persist-approved', (req, res) => handlePostPersonalPersistApproved(req, res, ctx));
  router.post('/sessions', (req, res) => handlePostSessions(req, res, ctx));
  router.post('/observations:ingest', (req, res) => handlePostObservationsIngest(req, res, ctx));
  router.post('/transcripts/import', (req, res) => handlePostTranscriptsImport(req, res, ctx));
  router.post('/sessions/:id\\:pre-compact', (req, res) => handleCaptureSessionEvent(req, res, ctx, 'PRE_COMPACT'));
  router.post('/sessions/:id\\:stop', (req, res) => handleCaptureSessionEvent(req, res, ctx, 'STOP'));
  router.post('/sessions/:id/injections/:injectionId/usage', (req, res) => handlePostInjectionUsage(req, res, ctx));
  router.get('/injections/metrics', (_req, res) => handleGetInjectionMetrics(_req, res, ctx));
  router.get('/sessions/:id/injections', (req, res) => handleGetSessionInjections(req, res, ctx));
  router.get('/sessions/:id', (req, res) => handleGetSessionById(req, res, ctx));
  router.get('/sessions/:id/observations', (req, res) => handleGetSessionObservations(req, res, ctx));
  router.post('/provenance', (req, res) => handlePostProvenance(req, res, ctx));
  router.get('/provenance', (req, res) => handleGetProvenance(req, res, ctx));
  router.get('/provenance/detail', (req, res) => handleGetProvenanceDetail(req, res, ctx));
  router.get('/memory/promotion-candidates', (req, res) => handleGetPromotionCandidates(req, res, ctx));
  router.post('/memory/promotion-candidates/:id\\:approve', (req, res) => handleApproveCandidate(req, res, ctx));
  router.post('/memory/promotion-candidates/:id\\:reject', (req, res) => handleRejectCandidate(req, res, ctx));
  router.post('/retention:enforce', (_req, res) => handlePostRetentionEnforce(_req, res, ctx));
  router.get('/sessions/:id/export', (req, res) => handleGetSessionExport(req, res, ctx));
  router.delete('/sessions/:id', (req, res) => handleDeleteSession(req, res, ctx));

  return router;
}
