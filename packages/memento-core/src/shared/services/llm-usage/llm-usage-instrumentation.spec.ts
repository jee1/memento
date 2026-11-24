import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RetryManager } from '../../utils/retry-manager.js';
import { retryChatLlmCall } from '../chat-llm/chat-llm-retry.js';
import { JevClusterJudge } from '../../../domains/consolidation/services/cluster-judge.js';
import { SummarizationService } from '../../../domains/consolidation/services/summarization-service.js';
import { JevRelationJudge } from '../../../domains/relation/services/jev-relation-judge.js';
import { JevRelevanceGate } from '../../../domains/search/services/relevance-gate/jev-relevance-gate.js';
import type { UnifiedEmbeddingService } from '../../../domains/embedding/index.js';
import type { MemoryItem } from '../../types/memory.types.js';
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
    const answers = { q0: { noul: 0.7 }, c0: { noul: 0.7 }, r0: { noul: 0.1 } };
    const usage = { input_tokens: 688, output_tokens: 21 };

    function respondWith(...bodies: Array<{ status?: number; body: unknown }>): void {
      const queue = [...bodies];
      global.fetch = vi.fn().mockImplementation(async () => {
        const { status = 200, body } = queue.length > 1 ? queue.shift()! : queue[0]!;
        return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
      }) as typeof fetch;
    }

    function client(): SystemOneClient {
      return new SystemOneClient({ apiKey: 'test-api-key' });
    }

    function memory(id: string): MemoryItem {
      return {
        id,
        type: 'episodic',
        content: id,
        importance: 0.5,
        privacy_scope: 'private',
        created_at: new Date('2026-01-01T00:00:00.000Z'),
        pinned: false,
      };
    }

    const noEmbedding = {
      generateEmbedding: () => Promise.reject(new Error('pool should not embed under the limit')),
    } as unknown as UnifiedEmbeddingService;

    const callers: Record<string, () => Promise<unknown>> = {
      cluster_judge: () =>
        new JevClusterJudge({ apiKey: 'test-api-key' }).scorePairs([{ a: 'alpha', b: 'beta' }]),
      relevance_gate: () => new JevRelevanceGate(client(), 'jev-latest').score('query', ['doc']),
      relation_extraction: () =>
        runWithLlmUsageLogicalContext('relation_extraction', null, () =>
          new JevRelationJudge(client(), noEmbedding).judge(memory('source'), [memory('target')]),
        ),
    };

    function attempts() {
      return db
        .prepare(
          `SELECT feature, outcome, failure_reason AS reason, input_tokens AS input, output_tokens AS output,
                  usage_unknown AS unknown
           FROM llm_usage_attempt`,
        )
        .all();
    }

    for (const [feature, call] of Object.entries(callers)) {
      const success = { feature, outcome: 'success', reason: null };

      it.each([
        ['both counts', { usage }, { input: 688, output: 21, unknown: 0 }],
        ['a zero count', { usage: { input_tokens: 688, output_tokens: 0 } }, { input: 688, output: 0, unknown: 0 }],
        ['one missing count', { usage: { input_tokens: 688 } }, { input: 688, output: null, unknown: 1 }],
        ['no usage', {}, { input: null, output: null, unknown: 1 }],
        ['null usage', { usage: null }, { input: null, output: null, unknown: 1 }],
        ['a string count', { usage: { ...usage, input_tokens: '688' } }, { input: null, output: 21, unknown: 1 }],
        ['a negative count', { usage: { ...usage, input_tokens: -1 } }, { input: null, output: 21, unknown: 1 }],
        ['a fractional count', { usage: { ...usage, input_tokens: 1.5 } }, { input: null, output: 21, unknown: 1 }],
        ['an unsafe count', { usage: { ...usage, input_tokens: 1e300 } }, { input: null, output: 21, unknown: 1 }],
      ])(`${feature}: %s`, async (_name, extra, recorded) => {
        respondWith({ body: { answers, ...extra } });
        await call();
        expect(attempts()).toEqual([{ ...success, ...recorded }]);
      });
    }

    it('records the retry\'s counts after a WAF block, with partial coverage', async () => {
      respondWith({ status: 403, body: {} }, { body: { answers, usage } });
      await new JevRelevanceGate(client(), 'jev-latest').score('query', ['```js\ncode\n```']);
      expect(attempts()).toEqual([
        { feature: 'relevance_gate', outcome: 'success', reason: null, input: 688, output: 21, unknown: 0 },
      ]);
      expect(db.prepare(`SELECT attempt_coverage AS coverage FROM llm_usage_attempt`).get()).toEqual({
        coverage: 'partial',
      });
    });

    it('cluster_judge: a 200 body that is not JSON is one parse failure without the body text', async () => {
      respondWith({ body: '<h>429 secret' });
      await callers.cluster_judge!();
      expect(attempts()).toEqual([
        { feature: 'cluster_judge', outcome: 'failure', reason: 'parse', input: null, output: null, unknown: 1 },
      ]);
    });
  });
});
