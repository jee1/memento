import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createClusterJudge,
  JevClusterJudge
} from './cluster-judge.js';
import { logger } from '../../../shared/utils/logger.js';
import { getClusterJudgeThreshold } from '../../../shared/config/cluster-judge-config.js';

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
  /** Pair i is sent as a${i}/b${i}; answers q0 after a delay that grows as i shrinks, so later pairs finish first. */
  function delayedFetch(scoreOf: (pairIndex: number) => number | null, stats: { inFlight: number; max: number }) {
    return vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const { state } = JSON.parse(String(init?.body)) as { state: { a0: string } };
      const i = Number(state.a0.slice(1));
      stats.inFlight++;
      stats.max = Math.max(stats.max, stats.inFlight);
      await new Promise(resolve => setTimeout(resolve, 30 - i));
      stats.inFlight--;
      const score = scoreOf(i);
      return score === null ? jsonResponse(500, {}) : jsonResponse(200, { answers: { q0: { noul: score } } });
    });
  }

  it('sends one request per pair, at most 10 at once, and keeps the pair order', async () => {
    const stats = { inFlight: 0, max: 0 };
    const fetchMock = delayedFetch(i => i / 100, stats);
    vi.stubGlobal('fetch', fetchMock);

    const judge = new JevClusterJudge({ apiKey: 'key' });
    const pairs = Array.from({ length: 23 }, (_, i) => ({ a: `a${i}`, b: `b${i}` }));
    const scores = (await judge.scorePairs(pairs)).map(s => s.score);

    const asked = fetchMock.mock.calls.map(([, init]) =>
      Object.keys((JSON.parse(String((init as RequestInit).body)) as { questions: object }).questions)
    );
    expect(asked).toEqual(pairs.map(() => ['q0']));
    expect(stats.max).toBe(10);
    expect(scores).toEqual(pairs.map((_, i) => i / 100));
  });

  it('a failed request leaves the other pairs scored, is not retried and is not cached', async () => {
    const stats = { inFlight: 0, max: 0 };
    let failing = true;
    const fetchMock = delayedFetch(i => (failing && i === 9 ? null : 0.8), stats);
    vi.stubGlobal('fetch', fetchMock);

    const judge = new JevClusterJudge({ apiKey: 'key' });
    const pairs = Array.from({ length: 13 }, (_, i) => ({ a: `a${i}`, b: `b${i}` }));
    const first = (await judge.scorePairs(pairs)).map(s => s.score);

    expect(fetchMock).toHaveBeenCalledTimes(13);
    expect(first.map(s => Number.isNaN(s))).toEqual(pairs.map((_, i) => i === 9));
    expect(first.filter(s => s === 0.8)).toHaveLength(12);

    failing = false;
    const second = await judge.scorePairs(pairs);
    expect(fetchMock).toHaveBeenCalledTimes(14);
    expect(second[9]).toEqual({ score: 0.8, cacheHit: false });
  });

  it('stops sending after a 429, scores the unsent pairs NaN and asks for them next time', async () => {
    let limited = true;
    let release!: () => void;
    const othersHeld = new Promise<void>(resolve => {
      release = resolve;
    });
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const { state } = JSON.parse(String(init?.body)) as { state: { a0: string } };
      if (limited && state.a0 === 'a0') {
        setTimeout(release, 10);
        return jsonResponse(429, {});
      }
      if (limited) {
        await othersHeld;
      }
      return jsonResponse(200, { answers: { q0: { noul: 0.7 } } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const warn = vi.spyOn(logger, 'warn');
    const judge = new JevClusterJudge({ apiKey: 'key' });
    const pairs = Array.from({ length: 25 }, (_, i) => ({ a: `a${i}`, b: 'b' }));
    const first = await judge.scorePairs(pairs);

    expect(fetchMock).toHaveBeenCalledTimes(10);
    expect(warn.mock.calls.map(([message]) => message)).toContain(
      'Consolidation judge: stopped after a 429 (15 requests not sent)'
    );
    expect(first.map(s => Number.isNaN(s.score))).toEqual(pairs.map((_, i) => i === 0 || i >= 10));

    warn.mockClear();
    limited = false;
    const second = await judge.scorePairs(pairs);
    expect(fetchMock).toHaveBeenCalledTimes(10 + 16);
    expect(second.every(s => s.score === 0.7)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it('times out each request on its own', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn().mockImplementation(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            const { state } = JSON.parse(String(init?.body)) as { state: { a0: string } };
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
            if (state.a0 !== 'a0') {
              setTimeout(() => resolve(jsonResponse(200, { answers: { q0: { noul: 0.7 } } })), 60);
            }
          })
      );
      vi.stubGlobal('fetch', fetchMock);

      const judge = new JevClusterJudge({ apiKey: 'key', timeoutMs: 100 });
      const pending = judge.scorePairs(Array.from({ length: 12 }, (_, i) => ({ a: `a${i}`, b: 'b' })));
      await vi.advanceTimersByTimeAsync(130);
      const scores = await pending;

      expect(scores[0]!.score).toBeNaN();
      expect(scores.slice(1).every(s => s.score === 0.7)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
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

  it('returns NaN when fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const judge = new JevClusterJudge({ apiKey: 'key' });
    const scores = (await judge.scorePairs([{ a: 'a', b: 'b' }])).map(s => s.score);
    expect(scores).toEqual([Number.NaN]);
  });

  it('returns NaN when the response has no answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => jsonResponse(200, { answers: {} })));

    const judge = new JevClusterJudge({ apiKey: 'key' });
    const scores = await judge.scorePairs([{ a: 'a0', b: 'b0' }]);
    expect(scores[0]!.score).toBeNaN();
  });
});

describe('#1668: JevClusterJudge score cache', () => {
  function answeringFetch(score = 0.8) {
    return vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { questions: Record<string, unknown> };
      const answers: Record<string, { noul: number }> = {};
      for (const key of Object.keys(body.questions)) {
        answers[key] = { noul: score };
      }
      return jsonResponse(200, { answers });
    });
  }

  function sentStates(fetchMock: ReturnType<typeof vi.fn>, call: number): string[] {
    const init = fetchMock.mock.calls[call]![1] as RequestInit;
    return Object.values((JSON.parse(String(init.body)) as { state: Record<string, string> }).state);
  }

  const pairs = [
    { a: 'seed', b: 'member one' },
    { a: 'seed', b: 'member two' }
  ];

  it('serves a repeated pair from cache without calling Jev', async () => {
    const fetchMock = answeringFetch();
    vi.stubGlobal('fetch', fetchMock);
    const judge = new JevClusterJudge({ apiKey: 'key' });

    const first = await judge.scorePairs(pairs);
    const second = await judge.scorePairs(pairs);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(first).toEqual([
      { score: 0.8, cacheHit: false },
      { score: 0.8, cacheHit: false }
    ]);
    expect(second).toEqual([
      { score: 0.8, cacheHit: true },
      { score: 0.8, cacheHit: true }
    ]);
  });

  it('re-judges only the pair whose content changed', async () => {
    const fetchMock = answeringFetch();
    vi.stubGlobal('fetch', fetchMock);
    const judge = new JevClusterJudge({ apiKey: 'key' });

    await judge.scorePairs(pairs);
    const second = await judge.scorePairs([pairs[0]!, { a: 'seed', b: 'member two edited' }]);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(sentStates(fetchMock, 2)).toEqual(['seed', 'member two edited']);
    expect(second.map(s => s.cacheHit)).toEqual([true, false]);
  });

  it('re-judges when the judge model changes', async () => {
    const fetchMock = answeringFetch();
    vi.stubGlobal('fetch', fetchMock);
    const scoreCache = new Map<string, number>();

    await new JevClusterJudge({ apiKey: 'key', model: 'jev-a', scoreCache }).scorePairs(pairs);
    const second = await new JevClusterJudge({ apiKey: 'key', model: 'jev-b', scoreCache }).scorePairs(pairs);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(second.every(s => !s.cacheHit)).toBe(true);
  });

  it('does not cache a failed or missing score', async () => {
    let answered = false;
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      const { state } = JSON.parse(String(init?.body)) as { state: { b0: string } };
      if (answered) {
        return jsonResponse(200, { answers: { q0: { noul: 0.8 } } });
      }
      return state.b0 === 'member one' ? jsonResponse(500, {}) : jsonResponse(200, { answers: {} });
    });
    vi.stubGlobal('fetch', fetchMock);
    const judge = new JevClusterJudge({ apiKey: 'key' });

    const first = await judge.scorePairs(pairs);
    expect(first.every(s => Number.isNaN(s.score) && !s.cacheHit)).toBe(true);

    answered = true;
    const second = await judge.scorePairs(pairs);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(second).toEqual([
      { score: 0.8, cacheHit: false },
      { score: 0.8, cacheHit: false }
    ]);
  });

  it('evicts the least recently used pair past the size limit', async () => {
    const fetchMock = answeringFetch();
    vi.stubGlobal('fetch', fetchMock);
    const judge = new JevClusterJudge({ apiKey: 'key', scoreCacheMaxEntries: 2 });
    const p = (b: string) => ({ a: 'seed', b });

    await judge.scorePairs([p('x'), p('y')]);
    await judge.scorePairs([p('x')]);
    await judge.scorePairs([p('z')]);
    const result = await judge.scorePairs([p('x'), p('y'), p('z')]);

    expect(result.map(s => s.cacheHit)).toEqual([true, false, true]);
    expect(sentStates(fetchMock, fetchMock.mock.calls.length - 1)).toEqual(['seed', 'y']);
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
