import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixtureDb, insertMemory } from './quarantine-fixture.js';
import { appendJsonl } from './quarantine-report.js';
import { countTargets } from './quarantine-targets.js';
import {
  cleanupResidue, type ForgetFn, parseBatchResult, type ProgressRow, readDeletedIds,
  compareProbes, createForgetFn, type ProbeEntry, runQuarantine, vacuumAndMeasure,
} from './quarantine-run.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'q065-run-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('parseBatchResult', () => {
  it('ToolResult 의 JSON 본문에서 batch_result 를 꺼낸다', () => {
    const result = {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          batch_result: { successful: ['mem_a', 'mem_b'], failed: [], total: 2 },
          message: '배치 삭제 완료: 2/2 성공',
          deleted_type: 'hard',
        }, null, 2),
      }],
    };

    expect(parseBatchResult(result)).toEqual({ successful: ['mem_a', 'mem_b'], failed: [], total: 2 });
  });

  it('실패 항목의 사유를 보존한다', () => {
    const result = {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          batch_result: {
            successful: [],
            failed: [{ id: 'mem_pinned', error: '핀된 기억은 삭제할 수 없습니다' }],
            total: 1,
          },
        }),
      }],
    };

    expect(parseBatchResult(result).failed[0]).toEqual({
      id: 'mem_pinned', error: '핀된 기억은 삭제할 수 없습니다',
    });
  });

  it('batch_result 가 없으면 조용히 넘어가지 않는다', () => {
    const result = { content: [{ type: 'text' as const, text: JSON.stringify({ message: '단일 삭제' }) }] };
    expect(() => parseBatchResult(result)).toThrow(/batch_result/);
  });

  it('본문이 비면 실패한다', () => {
    expect(() => parseBatchResult({ content: [] })).toThrow();
  });
});

