import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixtureDb, insertMemory } from './quarantine-fixture.js';
import { appendJsonl } from './quarantine-report.js';
import { countTargets } from './quarantine-targets.js';
import {
  type ForgetFn, parseBatchResult, type ProgressRow, runQuarantine,
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
    expect(summary).toEqual({ batches: 3, deleted: 5, failed: [] });
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
