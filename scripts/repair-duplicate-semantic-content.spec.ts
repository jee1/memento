import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDuplicatePlan } from './repair-duplicate-semantic-content.js';

/** #1137: 정리 스크립트가 쓰기 경로와 같은 렌더러·사전을 쓰는지 고정한다 */
describe('@memento/core 공개 심볼 (#1137)', () => {
  it('SemanticMemoryScoring과 PredicateCanonicalizer를 export한다', async () => {
    const core = await import('@memento/core');
    expect(typeof core.SemanticMemoryScoring).toBe('function');
    expect(typeof core.PredicateCanonicalizer).toBe('function');
  });
});

let db: Database.Database;

function insertSemantic(row: {
  id: string;
  content: string;
  subject?: string | null;
  predicate?: string | null;
  object?: string | null;
  confidence?: number;
  isDeleted?: number;
}): void {
  db.prepare(`
    INSERT INTO memory_item (id, type, content, subject, predicate, object, confidence, is_deleted, origin_source)
    VALUES (?, 'semantic', ?, ?, ?, ?, ?, ?, '{}')
  `).run(
    row.id,
    row.content,
    row.subject ?? null,
    row.predicate ?? null,
    row.object ?? null,
    row.confidence ?? 0.5,
    row.isDeleted ?? 0,
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
      object TEXT,
      confidence REAL,
      owner_id TEXT,
      project_id TEXT,
      origin_source TEXT,
      is_deleted INTEGER DEFAULT 0
    )
  `);
});

afterEach(() => {
  db.close();
});

describe('buildDuplicatePlan (#1137)', () => {
  it('중복 본문 그룹만 고르고 단일 행은 건드리지 않는다', () => {
    insertSemantic({
      id: 'sem_dup_a',
      content: '오늘 LLM provider 라우팅을 정리했다',
      subject: '서비스',
      predicate: 'uses',
      object: '설정',
    });
    insertSemantic({
      id: 'sem_dup_b',
      content: '오늘 LLM provider 라우팅을 정리했다',
      subject: '모듈',
      predicate: 'includes',
      object: '계약',
    });
    // 중복이 아닌 단일 행 — content 가 triple 에서 나온 것이 아니어도 후보가 아니다
    insertSemantic({
      id: 'sem_lonely',
      content: '혼자 있는 본문',
      subject: '패키지',
      predicate: 'uses',
      object: '모듈',
    });

    const plan = buildDuplicatePlan(db);

    expect(plan.rerender.map((entry) => entry.id)).toEqual(['sem_dup_a', 'sem_dup_b']);
    expect(plan.rerender.map((entry) => entry.after)).toEqual([
      '서비스는 설정을 사용합니다',
      '모듈은 계약을 포함합니다',
    ]);
    expect(plan.deletions).toEqual([]);
  });

  it('canonicalize 불가 predicate는 구성 요소로 렌더해 서로 구별시킨다', () => {
    insertSemantic({
      id: 'sem_a',
      content: '같은 본문 하나',
      subject: 'tests',
      predicate: 'zzcover',
      object: 'determineprovider',
    });
    insertSemantic({
      id: 'sem_b',
      content: '같은 본문 하나',
      subject: 'review',
      predicate: 'status',
      object: 'approved',
    });

    const plan = buildDuplicatePlan(db);
    const afters = plan.rerender.map((entry) => entry.after);

    expect(afters).toHaveLength(2);
    expect(new Set(afters).size).toBe(2);
    expect(afters).toContain('tests · zzcover · determineprovider');
    expect(afters).toContain('review · status · approved');
    expect(plan.deletions).toEqual([]);
  });

  it('triple까지 같은 행은 confidence 최대 1건만 남기고 나머지를 삭제 대상으로 표시한다', () => {
    insertSemantic({
      id: 'sem_dup_low',
      content: '완전중복 본문',
      subject: '시스템',
      predicate: 'uses',
      object: '기능',
      confidence: 0.3,
    });
    insertSemantic({
      id: 'sem_dup_high',
      content: '완전중복 본문',
      subject: '시스템',
      predicate: 'uses',
      object: '기능',
      confidence: 0.9,
    });

    const plan = buildDuplicatePlan(db);

    expect(plan.deletions).toEqual([{ id: 'sem_dup_low', keptId: 'sem_dup_high' }]);
    expect(plan.rerender.map((entry) => entry.id)).toEqual(['sem_dup_high']);
    expect(plan.rerender[0]!.after).toBe('시스템은 기능을 사용합니다');
  });

  it('이미 triple에서 렌더된 중복 행은 재렌더하지 않고 사본만 정리한다', () => {
    insertSemantic({
      id: 'sem_rendered_low',
      content: '시스템은 기능을 사용합니다',
      subject: '시스템',
      predicate: '사용함',
      object: '기능',
      confidence: 0.4,
    });
    insertSemantic({
      id: 'sem_rendered_high',
      content: '시스템은 기능을 사용합니다',
      subject: '시스템',
      predicate: '사용함',
      object: '기능',
      confidence: 0.8,
    });

    const plan = buildDuplicatePlan(db);

    expect(plan.rerender).toEqual([]);
    expect(plan.deletions).toEqual([{ id: 'sem_rendered_low', keptId: 'sem_rendered_high' }]);
  });

  it('is_deleted=1 행과 triple 컬럼이 없는 행은 건드리지 않는다', () => {
    insertSemantic({
      id: 'sem_deleted',
      content: '제외 대상 본문',
      subject: '시스템',
      predicate: 'uses',
      object: '기능',
      isDeleted: 1,
    });
    insertSemantic({
      id: 'sem_no_triple',
      content: '제외 대상 본문',
      subject: null,
      predicate: null,
      object: null,
    });
    insertSemantic({
      id: 'sem_no_triple_2',
      content: '제외 대상 본문',
      subject: null,
      predicate: null,
      object: null,
    });

    const plan = buildDuplicatePlan(db);

    expect(plan.rerender).toEqual([]);
    expect(plan.deletions).toEqual([]);
  });

  it('content는 저장된 subject/object에서만 만든다 — EntityLinker로 바꿔 쓰지 않는다', () => {
    insertSemantic({
      id: 'sem_system',
      content: '엔티티 링킹 판정 본문',
      subject: 'system',
      predicate: 'uses',
      object: '설정',
    });
    insertSemantic({
      id: 'sem_ai',
      content: '엔티티 링킹 판정 본문',
      subject: 'ai',
      predicate: 'uses',
      object: '설정',
    });

    const plan = buildDuplicatePlan(db);
    const afters = plan.rerender.map((entry) => entry.after).sort();

    // system·ai 는 EntityLinker 사전에서 둘 다 '시스템' 으로 묶인다. 그 값을 content 에 쓰면
    // 두 행의 content 가 같아지는데 그룹 키는 raw subject 라 중복이 살아남는다.
    expect(afters).toEqual(['ai는 설정을 사용합니다', 'system는 설정을 사용합니다']);
    expect(plan.deletions).toEqual([]);
    for (const entry of plan.rerender) {
      expect(entry.after).not.toContain('시스템');
    }
  });
});
