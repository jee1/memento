import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

vi.mock('../../core/agent-core.js', () => ({
  AgentCore: vi.fn().mockImplementation(() => ({
    ask: vi.fn().mockResolvedValue({
      answer: 'http answer',
      usedMemories: [],
      searchResults: [],
    }),
  })),
}));

vi.mock('@memento/client', () => ({
  MementoClient: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
  })),
}));

describe('POST /api/agent/ask', () => {
  it('returns 200 with answer', async () => {
    const { createAgentRouter } = await import('./router.js');
    const app = express();
    app.use(express.json());
    app.use('/api/agent', createAgentRouter());

    const res = await request(app)
      .post('/api/agent/ask')
      .send({ query: 'test question' });

    expect(res.status).toBe(200);
    expect(res.body.answer).toBe('http answer');
  });

  it('returns 400 when query is missing', async () => {
    const { createAgentRouter } = await import('./router.js');
    const app = express();
    app.use(express.json());
    app.use('/api/agent', createAgentRouter());

    const res = await request(app)
      .post('/api/agent/ask')
      .send({});

    expect(res.status).toBe(400);
  });
});
