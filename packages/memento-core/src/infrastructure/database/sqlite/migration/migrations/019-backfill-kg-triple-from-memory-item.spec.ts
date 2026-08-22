/**
 * Migration 019 테스트
 * kg_triple backfill from memory_item (Issue #90)
 *
 * Given/When/Then:
 * - Given: kg_triple 테이블 존재(018 적용), memory_item에 type='semantic'이고 subject,predicate,object 있는 행 존재
 * - When: 019 up 실행
 * - Then: kg_triple에 해당 (s,p,o)당 한 행 삽입, representative_memory_id 설정 (동일 (s,p,o) 여러 개면 하나만 대표로)
 * - When: down 실행
 * - Then: backfill 데이터 제거 정책(현재: no-op, 비가역)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { BackfillKgTripleFromMemoryItemMigration } from './019-backfill-kg-triple-from-memory-item.js';
import type { Migration } from '../types.js';

function createSchemaWith018(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      importance REAL DEFAULT 0.5,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      subject TEXT,
      predicate TEXT,
      object TEXT,
      owner_id TEXT,
      process_id TEXT,
      session_id TEXT,
          project_id TEXT,
          is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
          deleted_at TEXT
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS kg_triple (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object TEXT NOT NULL,
      owner_id TEXT NULL,
      process_id TEXT NULL,
      session_id TEXT NULL,
      representative_memory_id TEXT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (representative_memory_id) REFERENCES memory_item(id) ON DELETE SET NULL,
      UNIQUE(subject, predicate, object)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS memento_schema_version (
      version TEXT PRIMARY KEY,
      migration_name TEXT NOT NULL
    )
  `);
}

describe('Migration 019 - backfill kg_triple from memory_item', () => {
  let db: Database.Database;
  let migration: Migration;

  beforeEach(() => {
    db = new Database(':memory:');
    createSchemaWith018(db);
    migration = new BackfillKgTripleFromMemoryItemMigration();
  });

  afterEach(() => {
    if (db) db.close();
  });

  it('Given: semantic memory_item 2건(서로 다른 (s,p,o)), When: up 실행, Then: kg_triple 2행', async () => {
    db.prepare(`
      INSERT INTO memory_item (id, type, content, subject, predicate, object) VALUES ('mem1', 'semantic', 'A likes B', 'A', 'likes', 'B'),
             ('mem2', 'semantic', 'C has D', 'C', 'has', 'D')
    `).run();
    await migration.up(db);
    const rows = db.prepare('SELECT id, subject, predicate, object, representative_memory_id FROM kg_triple').all() as Array<{ id: string; subject: string; predicate: string; object: string; representative_memory_id: string }>;
    expect(rows.length).toBe(2);
    expect(rows.find(r => r.subject === 'A' && r.predicate === 'likes' && r.object === 'B')?.representative_memory_id).toBe('mem1');
    expect(rows.find(r => r.subject === 'C' && r.predicate === 'has' && r.object === 'D')?.representative_memory_id).toBe('mem2');
  });

  it('Given: 동일 (s,p,o) semantic 2건, When: up 실행, Then: kg_triple 1행, representative는 하나', async () => {
    db.prepare(`
      INSERT INTO memory_item (id, type, content, subject, predicate, object, created_at) VALUES ('mem1', 'semantic', 'User likes Coffee', 'User', 'likes', 'Coffee', '2025-01-01T00:00:00.000Z'),
             ('mem2', 'semantic', 'User likes Coffee', 'User', 'likes', 'Coffee', '2025-01-02T00:00:00.000Z')
    `).run();
    await migration.up(db);
    const count = (db.prepare('SELECT COUNT(*) as c FROM kg_triple').get() as { c: number }).c;
    expect(count).toBe(1);
    const row = db.prepare('SELECT representative_memory_id FROM kg_triple WHERE subject=? AND predicate=? AND object=?')
      .get('User', 'likes', 'Coffee') as { representative_memory_id: string };
    expect(['mem1', 'mem2']).toContain(row.representative_memory_id);
  });

  it('Given: subject/predicate/object 없는 semantic, When: up 실행, Then: backfill 대상 제외', async () => {
    db.prepare(`
      INSERT INTO memory_item (id, type, content, subject, predicate, object) VALUES ('mem1', 'semantic', 'No triple', NULL, NULL, NULL)
    `).run();
    await migration.up(db);
    const count = (db.prepare('SELECT COUNT(*) as c FROM kg_triple').get() as { c: number }).c;
    expect(count).toBe(0);
  });

  it('Given: up 적용 후, When: down 실행, Then: 예외 없이 완료 (no-op)', async () => {
    db.prepare(`
      INSERT INTO memory_item (id, type, content, subject, predicate, object) VALUES ('mem1', 'semantic', 'A p B', 'A', 'p', 'B')
    `).run();
    await migration.up(db);
    await migration.down(db);
    const count = (db.prepare('SELECT COUNT(*) as c FROM kg_triple').get() as { c: number }).c;
    expect(count).toBe(1);
  });
});
