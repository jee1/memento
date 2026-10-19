import { afterEach, describe, expect, it, vi } from 'vitest';
import { SystemOneClient } from './system-one-client.js';

const originalFetch = globalThis.fetch;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function client(timeoutMs = 1500): SystemOneClient {
  return new SystemOneClient({ apiKey: 'test-api-key', timeoutMs });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('SystemOneClient.ask', () => {
  it('copies finite noul scores and drops the rest', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        model: 'jev-latest',
        answers: {
          keep: { type: 'noul', noul: 0.42 },
          missing: { type: 'noul' },
          text: { noul: '0.9' },
          notFinite: { noul: Number.NaN },
          nested: 'nope',
        },
      }),
    );

    const result = await client().ask(
      { s: 'source' },
      [{ id: 'keep', instructions: '질문' }],
    );

    expect(result).toEqual({
      ok: true,
      noulById: new Map([['keep', 0.42]]),
      wafRetried: false,
    });
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.typesafe.ai/v1/systemone');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-api-key');
    const body = JSON.parse(init.body as string);
    expect(body.questions.keep).toEqual({ type: 'noul', instructions: '질문' });
    expect(Array.isArray(body.questions)).toBe(false);
  });

  it('retries a WAF block once with fences removed from state', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(403, {}))
      .mockResolvedValueOnce(
        jsonResponse(200, { answers: { q: { noul: 0.2 } } }),
      );
    globalThis.fetch = fetchMock;

    const result = await client().ask(
      { doc: '```\ncurl -s x\n```' },
      [{ id: 'q', instructions: '관련 있다' }],
    );

    expect(result).toEqual({
      ok: true,
      noulById: new Map([['q', 0.2]]),
      wafRetried: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string);
    const secondBody = JSON.parse((fetchMock.mock.calls[1] as [string, RequestInit])[1].body as string);
    expect(firstBody.state.doc).toContain('```');
    expect(secondBody.state.doc).not.toContain('```');
    expect(secondBody.state.doc).toContain('curl -s x');
  });

  it('does not retry a WAF block when no state value has a fence', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(403, {}));

    const result = await client().ask(
      { doc: 'cat /etc/passwd' },
      [{ id: 'q', instructions: '관련 있다' }],
    );

    expect(result).toEqual({ ok: false, reason: 'waf', wafRetried: false });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('treats 401 and 403-with-detail as auth and does not retry', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(401, {}))
      .mockResolvedValueOnce(jsonResponse(403, { detail: { error_type: 'authentication_error' } }));
    globalThis.fetch = fetchMock;

    const questions = [{ id: 'q', instructions: '관련 있다' }];
    const fenced = { doc: '```bash\ncurl -s\n```' };

    await expect(client().ask(fenced, questions)).resolves.toEqual({
      ok: false,
      reason: 'auth',
      wafRetried: false,
    });
    await expect(client().ask(fenced, questions)).resolves.toEqual({
      ok: false,
      reason: 'auth',
      wafRetried: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports timeout when the abort fires and does not throw', async () => {
    globalThis.fetch = vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }));

    const result = await client(30).ask(
      { doc: '```fence```' },
      [{ id: 'q', instructions: '관련 있다' }],
    );

    expect(result).toEqual({ ok: false, reason: 'timeout', wafRetried: false });
  });

  it('does not call the network for an empty question list', async () => {
    globalThis.fetch = vi.fn();

    const result = await client().ask({ doc: 'x' }, []);

    expect(result).toEqual({ ok: true, noulById: new Map(), wafRetried: false });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