function deleteIds(db: Database.Database, ids: string[]): void {
  if (ids.length === 0) return;
  db.prepare(`DELETE FROM memory_item WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
}

describe('runQuarantine (FR-005, FR-005b, SC-006a)', () => {
  it('배치 상한만큼 끊어 부르고 잔여가 0이 되면 멈춘다', async () => {
    const db = createFixtureDb();
    for (let i = 0; i < 5; i += 1) {
      insertMemory(db, { id: `mem_${i}`, subject: '러너', predicate: '호출', object: 'forget',
        content: '러너는 forget를 호출합니다' });
    }
    const calls: string[][] = [];
    const forget: ForgetFn = async (ids) => {
      calls.push(ids);
      deleteIds(db, ids);
      return { successful: ids, failed: [], total: ids.length };
    };

    const summary = await runQuarantine({ db, forget, batchSize: 2, onBatch: () => {} });

    expect(calls.map((call) => call.length)).toEqual([2, 2, 1]);
    expect(summary).toMatchObject({ batches: 3, deleted: 5, failed: [] });
    expect(summary.elapsedMs).toBeGreaterThanOrEqual(0);
    db.close();
  });

  it('중단 후 재실행하면 남은 대상만 처리한다', async () => {
    const db = createFixtureDb();
    for (let i = 0; i < 4; i += 1) {
      insertMemory(db, { id: `mem_${i}`, subject: '러너', predicate: '호출', object: 'forget',
        content: '러너는 forget를 호출합니다' });
    }
    const forget: ForgetFn = async (ids) => {
      deleteIds(db, ids);
      return { successful: ids, failed: [], total: ids.length };
    };

    await forget(['mem_0', 'mem_1']);
    const summary = await runQuarantine({ db, forget, batchSize: 100, onBatch: () => {} });

    expect(summary.deleted).toBe(2);
    expect(countTargets(db)).toBe(0);
    db.close();
  });

  it('영구 실패 ID 를 건너뛰어 무한 루프를 막는다', async () => {
    const db = createFixtureDb();
    insertMemory(db, { id: 'mem_stuck', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다' });
    insertMemory(db, { id: 'mem_ok', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다' });

    const forget: ForgetFn = async (ids) => {
      const ok = ids.filter((id) => id !== 'mem_stuck');
      deleteIds(db, ok);
      return {
        successful: ok,
        failed: ids.filter((id) => id === 'mem_stuck').map((id) => ({ id, error: '핀된 기억' })),
        total: ids.length,
      };
    };

    const summary = await runQuarantine({ db, forget, batchSize: 100, onBatch: () => {} });

    expect(summary.deleted).toBe(1);
    expect(summary.failed).toEqual(['mem_stuck']);
    db.close();
  });

  it('배치마다 성공·실패 ID 를 진행 기록으로 넘긴다', async () => {
    const db = createFixtureDb();
    insertMemory(db, { id: 'mem_a', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다' });
    const rows: ProgressRow[] = [];
    const forget: ForgetFn = async (ids) => {
      deleteIds(db, ids);
      return { successful: ids, failed: [], total: ids.length };
    };

    await runQuarantine({ db, forget, batchSize: 100, onBatch: (row) => rows.push(row) });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.ok).toEqual(['mem_a']);
    expect(rows[0]!.batch).toBe(1);
    expect(typeof rows[0]!.at).toBe('string');
    db.close();
  });
});

describe('cleanupResidue (FR-006d, FR-006f, FR-009a)', () => {
  // event_outbox · memory_forgetting_event 는 픽스처가 라이브 스키마대로 만든다.
  const createResidueDb = createFixtureDb;

  it('격리된 ID 의 memory.forgotten 만 지운다 (SC-005a)', () => {
    const db = createResidueDb();
    db.prepare("INSERT INTO event_outbox (id, event_type, target_uri, payload_json, idempotency_key) VALUES ('1','memory.forgotten','memento://default/memory/mem_gone','{}','k1')").run();
    db.prepare("INSERT INTO event_outbox (id, event_type, target_uri, payload_json, idempotency_key) VALUES ('2','memory.forgotten','memento://default/memory/mem_other','{}','k2')").run();
    db.prepare("INSERT INTO event_outbox (id, event_type, target_uri, payload_json, idempotency_key) VALUES ('3','memory.created','memento://default/memory/mem_gone','{}','k3')").run();

    const result = cleanupResidue(db, { deletedIds: ['mem_gone'] });

    expect(result.outbox).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM event_outbox').get()).toEqual({ n: 2 });
    db.close();
  });

  it('CURRENT_TIMESTAMP 표기(공백 구분)에도 동작한다 — 시간 비교를 쓰지 않는다', () => {
    // event_outbox.created_at 은 INSERT 컬럼 목록에 없어 'YYYY-MM-DD HH:MM:SS' 로 들어간다.
    // 운영자가 넘기는 date -Iseconds 는 'YYYY-MM-DDTHH:MM:SS+09:00' 이라 문자열 비교가 항상 거짓이었다.
    const db = createResidueDb();
    db.prepare(`INSERT INTO event_outbox (id, event_type, target_uri, payload_json, idempotency_key) VALUES ('1','memory.forgotten','memento://default/memory/mem_gone','{}','k1')`).run();
    db.prepare("UPDATE event_outbox SET created_at = '2026-08-23 12:00:00'").run();

    expect(cleanupResidue(db, { deletedIds: ['mem_gone'] }).outbox).toBe(1);
    db.close();
  });

  it('ID 가 다른 ID 의 부분 문자열이어도 오삭제하지 않는다', () => {
    const db = createResidueDb();
    db.prepare("INSERT INTO event_outbox (id, event_type, target_uri, payload_json, idempotency_key) VALUES ('1','memory.forgotten','memento://default/memory/mem_a1','{}','k1')").run();
    db.prepare("INSERT INTO event_outbox (id, event_type, target_uri, payload_json, idempotency_key) VALUES ('2','memory.forgotten','memento://default/memory/mem_a12','{}','k2')").run();

    expect(cleanupResidue(db, { deletedIds: ['mem_a1'] }).outbox).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM event_outbox WHERE id = 2").get()).toEqual({ n: 1 });
    db.close();
  });

  it('격리된 ID 를 참조하는 forgetting_event 만 지운다 (SC-005b)', () => {
    const db = createResidueDb();
    db.prepare("INSERT INTO memory_forgetting_event (id, memory_id, action) VALUES (1,'mem_gone','hard')").run();
    db.prepare("INSERT INTO memory_forgetting_event (id, memory_id, action) VALUES (2,'mem_alive','review')").run();

    const result = cleanupResidue(db, { deletedIds: ['mem_gone'] });

    expect(result.forgettingEvents).toBe(1);
    expect(db.prepare("SELECT COUNT(*) AS n FROM memory_forgetting_event WHERE memory_id = 'mem_alive'").get())
      .toEqual({ n: 1 });
    db.close();
  });

  it('정리할 ID 가 없으면 조용히 성공하지 않는다', () => {
    const db = createResidueDb();
    expect(() => cleanupResidue(db, { deletedIds: [] })).toThrow(/진행 기록/);
    db.close();
  });
});

describe('readDeletedIds', () => {
  it('진행 기록에서 성공 ID 를 모은다', () => {
    const file = join(dir, 'progress.jsonl');
    appendJsonl(file, { batch: 1, at: 'x', ok: ['mem_a', 'mem_b'], failed: [] });
    appendJsonl(file, { batch: 2, at: 'x', ok: ['mem_c'], failed: [{ id: 'mem_d', error: 'e' }] });

    expect(readDeletedIds(file)).toEqual(['mem_a', 'mem_b', 'mem_c']);
  });

  it('파일이 없으면 빈 배열이다', () => {
    expect(readDeletedIds(join(dir, 'nope.jsonl'))).toEqual([]);
  });
});

describe('vacuumAndMeasure (FR-010, SC-007)', () => {
  it('전후 파일 크기와 감소량을 기록한다', () => {
    const file = join(dir, 'vac.db');
    const db = new Database(file);
    db.exec('CREATE TABLE blob_rows (id INTEGER PRIMARY KEY, payload TEXT)');
    const insert = db.prepare('INSERT INTO blob_rows (payload) VALUES (?)');
    // 트랜잭션 없이 개별 INSERT 하면 커밋마다 fsync 가 돌아 테스트가 수십 초로 늘어난다.
    db.transaction(() => {
      for (let i = 0; i < 2000; i += 1) insert.run('x'.repeat(500));
    })();
    db.exec('DELETE FROM blob_rows');

    const result = vacuumAndMeasure(db, file);

    expect(result.before).toBeGreaterThan(result.after);
    expect(result.reclaimed).toBe(result.before - result.after);
    db.close();
  });
});

describe('compareProbes (SC-001, SC-001a)', () => {
  it('격리 후 형태 (1) 이 0건이면 통과로 본다', () => {
    const before: ProbeEntry[] = [{
      query: '검색 랭킹 공식', returned: [
        { id: 'mem_t1', type: 'semantic', form: 1 },
        { id: 'mem_e1', type: 'episodic', form: 0 },
      ],
    }];
    const after: ProbeEntry[] = [{
      query: '검색 랭킹 공식', returned: [
        { id: 'mem_e1', type: 'episodic', form: 0 },
        { id: 'mem_p1', type: 'procedural', form: 0 },
      ],
    }];

    expect(compareProbes(before, after)).toEqual({
      formOneAfter: 0,
      humanRatioBefore: 0.5,
      humanRatioAfter: 1,
      humanRatioImproved: true,
      passed: true,
    });
  });

  it('형태 (1) 이 남아 있으면 실패로 본다', () => {
    const probes: ProbeEntry[] = [{ query: 'q', returned: [{ id: 'mem_t', type: 'semantic', form: 1 }] }];
    expect(compareProbes(probes, probes).passed).toBe(false);
  });

  it('보존된 형태 (2) 가 반환돼도 실패가 아니다 (SC-001 단서)', () => {
    const before: ProbeEntry[] = [{ query: 'q', returned: [{ id: 'mem_t', type: 'semantic', form: 1 }] }];
    const after: ProbeEntry[] = [{ query: 'q', returned: [{ id: 'mem_f2', type: 'semantic', form: 2 }] }];
    expect(compareProbes(before, after).formOneAfter).toBe(0);
  });

  it('반환이 0건이면 비율을 0 으로 둔다', () => {
    expect(compareProbes([], []).humanRatioBefore).toBe(0);
  });
});

describe('createForgetFn 통합 (I-3: 실제 forget 도구 경유)', () => {
  it('executeTool 로 ForgetTool 에 도달해 실제로 지우고 연쇄를 남기지 않는다', async () => {
    const db = createFixtureDb();
    insertMemory(db, { id: 'mem_real', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다' });
    db.prepare("INSERT INTO memory_item_tag VALUES ('mem_real','triple')").run();
    db.prepare("INSERT INTO memory_embedding (memory_id) VALUES ('mem_real')").run();

    const forget = createForgetFn(db);
    const outcome = await forget(['mem_real']);

    expect(outcome.successful).toEqual(['mem_real']);
    expect(outcome.failed).toEqual([]);
    expect(countTargets(db)).toBe(0);
    // FK CASCADE 가 실제로 돌았는지 — PRAGMA foreign_keys 가 꺼져 있으면 여기서 깨진다
    expect(db.prepare('SELECT COUNT(*) AS n FROM memory_item_tag').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM memory_embedding').get()).toEqual({ n: 0 });
    db.close();
  });

  it('forget 이 적재한 outbox 행을 cleanupResidue 가 실제로 지운다', async () => {
    // event_outbox 는 MEMENTO_EVENT_OUTBOX_ENABLED=true 일 때만 적재된다 (기본 off).
    // 라이브 event_outbox 가 0행인 것도 이 때문이다 — FR-009a 는 이 플래그가 켜진 배포에서만 의미가 있다.
    const previous = process.env.MEMENTO_EVENT_OUTBOX_ENABLED;
    process.env.MEMENTO_EVENT_OUTBOX_ENABLED = 'true';
    const db = createFixtureDb();
    insertMemory(db, { id: 'mem_real', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다' });

    await createForgetFn(db)(['mem_real']);

    const before = db.prepare("SELECT COUNT(*) AS n FROM event_outbox WHERE event_type='memory.forgotten'").get();
    expect(before).toEqual({ n: 1 });

    expect(cleanupResidue(db, { deletedIds: ['mem_real'] }).outbox).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM event_outbox').get()).toEqual({ n: 0 });
    db.close();
    if (previous === undefined) {
      delete process.env.MEMENTO_EVENT_OUTBOX_ENABLED;
    } else {
      process.env.MEMENTO_EVENT_OUTBOX_ENABLED = previous;
    }
  });
});
