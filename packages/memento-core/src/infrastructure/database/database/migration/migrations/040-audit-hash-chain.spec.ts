import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { AuditHashChainMigration } from './040-audit-hash-chain.js';

describe('AuditHashChainMigration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec('CREATE TABLE memory_item (id TEXT PRIMARY KEY)');
  });

  afterEach(() => db.close());

  it('creates an append-only audit schema with validated vocabulary', async () => {
    const migration = new AuditHashChainMigration();
    await migration.up(db);
    await expect(migration.validateAfter(db)).resolves.toBeUndefined();

    const columns = db.prepare('PRAGMA table_info(audit_log)').all() as Array<{ name: string }>;
    expect(columns.map(({ name }) => name)).toEqual(expect.arrayContaining([
      'actor_id', 'owner_id', 'agent_id', 'transport', 'tool_or_endpoint', 'action',
      'target_uri', 'evidence_mode', 'audit_verdict', 'previous_hash', 'current_hash',
    ]));
    expect(() => db.prepare(`
      INSERT INTO audit_log (
        id, transport, tool_or_endpoint, action, result_status, evidence_mode,
        request_seen, response_seen, tool_args_state, output_state, audit_verdict, current_hash
      ) VALUES ('invalid', 'other', 'remember', 'write', 'success', 'metadata_only', 1, 1, 'omitted', 'omitted', 'pass', 'hash')
    `).run()).toThrow(/CHECK constraint failed/);
  });

  it('rejects updates and deletes after a record is appended', async () => {
    await new AuditHashChainMigration().up(db);
    db.prepare(`
      INSERT INTO audit_log (
        id, transport, tool_or_endpoint, action, result_status, evidence_mode,
        request_seen, response_seen, tool_args_state, output_state, audit_verdict, current_hash
      ) VALUES ('entry', 'mcp_stdio', 'remember', 'write', 'success', 'metadata_only', 1, 1, 'omitted', 'omitted', 'pass', 'hash')
    `).run();

    expect(() => db.prepare("UPDATE audit_log SET result_status = 'failure' WHERE id = 'entry'").run())
      .toThrow('audit_log is append-only');
    expect(() => db.prepare("DELETE FROM audit_log WHERE id = 'entry'").run())
      .toThrow('audit_log is append-only');
  });
});
