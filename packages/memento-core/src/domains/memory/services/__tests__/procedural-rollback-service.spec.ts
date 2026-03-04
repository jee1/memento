/**
 * Procedural Rollback Service 테스트 (Issue #57 Phase 2)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { rollbackToVersion } from '../procedural-rollback-service.js';

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
      version_series_id TEXT NULL
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
    INSERT INTO memory_item (id, type, content, version, version_series_id, workflow_name, skill_name)
    VALUES
      ('proc-v1', 'procedural', 'V1 content', 1, 'series-a', 'wf', 'sk'),
      ('proc-v2', 'procedural', 'V2 content', 2, 'series-a', 'wf', 'sk'),
      ('proc-v3', 'procedural', 'V3 content', 3, 'series-a', 'wf', 'sk'),
      ('other-series', 'procedural', 'Other', 1, 'series-b', 'wf2', 'sk2')
  `);
}

describe('procedural-rollback-service', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    createSchema(db);
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('Given: currentId와 targetVersionId(같은 시리즈), When: rollbackToVersion 호출하면, Then: 새 메모리 생성 및 version_of 링크, 새 id 반환', () => {
    const newId = rollbackToVersion(db, 'proc-v3', 'proc-v1');
    expect(newId).toBeDefined();
    expect(newId).toMatch(/^mem_\d+_[a-z0-9]+$/);

    const row = DatabaseUtils.get(db, 'SELECT id, version, version_series_id, content FROM memory_item WHERE id = ?', [newId]) as { id: string; version: number; version_series_id: string; content: string };
    expect(row.version).toBe(4);
    expect(row.version_series_id).toBe('series-a');
    expect(row.content).toBe('V1 content');

    const link = DatabaseUtils.get(db, 'SELECT source_id, target_id, relation_type FROM memory_link WHERE source_id = ?', [newId]) as { source_id: string; target_id: string; relation_type: string };
    expect(link.target_id).toBe('proc-v1');
    expect(link.relation_type).toBe('version_of');
  });

  it('Given: targetVersionId가 다른 시리즈, When: rollbackToVersion 호출하면, Then: throw', () => {
    expect(() => rollbackToVersion(db, 'proc-v3', 'other-series')).toThrow('not in the same version series');
  });

  it('Given: 존재하지 않는 targetVersionId, When: rollbackToVersion 호출하면, Then: throw', () => {
    expect(() => rollbackToVersion(db, 'proc-v3', 'nonexistent')).toThrow('not found');
  });
});
