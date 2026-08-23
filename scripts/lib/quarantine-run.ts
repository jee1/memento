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

  return { batches, deleted, failed: [...stuck] };
}
