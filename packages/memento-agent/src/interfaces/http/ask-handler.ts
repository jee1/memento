import type { Request, Response } from 'express';
import type { AgentCore } from '../../core/agent-core.js';

export function createAskHandler(core: AgentCore) {
  return async (req: Request, res: Response): Promise<void> => {
    const { query, useSearch = true } = req.body as { query?: string; useSearch?: boolean };

    if (!query || typeof query !== 'string') {
      res.status(400).json({ error: 'query is required' });
      return;
    }

    try {
      const result = await core.ask(query, useSearch);
      res.json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('connect') || message.includes('ECONNREFUSED')) {
        res.status(503).json({ error: 'Memento server unavailable' });
      } else if (message.includes('timeout')) {
        res.status(504).json({ error: `LLM timeout: ${message}` });
      } else {
        res.status(500).json({ error: `LLM provider error: ${message}` });
      }
    }
  };
}
