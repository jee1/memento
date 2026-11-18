import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { detectInstallKind, runDoctorReport } from './doctor-report.js';

const SECRET_MEMORY = '회사 비밀번호는 hunter2-Zq9 이다';
const NOW = new Date('2026-11-19T10:00:00.000Z');

describe('memento doctor --report (#1769)', () => {
  let dir: string;
  let dbPath: string;
  let stdout: string[];
  let stderr: string[];

  const run = (argv: string[], over: Parameters<typeof runDoctorReport>[1] = {}) =>
    runDoctorReport(argv, {
      now: () => NOW,
      dbPath,
      writeStdout: (m) => void stdout.push(m),
      writeStderr: (m) => void stderr.push(m),
      ...over,
    });

  beforeEach(() => {
    dir = mkdtempSync(join(os.tmpdir(), 'doctor-report-secret-dir-'));
    dbPath = join(dir, 'memory.db');
    stdout = [];
    stderr = [];
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  function seedDatabase() {
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE memory_item (id TEXT PRIMARY KEY, content TEXT NOT NULL, is_deleted INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE memento_schema_version (version TEXT PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, migration_name TEXT NOT NULL);
      INSERT INTO memento_schema_version (version, migration_name) VALUES ('69.0', 'usage');
      CREATE TABLE usage_daily_count (
        day TEXT NOT NULL, client_name TEXT NOT NULL, client_version TEXT NOT NULL, connection_method TEXT NOT NULL,
        era TEXT NOT NULL, request_kind TEXT NOT NULL, tool TEXT NOT NULL, outcome TEXT NOT NULL, error_code INTEGER NOT NULL, count INTEGER NOT NULL
      );
    `);
    const insertMemory = db.prepare('INSERT INTO memory_item (id, content) VALUES (?, ?)');
    for (let i = 0; i < 150; i += 1) insertMemory.run(`m${i}`, i === 0 ? SECRET_MEMORY : `기억 ${i}`);
    // 삭제 표시된 60건은 세지 않는다: 150건 중 활성 90건이라 구간이 1-99 다.
    db.exec("UPDATE memory_item SET is_deleted = 1 WHERE CAST(substr(id, 2) AS INTEGER) >= 90");
    db.prepare(
      `INSERT INTO usage_daily_count VALUES ('2026-11-18', 'claude-code', '2.1.327', 'stdio', 'modern', 'tools/call', 'recall', 'error', -32603, 3)`,
    ).run();
    db.prepare(
      `INSERT INTO usage_daily_count VALUES ('2026-11-18', 'claude-code', '2.1.327', 'stdio', 'modern', 'tools/call', 'recall', 'success', 0, 40)`,
    ).run();
    db.close();
  }

  it('--print 는 붙여 넣을 내용 전체를 보여 주고 기억 내용, 경로, 호스트 이름, 사용자 이름은 없다', async () => {
    seedDatabase();
    expect(await run(['--report', '--print'])).toBe(0);
    const out = stdout.join('');
    expect(out).toContain('기억 수 1-99');
    expect(out).toContain('claude-code 2.1.327: 요청 43, 오류 3');
    expect(out).toContain('recall, 오류 코드 -32603: 3회');
    expect(out).toContain('스키마 69.0');
    expect(out).toContain('https://github.com/jee1/memento/issues/new?');

    const forbidden = [SECRET_MEMORY, 'hunter2', dir, dbPath, 'doctor-report-secret-dir', os.hostname(), os.userInfo().username, os.homedir()];
    for (const value of forbidden.filter((v) => v.length >= 4)) {
      expect(out, `출력에 ${value.slice(0, 8)}… 가 있다`).not.toContain(value);
      expect(decodeURIComponent(out), `디코딩한 출력에 ${value.slice(0, 8)}… 가 있다`).not.toContain(value);
    }
  });

  it('--print 없이는 링크만 보여 주고 아무것도 자동으로 열거나 보내지 않는다', async () => {
    seedDatabase();
    expect(await run(['--report'])).toBe(0);
    const out = stdout.join('');
    expect(out).toContain('https://github.com/jee1/memento/issues/new?');
    expect(out).toContain('--print');
    expect(out).not.toContain('## 환경');
  });

  it('네트워크 호출이 없다(fetch, http, https, net 소켓)', async () => {
    seedDatabase();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const httpSpy = vi.spyOn(http, 'request');
    const httpsSpy = vi.spyOn(https, 'request');
    const connectSpy = vi.spyOn(net.Socket.prototype, 'connect');
    expect(await run(['--report', '--print'])).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(httpSpy).not.toHaveBeenCalled();
    expect(httpsSpy).not.toHaveBeenCalled();
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it('DB 파일이 없으면 database=missing 으로 보고서는 만든다', async () => {
    expect(await run(['--report', '--print'])).toBe(0);
    const out = stdout.join('');
    expect(out).toContain('DB missing');
    expect(out).toContain('기억 수 unknown');
  });

  it('DB 파일이 SQLite 가 아니면 open_failed 로 보고서는 만든다', async () => {
    writeFileSync(dbPath, 'not a sqlite file, '.repeat(50));
    expect(await run(['--report', '--print'])).toBe(0);
    expect(stdout.join('')).toContain('DB open_failed');
  });

  it('읽기 전용으로 열어 DB 를 바꾸지 않는다', async () => {
    seedDatabase();
    const db = new Database(dbPath, { readonly: true });
    const before = db.prepare('SELECT COUNT(*) AS n FROM memory_item').get();
    db.close();
    await run(['--report']);
    const after = new Database(dbPath, { readonly: true });
    expect(after.prepare('SELECT COUNT(*) AS n FROM memory_item').get()).toEqual(before);
    after.close();
  });

  it('알 수 없는 옵션은 실패한다', async () => {
    expect(await run(['--report', '--send'])).toBe(1);
    expect(stderr.join('')).toContain('Unknown option: --send');
  });

  it('--help 는 자동 전송이 없다고 알린다', async () => {
    expect(await run(['--report', '--help'])).toBe(0);
    expect(stdout.join('')).toContain('자동으로 전송하지 않습니다');
  });
});

describe('detectInstallKind', () => {
  const base = { hasDockerEnv: false, hasGitCheckout: false };
  it.each([
    [{ ...base, modulePath: '/usr/lib/node_modules/memento-mcp-server/dist/cli/doctor-report.js' }, 'npm-global'],
    [{ ...base, modulePath: '/home/u/.npm/_npx/abc123/node_modules/memento-mcp-server/dist/cli.js' }, 'npx'],
    [{ ...base, modulePath: '/app/dist/cli.js', hasDockerEnv: true }, 'docker'],
    [{ ...base, modulePath: '/home/u/git/memento/packages/memento-server/src/cli/doctor-report.ts', hasGitCheckout: true }, 'source'],
    [{ ...base, modulePath: '/opt/somewhere/cli.js' }, 'unknown'],
  ])('%j 는 %s', (input, expected) => {
    expect(detectInstallKind(input)).toBe(expected);
  });
});
