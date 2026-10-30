/**
 * check-retry-usage 게이트 회귀 테스트 (#1338)
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { checkAllFiles, checkRetryUsage } from '../check-retry-usage.js';

describe('check-retry-usage', () => {
  it('대상 디렉토리가 없으면 통과하지 않고 실패한다', async () => {
    await expect(checkAllFiles(join(tmpdir(), 'memento-retry-usage-missing'))).rejects.toThrow();
  });

  it('검사할 파일이 0개면 실패한다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'memento-retry-usage-'));
    try {
      await expect(checkAllFiles(dir)).rejects.toThrow('검사할 파일이 없습니다');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('재시도 없는 외부 호출은 파일 순서와 관계없이 모두 잡는다 (/g lastIndex 회귀)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'memento-retry-usage-'));
    try {
      mkdirSync(join(dir, 'src'));
      const call = 'export async function f() { return fetch("http://x"); }\n';
      writeFileSync(join(dir, 'src', 'a.ts'), call);
      writeFileSync(join(dir, 'src', 'b.ts'), call);
      const results = await checkAllFiles(dir);
      expect(results.filter(r => r.issues.length > 0).map(r => r.file).sort()).toEqual(['src/a.ts', 'src/b.ts']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('주석 속 fetch( 는 외부 호출로 보지 않는다', () => {
    expect(checkRetryUsage('x.ts', '/** neighbor fetch (분리) */\n// fetch(url)\n').hasExternalAPICall).toBe(false);
  });

  it('retryManager.retry 로 감싸면 통과한다', () => {
    const content = 'await this.retryManager.retry(() => fetch(url), opts);';
    expect(checkRetryUsage('x.ts', content).issues).toEqual([]);
  });

  it('retryChatLlmCall 래퍼로 감싸면 통과한다', () => {
    const content = 'await retryChatLlmCall(this.retryManager, ctx, () => fetch(url));';
    expect(checkRetryUsage('x.ts', content).issues).toEqual([]);
  });

  it('래퍼 이름만 비슷하면 통과시키지 않는다', () => {
    const content = 'await myRetryHelper(this.manager, () => fetch(url));';
    expect(checkRetryUsage('x.ts', content).issues).toHaveLength(1);
  });
});
