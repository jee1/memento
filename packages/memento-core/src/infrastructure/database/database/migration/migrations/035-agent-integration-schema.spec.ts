import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentIntegrationSchemaMigration } from './035-agent-integration-schema.js';

describe('AgentIntegrationSchemaMigration', () => {
  let db: Database.Database;
  let migration: AgentIntegrationSchemaMigration;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE memory_item (
        id TEXT PRIMARY KEY,
        session_id TEXT
      );
    `);
    migration = new AgentIntegrationSchemaMigration();
  });

  afterEach(() => {
    db.close();
  });

  it('creates the agent lifecycle tables and indexes additively', async () => {
    await migration.validateBefore(db);
    await migration.up(db);
    await migration.validateAfter(db);

    const objects = db
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type IN ('table', 'index')
      `)
      .all() as Array<{ name: string }>;
    const names = new Set(objects.map(({ name }) => name));

    for (const expectedName of [
      'agent_session',
      'agent_observation',
      'memory_provenance',
      'idx_agent_observation_timeline',
      'idx_agent_observation_expires_at',
      'idx_memory_provenance_observation',
    ]) {
      expect(names.has(expectedName)).toBe(true);
    }
  });

  it('removes only the additive agent integration schema on rollback', async () => {
    await migration.up(db);
    await migration.down(db);

    const remaining = db
      .prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name IN ('agent_session', 'agent_observation', 'memory_provenance')
      `)
      .all();

    expect(remaining).toEqual([]);
    expect(
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_item'`).get(),
    ).toBeTruthy();
  });

  it('refuses destructive rollback when agent integration data exists', async () => {
    await migration.up(db);
    db.prepare(`
      INSERT INTO agent_session (
        id, adapter_name, adapter_version, contract_version, status,
        started_at, last_event_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'session-1',
      'codex',
      '1.0.0',
      1,
      'ACTIVE',
      '2026-06-06T00:00:00.000Z',
      '2026-06-06T00:00:00.000Z',
      '2026-06-06T00:00:00.000Z',
      '2026-06-06T00:00:00.000Z',
    );

    await expect(migration.down(db)).rejects.toThrow('destructive cleanup');
    expect(
      db.prepare(`SELECT id FROM agent_session WHERE id = 'session-1'`).get(),
    ).toEqual({ id: 'session-1' });
  });

  it('preserves legacy memory session attribution reads', async () => {
    db.prepare('INSERT INTO memory_item (id, session_id) VALUES (?, ?)').run(
      'legacy-memory',
      'legacy-session',
    );

    await migration.up(db);

    expect(
      db.prepare('SELECT id FROM memory_item WHERE session_id = ?').all('legacy-session'),
    ).toEqual([{ id: 'legacy-memory' }]);
  });
});
