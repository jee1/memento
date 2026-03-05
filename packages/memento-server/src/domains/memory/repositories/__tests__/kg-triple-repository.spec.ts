/**
 * KgTripleRepository 테스트 (Issue #90)
 *
 * Given/When/Then:
 * - Given: DB with kg_triple table (018 applied)
 * - When: upsertTriple({ subject, predicate, object, ... })
 * - Then: 동일 (s,p,o)로 두 번 호출 시 두 번째는 기존 id 반환, representative_memory_id는 첫 설정 유지
 * - When: getBySubjectPredicateObject(s, p, o)
 * - Then: 해당 행 반환 또는 null
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { KgTripleRepository } from '../kg-triple-repository.js';

function createKgTripleTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
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
    );
    CREATE INDEX IF NOT EXISTS idx_kg_triple_spo ON kg_triple(subject, predicate, object);
    CREATE INDEX IF NOT EXISTS idx_kg_triple_representative ON kg_triple(representative_memory_id);
  `);
}

describe('KgTripleRepository', () => {
  let db: Database.Database;
  let repo: KgTripleRepository;

  beforeEach(() => {
    db = new Database(':memory:');
    createKgTripleTable(db);
    repo = new KgTripleRepository(db);
  });

  afterEach(() => {
    if (db) db.close();
  });

  describe('upsertTriple', () => {
    it('Given: 빈 kg_triple, When: upsertTriple(s,p,o) 호출, Then: 새 id 반환하고 한 행 삽입', () => {
      const id = repo.upsertTriple({
        subject: 'User',
        predicate: 'likes',
        object: 'Coffee'
      });
      expect(id).toBeDefined();
      expect(typeof id).toBe('string');
      const row = db.prepare('SELECT * FROM kg_triple WHERE id = ?').get(id) as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row.subject).toBe('User');
      expect(row.predicate).toBe('likes');
      expect(row.object).toBe('Coffee');
    });

    it('Given: 동일 (s,p,o)로 이미 한 번 upsert함, When: 같은 (s,p,o)로 다시 upsert, Then: 기존 id 반환하고 행 수 유지', () => {
      const id1 = repo.upsertTriple({ subject: 'A', predicate: 'p', object: 'B' });
      const id2 = repo.upsertTriple({ subject: 'A', predicate: 'p', object: 'B' });
      expect(id1).toBe(id2);
      const count = (db.prepare('SELECT COUNT(*) as c FROM kg_triple').get() as { c: number }).c;
      expect(count).toBe(1);
    });

    it('Given: 첫 upsert 시 representative_memory_id 전달, When: 동일 (s,p,o)로 두 번째 upsert, Then: representative_memory_id는 첫 값 유지', () => {
      db.prepare("INSERT INTO memory_item (id, type, content) VALUES ('mem_1', 'semantic', 'A p B')").run();
      const id1 = repo.upsertTriple({
        subject: 'A',
        predicate: 'p',
        object: 'B',
        representative_memory_id: 'mem_1'
      });
      repo.upsertTriple({ subject: 'A', predicate: 'p', object: 'B' });
      const row = repo.getBySubjectPredicateObject('A', 'p', 'B');
      expect(row?.representative_memory_id).toBe('mem_1');
      expect(row?.id).toBe(id1);
    });
  });

  describe('getBySubjectPredicateObject', () => {
    it('Given: 해당 (s,p,o) 없음, When: getBySubjectPredicateObject 호출, Then: null 반환', () => {
      const row = repo.getBySubjectPredicateObject('X', 'q', 'Y');
      expect(row).toBeNull();
    });

    it('Given: upsert로 (s,p,o) 삽입함, When: getBySubjectPredicateObject(s,p,o) 호출, Then: 해당 행 반환', () => {
      repo.upsertTriple({ subject: 'S', predicate: 'P', object: 'O' });
      const row = repo.getBySubjectPredicateObject('S', 'P', 'O');
      expect(row).not.toBeNull();
      expect(row?.subject).toBe('S');
      expect(row?.predicate).toBe('P');
      expect(row?.object).toBe('O');
      expect(row?.id).toBeDefined();
    });
  });
});
