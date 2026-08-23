import type Database from 'better-sqlite3';
import { createFixtureDb, insertMemory } from './quarantine-fixture.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  attributionCounts, classifyForms, countTargets, crossVerifyTargets, fallbackTrendByMonth,
  burstIntervalSplit, corpusOverlap, fallbackOriginSurvival, importanceBuckets,
  kgPredicateNormalization, kgPreservation, listPreservedFormIds, listTargetIds, orphanForgettingEvents,
  pinnedCandidates, sampleTargets,
} from './quarantine-targets.js';

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

describe('본문 형태 분류 (FR-002f, FR-002g)', () => {
  it('세 형태를 각각 센다', () => {
    insertMemory(db, { id: 'mem_f1', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다' });
    insertMemory(db, { id: 'mem_f2', subject: '러너', predicate: 'pragma()', object: 'forget',
      content: '어제 회의에서 러너 실행 순서를 다시 정리했다' });
    insertMemory(db, { id: 'mem_f3', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너 · 호출 · forget' });

    expect(classifyForms(db)).toEqual({ total: 3, one: 1, two: 1, three: 1 });
  });

  it('pinned 도 모수에 넣는다 (제외 규모를 알기 위함)', () => {
    insertMemory(db, { id: 'mem_f4', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다', pinned: 1 });
    expect(classifyForms(db).one).toBe(1);
    expect(countTargets(db)).toBe(0);
  });

  it('보존되는 형태 (2)(3) 의 ID 를 남긴다 (SC-003c)', () => {
    insertMemory(db, { id: 'mem_f2', subject: '러너', predicate: 'x', object: 'y',
      content: '사람이 쓴 원문이 그대로 들어온 경우' });
    insertMemory(db, { id: 'mem_f3', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너 · 호출 · forget' });
    expect(listPreservedFormIds(db).sort()).toEqual(['mem_f2', 'mem_f3']);
  });
});

describe('오탐 전수 검증 (FR-002j, SC-003)', () => {
  it('두 방식이 일치하면 agree 가 true 다', () => {
    insertMemory(db, { id: 'mem_c1', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다' });

    expect(crossVerifyTargets(db)).toEqual({
      positional: 1, escapedLike: 1, emptySubject: 0, agree: true,
    });
  });

  it('subject 안의 _ 를 이스케이프해 위치 비교와 같은 답을 낸다', () => {
    insertMemory(db, { id: 'mem_c2', subject: 'a_c', predicate: '호출', object: 'x',
      content: 'abc는 x를 호출합니다' });

    const result = crossVerifyTargets(db);
    expect(result.positional).toBe(0);
    expect(result.escapedLike).toBe(0);
    expect(result.agree).toBe(true);
  });

  it('subject 안의 % 도 이스케이프한다', () => {
    insertMemory(db, { id: 'mem_c3', subject: '50%', predicate: '초과', object: '임계',
      content: '50%는 임계를 초과합니다' });

    const result = crossVerifyTargets(db);
    expect(result.positional).toBe(1);
    expect(result.escapedLike).toBe(1);
  });
});

describe('표본과 분포 (FR-002d, FR-003, FR-001c, FR-001d)', () => {
  it('표본은 ORDER BY random() 으로 뽑고 요청 크기를 넘지 않는다', () => {
    for (let i = 0; i < 5; i += 1) {
      insertMemory(db, { id: `mem_s${i}`, subject: '러너', predicate: '호출', object: 'forget',
        content: '러너는 forget를 호출합니다' });
    }
    const sample = sampleTargets(db, 3);
    expect(sample).toHaveLength(3);
    expect(new Set(sample.map((row) => row.id)).size).toBe(3);
  });

  it('모수가 표본 크기보다 작으면 전수를 준다', () => {
    insertMemory(db, { id: 'mem_s1', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다' });
    expect(sampleTargets(db, 50)).toHaveLength(1);
  });

  it('importance 구간별로 센다', () => {
    insertMemory(db, { id: 'mem_i1', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다', importance: 0.9 });
    insertMemory(db, { id: 'mem_i2', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다', importance: 0.3 });

    const buckets = importanceBuckets(db);
    expect(buckets.find((b) => b.bucket === '0.8~1.0')?.count).toBe(1);
    expect(buckets.find((b) => b.bucket === '0.2~0.4')?.count).toBe(1);
  });

  it('귀속이 전부 NULL 이면 그렇게 보고한다 (FR-001d)', () => {
    insertMemory(db, { id: 'mem_a1', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다' });

    expect(attributionCounts(db)).toEqual({
      withProject: 0, withOwner: 0, nonPrivate: 0, softDeleted: 0, total: 1,
    });
  });

  it('pinned 후보를 별도 목록으로 남긴다 (FR-001a)', () => {
    insertMemory(db, { id: 'mem_pin', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다', pinned: 1 });
    expect(pinnedCandidates(db)).toEqual(['mem_pin']);
  });

  it('형태 (2) 의 월별 추이를 낸다 (FR-001c)', () => {
    insertMemory(db, { id: 'mem_m1', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다', created_at: '2026-07-02T00:00:00Z' });
    insertMemory(db, { id: 'mem_m2', subject: '러너', predicate: 'pragma()', object: 'forget',
      content: '사람이 쓴 원문 그대로', created_at: '2026-08-02T00:00:00Z' });

    const trend = fallbackTrendByMonth(db);
    expect(trend).toEqual([
      { month: '2026-07', total: 1, fallback: 0, rate: 0 },
      { month: '2026-08', total: 1, fallback: 1, rate: 1 },
    ]);
  });
});

describe('kg_triple 보존 대조 (FR-004 b, SC-004a)', () => {
  it('전량 보존되면 rate 가 1 이다', () => {
    insertMemory(db, { id: 'mem_k1', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다' });
    db.prepare("INSERT INTO kg_triple (subject, predicate, object) VALUES ('러너','호출','forget')").run();

    expect(kgPreservation(db)).toEqual({ total: 1, missing: 0, rate: 1 });
  });

  it('보존되지 않은 조합을 missing 으로 센다', () => {
    insertMemory(db, { id: 'mem_k2', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다' });

    const result = kgPreservation(db);
    expect(result.missing).toBe(1);
    expect(result.rate).toBe(0);
  });

  it('predicate 정규화 지표를 낸다 (FR-004d, SC-004b)', () => {
    db.prepare("INSERT INTO kg_triple (subject, predicate, object) VALUES ('a','호출','b')").run();
    db.prepare("INSERT INTO kg_triple (subject, predicate, object) VALUES ('a','pragma(mode)','b')").run();

    const metrics = kgPredicateNormalization(db);
    expect(metrics.total).toBe(2);
    expect(metrics.hangulEnding).toBe(1);
  });
});

describe('코퍼스 대조 (FR-004 a)', () => {
  it('대상과 episodic·procedural 의 교집합이 0 임을 센다', () => {
    insertMemory(db, { id: 'mem_t', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다' });
    insertMemory(db, { id: 'mem_e', type: 'episodic', content: '사람이 쓴 기록' });
    insertMemory(db, { id: 'mem_p', type: 'procedural', content: '절차' });

    expect(corpusOverlap(db)).toEqual({ targets: 1, episodic: 1, procedural: 1, overlap: 0 });
  });
});

describe('형태 (2) 원본 생존 대조 (FR-004c)', () => {
  it('본문 앞 80자가 일치하는 episodic 이 있으면 생존으로 센다', () => {
    insertMemory(db, { id: 'mem_f2', subject: '러너', predicate: 'x', object: 'y',
      content: '어제 회의에서 러너 실행 순서를 다시 정리했다' });
    insertMemory(db, { id: 'mem_src', type: 'episodic',
      content: '어제 회의에서 러너 실행 순서를 다시 정리했다' });

    expect(fallbackOriginSurvival(db)).toEqual({ total: 1, survived: 1, orphanIds: [] });
  });

  it('원본이 없으면 ID 를 남긴다', () => {
    insertMemory(db, { id: 'mem_f2', subject: '러너', predicate: 'x', object: 'y',
      content: '원본이 사라진 폴백 본문' });

    expect(fallbackOriginSurvival(db)).toEqual({ total: 1, survived: 0, orphanIds: ['mem_f2'] });
  });
});

describe('고아가 될 forgetting_event (FR-006d)', () => {
  it('FK 가 없어 cascadeImpact 가 못 보는 행을 따로 센다', () => {
    insertMemory(db, { id: 'mem_t', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다' });
    db.prepare("INSERT INTO memory_forgetting_event (id, memory_id, action) VALUES (1,'mem_t','review')").run();
    db.prepare("INSERT INTO memory_forgetting_event (id, memory_id, action) VALUES (2,'mem_t','review')").run();
    db.prepare("INSERT INTO memory_forgetting_event (id, memory_id, action) VALUES (3,'mem_alive','review')").run();

    expect(orphanForgettingEvents(db)).toBe(2);
  });

  it('참조 행이 없으면 0 을 준다', () => {
    expect(orphanForgettingEvents(db)).toBe(0);
  });
});

describe('백필 버스트 구간 분리 (FR-002b, SC-003b)', () => {
  it('2026-04·05 안과 밖을 나눠 형태별로 센다', () => {
    insertMemory(db, { id: 'mem_in', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다', created_at: '2026-04-10T00:00:00Z' });
    insertMemory(db, { id: 'mem_out1', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다', created_at: '2026-08-10T00:00:00Z' });
    insertMemory(db, { id: 'mem_out2', subject: '러너', predicate: 'x', object: 'y',
      content: '사람이 쓴 원문', created_at: '2026-08-11T00:00:00Z' });

    expect(burstIntervalSplit(db)).toEqual([
      { interval: '구간 안 (2026-04·05)', total: 1, one: 1, two: 0, three: 0 },
      { interval: '구간 밖', total: 2, one: 1, two: 1, three: 0 },
    ]);
  });
});
