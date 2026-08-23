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
