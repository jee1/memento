import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendJsonl, buildDryRunReport, exportRelations, resolveOutDir } from './quarantine-report.js';
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
      '## 대상 건수', '## importance 구간 분포', '## 본문 형태 분포',
      '## 백필 버스트 구간 분리', '## 오탐 전수 검증', '## 표본 A', '## 코퍼스 대조',
      '## 귀속 분포', '## kg_triple 보존', '## 형태 (2) 원본 생존', '## 연쇄 영향',
      '## 형태 (2) 월별 추이', '## 격리 제외 pinned',
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

describe('exportRelations (FR-006i, SC-005c)', () => {
  it('본문 없이 식별자만 한 줄씩 쓴다', () => {
    const db = createFixtureDb();
    db.exec(`
      CREATE TABLE memory_relation (
        source_id TEXT REFERENCES memory_item(id) ON DELETE CASCADE,
        target_id TEXT REFERENCES memory_item(id) ON DELETE CASCADE,
        relation_type TEXT
      )
    `);
    insertMemory(db, { id: 'mem_t', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다' });
    insertMemory(db, { id: 'mem_src', type: 'episodic', content: '사람이 쓴 원문' });
    db.prepare("INSERT INTO memory_relation VALUES ('mem_t','mem_src','extracted_from')").run();

    const file = join(dir, 'relations.jsonl');
    const summary = exportRelations(db, file);

    expect(summary).toEqual({ rows: 1, byType: { extracted_from: 1 } });
    const line = JSON.parse(readFileSync(file, 'utf8').trim());
    expect(line).toEqual({
      target_id: 'mem_t', relation_type: 'extracted_from', other_id: 'mem_src', other_type: 'episodic',
    });
    expect(readFileSync(file, 'utf8')).not.toContain('사람이 쓴 원문');
    db.close();
  });
});

describe('buildDryRunReport 누락 방지 (I-1 회귀)', () => {
  it('FK 가 없는 memory_forgetting_event 의 고아 수를 연쇄 영향 절에 포함한다 (FR-006d)', () => {
    const db = createFixtureDb();
    insertMemory(db, { id: 'mem_t', subject: '러너', predicate: '호출', object: 'forget',
      content: '러너는 forget를 호출합니다' });
    db.prepare("INSERT INTO memory_forgetting_event (id, memory_id, action) VALUES (1,'mem_t','review')").run();

    const report = buildDryRunReport(db, { sampleSize: 50 });

    expect(report).toContain('memory_forgetting_event');
    expect(report).toMatch(/memory_forgetting_event.*FK 없음.*1/s);
    db.close();
  });
});
