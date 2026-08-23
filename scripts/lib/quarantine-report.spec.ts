import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDryRunReport, appendJsonl, resolveOutDir } from './quarantine-report.js';
import { createFixtureDb, insertMemory } from './quarantine-fixture.js';

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

describe('buildDryRunReport (FR-003, SC-003b·003c)', () => {
  it('필수 절을 모두 담는다', () => {
    const db = createFixtureDb();
    insertMemory(db, { id: 'mem_r1', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다' });
    db.prepare("INSERT INTO kg_triple (subject, predicate, object) VALUES ('러너','호출','forget')").run();

    const report = buildDryRunReport(db, { sampleSize: 50 });

    for (const heading of [
      '## 대상 건수', '## 본문 형태 분포', '## 오탐 전수 검증', '## 표본 A',
      '## 귀속 분포', '## kg_triple 보존', '## 연쇄 영향', '## 형태 (2) 월별 추이',
      '## 격리 제외 pinned',
    ]) {
      expect(report).toContain(heading);
    }
    db.close();
  });

  it('recall_count 출발값 차이를 주석으로 남긴다 (FR-001f)', () => {
    const db = createFixtureDb();
    expect(buildDryRunReport(db, { sampleSize: 50 })).toContain('createSemanticMemory');
    db.close();
  });
});
