import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createClusterJudge,
  getClusterJudgeThreshold,
  JevClusterJudge
} from './cluster-judge.js';

const originalFetch = globalThis.fetch;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('JevClusterJudge', () => {
  it('batches 23 pairs into 3 fetch calls and returns scores in order', async () => {
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        questions: Record<string, unknown>;
      };
      const batchSize = Object.keys(body.questions).length;
      const batchIndex = fetchMock.mock.calls.length - 1;
      const answers: Record<string, { noul: number }> = {};
      for (let k = 0; k < batchSize; k++) {
        answers[`q${k}`] = { noul: batchIndex * 10 + k + 0.1 };
      }
      return jsonResponse(200, { answers });
    });
    vi.stubGlobal('fetch', fetchMock);

    const judge = new JevClusterJudge({ apiKey: 'key' });
    const pairs = Array.from({ length: 23 }, (_, i) => ({ a: `a${i}`, b: `b${i}` }));
    const scores = await judge.scorePairs(pairs);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(scores).toHaveLength(23);
    expect(scores[0]).toBe(0.1);
    expect(scores[9]).toBe(9.1);
    expect(scores[10]).toBe(10.1);
    expect(scores[22]).toBe(22.1);
  });

  it('sends the expected request body shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { answers: { q0: { noul: 0.5 } } })
    );
    vi.stubGlobal('fetch', fetchMock);

    const longTail = 'x'.repeat(500);
    const judge = new JevClusterJudge({ apiKey: 'test-key' });
    await judge.scorePairs([{ a: `결정: alpha\n${longTail}`, b: 'beta body' }]);

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(String(init.body)) as {
      model: string;
      state: Record<string, string>;
      questions: Record<string, { type: string; instructions: string }>;
    };
    expect(body.model).toBe('jev-latest');
    expect(body.state.a0).toBe(`alpha\n${'x'.repeat(394)}`);
    expect(body.state.a0.length).toBe(400);
    expect(body.questions.q0).toEqual({
      type: 'noul',
      instructions:
        '기억 A 와 기억 B 는 같은 작업이나 같은 주제를 다룬다 (기억 A = a0, 기억 B = b0)'
    });
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-key');
  });

  it('returns NaN for a failed batch without affecting other batches', async () => {
    let call = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      call++;
      if (call === 1) {
        return jsonResponse(500, {});
      }
      const answers: Record<string, { noul: number }> = {};
      for (let k = 0; k < 3; k++) {
        answers[`q${k}`] = { noul: 0.8 };
      }
      return jsonResponse(200, { answers });
    });
    vi.stubGlobal('fetch', fetchMock);

    const judge = new JevClusterJudge({ apiKey: 'key' });
    const pairs = Array.from({ length: 13 }, (_, i) => ({ a: `a${i}`, b: `b${i}` }));
    const scores = await judge.scorePairs(pairs);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(scores.slice(0, 10).every(s => Number.isNaN(s))).toBe(true);
    expect(scores.slice(10)).toEqual([0.8, 0.8, 0.8]);
  });

  it('returns NaN when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const judge = new JevClusterJudge({ apiKey: 'key' });
    const scores = await judge.scorePairs([{ a: 'a', b: 'b' }]);
    expect(scores).toEqual([Number.NaN]);
  });

  it('returns NaN for missing answer keys', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          answers: {
            q0: { noul: 0.7 }
          }
        })
      )
    );

    const judge = new JevClusterJudge({ apiKey: 'key' });
    const scores = await judge.scorePairs([{ a: 'a0', b: 'b0' }, { a: 'a1', b: 'b1' }]);
    expect(scores[0]).toBe(0.7);
    expect(Number.isNaN(scores[1])).toBe(true);
  });
});

describe('getClusterJudgeThreshold', () => {
  it('defaults to 0.6', () => {
    delete process.env.CONSOLIDATION_JUDGE_THRESHOLD;
    expect(getClusterJudgeThreshold()).toBe(0.6);
  });

  it('parses valid overrides', () => {
    vi.stubEnv('CONSOLIDATION_JUDGE_THRESHOLD', '0.7');
    expect(getClusterJudgeThreshold()).toBe(0.7);
  });

  it('falls back to 0.6 for invalid values', () => {
    for (const bad of ['abc', '0', '1.5']) {
      vi.stubEnv('CONSOLIDATION_JUDGE_THRESHOLD', bad);
      expect(getClusterJudgeThreshold()).toBe(0.6);
    }
  });
});

describe('createClusterJudge', () => {
  it('returns null when env is unset', () => {
    delete process.env.CONSOLIDATION_JUDGE;
    expect(createClusterJudge('key', undefined)).toBeNull();
  });

  it('returns null for typesafe with empty key', () => {
    vi.stubEnv('CONSOLIDATION_JUDGE', 'typesafe');
    expect(createClusterJudge('', undefined)).toBeNull();
  });

  it('returns JevClusterJudge for typesafe with key', () => {
    vi.stubEnv('CONSOLIDATION_JUDGE', 'typesafe');
    const judge = createClusterJudge('secret', 'custom-model');
    expect(judge).toBeInstanceOf(JevClusterJudge);
  });
});
