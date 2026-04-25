import { Router } from 'express';
import { MementoClient } from '@memento/client';
import { AgentCore } from '../../core/agent-core.js';
import { createLLMProvider } from '../../providers/llm/llm-factory.js';
import { createSearchProvider } from '../../providers/search/search-factory.js';
import { loadAgentConfig } from '../../core/types.js';
import { createAskHandler } from './ask-handler.js';

export function createAgentRouter(): Router {
  const config = loadAgentConfig();
  const client = new MementoClient({ serverUrl: config.mementoBaseUrl });
  const core = new AgentCore(client, createLLMProvider(), createSearchProvider(), {
    recallLimit: config.recallLimit,
    llmTimeoutMs: config.llmTimeoutMs,
    searchTimeoutMs: config.searchTimeoutMs,
  });

  const router = Router();

  // lazy-connect: Promise 캐싱으로 경쟁 조건 방지
  let connectPromise: Promise<void> | null = null;
  router.use(async (_req, _res, next) => {
    if (!connectPromise) {
      connectPromise = client.connect();
    }
    await connectPromise;
    next();
  });

  router.post('/ask', createAskHandler(core));
  return router;
}
