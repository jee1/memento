import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LlmUsageTelemetryMigration } from '../../../infrastructure/database/sqlite/migration/migrations/058-llm-usage-telemetry.js';
import { runWithLlmUsageLogicalContext } from './llm-usage-logical-context.js';
import {
  recordLlmUsageAttempt,
  recordLlmUsageLogicalFinal,
  setLlmUsageRepository,
} from './llm-usage-recorder.js';
import { LlmUsageRepository } from './llm-usage-repository.js';

describe('llm usage recorder resilience (#1546)', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = new Database(':memory:');
    await new LlmUsageTelemetryMigration().up(db);
  });

  afterEach(() => {
    setLlmUsageRepository(null);
    db.close();
  });

  it('continues logical work when insertAttempt throws', async () => {
    const repo = new LlmUsageRepository(db);
    vi.spyOn(repo, 'insertAttempt').mockImplementation(() => {
      throw new Error('disk full');
    });
    setLlmUsageRepository(repo);

    let ran = false;
    await runWithLlmUsageLogicalContext('relation_extraction', null, async () => {
      recordLlmUsageAttempt({
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        outcome: 'success',
        attemptCoverage: 'full',
        inputTokens: 'unknown',
        outputTokens: 'unknown',
      });
      ran = true;
    });
    expect(ran).toBe(true);
    expect(db.prepare(`SELECT COUNT(*) AS c FROM llm_usage_attempt`).get()).toEqual({ c: 0 });
  });

  it('continues when insertLogical throws', async () => {
    const repo = new LlmUsageRepository(db);
    vi.spyOn(repo, 'insertLogical').mockImplementation(() => {
      throw new Error('disk full');
    });
    setLlmUsageRepository(repo);

    await runWithLlmUsageLogicalContext('consolidation_summarize', null, async () => {
      recordLlmUsageLogicalFinal({ finalPath: 'llm', provider: 'openai', model: 'gpt-4o-mini' });
    });
    expect(db.prepare(`SELECT COUNT(*) AS c FROM llm_usage_logical`).get()).toEqual({ c: 0 });
  });
});
