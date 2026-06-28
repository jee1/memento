import { AgentIntegrationError } from '@memento/core';
import type { Request, Response } from 'express';
import { createPersonalKnowledgeAgent } from './agent.routes.context.js';
import type { AgentRouterCtx } from './agent.routes.types.js';
import { requireString, writeError } from './agent.routes.utils.js';
import {
  optionalMemoryTypes,
  optionalOwnerId,
  optionalPositiveInteger,
  optionalString,
  optionalStringArray,
  requireCandidates,
} from './agent.routes.validation.js';

function parsePersonalRunBody(body: Record<string, unknown>) {
  return {
    userMessage: requireString(body.user_message ?? body.userMessage, 'user_message'),
    projectId: optionalString(body.project_id ?? body.projectId, 'project_id'),
    ownerId: optionalOwnerId(body.owner_id ?? body.ownerId),
    sessionId: optionalString(body.session_id ?? body.sessionId, 'session_id'),
    tokenBudget: optionalPositiveInteger(body.token_budget ?? body.tokenBudget, 'token_budget'),
    maxMemories: optionalPositiveInteger(body.max_memories ?? body.maxMemories, 'max_memories'),
    memoryTypes: optionalMemoryTypes(body.memory_types ?? body.memoryTypes),
  };
}

export async function handlePostPersonalRun(req: Request, res: Response, ctx: AgentRouterCtx): Promise<Response | void> {
  try {
    const agent = createPersonalKnowledgeAgent(ctx);
    const result = await agent.runOneTurn(parsePersonalRunBody(req.body ?? {}));
    return res.json({
      ok: true,
      knowledgeContext: {
        itemCount: result.knowledgeContext.itemCount,
        tokenEstimate: result.knowledgeContext.tokenEstimate,
        summary: result.knowledgeContext.summary,
      },
      llm: {
        response: result.llmResponse,
        metadata: result.llmMetadata ?? null,
      },
      candidates: result.candidates,
      persistence: { attempted: false, items: [], persistedCount: 0, errorCount: 0 },
    });
  } catch (error) {
    return writeError(res, error);
  }
}

export async function handlePostPersonalPersistApproved(req: Request, res: Response, ctx: AgentRouterCtx): Promise<Response | void> {
  try {
    const body = req.body ?? {};
    const approvedCandidateIds = optionalStringArray(
      body.approved_candidate_ids ?? body.approvedCandidateIds,
      'approved_candidate_ids',
    );
    if (!approvedCandidateIds) {
      throw new AgentIntegrationError('approved_candidate_ids is required', 'INVALID_PAYLOAD', 400);
    }

    const service = createPersonalKnowledgeAgent(ctx);
    const result = await service.persistApprovedCandidates({
      candidates: requireCandidates(body.candidates),
      approvedCandidateIds,
      projectId: optionalString(body.project_id ?? body.projectId, 'project_id'),
      ownerId: optionalOwnerId(body.owner_id ?? body.ownerId),
      sessionId: optionalString(body.session_id ?? body.sessionId, 'session_id'),
      processId: optionalString(body.process_id ?? body.processId, 'process_id'),
    });

    return res.json({
      ok: true,
      persistence: {
        attempted: approvedCandidateIds.length > 0,
        items: result.items,
        persistedCount: result.persistedCount,
        errorCount: result.errorCount,
      },
    });
  } catch (error) {
    return writeError(res, error);
  }
}
