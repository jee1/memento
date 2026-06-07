import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

const AGENT_MEMORY_PROMOTION_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS agent_memory_promotion_candidate (
  id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  summary_memory_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('semantic', 'procedural')),
  category TEXT NOT NULL CHECK (category IN ('decision', 'error_resolution', 'procedure')),
  content TEXT NOT NULL,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence_observation_ids_json TEXT NOT NULL,
  merge_target_memory_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  memory_id TEXT,
  rejection_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  reviewed_at TEXT,
  FOREIGN KEY (session_id) REFERENCES agent_session(id) ON DELETE CASCADE,
  FOREIGN KEY (summary_memory_id) REFERENCES memory_item(id) ON DELETE CASCADE,
  FOREIGN KEY (merge_target_memory_id) REFERENCES memory_item(id) ON DELETE SET NULL,
  FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_memory_promotion_queue
  ON agent_memory_promotion_candidate(status, confidence DESC, created_at);
CREATE INDEX IF NOT EXISTS idx_agent_memory_promotion_session
  ON agent_memory_promotion_candidate(session_id, created_at);
`;

function objectExists(db: Database.Database, type: 'table' | 'index', name: string): boolean {
  return Boolean(
    db.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get(type, name),
  );
}

export class AgentMemoryPromotionSchemaMigration implements Migration {
  version = '36.0';
  name = 'agent-memory-promotion-schema';
  description = 'Add reviewable semantic and procedural promotion candidates';

  async validateBefore(db: Database.Database): Promise<void> {
    for (const table of ['memory_item', 'agent_session', 'agent_observation']) {
      if (!objectExists(db, 'table', table)) {
        throw new Error(`${table} table does not exist. Apply migration 035 first.`);
      }
    }
  }

  async up(db: Database.Database): Promise<void> {
    db.exec(AGENT_MEMORY_PROMOTION_SCHEMA_SQL);
  }

  async down(db: Database.Database): Promise<void> {
    const count = objectExists(db, 'table', 'agent_memory_promotion_candidate')
      ? (db.prepare(`
          SELECT COUNT(*) AS count FROM agent_memory_promotion_candidate
        `).get() as { count: number }).count
      : 0;
    if (count > 0) {
      throw new Error(
        'Migration 036 rollback requires write-off and an approved destructive cleanup migration',
      );
    }
    db.exec('DROP TABLE IF EXISTS agent_memory_promotion_candidate');
    if (objectExists(db, 'table', 'memento_schema_version')) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run(this.version);
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    const requiredObjects: Array<['table' | 'index', string]> = [
      ['table', 'agent_memory_promotion_candidate'],
      ['index', 'idx_agent_memory_promotion_queue'],
      ['index', 'idx_agent_memory_promotion_session'],
    ];
    for (const [type, name] of requiredObjects) {
      if (!objectExists(db, type, name)) {
        throw new Error(`Migration 036 did not create required ${type}: ${name}`);
      }
    }
  }
}

export default AgentMemoryPromotionSchemaMigration;
