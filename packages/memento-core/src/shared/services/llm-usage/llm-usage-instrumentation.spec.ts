import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RetryManager } from '../../utils/retry-manager.js';
import { retryChatLlmCall } from '../chat-llm/chat-llm-retry.js';
import { LlmUsageTelemetryMigration } from '../../../infrastructure/database/sqlite/migration/migrations/058-llm-usage-telemetry.js';
import { LlmUsageRepository } from './llm-usage-repository.js';
import { setLlmUsageRepository } from './llm-usage-recorder.js';
import { runWithLlmUsageLogicalContext } from './llm-usage-logical-context.js';

describe('llm usage retry instrumentation (#1546)', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = new Database(':memory:');
    await new LlmUsageTelemetryMigration().up(db);
    setLlmUsageRepository(new LlmUsageRepository(db));
  });

  afterEach(() => {
    setLlmUsageRepository(null);
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
    });

    const rows = db
      .prepare(`SELECT outcome FROM llm_usage_attempt ORDER BY attempt_index ASC`)
      .all() as Array<{ outcome: string }>;
    expect(rows.map((r) => r.outcome)).toEqual(['rate_limited', 'rate_limited']);
  });

  it('records direct fetch style 429 on summarization path via repository', async () => {
    await runWithLlmUsageLogicalContext('consolidation_summarize', null, async () => {
      const repo = new LlmUsageRepository(db);
      repo.insertAttempt({
        logicalRequestId: 'logical-1',
        attemptIndex: 1,
        feature: 'consolidation_summarize',
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        outcome: 'rate_limited',
        attemptCoverage: 'full',
        inputTokens: 'unknown',
        outputTokens: 'unknown',
        createdAtUtc: '2026-06-01T12:00:00.000Z',
      });
    });
    const row = db.prepare(`SELECT pacific_date, usage_unknown FROM llm_usage_attempt`).get() as {
      pacific_date: string;
      usage_unknown: number;
    };
    expect(row.pacific_date).toBe('2026-06-01');
    expect(row.usage_unknown).toBe(1);
  });
});
