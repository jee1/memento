import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MementoClient } from '../memento-client.js';
import type { SearchResult } from '../types.js';

describe('MementoClient recordRecallFeedback', () => {
  let client: MementoClient;
  let http: { post: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    client = new MementoClient({ apiKey: 'test-key', logLevel: 'silent' });
    http = { post: vi.fn() };
    Object.assign(client as unknown as Record<string, unknown>, {
      httpClient: http,
      isConnected: true,
    });
  });

  it('recall 항목의 score_breakdown을 feedback POST 본문에 포함한다', async () => {
    const breakdown = {
      relevance: { score: 0.42, pct: 72 },
      feedback: { score: 0.1, pct: 5 },
    };
    const recallResult: SearchResult = {
      items: [
        {
          id: 'mem_fb_1',
          content: 'test',
          type: 'semantic',
          importance: 0.5,
          created_at: '2026-07-05T00:00:00.000Z',
          pinned: false,
          privacy_scope: 'private',
          score: 0.8,
          recall_reason: 'hybrid',
          score_breakdown: breakdown,
        },
      ],
      total_count: 1,
      query_time: 12,
    };
    http.post.mockResolvedValue({
      data: {
        result: {
          success: true,
          memory_id: 'mem_fb_1',
          feedback_id: '1',
          helpful: true,
          created_at: '2026-07-05T01:00:00.000Z',
        },
      },
    });

    await expect(
      client.recordRecallFeedback(recallResult, 'mem_fb_1', true, {
        session_id: 'sess-1',
        agent_id: 'agent-1',
        comment: 'helpful',
      })
    ).resolves.toMatchObject({ success: true, memory_id: 'mem_fb_1' });

    expect(http.post).toHaveBeenCalledWith('/tools/feedback', {
      memory_id: 'mem_fb_1',
      helpful: true,
      comment: 'helpful',
      score: undefined,
      score_breakdown: breakdown,
      session_id: 'sess-1',
      agent_id: 'agent-1',
    });
  });

  it('memoryId가 recall 결과에 없으면 score_breakdown 없이 feedback을 호출한다', async () => {
    http.post.mockResolvedValue({
      data: { result: { success: true, memory_id: 'mem_missing' } },
    });
    const recallResult: SearchResult = {
      items: [],
      total_count: 0,
      query_time: 1,
    };

    await client.recordRecallFeedback(recallResult, 'mem_missing', false);

    expect(http.post).toHaveBeenCalledWith('/tools/feedback', {
      memory_id: 'mem_missing',
      helpful: false,
      comment: undefined,
      score: undefined,
      session_id: undefined,
      agent_id: undefined,
    });
    const body = http.post.mock.calls[0][1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('score_breakdown');
  });
});
