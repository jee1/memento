import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildRepairPlan } from './repair-triple-sentence-memories.js';

/** #811 US1: repair CLI named-export regression guard */
describe('@memento/core triple-sentence public exports (#811)', () => {
  it('exports buildTripleSentence and hasBrokenTripleConjugation', async () => {
    const core = await import('@memento/core');
    expect(typeof core.buildTripleSentence).toBe('function');
    expect(typeof core.hasBrokenTripleConjugation).toBe('function');
  });
});

let db: Database.Database;

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

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE memory_item (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      subject TEXT,
      predicate TEXT,
      object TEXT
    )
  `);
});

afterEach(() => {
  db.close();
});

describe('buildRepairPlan (#768)', () => {
  it('옛 템플릿과 정확히 일치하는 행만 다시 렌더한다', () => {
    insert({
      id: 'mem_broken',
      subject: 'serverservices 인터페이스',
      predicate: '정의됨',
      object: '모든 서비스 타입',
      content: 'serverservices 인터페이스는 모든 서비스 타입를 정의됨합니다',
    });

    const plan = buildRepairPlan(db);

    expect(plan.repairable).toEqual([
      {
        id: 'mem_broken',
        before: 'serverservices 인터페이스는 모든 서비스 타입를 정의됨합니다',
        after: 'serverservices 인터페이스는 모든 서비스 타입을 정의됩니다',
      },
    ]);
  });

  it('조사만 틀린 행도 잡는다 (이중 활용이 없어도 옛 템플릿이면 대상)', () => {
    insert({
      id: 'mem_particle',
      subject: '자동 설정 시스템',
      predicate: '관련 작업',
      object: 'mit license 문서화',
      content: '자동 설정 시스템는 mit license 문서화를 관련 작업합니다',
    });

    const plan = buildRepairPlan(db);

    expect(plan.repairable.map((entry) => entry.after)).toEqual([
      '자동 설정 시스템은 mit license 문서화를 관련 작업합니다',
    ]);
  });

  it('사람이 쓴 문장이나 폴백 원문은 건드리지 않는다', () => {
    insert({
      id: 'mem_human',
      subject: '시스템',
      predicate: '포함함',
      object: '기능',
      content: '오늘 회의에서 배포 일정을 정했다. 시스템은 기능을 포함합니다.',
    });
    insert({ id: 'mem_plain', content: '릴리스 절차를 문서로 남겼다' });

    expect(buildRepairPlan(db).repairable).toEqual([]);
  });

  it('이미 새 렌더러 결과와 같은 행은 대상이 아니다', () => {
    // 옛 템플릿과 새 렌더러 결과가 우연히 같은 경우 (받침 없는 주어 + 다 종결 서술)
    insert({
      id: 'mem_same',
      subject: '스키마',
      predicate: '가지고 있다',
      object: '인덱스',
      content: '스키마는 인덱스를 가지고 있다합니다',
    });

    const plan = buildRepairPlan(db);
    expect(plan.repairable.map((entry) => entry.after)).toEqual([
      '스키마는 인덱스를 가지고 있다',
    ]);
  });

  it('triple 컬럼이 없는 손상 행은 복구 불가로 보고한다', () => {
    insert({
      id: 'mem_orphan',
      content: '인터페이스는 타입를 정의됨합니다',
    });

    const plan = buildRepairPlan(db);

    expect(plan.repairable).toEqual([]);
    expect(plan.missingComponents).toEqual(['mem_orphan']);
  });
});
