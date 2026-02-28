import { describe, expect, it } from 'vitest';
import { createServer } from 'http';
import { createAssistantApp } from './assistant-http-server.js';

describe('Assistant HTTP Server', () => {
  it('exposes assistant registry at POST /assistant/tools/:name', async () => {
    const app = createAssistantApp({
      queryContinuityMemories: async () => [
        { id: 'm1', content: 'Task', tags: ['continuity', 'task'] },
      ],
    });
    const server = createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, () => resolve());
    });
    const port = (server.address() as { port: number }).port;
    const res = await fetch(`http://127.0.0.1:${port}/assistant/tools/resume_session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: 'memento', process_id: 'cursor', session_id: 'sess-1' }),
    });
    const data = (await res.json()) as {
      result?: { snapshot?: { resume?: unknown[]; recentDecisions?: unknown[]; openThreads?: unknown[]; nextActions?: unknown[] } };
      error?: string;
    };
    server.close();
    expect(res.status).toBe(200);
    expect(data.result?.snapshot).toHaveProperty('resume');
    expect(data.result?.snapshot).toHaveProperty('recentDecisions');
    expect(data.result?.snapshot).toHaveProperty('openThreads');
    expect(data.result?.snapshot).toHaveProperty('nextActions');
  });
});
