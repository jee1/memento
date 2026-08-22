import type Database from 'better-sqlite3';

const BASE_TRANSPORTS = "'mcp_stdio', 'mcp_http', 'http_admin'";
const ALL_TRANSPORTS = "'mcp_stdio', 'mcp_http', 'mcp_ws', 'rest', 'http_admin'";

export function createAuditLogTable(
  db: Database.Database,
  tableName: 'audit_log' | 'audit_log_next' = 'audit_log',
  includeToolTransports = true,
): void {
  const transports = includeToolTransports ? ALL_TRANSPORTS : BASE_TRANSPORTS;
  db.exec(`
    CREATE TABLE ${tableName} (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      actor_id TEXT,
      owner_id TEXT,
      agent_id TEXT,
      transport TEXT NOT NULL CHECK (transport IN (${transports})),
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
    )
  `);
}

export function createAuditLogIndexesAndTriggers(db: Database.Database): void {
  db.exec(`
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

export function rebuildAuditLogTransportCheck(
  db: Database.Database,
  includeToolTransports = true,
): void {
  const rebuild = db.transaction(() => {
    db.exec(`
      DROP TRIGGER IF EXISTS audit_log_prevent_update;
      DROP TRIGGER IF EXISTS audit_log_prevent_delete;
      DROP TABLE IF EXISTS audit_log_next;
    `);
    createAuditLogTable(db, 'audit_log_next', includeToolTransports);
    db.exec(`
      INSERT INTO audit_log_next (
        id, timestamp, actor_id, owner_id, agent_id, transport, tool_or_endpoint, action,
        target_uri, result_status, evidence_mode, request_seen, response_seen, tool_args_state,
        output_state, audit_verdict, coverage_gap, previous_hash, current_hash
      )
      SELECT
        id, timestamp, actor_id, owner_id, agent_id, transport, tool_or_endpoint, action,
        target_uri, result_status, evidence_mode, request_seen, response_seen, tool_args_state,
        output_state, audit_verdict, coverage_gap, previous_hash, current_hash
      FROM audit_log;
      DROP TABLE audit_log;
      ALTER TABLE audit_log_next RENAME TO audit_log;
    `);
    createAuditLogIndexesAndTriggers(db);
  });
  rebuild();
}
