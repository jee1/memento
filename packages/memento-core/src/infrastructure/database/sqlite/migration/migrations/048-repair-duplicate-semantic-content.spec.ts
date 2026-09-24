/**
 * Migration 048 테스트 — 중복 본문 semantic 기억 정리 (#1139)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { RepairDuplicateSemanticContentMigration } from './048-repair-duplicate-semantic-content.js';

const RENDER_DOCKER = '도커는 컨테이너를 사용합니다';
const RENDER_MEMENTO = 'memento는 sqlite를 사용합니다';
const RENDER_USER = '사용자는 한글 답변을 좋아합니다';

interface SeedRow {
  id: string;
  type?: string;
  content: string;
  subject?: string | null;
  predicate?: string | null;
  object?: string | null;
  confidence?: number | null;
}

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      subject TEXT,
      predicate TEXT,
      object TEXT,
      confidence REAL,
      owner_id TEXT,
      project_id TEXT,
      is_deleted INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE memory_embedding (
      id TEXT PRIMARY KEY,
      embedding BLOB
    );
  `);
}

function seed(db: Database.Database, rows: SeedRow[]): void {
  const insert = db.prepare(`
    INSERT INTO memory_item (id, type, content, subject, predicate, object, confidence, owner_id, project_id, is_deleted)
    VALUES (@id, @type, @content, @subject, @predicate, @object, @confidence, 'owner-1', 'project-1', 0)
  `);
  for (const row of rows) {
    insert.run({
      id: row.id,
      type: row.type ?? 'semantic',
      content: row.content,
      subject: row.subject ?? null,
      predicate: row.predicate ?? null,
      object: row.object ?? null,
      confidence: row.confidence ?? 0.5,
    });
  }
}

function contentOf(db: Database.Database, id: string): string {
  return (db.prepare('SELECT content FROM memory_item WHERE id = ?').get(id) as { content: string })
    .content;
}

function isDeleted(db: Database.Database, id: string): number {
  return (
    db.prepare('SELECT is_deleted FROM memory_item WHERE id = ?').get(id) as { is_deleted: number }
  ).is_deleted;
}

describe('Migration 048 - repair duplicate semantic content', () => {
  let db: Database.Database;
  let migration: RepairDuplicateSemanticContentMigration;

  beforeEach(() => {
    db = new Database(':memory:');
    createSchema(db);
    migration = new RepairDuplicateSemanticContentMigration();
  });

  afterEach(() => {
    db.close();
  });

  it('re-renders duplicated content from each row own triple', async () => {
    seed(db, [
      { id: 'dup-a', content: '원본 episodic 본문 A', subject: '도커', predicate: '사용한다', object: '컨테이너' },
      { id: 'dup-b', content: '원본 episodic 본문 A', subject: 'memento', predicate: 'uses', object: 'sqlite' },
    ]);

    await migration.up(db);

    expect(contentOf(db, 'dup-a')).toBe(RENDER_DOCKER);
    expect(contentOf(db, 'dup-b')).toBe(RENDER_MEMENTO);
    expect(isDeleted(db, 'dup-a')).toBe(0);
    expect(isDeleted(db, 'dup-b')).toBe(0);
  });

  it('soft-deletes an exact duplicate and keeps the highest confidence row', async () => {
    seed(db, [
      { id: 'same-hi', content: '원본 episodic 본문 B', subject: '사용자', predicate: '선호한다', object: '한글 답변', confidence: 0.9 },
      { id: 'same-lo', content: '원본 episodic 본문 B', subject: '사용자', predicate: '선호한다', object: '한글 답변', confidence: 0.4 },
    ]);

    await migration.up(db);

    expect(isDeleted(db, 'same-hi')).toBe(0);
    expect(isDeleted(db, 'same-lo')).toBe(1);
    expect(contentOf(db, 'same-hi')).toBe(RENDER_USER);
    expect(contentOf(db, 'same-lo')).toBe('원본 episodic 본문 B');
  });

  it('leaves duplicated rows without a triple untouched', async () => {
    seed(db, [
      { id: 'no-triple-1', content: 'triple 없는 중복 본문' },
      { id: 'no-triple-2', content: 'triple 없는 중복 본문' },
    ]);

    await migration.up(db);

    expect(contentOf(db, 'no-triple-1')).toBe('triple 없는 중복 본문');
    expect(contentOf(db, 'no-triple-2')).toBe('triple 없는 중복 본문');
    expect(isDeleted(db, 'no-triple-1')).toBe(0);
    expect(isDeleted(db, 'no-triple-2')).toBe(0);
  });

  it('leaves unique semantic rows and duplicated episodic rows untouched', async () => {
    seed(db, [
      { id: 'unique-1', content: '유일한 본문', subject: '도커', predicate: '사용한다', object: '컨테이너' },
      { id: 'epi-1', type: 'episodic', content: '중복 episodic 본문', subject: '도커', predicate: '사용한다', object: '컨테이너' },
      { id: 'epi-2', type: 'episodic', content: '중복 episodic 본문', subject: 'memento', predicate: 'uses', object: 'sqlite' },
    ]);

    await migration.up(db);

    expect(contentOf(db, 'unique-1')).toBe('유일한 본문');
    expect(contentOf(db, 'epi-1')).toBe('중복 episodic 본문');
    expect(contentOf(db, 'epi-2')).toBe('중복 episodic 본문');
  });

  it('converges when a re-render creates a new duplicate group', async () => {
    // casc-c 는 1회차에 content 가 유일해서 후보에 없다. casc-a 가 재렌더되면서 같은 본문이 된다.
    seed(db, [
      { id: 'casc-a', content: '원본 episodic 본문 C', subject: '도커', predicate: '사용한다', object: '컨테이너', confidence: 0.9 },
      { id: 'casc-b', content: '원본 episodic 본문 C', subject: '사용자', predicate: '선호한다', object: '한글 답변', confidence: 0.5 },
      { id: 'casc-c', content: RENDER_DOCKER, subject: '도커', predicate: '사용한다', object: '컨테이너', confidence: 0.1 },
    ]);

    await migration.up(db);

    expect(contentOf(db, 'casc-a')).toBe(RENDER_DOCKER);
    expect(contentOf(db, 'casc-b')).toBe(RENDER_USER);
    expect(isDeleted(db, 'casc-a')).toBe(0);
    expect(isDeleted(db, 'casc-b')).toBe(0);
    expect(isDeleted(db, 'casc-c')).toBe(1);

    await expect(migration.validateAfter(db)).resolves.toBeUndefined();
  });

  it('leaves the source episodic row that shares content with the duplicated semantic pair', async () => {
    // #1137 부채는 재조립 실패한 triple 이 원본 episodic 본문을 복사해 생긴다.
    // 그래서 실제 DB 에는 같은 본문의 episodic 원본이 함께 있다. 후보 선별이 type 을
    // 놓치면 그 원본이 재렌더되거나 soft-delete 된다.
    seed(db, [
      { id: 'src-epi', type: 'episodic', content: '원본 episodic 본문 E', subject: '도커', predicate: '사용한다', object: '컨테이너' },
      { id: 'cp-1', content: '원본 episodic 본문 E', subject: '도커', predicate: '사용한다', object: '컨테이너', confidence: 0.9 },
      { id: 'cp-2', content: '원본 episodic 본문 E', subject: 'memento', predicate: 'uses', object: 'sqlite', confidence: 0.5 },
    ]);

    await migration.up(db);

    expect(contentOf(db, 'src-epi')).toBe('원본 episodic 본문 E');
    expect(isDeleted(db, 'src-epi')).toBe(0);
    expect(contentOf(db, 'cp-1')).toBe(RENDER_DOCKER);
    expect(contentOf(db, 'cp-2')).toBe(RENDER_MEMENTO);
  });

  it('does not create embeddings', async () => {
    seed(db, [
      { id: 'emb-a', content: '원본 episodic 본문 D', subject: '도커', predicate: '사용한다', object: '컨테이너' },
      { id: 'emb-b', content: '원본 episodic 본문 D', subject: 'memento', predicate: 'uses', object: 'sqlite' },
    ]);

    await migration.up(db);

    const count = (db.prepare('SELECT COUNT(*) AS c FROM memory_embedding').get() as { c: number }).c;
    expect(count).toBe(0);
  });

  it('validateBefore rejects a database without memory_item', async () => {
    const empty = new Database(':memory:');
    try {
      await expect(migration.validateBefore(empty)).rejects.toThrow(/memory_item/);
    } finally {
      empty.close();
    }
  });
});
