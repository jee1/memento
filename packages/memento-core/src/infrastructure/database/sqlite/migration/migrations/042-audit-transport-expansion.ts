import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';
import { rebuildAuditLogTransportCheck } from './audit-log-schema.js';

function auditTableSql(db: Database.Database): string {
  return (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'audit_log'").get() as {
    sql?: string;
  } | undefined)?.sql ?? '';
}

export class AuditTransportExpansionMigration implements Migration {
  version = '42.0';
  name = 'audit-transport-expansion';
  description = 'Add WebSocket and REST tool transports to the audit vocabulary';

  async validateBefore(db: Database.Database): Promise<void> {
    if (!auditTableSql(db)) throw new Error('audit_log table does not exist');
  }

  async up(db: Database.Database): Promise<void> {
    const sql = auditTableSql(db);
    if (sql.includes("'mcp_ws'") && sql.includes("'rest'")) return;
    rebuildAuditLogTransportCheck(db);
  }

  async down(db: Database.Database): Promise<void> {
    const extendedRows = db.prepare(
      "SELECT COUNT(*) AS count FROM audit_log WHERE transport IN ('mcp_ws', 'rest')"
    ).get() as { count: number };
    if (extendedRows.count > 0) {
      throw new Error('Cannot remove audit transports while mcp_ws or rest records exist');
    }
    rebuildAuditLogTransportCheck(db, false);
    if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'memento_schema_version'").get()) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run(this.version);
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    const sql = auditTableSql(db);
    if (!sql.includes("'mcp_ws'") || !sql.includes("'rest'")) {
      throw new Error('Migration 042 did not add mcp_ws and rest audit transports');
    }
  }
}

export default AuditTransportExpansionMigration;
