import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFixtureDb, insertMemory } from './quarantine-fixture.js';
import { appendJsonl } from './quarantine-report.js';
import { countTargets } from './quarantine-targets.js';
import { parseBatchResult } from './quarantine-run.js';

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
