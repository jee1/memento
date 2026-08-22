import type Database from 'better-sqlite3';
import type { Migration } from '../types.js';

const AGENT_INTEGRATION_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS agent_session (
  id TEXT PRIMARY KEY,
  adapter_name TEXT NOT NULL,
  adapter_version TEXT NOT NULL,
  contract_version INTEGER NOT NULL,
  owner_id TEXT,
  project_id TEXT,
  process_id TEXT,
  status TEXT NOT NULL CHECK (
    status IN ('ACTIVE','COMPACTING','STOPPING','COMPLETED','DEGRADED','ABANDONED')
  ),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  last_event_at TEXT NOT NULL,
  max_sequence_no INTEGER NOT NULL DEFAULT 0,
  agent_metadata_json TEXT,
  summary_memory_id TEXT,
  degraded_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (summary_memory_id) REFERENCES memory_item(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_session_status_last_event
  ON agent_session(status, last_event_at);
CREATE INDEX IF NOT EXISTS idx_agent_session_scope
  ON agent_session(owner_id, project_id, process_id);

CREATE TABLE IF NOT EXISTS agent_observation (
  id TEXT PRIMARY KEY,
  adapter_name TEXT NOT NULL,
  event_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('SESSION_START','USER_PROMPT','TOOL_RESULT','PRE_COMPACT','STOP')
  ),
  sequence_no INTEGER NOT NULL CHECK (sequence_no >= 0),
  tool_name TEXT,
  outcome TEXT,
  payload_json TEXT,
  payload_sha256 TEXT NOT NULL,
  redaction_metadata_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (
    status IN ('ACCEPTED','REDACTED','DUPLICATE','DROPPED','DEGRADED','INVALID')
  ),
  drop_reason TEXT,
  late_arrival INTEGER NOT NULL DEFAULT 0 CHECK (late_arrival IN (0, 1)),
  occurred_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  expires_at TEXT,
  FOREIGN KEY (session_id) REFERENCES agent_session(id) ON DELETE CASCADE,
  UNIQUE(adapter_name, event_id)
);
CREATE INDEX IF NOT EXISTS idx_agent_observation_timeline
  ON agent_observation(session_id, sequence_no, occurred_at, received_at, id);
CREATE INDEX IF NOT EXISTS idx_agent_observation_expires_at
  ON agent_observation(expires_at);
CREATE INDEX IF NOT EXISTS idx_agent_observation_status_drop
  ON agent_observation(status, drop_reason);

CREATE TABLE IF NOT EXISTS memory_provenance (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  session_id TEXT,
  observation_id TEXT,
  derivation_type TEXT NOT NULL,
  source_deleted INTEGER NOT NULL DEFAULT 0 CHECK (source_deleted IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK (session_id IS NOT NULL OR observation_id IS NOT NULL),
  FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE,
  UNIQUE(memory_id, observation_id, derivation_type)
);
CREATE INDEX IF NOT EXISTS idx_memory_provenance_memory
  ON memory_provenance(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_provenance_session
  ON memory_provenance(session_id);
CREATE INDEX IF NOT EXISTS idx_memory_provenance_observation
  ON memory_provenance(observation_id);
`;

function objectExists(db: Database.Database, type: 'table' | 'index', name: string): boolean {
  return Boolean(
    db.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get(type, name),
  );
}

export class AgentIntegrationSchemaMigration implements Migration {
  version = '35.0';
  name = 'agent-integration-schema';
  description = 'Add agent lifecycle sessions, observations, and memory provenance storage';

  async validateBefore(db: Database.Database): Promise<void> {
    if (!objectExists(db, 'table', 'memory_item')) {
      throw new Error('memory_item table does not exist. Apply the base schema before migration 035.');
    }
  }

  async up(db: Database.Database): Promise<void> {
    db.exec(AGENT_INTEGRATION_SCHEMA_SQL);
  }

  async down(db: Database.Database): Promise<void> {
    const dataCount = ['memory_provenance', 'agent_observation', 'agent_session']
      .filter(name => objectExists(db, 'table', name))
      .reduce((total, name) => {
        const row = db.prepare(`SELECT COUNT(*) AS count FROM ${name}`).get() as {
          count: number;
        };
        return total + row.count;
      }, 0);
    if (dataCount > 0) {
      throw new Error(
        'Migration 035 rollback requires write-off and an approved destructive cleanup migration',
      );
    }
    db.exec(`
      DROP TABLE IF EXISTS memory_provenance;
      DROP TABLE IF EXISTS agent_observation;
      DROP TABLE IF EXISTS agent_session;
    `);
    if (objectExists(db, 'table', 'memento_schema_version')) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run(this.version);
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    const requiredObjects: Array<['table' | 'index', string]> = [
      ['table', 'agent_session'],
      ['table', 'agent_observation'],
      ['table', 'memory_provenance'],
      ['index', 'idx_agent_observation_timeline'],
      ['index', 'idx_agent_observation_expires_at'],
      ['index', 'idx_memory_provenance_observation'],
    ];

    for (const [type, name] of requiredObjects) {
      if (!objectExists(db, type, name)) {
        throw new Error(`Migration 035 did not create required ${type}: ${name}`);
      }
    }
  }
}

export default AgentIntegrationSchemaMigration;
