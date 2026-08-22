import { AgentIntegrationError } from '@memento/core';
import type { Request, Response } from 'express';
import { promotionCandidateDto } from './agent.routes.dto.js';
import type { AgentRouterCtx } from './agent.routes.types.js';
import { requireString, writeError } from './agent.routes.utils.js';

export function handleGetPromotionCandidates(req: Request, res: Response, ctx: AgentRouterCtx): Response {
  try {
    const { promotionService } = ctx;
    if (!promotionService) {
      throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    }
    const status = req.query.status;
    return res.json({
      candidates: promotionService.listCandidates({
        sessionId: typeof req.query.session_id === 'string'
          ? req.query.session_id
          : undefined,
        status: status === 'pending' || status === 'approved' || status === 'rejected'
          ? status
          : undefined,
      }).map(promotionCandidateDto),
    });
  } catch (error) {
    return writeError(res, error);
  }
}

export function handleApproveCandidate(req: Request, res: Response, ctx: AgentRouterCtx): Response {
  try {
    const { promotionService } = ctx;
    if (!promotionService) {
      throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    }
    const candidateId = requireString(req.params.id, 'candidate_id');
    return res.json(promotionCandidateDto(
      promotionService.approveCandidate(candidateId),
    ));
  } catch (error) {
    return writeError(res, error);
  }
}

export function handleRejectCandidate(req: Request, res: Response, ctx: AgentRouterCtx): Response {
  try {
    const { promotionService } = ctx;
    if (!promotionService) {
      throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    }
    const candidateId = requireString(req.params.id, 'candidate_id');
    return res.json(promotionCandidateDto(
      promotionService.rejectCandidate(
        candidateId,
        requireString(req.body?.reason, 'reason'),
      ),
    ));
  } catch (error) {
    return writeError(res, error);
  }
}

export function handlePostRetentionEnforce(_req: Request, res: Response, ctx: AgentRouterCtx): Response {
  try {
    const { service } = ctx;
    if (!service) throw new AgentIntegrationError('Database unavailable', 'SCHEMA_NOT_READY', 503, true);
    const abandonedSessions = service.abandonExpiredSessions();
    return res.json({
      ...service.enforceRetention(),
      abandonedSessions,
    });
  } catch (error) {
    return writeError(res, error);
  }
}
