/**
 * #804 격리의 실행부 — forget 반복, 잔재 정리, 공간 회수, 전후 프로브 대조.
 *
 * 삭제 로직은 재구현하지 않는다. executeTool 로 기존 forget 도구를 부른다 (FR-005).
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { executeTool } from '@memento/core';
import type { CliDatabase } from './cli.js';
import { listTargetIds } from './quarantine-targets.js';

export interface BatchOutcome {
  successful: string[];
  failed: Array<{ id: string; error: string }>;
  total: number;
}

interface TextToolResult {
  content: Array<{ text: string }>;
}

/** forget 은 createSuccessResult 로 감싸므로 content[0].text 가 JSON 문자열이다. */
export function parseBatchResult(result: TextToolResult): BatchOutcome {
  const [first] = result.content;
  if (!first) {
    throw new Error('forget 결과가 비어 있습니다');
  }
  const payload = JSON.parse(first.text) as { batch_result?: BatchOutcome };
  if (!payload.batch_result) {
    throw new Error(`forget 결과에 batch_result 가 없습니다: ${first.text.slice(0, 200)}`);
  }
  return payload.batch_result;
}

export type ForgetFn = (ids: string[]) => Promise<BatchOutcome>;

/**
 * ForgetTool 클래스는 @memento/core 의 공개 export 가 아니고 package.json exports 맵에도 없다.
 * executeTool 은 레지스트리를 거쳐 같은 ForgetTool 에 도달하는 공개 경로다 (research 결정 1).
 *
 * ToolContext 는 services 의 항목이 전부 optional 이라 빈 객체로 충분하다.
 * createToolContext 는 완전한 ServerServices 를 요구하므로 쓰지 않는다.
 */
export function createForgetFn(db: CliDatabase): ForgetFn {
  return async (ids) => {
    const result = await executeTool(
      'forget',
      { batch: ids, hard: true, confirm: true, reason: 'issue #804 파이프라인 템플릿 문장 격리' },
      { db, services: {} },
    );
    return parseBatchResult(result as TextToolResult);
  };
}

export interface ProgressRow {
  batch: number;
  at: string;
  ok: string[];
  failed: Array<{ id: string; error: string }>;
}

export interface RunSummary {
  batches: number;
  deleted: number;
  failed: string[];
  /** SC-007a: 서버 정지 창구 산정의 근거. 운영자가 time 으로 감싸지 않아도 남는다. */
  elapsedMs: number;
}

/**
 * FR-005b: 재개는 커서가 아니라 판별식 재평가로 한다.
 * 매 배치마다 대상을 다시 조회하므로 이미 지워진 건은 자연히 빠진다.
 * 영구 실패 ID 는 건너뛴다 — 핀된 항목이 있으면 같은 지점에서 무한히 실패한다.
 */
export async function runQuarantine(args: {
  db: CliDatabase;
  forget: ForgetFn;
  batchSize: number;
  onBatch: (row: ProgressRow) => void;
}): Promise<RunSummary> {
  const startedAt = Date.now();
  const stuck = new Set<string>();
  let batches = 0;
  let deleted = 0;

  for (;;) {
    const remaining = listTargetIds(args.db).filter((id) => !stuck.has(id));
    if (remaining.length === 0) {
      break;
    }
    const ids = remaining.slice(0, args.batchSize);
    batches += 1;

    const outcome = await args.forget(ids);
    deleted += outcome.successful.length;
    for (const failure of outcome.failed) {
      stuck.add(failure.id);
    }
    args.onBatch({ batch: batches, at: new Date().toISOString(), ok: outcome.successful, failed: outcome.failed });

    if (outcome.successful.length === 0 && outcome.failed.length === 0) {
      throw new Error(`배치 ${batches}: 성공도 실패도 없습니다 — 진행이 불가능해 중단합니다`);
    }
  }

  return { batches, deleted, failed: [...stuck], elapsedMs: Date.now() - startedAt };
}

