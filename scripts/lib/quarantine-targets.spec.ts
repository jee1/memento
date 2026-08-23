import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { countTargets, listTargetIds } from './quarantine-targets.js';

export function createFixtureDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      subject TEXT,
      predicate TEXT,
      object TEXT,
      importance REAL,
      pinned BOOLEAN DEFAULT FALSE,
      project_id TEXT,
      owner_id TEXT,
      privacy_scope TEXT DEFAULT 'private',
      is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
      recall_count INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE kg_triple (
      id INTEGER PRIMARY KEY,
      subject TEXT, predicate TEXT, object TEXT,
      representative_memory_id TEXT REFERENCES memory_item(id) ON DELETE SET NULL
    );
  `);
  return db;
}

export function insertMemory(db: Database.Database, row: Partial<{
  id: string; type: string; content: string; subject: string | null;
  predicate: string | null; object: string | null; importance: number;
  pinned: number; created_at: string;
}>): void {
  db.prepare(`
    INSERT INTO memory_item (id, type, content, subject, predicate, object, importance, pinned, created_at)
    VALUES (@id, @type, @content, @subject, @predicate, @object, @importance, @pinned, @created_at)
  `).run({
    id: row.id ?? 'mem_x', type: row.type ?? 'semantic', content: row.content ?? '',
    subject: row.subject ?? null, predicate: row.predicate ?? null, object: row.object ?? null,
    importance: row.importance ?? 0.5, pinned: row.pinned ?? 0,
    created_at: row.created_at ?? '2026-08-01T00:00:00Z',
  });
}

let db: Database.Database;
beforeEach(() => { db = createFixtureDb(); });
afterEach(() => db.close());

describe('격리 대상 판별식 (FR-001, FR-002i)', () => {
  it('subject + 조사 1글자 + 공백으로 시작하는 템플릿을 잡는다', () => {
    insertMemory(db, {
      id: 'mem_t1', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다',
    });
    expect(countTargets(db)).toBe(1);
    expect(listTargetIds(db)).toEqual(['mem_t1']);
  });

  it('subject 가 비면 잡지 않는다', () => {
    insertMemory(db, { id: 'mem_n1', subject: '', content: '사람이 직접 쓴 서술입니다' });
    insertMemory(db, { id: 'mem_n2', subject: null, content: '사람이 직접 쓴 서술입니다' });
    expect(countTargets(db)).toBe(0);
  });

  it('pinned 는 제외한다 (FR-001a)', () => {
    insertMemory(db, {
      id: 'mem_p1', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다', pinned: 1,
    });
    expect(countTargets(db)).toBe(0);
  });

  it('semantic 이 아니면 잡지 않는다', () => {
    insertMemory(db, {
      id: 'mem_e1', type: 'episodic', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다',
    });
    expect(countTargets(db)).toBe(0);
  });

  it('subject 의 _ 를 와일드카드로 해석하지 않는다 (LIKE 금지의 이유)', () => {
    insertMemory(db, {
      id: 'mem_w1', subject: 'a_c', predicate: '호출', object: 'x',
      content: 'abc는 x를 호출합니다',
    });
    expect(countTargets(db)).toBe(0);
  });

  it('subject 로 시작해도 조사 자리 다음이 공백이 아니면 잡지 않는다', () => {
    insertMemory(db, {
      id: 'mem_x1', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는forget를 호출합니다',
    });
    expect(countTargets(db)).toBe(0);
  });
});
