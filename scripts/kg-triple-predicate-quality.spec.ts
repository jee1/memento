import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SAMPLE_LIMIT,
  buildKgTriplePredicateQualityReport,
} from './lib/kg-triple-predicate-quality.js';
import { main } from './kg-triple-predicate-quality.js';

function createKgTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE kg_triple (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      predicate TEXT NOT NULL,
      object TEXT NOT NULL,
      UNIQUE(subject, predicate, object)
    )
  `);
}

function insertTriple(
  db: Database.Database,
  subject: string,
  predicate: string,
  object: string,
  id?: string,
): void {
  db.prepare(
    `INSERT INTO kg_triple (id, subject, predicate, object) VALUES (?, ?, ?, ?)`,
  ).run(id ?? `kg_${subject}_${predicate}_${object}`, subject, predicate, object);
}

function countTriples(db: Database.Database): number {
  return (db.prepare(`SELECT COUNT(*) AS c FROM kg_triple`).get() as { c: number }).c;
}

describe('buildKgTriplePredicateQualityReport (T009)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    createKgTable(db);
  });

  afterEach(() => {
    db.close();
  });

  it('합성 9 hangul + 1 non-hangul → hangul_termination_rate ≈ 0.9', () => {
    for (let i = 0; i < 9; i += 1) {
      insertTriple(db, `subj_${i}`, `사용함`, `obj_${i}`, `kg_h_${i}`);
    }
    insertTriple(db, 'subj_x', 'use', 'obj_x', 'kg_nh_0');

    const report = buildKgTriplePredicateQualityReport(db);

    expect(report.total).toBe(10);
    expect(report.hangul_termination_rate).toBeCloseTo(0.9, 5);
    expect(report.non_hangul_termination_count).toBe(1);
    expect(report.whitespace_rate).toBe(0);
    expect(report.average_length).toBeGreaterThan(0);
    expect(report.samples.non_hangul_termination).toEqual(['use']);
    expect(report.samples.with_whitespace).toEqual([]);
  });

  it('whitespace_rate와 with_whitespace 샘플을 집계한다', () => {
    insertTriple(db, 'a', '사용함', 'b', 'kg_ok');
    insertTriple(db, 'a', '관련 작업', 'b', 'kg_ws');
    insertTriple(db, 'a', 'related work', 'b', 'kg_ws_en');

    const report = buildKgTriplePredicateQualityReport(db);

    expect(report.total).toBe(3);
    expect(report.whitespace_rate).toBeCloseTo(2 / 3, 5);
    expect(report.samples.with_whitespace.sort()).toEqual(['related work', '관련 작업']);
    expect(report.non_hangul_termination_count).toBe(1); // 'related work' ends in Latin
  });

  it('sampleLimit으로 샘플을 캡한다 (기본 ≤20)', () => {
    for (let i = 0; i < 25; i += 1) {
      insertTriple(db, `s${i}`, `pred_en_${i}`, `o${i}`, `kg_cap_${i}`);
    }

    const capped = buildKgTriplePredicateQualityReport(db, { sampleLimit: 5 });
    expect(capped.total).toBe(25);
    expect(capped.samples.non_hangul_termination).toHaveLength(5);

    const defaulted = buildKgTriplePredicateQualityReport(db);
    expect(defaulted.samples.non_hangul_termination.length).toBeLessThanOrEqual(
      DEFAULT_SAMPLE_LIMIT,
    );
    expect(DEFAULT_SAMPLE_LIMIT).toBeLessThanOrEqual(20);
  });

  it('빈 테이블이면 rate 0·샘플 빈 배열', () => {
    const report = buildKgTriplePredicateQualityReport(db);
    expect(report).toEqual({
      total: 0,
      hangul_termination_rate: 0,
      whitespace_rate: 0,
      average_length: 0,
      non_hangul_termination_count: 0,
      samples: { non_hangul_termination: [], with_whitespace: [] },
    });
  });

  it('읽기 전용: report 전후 kg_triple COUNT 불변', () => {
    insertTriple(db, 's', '사용함', 'o', 'kg_ro');
    insertTriple(db, 's', 'use', 'o', 'kg_ro2');
    const before = countTriples(db);
    buildKgTriplePredicateQualityReport(db);
    expect(countTriples(db)).toBe(before);
  });
});

describe('kg-triple-predicate-quality CLI (T010–T011)', () => {
  let tmpDir: string;
  let dbPath: string;
  let prevDbPath: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'kg-pred-quality-'));
    dbPath = join(tmpDir, 'memory.db');
    const db = new Database(dbPath);
    createKgTable(db);
    for (let i = 0; i < 9; i += 1) {
      insertTriple(db, `subj_${i}`, `사용함`, `obj_${i}`, `kg_h_${i}`);
    }
    insertTriple(db, 'subj_x', 'use', 'obj_x', 'kg_nh_0');
    insertTriple(db, 'subj_w', '관련 작업', 'obj_w', 'kg_ws_0');
    db.close();

    prevDbPath = process.env.DB_PATH;
    process.env.DB_PATH = dbPath;
  });

  afterEach(() => {
    if (prevDbPath === undefined) {
      delete process.env.DB_PATH;
    } else {
      process.env.DB_PATH = prevDbPath;
    }
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('JSON { ok: true, report } 를 출력하고 절대 DB_PATH를 stdout에 넣지 않는다', async () => {
    const chunks: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);

    try {
      const code = await main([]);
      expect(code).toBe(0);

      const out = chunks.join('');
      expect(out).not.toContain(dbPath);
      // FR-006: absolute path leak guard (tmp dir is absolute)
      expect(out).not.toMatch(/\/home\//);
      expect(dbPath.startsWith('/')).toBe(true);

      const parsed = JSON.parse(out) as {
        ok: boolean;
        report: {
          total: number;
          hangul_termination_rate: number;
          samples: { non_hangul_termination: string[]; with_whitespace: string[] };
        };
      };
      expect(parsed.ok).toBe(true);
      expect(parsed.report.total).toBe(11);
      // 9×사용함 + 관련 작업(한글 종결) + use(비한글) → 10/11
      expect(parsed.report.hangul_termination_rate).toBeCloseTo(10 / 11, 5);
      expect(parsed.report.samples.non_hangul_termination.length).toBeLessThanOrEqual(20);
      expect(parsed.report.samples.with_whitespace.length).toBeLessThanOrEqual(20);
    } finally {
      spy.mockRestore();
    }
  });

  it('--sample-limit 으로 샘플 상한을 적용한다', async () => {
    const db = new Database(dbPath);
    for (let i = 0; i < 15; i += 1) {
      insertTriple(db, `extra_s${i}`, `latin_${i}`, `extra_o${i}`, `kg_extra_${i}`);
    }
    db.close();

    const chunks: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: unknown) => {
      chunks.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);

    try {
      const code = await main(['--sample-limit', '3']);
      expect(code).toBe(0);
      const parsed = JSON.parse(chunks.join('')) as {
        report: { samples: { non_hangul_termination: string[] } };
      };
      expect(parsed.report.samples.non_hangul_termination).toHaveLength(3);
    } finally {
      spy.mockRestore();
    }
  });

  it('CLI 실행 후에도 kg_triple COUNT가 변하지 않는다 (read-only)', async () => {
    const beforeDb = new Database(dbPath, { readonly: true });
    const before = countTriples(beforeDb);
    beforeDb.close();

    const spy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      expect(await main([])).toBe(0);
    } finally {
      spy.mockRestore();
    }

    const afterDb = new Database(dbPath, { readonly: true });
    expect(countTriples(afterDb)).toBe(before);
    afterDb.close();
  });
});
