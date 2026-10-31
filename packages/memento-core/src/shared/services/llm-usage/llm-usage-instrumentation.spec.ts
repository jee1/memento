import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RetryManager } from '../../utils/retry-manager.js';
import { retryChatLlmCall } from '../chat-llm/chat-llm-retry.js';
import { SummarizationService } from '../../../domains/consolidation/services/summarization-service.js';
import { LlmUsageTelemetryMigration } from '../../../infrastructure/database/sqlite/migration/migrations/058-llm-usage-telemetry.js';
import { LlmUsageRepository } from './llm-usage-repository.js';
import { recordLlmUsageAttempt, setLlmUsageRepository } from './llm-usage-recorder.js';
import { runWithLlmUsageLogicalContext } from './llm-usage-logical-context.js';

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
      await retryChatLlmCall(
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
      });
    });

    const rows = db
      .prepare(`SELECT outcome FROM llm_usage_attempt ORDER BY attempt_index ASC`)
      .all() as Array<{ outcome: string }>;
    expect(rows.map((r) => r.outcome)).toEqual(['rate_limited', 'rate_limited', 'success']);
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
});
