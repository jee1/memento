/**
 * Procedural Rollback Tool 테스트 (Issue #57 Phase 2)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { ProceduralRollbackTool } from '../procedural-rollback-tool.js';
import { DatabaseUtils } from '../../../../shared/utils/database.js';

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      importance REAL DEFAULT 0.5,
      privacy_scope TEXT DEFAULT 'private',
      tags TEXT,
      task_goal TEXT,
      steps TEXT,
      reflection_notes TEXT,
      workflow_name TEXT,
      skill_name TEXT,
      trigger_conditions TEXT,
      version INTEGER NULL,
      version_series_id TEXT NULL,
          project_id TEXT,
          is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
          deleted_at TEXT
    )
  `);
  db.exec(`
    CREATE TABLE memory_link (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation_type TEXT NOT NULL,
      UNIQUE(source_id, target_id, relation_type)
    )
  `);
  db.exec(`
    INSERT INTO memory_item (id, type, content, version, version_series_id, workflow_name, skill_name, importance, privacy_scope) VALUES ('proc-v1', 'procedural', 'V1', 1, 'series-a', 'wf', 'sk', 0.5, 'private'),
      ('proc-v2', 'procedural', 'V2', 2, 'series-a', 'wf', 'sk', 0.5, 'private'),
      ('proc-v3', 'procedural', 'V3', 3, 'series-a', 'wf', 'sk', 0.5, 'private'),
      ('other', 'procedural', 'Other', 1, 'series-b', 'wf2', 'sk2', 0.5, 'private')
  `);
}

describe('ProceduralRollbackTool', () => {
  let db: Database.Database;
  let tool: ProceduralRollbackTool;

  beforeEach(() => {
    db = new Database(':memory:');
    createSchema(db);
    tool = new ProceduralRollbackTool();
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('Given: current_id, target_version_id(같은 시리즈), When: handle 호출하면, Then: 새 memory_id 반환 및 DB에 행·version_of 존재', async () => {
    const result = await tool.handle(
      { current_id: 'proc-v3', target_version_id: 'proc-v1' },
      { db, services: {} }
    );
    expect(result.content).toHaveLength(1);
    const data = JSON.parse(result.content[0].text);
    expect(data.memory_id).toBeDefined();
    expect(data.memory_id).toMatch(/^mem_\d+_[a-z0-9]+$/);

    const row = DatabaseUtils.get(db, 'SELECT id, version, version_series_id, content FROM memory_item WHERE id = ?', [data.memory_id]) as { version: number; version_series_id: string; content: string };
    expect(row.version).toBe(4);
    expect(row.version_series_id).toBe('series-a');
    expect(row.content).toBe('V1');

    const link = DatabaseUtils.get(db, 'SELECT relation_type FROM memory_link WHERE source_id = ?', [data.memory_id]) as { relation_type: string };
    expect(link.relation_type).toBe('version_of');
  });

  it('Given: target가 다른 시리즈, When: handle 호출하면, Then: rollback_failed 에러', async () => {
    const result = await tool.handle(
      { current_id: 'proc-v3', target_version_id: 'other' },
      { db, services: {} }
    );
    expect(result.error).toBe('rollback_failed');
  });
});
