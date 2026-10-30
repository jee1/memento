import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('Jev backfill audit CLI', () => {
  let dir: string;
  let path: string;
  const cli = resolve('scripts/sample-relations-jev.mjs');
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' },
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jev-audit-'));
    path = join(dir, 'memory.db');
    const db = new Database(path);
    db.exec(`
      CREATE TABLE memory_item (id TEXT PRIMARY KEY, content TEXT, created_at TEXT, is_deleted INTEGER);
      CREATE TABLE memory_relation (id INTEGER PRIMARY KEY, source_id TEXT, target_id TEXT, relation_type TEXT, confidence REAL, metadata TEXT);
      INSERT INTO memory_item VALUES ('s', 'full source', '2026-10-24', 0), ('t', 'full target', '2026-10-23', NULL), ('deleted', 'hidden', '2026-10-22', 1);
      INSERT INTO memory_relation VALUES
        (1, 's', 't', 'FOLLOWS', 0.5, '{"backfill":true}'),
        (2, 's', 't', 'FOLLOWS', 0.6, '{"backfill":true}'),
        (3, 's', 't', 'CAUSES', 0.8, '{"backfill":true}'),
        (4, 's', 't', 'CAUSES', 1.0, '{"backfill":true}'),
        (5, 's', 't', 'FOLLOWS', 0.9, '{}'),
        (6, 's', 'deleted', 'FOLLOWS', 0.9, '{"backfill":true}'),
        (7, 's', 'missing', 'FOLLOWS', 0.9, '{"backfill":true}'),
        (8, 's', 't', 'FOLLOWS', 0.9, 'invalid');
    `);
    db.close();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('samples each type reproducibly, excludes ineligible pairs, and leaves the DB unchanged', () => {
    const before = readFileSync(path);
    const first = run('--db', path, '--size', '1');
    expect(first.status, first.stderr).toBe(0);
    const audit = JSON.parse(first.stdout);
    const second = JSON.parse(run('--db', path, '--size', '1').stdout);
    expect(audit.samples).toEqual(second.samples);
    expect(audit.samples).toHaveLength(2);
    expect(audit.population.FOLLOWS).toEqual({ '0.5-0.6': 1, '0.6-0.8': 1, '0.8-1.0': 0 });
    expect(audit.population.CAUSES['0.8-1.0']).toBe(2);
    expect(audit.samples[0]).toMatchObject({ source_content: 'full source', target_content: 'full target', verdict: null });
    expect(readFileSync(path)).toEqual(before);
    expect(run('--db', path, '--size', '0').status).toBe(1);
    expect(run('--db', join(dir, 'missing.db')).status).toBe(1);
  });

  it('counts all three verdicts and rejects pending, duplicate, or invalid ratings', () => {
    const audit = JSON.parse(run('--db', path).stdout);
    const verdicts = ['correct', 'wrong_type', 'unrelated', 'correct'];
    audit.samples.forEach((s: Record<string, unknown>, i: number) => {
      s.verdict = verdicts[i];
      s.reason = 'synthetic review';
    });
    const file = join(dir, 'rated.json');
    writeFileSync(file, JSON.stringify(audit));
    const result = run('--report', file);
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(result.stdout);
    expect(report.by_type.CAUSES).toMatchObject({ precision: 0.5, related_precision: 1, wrong_type: 1 });
    expect(report.by_type.FOLLOWS).toMatchObject({ precision: 0.5, related_precision: 0.5, unrelated: 1 });
    expect(report.by_type.BELONGS_TO.precision).toBeNull();
    expect(report.by_confidence['0.5-0.6'].sampled).toBe(1);
    expect(report.by_confidence['0.6-0.8'].sampled).toBe(1);
    expect(report.by_confidence['0.8-1.0']).toMatchObject({ sampled: 2, correct: 1, wrong_type: 1 });
    for (const invalid of [null, 'unknown']) {
      audit.samples[0].verdict = invalid;
      writeFileSync(file, JSON.stringify(audit));
      expect(run('--report', file).status).toBe(1);
    }
    audit.samples[0].verdict = 'correct';
    const complete = [...audit.samples];
    audit.samples.pop();
    writeFileSync(file, JSON.stringify(audit));
    expect(run('--report', file).status).toBe(1);
    audit.samples = complete;
    audit.samples.push(audit.samples[0]);
    writeFileSync(file, JSON.stringify(audit));
    expect(run('--report', file).status).toBe(1);
  });
});
