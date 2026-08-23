import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendJsonl, resolveOutDir } from './quarantine-report.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'q065-out-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('resolveOutDir', () => {
  it('저장소 안이면 .local/ 아래만 허용한다', () => {
    expect(() => resolveOutDir('specs/065/report', '/repo')).toThrow(/\.local/);
  });

  it('저장소 안 .local/ 아래는 허용한다', () => {
    expect(resolveOutDir('/repo/.local/quarantine-065', '/repo')).toBe('/repo/.local/quarantine-065');
  });

  it('저장소 밖은 그대로 허용한다', () => {
    expect(resolveOutDir('/tmp/q065', '/repo')).toBe('/tmp/q065');
  });
});

describe('appendJsonl', () => {
  it('한 줄에 한 레코드씩 덧붙인다', () => {
    const file = join(dir, 'progress.jsonl');
    appendJsonl(file, { batch: 1, ok: ['mem_a'] });
    appendJsonl(file, { batch: 2, ok: ['mem_b'] });

    const lines = readFileSync(file, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1]!)).toEqual({ batch: 2, ok: ['mem_b'] });
  });
});
