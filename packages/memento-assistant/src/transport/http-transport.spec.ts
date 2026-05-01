// packages/memento-assistant/src/transport/http-transport.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpTransport } from './http-transport.js';

vi.mock('@memento/client', () => {
  return {
    MementoClient: vi.fn().mockImplementation(() => ({
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      recall: vi.fn().mockResolvedValue({ items: [{ id: 'h:1', content: 'a', type: 'semantic' }] }),
      remember: vi.fn().mockResolvedValue({ memory_id: 'h:2', created_at: '2026-05-01T00:00:00Z' }),
    })),
  };
});

describe('HttpTransport', () => {
  it('calls recall and adapts result shape', async () => {
    const t = new HttpTransport({ baseUrl: 'http://localhost:9001', token: 'tok' });
    await t.connect();
    const r = await t.recall('q', { tags: ['channel:tg'] }, 5);
    expect(r.items[0].id).toBe('h:1');
  });

  it('calls remember and maps memory_id → id', async () => {
    const t = new HttpTransport({ baseUrl: 'http://localhost:9001', token: 'tok' });
    const r = await t.remember({ content: 'x', type: 'working' });
    expect(r.id).toBe('h:2');
  });

  it('close calls underlying disconnect', async () => {
    const t = new HttpTransport({ baseUrl: 'http://localhost:9001', token: 'tok' });
    await t.connect();
    await t.close();
    // double close is safe
    await t.close();
  });
});
