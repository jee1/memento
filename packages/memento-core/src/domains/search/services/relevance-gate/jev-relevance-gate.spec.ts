import { afterEach, describe, expect, it, vi } from 'vitest';
import { JevRelevanceGate } from './jev-relevance-gate.js';

const originalFetch = globalThis.fetch;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeGate(overrides: Partial<ConstructorParameters<typeof JevRelevanceGate>[0]> = {}) {
  return new JevRelevanceGate({
    apiKey: 'test-api-key',
    ...overrides,
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('JevRelevanceGate', () => {
  it('정상 응답에서 확률을 순서대로 뽑는다', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        model: 'jev-1.13.0',
        answers: {
          c0: { type: 'noul', noul: 0.01 },
          c1: { type: 'noul', noul: 0.9 },
        },
        usage: { input_tokens: 10, output_tokens: 2 },
      }),
    );

    const gate = makeGate();
    const scores = await gate.score('질의', ['a', 'b']);

    expect(scores).toEqual([0.01, 0.9]);
  });

  it('후보 K개를 1회 호출로 묶는다', async () => {
    // 실측에서 batch 288ms vs 후보별 2521ms 로 8.7배 차이가 났다.
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        model: 'jev-1.13.0',
        answers: {
          c0: { type: 'noul', noul: 0.1 },
          c1: { type: 'noul', noul: 0.2 },
          c2: { type: 'noul', noul: 0.3 },
          c3: { type: 'noul', noul: 0.4 },
          c4: { type: 'noul', noul: 0.5 },
        },
      }),
    );

    const gate = makeGate();
    const docs = ['a', 'b', 'c', 'd', 'e'];
    await gate.score('질의', docs);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('요청 본문 형태가 API 명세와 맞는다', async () => {
    // 이 4가지는 전부 실제로 4xx 를 맞고 확인한 제약이다. questions 를 배열로 주면
    // {"msg":"Input should be a valid dictionary"}, prompt 를 쓰면
    // {"detail":"Noul question must have criteria or instructions: c0"} 가 온다.
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        model: 'jev-latest',
        answers: { c0: { type: 'noul', noul: 0.5 } },
      }),
    );

    const gate = makeGate();
    await gate.score('질의', ['후보']);

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);

    expect(typeof body.model).toBe('string');
    expect(body.model).toBe('jev-latest');
    expect(Array.isArray(body.questions)).toBe(false);
    expect(typeof body.questions).toBe('object');
    expect(body.questions.c0.type).toBe('noul');
    expect(body.questions.c0).toHaveProperty('instructions');
    expect(body.questions.c0).not.toHaveProperty('prompt');
    expect(body.state.query).toBe('질의');
  });

  it('docChars 로 후보 본문을 자른다', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        model: 'jev-latest',
        answers: { c0: { type: 'noul', noul: 0.5 } },
      }),
    );

    const gate = makeGate({ docChars: 10 });
    const longDoc = 'a'.repeat(50);
    await gate.score('질의', [longDoc]);

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);

    expect(body.state.c0).toHaveLength(10);
  });

  it('WAF 차단(detail 없는 403)이면 전부 NaN 이고 재시도하지 않는다', async () => {
    // 지수 백오프 5회(1·2·4·8·16초)가 전부 실패했다 — 페이로드에 결정적이라 재시도가 무의미하다.
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(403, {}));

    const gate = makeGate();
    const scores = await gate.score('질의', ['a', 'b', 'c']);

    expect(scores).toHaveLength(3);
    expect(scores.every((s) => Number.isNaN(s))).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('인증 실패(detail 있는 403)도 예외 없이 NaN 배열이다', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse(403, {
        detail: { error_type: 'authentication_error', message: 'Must supply an API key!' },
      }),
    );

    const gate = makeGate();
    await expect(gate.score('질의', ['a', 'b'])).resolves.toEqual([Number.NaN, Number.NaN]);
  });

  it('500 응답도 NaN 배열이다', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(500, {}));

    const gate = makeGate();
    const scores = await gate.score('질의', ['a', 'b', 'c']);

    expect(scores).toHaveLength(3);
    expect(scores.every((s) => Number.isNaN(s))).toBe(true);
  });

  it('빈 후보 배열이면 네트워크 호출이 없다', async () => {
    globalThis.fetch = vi.fn();

    const gate = makeGate();
    const scores = await gate.score('질의', []);

    expect(scores).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
