/**
 * Migration 049 테스트 — 손상된 triple 문장 semantic 기억 복구 (#1156)
 */
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RepairTripleSentenceMemoriesMigration } from './049-repair-triple-sentence-memories.js';

let db: Database.Database;

function createSchema(target: Database.Database): void {
  target.exec(`
    CREATE TABLE memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      subject TEXT,
      predicate TEXT,
      object TEXT
    )
  `);
}

function insert(row: {
  id: string;
  content: string;
  subject?: string | null;
  predicate?: string | null;
  object?: string | null;
  type?: string;
}): void {
  db.prepare(
    'INSERT INTO memory_item (id, type, content, subject, predicate, object) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    row.id,
    row.type ?? 'semantic',
    row.content,
    row.subject ?? null,
    row.predicate ?? null,
    row.object ?? null,
  );
}

function contentOf(id: string): string {
  return (db.prepare('SELECT content FROM memory_item WHERE id = ?').get(id) as { content: string })
    .content;
}

beforeEach(() => {
  db = new Database(':memory:');
  createSchema(db);
});

afterEach(() => {
  db.close();
});

describe('RepairTripleSentenceMemoriesMigration (#1156)', () => {
  it('옛 템플릿과 정확히 일치하는 행의 content 를 다시 렌더한다', async () => {
    insert({
      id: 'mem_broken',
      subject: 'serverservices 인터페이스',
      predicate: '정의됨',
      object: '모든 서비스 타입',
      content: 'serverservices 인터페이스는 모든 서비스 타입를 정의됨합니다',
    });

    await new RepairTripleSentenceMemoriesMigration().up(db);

    expect(contentOf('mem_broken')).toBe('serverservices 인터페이스는 모든 서비스 타입을 정의됩니다');
  });

  it('사람이 쓴 문장과 triple 이 없는 행은 건드리지 않는다', async () => {
    insert({
      id: 'mem_human',
      subject: '시스템',
      predicate: '포함함',
      object: '기능',
      content: '오늘 회의에서 배포 일정을 정했다. 시스템은 기능을 포함합니다.',
    });
    insert({ id: 'mem_plain', content: '릴리스 절차를 문서로 남겼다' });
    insert({ id: 'mem_orphan', content: '인터페이스는 타입를 정의됨합니다' });

    await new RepairTripleSentenceMemoriesMigration().up(db);

    expect(contentOf('mem_human')).toBe('오늘 회의에서 배포 일정을 정했다. 시스템은 기능을 포함합니다.');
    expect(contentOf('mem_plain')).toBe('릴리스 절차를 문서로 남겼다');
    expect(contentOf('mem_orphan')).toBe('인터페이스는 타입를 정의됨합니다');
  });

  it('semantic 이 아닌 행은 대상이 아니다', async () => {
    insert({
      id: 'mem_episodic',
      type: 'episodic',
      subject: '스키마',
      predicate: '정의됨',
      object: '인덱스',
      content: '스키마는 인덱스를 정의됨합니다',
    });

    await new RepairTripleSentenceMemoriesMigration().up(db);

    expect(contentOf('mem_episodic')).toBe('스키마는 인덱스를 정의됨합니다');
  });

  it('up 이 끝나면 한 번에 수렴한다 — validateAfter 가 통과한다', async () => {
    insert({
      id: 'mem_broken',
      subject: 'serverservices 인터페이스',
      predicate: '정의됨',
      object: '모든 서비스 타입',
      content: 'serverservices 인터페이스는 모든 서비스 타입를 정의됨합니다',
    });
    insert({
      id: 'mem_particle',
      subject: '자동 설정 시스템',
      predicate: '관련 작업',
      object: 'mit license 문서화',
      content: '자동 설정 시스템는 mit license 문서화를 관련 작업합니다',
    });

    const migration = new RepairTripleSentenceMemoriesMigration();
    await migration.up(db);

    await expect(migration.validateAfter(db)).resolves.toBeUndefined();
  });

  it('memory_item 이 없으면 validateBefore 가 막는다', async () => {
    const empty = new Database(':memory:');
    try {
      await expect(new RepairTripleSentenceMemoriesMigration().validateBefore(empty)).rejects.toThrow(
        'Migration 049 requires the memory_item table',
      );
    } finally {
      empty.close();
    }
  });

  it('version 과 name 이 049 규약을 따른다', () => {
    const migration = new RepairTripleSentenceMemoriesMigration();
    expect(migration.version).toBe('49.0');
    expect(migration.name).toBe('repair-triple-sentence-memories');
  });
});
