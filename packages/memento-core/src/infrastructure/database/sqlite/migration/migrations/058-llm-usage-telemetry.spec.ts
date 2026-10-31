import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { LlmUsageTelemetryMigration } from './058-llm-usage-telemetry.js';

describe('058-llm-usage-telemetry', () => {
  it('creates attempt and logical tables', async () => {
    const db = new Database(':memory:');
    const migration = new LlmUsageTelemetryMigration();
    await migration.up(db);
    await migration.validateAfter(db);
    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'llm_usage_%' ORDER BY name`)
      .all() as Array<{ name: string }>;
    expect(tables.map((t) => t.name)).toEqual(['llm_usage_attempt', 'llm_usage_logical']);
    db.close();
  });
});
