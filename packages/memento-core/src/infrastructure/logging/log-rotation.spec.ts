/**
 * log_rotation multi-family orchestrator tests (#852).
 * Always uses injected temp roots — never live ~/.memento.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { DAY_MS } from '../../shared/utils/date.js';
import {
  DEFAULT_DOCKER_DIAGNOSTICS_MAX_BYTES,
  DEFAULT_MIGRATION_KEEP_COUNT,
  DEFAULT_MONITOR_JSONL_MAX_BYTES,
  DEFAULT_TRIPLE_EXTRACTION_DAYS,
  resolveLogRotationPolicies,
} from './log-rotation-policies.js';
import { resolveLogRotationRoots } from './log-rotation-paths.js';
import { rotateLogs } from './log-rotation.js';

async function mkTempRoot(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeFileAt(
  dir: string,
  name: string,
  contents: string | Buffer,
  mtimeMs?: number
): Promise<void> {
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, contents);
  if (mtimeMs !== undefined) {
    const atime = new Date();
    await fs.utimes(filePath, atime, new Date(mtimeMs));
  }
}

function assertNoAbsTempLeak(report: { warnings: string[]; families: unknown[] }, tempRoot: string): void {
  const asJson = JSON.stringify(report);
  expect(asJson).not.toContain(tempRoot);
  for (const w of report.warnings) {
    expect(w).not.toContain(tempRoot);
    expect(w).not.toMatch(/^\//);
  }
}

describe('log-rotation-policies', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of [
      'LOG_ROTATION_MIGRATION_KEEP_COUNT',
      'LOG_ROTATION_DOCKER_DIAGNOSTICS_MAX_BYTES',
      'LOG_ROTATION_MONITOR_JSONL_MAX_BYTES',
      'LOG_ROTATION_TRIPLE_EXTRACTION_DAYS',
    ]) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('uses documented defaults', () => {
    const p = resolveLogRotationPolicies();
    expect(p.migrationKeepCount).toBe(DEFAULT_MIGRATION_KEEP_COUNT);
    expect(p.migrationKeepCount).toBe(500);
    expect(p.dockerDiagnosticsMaxBytes).toBe(DEFAULT_DOCKER_DIAGNOSTICS_MAX_BYTES);
    expect(p.dockerDiagnosticsMaxBytes).toBe(268_435_456);
    expect(p.monitorJsonlMaxBytes).toBe(DEFAULT_MONITOR_JSONL_MAX_BYTES);
    expect(p.monitorJsonlMaxBytes).toBe(33_554_432);
    expect(p.tripleExtractionDays).toBe(DEFAULT_TRIPLE_EXTRACTION_DAYS);
    expect(p.tripleExtractionDays).toBe(30);
  });

  it('parses env overrides including keepCount <= 0', () => {
    process.env.LOG_ROTATION_MIGRATION_KEEP_COUNT = '0';
    process.env.LOG_ROTATION_DOCKER_DIAGNOSTICS_MAX_BYTES = '1024';
    process.env.LOG_ROTATION_MONITOR_JSONL_MAX_BYTES = '2048';
    process.env.LOG_ROTATION_TRIPLE_EXTRACTION_DAYS = '7';
    const p = resolveLogRotationPolicies();
    expect(p.migrationKeepCount).toBe(0);
    expect(p.dockerDiagnosticsMaxBytes).toBe(1024);
    expect(p.monitorJsonlMaxBytes).toBe(2048);
    expect(p.tripleExtractionDays).toBe(7);
  });

  it('prefers explicit overrides over env', () => {
    process.env.LOG_ROTATION_MIGRATION_KEEP_COUNT = '10';
    const p = resolveLogRotationPolicies({ migrationKeepCount: 50 });
    expect(p.migrationKeepCount).toBe(50);
  });
});

describe('log-rotation-paths', () => {
  it('allows full injectable roots for tests', () => {
    const roots = resolveLogRotationRoots({
      migrationLogDir: '/tmp/a',
      tripleExtractionLogDir: '/tmp/b',
      dockerDiagnosticsDir: '/tmp/c',
      logIssueMonitorDir: '/tmp/d',
    });
    expect(roots.migrationLogDir).toBe('/tmp/a');
    expect(roots.tripleExtractionLogDir).toBe('/tmp/b');
    expect(roots.dockerDiagnosticsDir).toBe('/tmp/c');
    expect(roots.logIssueMonitorDir).toBe('/tmp/d');
  });
});

describe('rotateLogs', () => {
  let base: string;
  let migrationDir: string;
  let teDir: string;
  let dockerDir: string;
  let monitorDir: string;

  beforeEach(async () => {
    base = await mkTempRoot('memento-log-rot-');
    migrationDir = path.join(base, 'migration');
    teDir = path.join(base, 'te');
    dockerDir = path.join(base, 'docker');
    monitorDir = path.join(base, 'monitor');
    await fs.mkdir(migrationDir, { recursive: true });
    await fs.mkdir(teDir, { recursive: true });
    await fs.mkdir(dockerDir, { recursive: true });
    await fs.mkdir(monitorDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(base, { recursive: true, force: true });
  });

  function roots() {
    return {
      migrationLogDir: migrationDir,
      tripleExtractionLogDir: teDir,
      dockerDiagnosticsDir: dockerDir,
      logIssueMonitorDir: monitorDir,
    };
  }

  it('keeps newest keepCount migration_*.log under high churn (US1/US4/SC-001)', async () => {
    const keepCount = DEFAULT_MIGRATION_KEEP_COUNT;
    const seed = 1000;
    const now = Date.now();
    for (let i = 0; i < seed; i += 1) {
      // Pad so basename ASC tie-break is stable when mtimes collide
      const name = `migration_001_${String(i).padStart(4, '0')}.log`;
      await writeFileAt(migrationDir, name, `m${i}`, now - i * 1000);
    }
    await writeFileAt(migrationDir, 'readme.txt', 'leave me');
    await writeFileAt(migrationDir, 'other.log', 'not migration');

    const report = await rotateLogs({
      roots: roots(),
    });

    const survivors = (await fs.readdir(migrationDir)).filter(n =>
      /^migration_.*\.log$/.test(n)
    );
    expect(survivors).toHaveLength(keepCount);
    expect(await fs.readFile(path.join(migrationDir, 'readme.txt'), 'utf8')).toBe('leave me');
    expect(await fs.readFile(path.join(migrationDir, 'other.log'), 'utf8')).toBe('not migration');

    const migration = report.families.find(f => f.family === 'migration');
    expect(migration?.deletedCount).toBe(seed - keepCount);
    assertNoAbsTempLeak(report, base);
  });

  it('keepCount 0 deletes 0 surplus in-window migration logs (age-only failure doc)', async () => {
    const now = Date.now();
    for (let i = 0; i < 30; i += 1) {
      await writeFileAt(
        migrationDir,
        `migration_x_${String(i).padStart(3, '0')}.log`,
        'x',
        now - i * 100
      );
    }

    const report = await rotateLogs({
      roots: roots(),
      policies: { migrationKeepCount: 0 },
    });

    const survivors = (await fs.readdir(migrationDir)).filter(n =>
      /^migration_.*\.log$/.test(n)
    );
    expect(survivors).toHaveLength(30);
    expect(report.families.find(f => f.family === 'migration')?.deletedCount).toBe(0);
  });

  it('reduces docker-diagnostics over byte budget (US2)', async () => {
    const now = Date.now();
    await writeFileAt(dockerDir, 'old.jsonl', Buffer.alloc(1000, 0x61), now - 3000);
    await writeFileAt(dockerDir, 'mid.jsonl', Buffer.alloc(1000, 0x62), now - 2000);
    await writeFileAt(dockerDir, 'new.jsonl', Buffer.alloc(1000, 0x63), now - 1000);

    const report = await rotateLogs({
      roots: roots(),
      policies: { dockerDiagnosticsMaxBytes: 1500, migrationKeepCount: 0 },
    });

    const left = await fs.readdir(dockerDir);
    expect(left).toContain('new.jsonl');
    expect(left).not.toContain('old.jsonl');
    const docker = report.families.find(f => f.family === 'docker_diagnostics');
    expect(docker!.deletedCount).toBeGreaterThanOrEqual(1);
    const total = (
      await Promise.all(left.map(async n => (await fs.stat(path.join(dockerDir, n))).size))
    ).reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(1500);
    assertNoAbsTempLeak(report, base);
  });

  it('preserves monitor state.json and trims oversized jsonl (US3)', async () => {
    await writeFileAt(monitorDir, 'state.json', JSON.stringify({ cursor: 1 }));
    const big = Buffer.alloc(5000, 0x7a);
    await writeFileAt(monitorDir, 'events.jsonl', big);

    const report = await rotateLogs({
      roots: roots(),
      policies: { monitorJsonlMaxBytes: 1000, migrationKeepCount: 0 },
    });

    expect(await fs.readFile(path.join(monitorDir, 'state.json'), 'utf8')).toContain('cursor');
    const trimmed = await fs.stat(path.join(monitorDir, 'events.jsonl'));
    expect(trimmed.size).toBe(1000);
    const monitor = report.families.find(f => f.family === 'log_issue_monitor');
    expect(monitor?.deletedCount).toBe(1);
    expect(monitor?.reclaimedBytes).toBe(4000);
    assertNoAbsTempLeak(report, base);
  });

  it('skips missing monitor root without deleting anything else', async () => {
    await fs.rm(monitorDir, { recursive: true, force: true });
    await writeFileAt(migrationDir, 'migration_only.log', 'x');

    const report = await rotateLogs({
      roots: roots(),
      policies: { migrationKeepCount: 500 },
    });

    const monitor = report.families.find(f => f.family === 'log_issue_monitor');
    expect(monitor?.skippedMissingRoot).toBe(true);
    expect(await fs.readdir(migrationDir)).toContain('migration_only.log');
  });

  it('deletes aged triple-extraction *.log via orchestrator (US3)', async () => {
    const now = Date.now();
    await writeFileAt(teDir, 'old.log', 'old', now - 40 * DAY_MS);
    await writeFileAt(teDir, 'fresh.log', 'fresh', now - 1 * DAY_MS);

    const report = await rotateLogs({
      roots: roots(),
      policies: { tripleExtractionDays: 30, migrationKeepCount: 0 },
      now: new Date(now),
    });

    const left = await fs.readdir(teDir);
    expect(left).toEqual(['fresh.log']);
    expect(report.families.find(f => f.family === 'triple_extraction')?.deletedCount).toBe(1);
    assertNoAbsTempLeak(report, base);
  });

  it('does not leak absolute temp paths in string report fields', async () => {
    await writeFileAt(migrationDir, 'migration_a.log', 'a');
    const report = await rotateLogs({
      roots: roots(),
      policies: { migrationKeepCount: 0 },
    });
    assertNoAbsTempLeak(report, base);
  });
});
