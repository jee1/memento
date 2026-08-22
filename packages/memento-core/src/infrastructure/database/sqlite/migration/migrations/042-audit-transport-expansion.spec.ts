import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { MigrationDetector } from '../migration-detector.js';
import { AuditHashChainMigration } from './040-audit-hash-chain.js';

describe('audit transport expansion migration', () => {
  let db: Database.Database;

  beforeEach(async () => {
    db = new Database(':memory:');
    db.exec('CREATE TABLE memory_item (id TEXT PRIMARY KEY)');
    await new AuditHashChainMigration().up(db);
    db.prepare(`
      INSERT INTO audit_log (
        id, transport, tool_or_endpoint, action, result_status, evidence_mode,
        request_seen, response_seen, tool_args_state, output_state, audit_verdict, current_hash
      ) VALUES ('existing', 'mcp_http', 'recall', 'read', 'success', 'metadata_only', 1, 1, 'omitted', 'omitted', 'pass', 'existing-hash')
    `).run();
  });

  afterEach(() => db.close());

  it('preserves existing rows while adding mcp_ws and rest to the validated vocabulary', async () => {
    const migrations = await new MigrationDetector().detectAllMigrations();
    const detected = migrations.find(({ migration }) => migration.version === '42.0');
    expect(detected, 'migration 42.0 must be discoverable').toBeDefined();
    if (!detected) return;

    await detected.migration.up(db);
    await expect(detected.migration.validateAfter(db)).resolves.toBeUndefined();

    expect(db.prepare('SELECT id, transport FROM audit_log').all()).toEqual([
      { id: 'existing', transport: 'mcp_http' },
    ]);
    for (const transport of ['mcp_ws', 'rest']) {
      expect(() => db.prepare(`
        INSERT INTO audit_log (
          id, transport, tool_or_endpoint, action, result_status, evidence_mode,
          request_seen, response_seen, tool_args_state, output_state, audit_verdict, current_hash
        ) VALUES (?, ?, 'remember', 'write', 'success', 'metadata_only', 1, 1, 'omitted', 'omitted', 'pass', ?)
      `).run(`entry-${transport}`, transport, `hash-${transport}`)).not.toThrow();
    }

    expect(() => db.prepare("UPDATE audit_log SET result_status = 'failure' WHERE id = 'existing'").run())
      .toThrow('audit_log is append-only');
    expect(() => db.prepare("DELETE FROM audit_log WHERE id = 'existing'").run())
      .toThrow('audit_log is append-only');
  });
});