/**
 * FR-009a: forget 은 삭제 건당 event_outbox 에 memory.forgotten 을 적재하고 정리 로직이 없다.
 * FR-006d: memory_forgetting_event 는 FK 가 없어 자동 정리되지 않는다.
 * FR-006f: 살아 있는 기억의 로그는 건드리지 않는다 — 그것은 #810 범위다.
 *   그래서 NOT IN (SELECT id FROM memory_item) 이 아니라 격리된 ID 목록으로만 지운다.
 *
 * 시간 범위(created_at >= startedAt)를 쓰지 않는 이유: event_outbox.created_at 은 INSERT 컬럼
 * 목록에 없어 CURRENT_TIMESTAMP 기본값 'YYYY-MM-DD HH:MM:SS' 로 들어간다. 운영자가 넘기는
 * `date -Iseconds` 는 'YYYY-MM-DDTHH:MM:SS+09:00' 이라 공백(0x20) < T(0x54) 로 비교가 항상
 * 거짓이 되어 0행을 지우고도 성공한 척한다. target_uri 의 ID 를 정확히 맞춘다.
 *
 * target_uri 형태: memento://<owner>/memory/<id> — ID 가 항상 맨 뒤다.
 * LIKE 가 아니라 접미사 등호 비교를 쓴다. ID 에 `_` 가 들어 있어 와일드카드로 해석되기 때문이다.
 */
export function cleanupResidue(
  db: CliDatabase,
  args: { deletedIds: string[] },
): { outbox: number; forgettingEvents: number } {
  if (args.deletedIds.length === 0) {
    throw new Error('정리할 격리 ID 가 없습니다 — 진행 기록(progress.jsonl)을 확인하세요');
  }

  const deleteOutbox = db.prepare(`
    DELETE FROM event_outbox
    WHERE event_type = 'memory.forgotten'
      AND substr(target_uri, length(target_uri) - length(?) + 1) = ?
  `);
  const deleteEvent = db.prepare('DELETE FROM memory_forgetting_event WHERE memory_id = ?');

  let outbox = 0;
  let forgettingEvents = 0;
  const deleteAll = db.transaction((ids: string[]) => {
    for (const id of ids) {
      outbox += deleteOutbox.run(id, id).changes;
      forgettingEvents += deleteEvent.run(id).changes;
    }
  });
  deleteAll(args.deletedIds);

  return { outbox, forgettingEvents };
}

export function readDeletedIds(progressFile: string): string[] {
  if (!existsSync(progressFile)) {
    return [];
  }
  return readFileSync(progressFile, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => (JSON.parse(line) as ProgressRow).ok);
}

/** FR-010: 잔재 정리가 VACUUM 보다 앞이어야 한다 — 아니면 감소량이 크게 과소 보고된다. */
export function vacuumAndMeasure(db: CliDatabase, dbPath: string): {
  before: number; after: number; reclaimed: number;
} {
  // -wal 을 본체로 접어 넣지 않으면 statSync 가 사이드카를 놓쳐 회수량이 어긋난다.
  db.pragma('wal_checkpoint(TRUNCATE)');
  const before = statSync(dbPath).size;
  db.exec('VACUUM');
  const after = statSync(dbPath).size;
  return { before, after, reclaimed: before - after };
}

export interface ProbeEntry {
  query: string;
  returned: Array<{ id: string; type: string; form: 0 | 1 | 2 | 3 }>;
}

export interface ProbeComparison {
  formOneAfter: number;
  humanRatioBefore: number;
  humanRatioAfter: number;
  humanRatioImproved: boolean;
  passed: boolean;
}

/** 사람이 쓴 기억 = episodic·procedural·triple 컬럼이 없는 semantic (form 0) */
function humanRatio(entries: ProbeEntry[]): number {
  const all = entries.flatMap((entry) => entry.returned);
  if (all.length === 0) {
    return 0;
  }
  return all.filter((row) => row.form === 0).length / all.length;
}

/**
 * SC-001: 격리 후 형태 (1) 이 0건. 보존된 형태 (2)(3) 반환은 의도된 동작이므로 실패가 아니다.
 * SC-001a: 사람이 쓴 기억의 비율 상승. 두 사본이 프로브를 1회씩만 받으므로 상승분은 격리 효과다.
 */
export function compareProbes(before: ProbeEntry[], after: ProbeEntry[]): ProbeComparison {
  const formOneAfter = after.flatMap((entry) => entry.returned).filter((row) => row.form === 1).length;
  const humanRatioBefore = humanRatio(before);
  const humanRatioAfter = humanRatio(after);
  const humanRatioImproved = humanRatioAfter > humanRatioBefore;

  return {
    formOneAfter,
    humanRatioBefore,
    humanRatioAfter,
    humanRatioImproved,
    passed: formOneAfter === 0 && humanRatioImproved,
  };
}
