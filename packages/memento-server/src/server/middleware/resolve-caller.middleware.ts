import type { Request, Response, NextFunction } from 'express';
import { mementoConfig } from '@memento/core';
import { readProjectIdHeader } from '../utils/project-id-header.js';

declare global {
  namespace Express {
    interface Request {
      callerAgentId?: string;
      projectId?: string;
    }
  }
}

export function resolveCallerMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const headerAgentId = req.get('x-memento-agent-id')?.trim();
  const defaultAgentId = mementoConfig.httpDefaultAgentId?.trim();
  const agentId = req.programmaticAuth?.agentId || headerAgentId || defaultAgentId || undefined;
  const projectId = req.programmaticAuth?.projectId || readProjectIdHeader(req);

  req.callerAgentId = agentId;
  req.projectId = projectId;
  next();
}
