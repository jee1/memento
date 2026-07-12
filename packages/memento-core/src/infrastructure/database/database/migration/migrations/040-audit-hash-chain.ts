import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

function tableExists(db: Database.Database, table: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
}

export class AuditHashChainMigration implements Migration {
  version = '40.0';
  name = 'audit-hash-chain';
  description = 'Add append-only tamper-evident audit chain';

  async validateBefore(db: Database.Database): Promise<void> {
    if (!tableExists(db, 'memory_item')) throw new Error('memory_item table does not exist');
  }

  async up(db: Database.Database): Promise<void> {
    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        actor_id TEXT,
        owner_id TEXT,
        agent_id TEXT,
        transport TEXT NOT NULL CHECK (transport IN ('mcp_stdio', 'mcp_http', 'http_admin')),
        tool_or_endpoint TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('read', 'write', 'delete', 'admin', 'auth_denied')),
        target_uri TEXT,
        result_status TEXT NOT NULL CHECK (result_status IN ('success', 'failure', 'denied')),
        evidence_mode TEXT NOT NULL CHECK (evidence_mode IN ('full', 'redacted', 'metadata_only', 'unavailable')),
        request_seen INTEGER NOT NULL CHECK (request_seen IN (0, 1)),
        response_seen INTEGER NOT NULL CHECK (response_seen IN (0, 1)),
        tool_args_state TEXT NOT NULL CHECK (tool_args_state IN ('captured', 'redacted', 'omitted')),
        output_state TEXT NOT NULL CHECK (output_state IN ('captured', 'truncated', 'omitted')),
        audit_verdict TEXT NOT NULL CHECK (audit_verdict IN ('pass', 'fail', 'incomplete')),
        coverage_gap TEXT CHECK (coverage_gap IS NULL OR coverage_gap IN (
          'audit_write_failed', 'actor_unverified', 'payload_redacted', 'output_truncated', 'retention_conflict'
        )),
        previous_hash TEXT,
        current_hash TEXT NOT NULL UNIQUE
      );

      CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_log_filter ON audit_log(action, transport, timestamp);
      CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_id, timestamp);

      CREATE TRIGGER IF NOT EXISTS audit_log_prevent_update
      BEFORE UPDATE ON audit_log
      BEGIN
        SELECT RAISE(ABORT, 'audit_log is append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS audit_log_prevent_delete
      BEFORE DELETE ON audit_log
      BEGIN
        SELECT RAISE(ABORT, 'audit_log is append-only');
      END;
    `);
  }

  async down(db: Database.Database): Promise<void> {
    db.exec('DROP TABLE IF EXISTS audit_log');
    if (tableExists(db, 'memento_schema_version')) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run(this.version);
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (!tableExists(db, 'audit_log')) throw new Error('Migration 040 did not create audit_log table');
  }
}
export default AuditHashChainMigration;
