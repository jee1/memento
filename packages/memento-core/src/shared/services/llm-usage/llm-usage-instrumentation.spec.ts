import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RetryManager } from '../../utils/retry-manager.js';
import { retryChatLlmCall } from '../chat-llm/chat-llm-retry.js';
import { JevClusterJudge } from '../../../domains/consolidation/services/cluster-judge.js';
import { SummarizationService } from '../../../domains/consolidation/services/summarization-service.js';
import { SystemOneClient } from '../typesafe/system-one-client.js';
import { LlmUsageTelemetryMigration } from '../../../infrastructure/database/sqlite/migration/migrations/058-llm-usage-telemetry.js';
import { LlmUsageRepository } from './llm-usage-repository.js';
import { recordLlmUsageAttempt, setLlmUsageRepository } from './llm-usage-recorder.js';
import { runWithLlmUsageLogicalContext } from './llm-usage-logical-context.js';
import { recordSystemOneUsageAttempt } from './llm-usage-systemone-attempt.js';

function episodicRow(id: string, content: string) {
  return {
    id,
    content,
    importance: 0.5,
    ownerId: null,
    createdAt: new Date().toISOString(),
    pinned: false,
    isConsolidated: false,
  };
}

describe('llm usage retry instrumentation (#1546)', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = new Database(':memory:');
    await new LlmUsageTelemetryMigration().up(db);
    setLlmUsageRepository(new LlmUsageRepository(db));
  });

  afterEach(() => {
    setLlmUsageRepository(null);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    db.close();
  });

  it('counts two rate_limited attempts then success as 3 attempts', async () => {
    const retryManager = new RetryManager({ maxAttempts: 3, baseDelay: 1 });
    let calls = 0;
    await runWithLlmUsageLogicalContext('relation_extraction', null, async () => {
      const { latencyMs } = await retryChatLlmCall(
        retryManager,
        { provider: 'gemini', model: 'gemini-2.0-flash', transient: 'cloud' },
        async () => {
          calls += 1;
          if (calls < 3) {
            throw new Error('429 rate limit exceeded');
          }
          return 'ok';
        },
      );
      recordLlmUsageAttempt({
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        outcome: 'success',
        attemptCoverage: 'full',
        inputTokens: 'unknown',
        outputTokens: 'unknown',
        latencyMs,
      });
    });

    const rows = db
      .prepare(`SELECT outcome FROM llm_usage_attempt ORDER BY attempt_index ASC`)
      .all() as Array<{ outcome: string }>;
    expect(rows.map((r) => r.outcome)).toEqual(['rate_limited', 'rate_limited', 'success']);
  });

  it('records latency_ms as a non-negative number on failure and success attempts (#1669)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const retryManager = new RetryManager({ maxAttempts: 2, baseDelay: 1 });
    let calls = 0;
    try {
      await runWithLlmUsageLogicalContext('relevance_gate', null, async () => {
        const { latencyMs } = await retryChatLlmCall(
          retryManager,
          { provider: 'openai', model: 'gpt-4o-mini', transient: 'cloud' },
          async () => {
            calls += 1;
            vi.advanceTimersByTime(12);
            if (calls < 2) {
              throw new Error('429 rate limit exceeded');
            }
            return 'ok';
          },
        );
        recordLlmUsageAttempt({
          provider: 'openai',
          model: 'gpt-4o-mini',
          outcome: 'success',
          attemptCoverage: 'full',
          inputTokens: 'unknown',
          outputTokens: 'unknown',
          latencyMs,
        });
      });
    } finally {
      vi.useRealTimers();
    }

    const rows = db
      .prepare(`SELECT outcome, latency_ms AS latencyMs FROM llm_usage_attempt ORDER BY attempt_index ASC`)
      .all() as Array<{ outcome: string; latencyMs: number | null }>;
    expect(rows.map((r) => r.outcome)).toEqual(['rate_limited', 'success']);
    for (const row of rows) {
      expect(typeof row.latencyMs).toBe('number');
      expect(row.latencyMs).toBeGreaterThanOrEqual(0);
    }

    await runWithLlmUsageLogicalContext('cluster_judge', null, () => {
      recordSystemOneUsageAttempt('jev-latest', { ok: true, noulById: new Map(), wafRetried: false }, 34);
      return undefined;
    });
    const systemOne = db
      .prepare(
        `SELECT latency_ms AS latencyMs FROM llm_usage_attempt WHERE provider = 'typesafe' ORDER BY rowid DESC LIMIT 1`,
      )
      .get() as { latencyMs: number | null };
    expect(systemOne.latencyMs).toBe(34);
  });

  it('records direct fetch 429 on summarization path', async () => {
    vi.stubEnv('GEMINI_API_KEY', 'g-test');
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({}),
    }) as typeof fetch;

    const svc = new SummarizationService({
      llmProvider: 'gemini',
      llmProviderOverrides: {},
      llmModelOverrides: {},
      openaiLlmModel: 'gpt-4o-mini',
      geminiLlmModel: 'gemini-2.0-flash',
      ollamaModel: 'llama3',
      ollamaBaseUrl: 'http://ollama.test:11434',
    });
    const out = await svc.summarizeCluster({
      clusterEpisodes: [episodicRow('1', 'episode body')],
    });
    expect(out.ok).toBe(false);
    const row = db.prepare(`SELECT outcome, usage_unknown FROM llm_usage_attempt`).get() as {
      outcome: string;
      usage_unknown: number;
    };
    expect(row.outcome).toBe('rate_limited');
    expect(row.usage_unknown).toBe(1);
    expect(global.fetch).toHaveBeenCalled();
  });

  it('ollama summarization success records one attempt with adapter tokens (#1672)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { content: '  ollama summary  ' },
        prompt_eval_count: 11,
        eval_count: 7,
      }),
      text: async () => '',
    }) as typeof fetch;

    const svc = new SummarizationService({
      llmProvider: 'ollama',
      llmProviderOverrides: { consolidation: 'ollama' },
      llmModelOverrides: {},
      openaiLlmModel: 'gpt-4o-mini',
      geminiLlmModel: 'gemini-2.0-flash',
      ollamaModel: 'llama3',
      ollamaBaseUrl: 'http://ollama.test:11434',
    });
    const out = await svc.summarizeCluster({
      clusterEpisodes: [episodicRow('1', 'episode body')],
    });
    expect(out.ok).toBe(true);

    const rows = db
      .prepare(
        `SELECT outcome, input_tokens AS inputTokens, output_tokens AS outputTokens
         FROM llm_usage_attempt ORDER BY attempt_index ASC`,
      )
      .all() as Array<{ outcome: string; inputTokens: number | null; outputTokens: number | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: 'success', inputTokens: 11, outputTokens: 7 });
  });

  it('ollama empty response keeps one success attempt and defers (#1672)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        message: { content: '   ' },
        prompt_eval_count: 3,
        eval_count: 0,
      }),
      text: async () => '',
    }) as typeof fetch;

    const svc = new SummarizationService({
      llmProvider: 'ollama',
      llmProviderOverrides: { consolidation: 'ollama' },
      llmModelOverrides: {},
      openaiLlmModel: 'gpt-4o-mini',
      geminiLlmModel: 'gemini-2.0-flash',
      ollamaModel: 'llama3',
      ollamaBaseUrl: 'http://ollama.test:11434',
    });
    const out = await svc.summarizeCluster({
      clusterEpisodes: [episodicRow('1', 'episode body')],
    });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.reason).toBe('empty_response');
    }

    const attempts = db
      .prepare(`SELECT outcome FROM llm_usage_attempt ORDER BY attempt_index ASC`)
      .all() as Array<{ outcome: string }>;
    expect(attempts).toEqual([{ outcome: 'success' }]);

    const logical = db
      .prepare(`SELECT final_path AS finalPath, final_reason AS finalReason FROM llm_usage_logical`)
      .get() as { finalPath: string; finalReason: string | null };
    expect(logical).toMatchObject({ finalPath: 'deferred', finalReason: 'empty_response' });
  });

  it('ollama HTTP failure records one attempt (#1672)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
      text: async () => 'down',
    }) as typeof fetch;

    const svc = new SummarizationService({
      llmProvider: 'ollama',
      llmProviderOverrides: { consolidation: 'ollama' },
      llmModelOverrides: {},
      openaiLlmModel: 'gpt-4o-mini',
      geminiLlmModel: 'gemini-2.0-flash',
      ollamaModel: 'llama3',
      ollamaBaseUrl: 'http://ollama.test:11434',
    });
    const out = await svc.summarizeCluster({
      clusterEpisodes: [episodicRow('1', 'episode body')],
    });
    expect(out.ok).toBe(false);

    const rows = db
      .prepare(`SELECT outcome, failure_reason AS failureReason FROM llm_usage_attempt`)
      .all() as Array<{ outcome: string; failureReason: string | null }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: 'failure', failureReason: 'http_503' });
  });

  describe('typesafe response usage (#1831)', () => {
    const answers = { q0: { noul: 0.7 }, m0: { noul: 0.7 } };

    function respondWith(body: unknown): void {
      global.fetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
    }

    const callers = {
      cluster_judge: () =>
        new JevClusterJudge({ apiKey: 'test-api-key' }).scorePairs([{ a: 'alpha', b: 'beta' }]),
      relevance_gate: () =>
        runWithLlmUsageLogicalContext('relevance_gate', null, async () => {
          const result = await new SystemOneClient({ apiKey: 'test-api-key' }).ask(
            { s: 'source' },
            [{ id: 'm0', instructions: 'question' }],
          );
          recordSystemOneUsageAttempt('jev-latest', result, 10);
        }),
    };

    function attempts() {
      return db
        .prepare(
          `SELECT feature, outcome, input_tokens AS input, output_tokens AS output, usage_unknown AS unknown
           FROM llm_usage_attempt`,
        )
        .all();
    }

    for (const [feature, call] of Object.entries(callers)) {
      it(`${feature}: records the token counts the provider returned`, async () => {
        respondWith({ answers, usage: { input_tokens: 688, output_tokens: 21 } });
        await call();
        expect(attempts()).toEqual([{ feature, outcome: 'success', input: 688, output: 21, unknown: 0 }]);
      });

      it.each([
        ['no usage', {}],
        ['null usage', { usage: null }],
        ['non-numeric counts', { usage: { input_tokens: '688', output_tokens: -1 } }],
      ])(`${feature}: %s stays unknown`, async (_name, extra) => {
        respondWith({ answers, ...extra });
        await call();
        expect(attempts()).toEqual([{ feature, outcome: 'success', input: null, output: null, unknown: 1 }]);
      });

      it(`${feature}: a missing count leaves the other one recorded`, async () => {
        respondWith({ answers, usage: { input_tokens: 688 } });
        await call();
        expect(attempts()).toEqual([{ feature, outcome: 'success', input: 688, output: null, unknown: 1 }]);
      });
    }

    it('cluster_judge: a 200 body that is not JSON is one failure', async () => {
      global.fetch = vi.fn().mockImplementation(async () => new Response('not json', { status: 200 })) as typeof fetch;
      await callers.cluster_judge();
      expect(attempts()).toEqual([
        { feature: 'cluster_judge', outcome: 'failure', input: null, output: null, unknown: 1 },
      ]);
    });
  });
});
