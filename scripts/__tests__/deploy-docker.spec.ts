import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

const scriptPath = resolve('scripts/deploy-docker.mjs');
const SECRET = 'deploy-secret-0123456789abcdef0123';
const TOKENS = JSON.stringify([{ id: 'deploy', secret: SECRET, scopes: ['tools:invoke'] }]);

let roots: string[] = [];
let servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.map(s => new Promise(r => s.close(r))));
  servers = [];
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

const PS = 'compose ps -q --status running memento-mcp-server';

/**
 * docker 대신 호출을 기록하는 가짜. failOn 에 든 compose 하위 명령은 1 로 끝난다.
 * notRunning 이면 compose ps 가 빈 출력을 내 서비스 컨테이너가 이 프로젝트에 없는 것처럼 보인다.
 */
function setup(opts: { failOn?: string; notRunning?: boolean } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'memento-deploy-docker-'));
  roots.push(root);
  const binDir = join(root, 'bin');
  mkdirSync(binDir);
  const callLog = join(root, 'docker-calls');
  writeFileSync(callLog, '');
  writeFileSync(
    join(binDir, 'docker'),
    `#!/bin/sh
echo "$*" >> "${callLog}"
case "$*" in
  "compose ${opts.failOn ?? '__none__'} "*) exit 1 ;;
  *" exec "*) echo '{"quick_check":"ok","memory_item":1}' ;;
  "compose ps "*) ${opts.notRunning ? ':' : 'echo c0ffee'} ;;
esac
exit 0
`,
    { mode: 0o755 }
  );
  const dbPath = join(root, 'memory.db');
  const db = new Database(dbPath);
  db.exec("CREATE TABLE memory_item (id TEXT PRIMARY KEY); INSERT INTO memory_item VALUES ('m1');");
  db.close();
  return {
    dbPath,
    env: {
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
      DB_PATH: dbPath,
      MEMENTO_BACKUP_DIR: join(root, 'backups'),
      MEMENTO_API_TOKENS: TOKENS,
      MCP_PUBLISH_HOST: '',
    },
    calls: () => readFileSync(callLog, 'utf8').trim().split('\n').filter(Boolean),
  };
}

/** /health 와 /tools/recall 만 흉내 내는 서버. recall 은 recallStatuses 를 차례로 쓰고 마지막 값을 되풀이한다. */
async function fakeServer(opts: { health?: number; recallStatuses?: number[] } = {}) {
  const statuses = opts.recallStatuses ?? [200];
  const seen = { recall: 0, auth: '', agent: '' };
  const server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(opts.health ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'healthy', version: '9.9.9' }));
      return;
    }
    const status = statuses[Math.min(seen.recall, statuses.length - 1)];
    seen.recall++;
    seen.auth = req.headers.authorization ?? '';
    seen.agent = String(req.headers['x-memento-agent-id'] ?? '');
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end('{"error":"bad"}');
  });
  servers.push(server);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  return { port: String((server.address() as AddressInfo).port), seen };
}

function runDeploy(env: Record<string, string>, args: string[] = []) {
  return new Promise<{ status: number | null; stdout: string; stderr: string }>(done => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      env: { ...process.env, NODE_ENV: 'test', ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => (stdout += d));
    child.stderr.on('data', d => (stderr += d));
    child.on('close', status => done({ status, stdout, stderr }));
  });
}

describe('deploy-docker (#1798)', () => {
  it('checks the running server, backs up after stop, starts the new image, waits for a real recall and prints one line', async () => {
    const t = setup();
    const server = await fakeServer();

    const result = await runDeploy({ ...t.env, MCP_SERVER_PORT: server.port });

    expect(result.status, result.stderr).toBe(0);
    expect(t.calls()).toEqual([
      'compose build memento-mcp-server',
      PS,
      'compose stop memento-mcp-server',
      'compose up -d --no-build memento-mcp-server',
      expect.stringMatching(/^compose exec -T memento-mcp-server node -e /),
    ]);
    expect(server.seen).toEqual({ recall: 2, auth: `Bearer ${SECRET}`, agent: 'deploy-check' });
    expect(result.stdout).toContain('[pre-docker-deploy] Backup OK');
    expect(result.stdout).toMatch(
      /\[deploy\] downtime=\d+\.\ds recall_ready=\d+\.\ds \(stop=.* memory_item=1 quick_check=ok version=9\.9\.9/
    );
  });

  it('stops before touching the server when the preflight recall is rejected', async () => {
    const t = setup();
    const server = await fakeServer({ recallStatuses: [401] });

    const result = await runDeploy({ ...t.env, MCP_SERVER_PORT: server.port });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('preflight recall returned HTTP 401; server untouched');
    expect(t.calls()).toEqual([]);
  });

  it('restarts the previous container and never runs up when the backup fails', async () => {
    const t = setup();
    const server = await fakeServer();

    const result = await runDeploy(
      { ...t.env, DB_PATH: join(t.dbPath, '..', 'missing.db'), MCP_SERVER_PORT: server.port },
      ['--skip-build']
    );

    expect(result.status).toBe(1);
    expect(t.calls()).toEqual([PS, 'compose stop memento-mcp-server', 'compose start memento-mcp-server']);
    expect(result.stderr).toContain('the previous container is running again');
    expect(server.seen.recall).toBe(1);
  });

  it('leaves an already stopped server down when the backup fails after --skip-preflight', async () => {
    const t = setup({ notRunning: true });

    const result = await runDeploy({ ...t.env, DB_PATH: join(t.dbPath, '..', 'missing.db') }, [
      '--skip-build',
      '--skip-preflight',
    ]);

    expect(result.status).toBe(1);
    expect(t.calls()).toEqual([PS, 'compose stop memento-mcp-server']);
    expect(result.stderr).toContain('the server was already down and stays down');
  });

  it('stops before touching the server when the answering server is not this compose project (e.g. run from a worktree)', async () => {
    const t = setup({ notRunning: true });
    const server = await fakeServer();

    const result = await runDeploy({ ...t.env, MCP_SERVER_PORT: server.port }, ['--skip-build']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('is not running in this compose project');
    expect(t.calls()).toEqual([PS]);
  });

  it('retries the first recall on 429 instead of failing a healthy deploy', async () => {
    const t = setup();
    const server = await fakeServer({ recallStatuses: [200, 429, 200] });

    const result = await runDeploy({ ...t.env, MCP_SERVER_PORT: server.port }, ['--skip-build']);

    expect(result.status, result.stderr).toBe(0);
    expect(server.seen.recall).toBe(3);
  });

  it('rejects a misspelled flag instead of ignoring it', async () => {
    const t = setup();

    const result = await runDeploy(t.env, ['--skip-prefight']);

    expect(result.status).not.toBe(0);
    expect(t.calls()).toEqual([]);
  });

  it('says the server is down when the restart after a failed backup also fails', async () => {
    const t = setup({ failOn: 'start' });
    const server = await fakeServer();

    const result = await runDeploy(
      { ...t.env, DB_PATH: join(t.dbPath, '..', 'missing.db'), MCP_SERVER_PORT: server.port },
      ['--skip-build']
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('the server is down, run: docker compose start memento-mcp-server');
  });

  it('fails when /health never turns healthy within the timeout', async () => {
    const t = setup();
    const server = await fakeServer({ health: 503 });

    const result = await runDeploy({ ...t.env, MCP_SERVER_PORT: server.port }, ['--skip-build', '--timeout-sec', '1']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('/health did not succeed within 1s');
    expect(server.seen.recall).toBe(1);
  });

  it('stops after one post-deploy recall when the server rejects it with 4xx (keeps the /tools rate limit untouched)', async () => {
    const t = setup();
    const server = await fakeServer({ recallStatuses: [200, 400] });

    const result = await runDeploy({ ...t.env, MCP_SERVER_PORT: server.port }, ['--skip-build']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('first recall returned HTTP 400');
    expect(server.seen.recall).toBe(2);
  });

  it('prefers a token not bound to an agent and sends the bound agent id otherwise', async () => {
    const t = setup();
    const server = await fakeServer();
    const bound = { id: 'bound', secret: `${SECRET}-b`, scopes: ['tools:invoke'], agent_id: 'claude-code' };
    const unbound = { id: 'free', secret: `${SECRET}-f`, scopes: ['tools:invoke'] };

    await runDeploy({ ...t.env, MCP_SERVER_PORT: server.port, MEMENTO_API_TOKENS: JSON.stringify([bound, unbound]) }, ['--skip-build']);
    expect(server.seen).toMatchObject({ auth: `Bearer ${SECRET}-f`, agent: 'deploy-check' });

    await runDeploy({ ...t.env, MCP_SERVER_PORT: server.port, MEMENTO_API_TOKENS: JSON.stringify([bound]) }, ['--skip-build']);
    expect(server.seen).toMatchObject({ auth: `Bearer ${SECRET}-b`, agent: 'claude-code' });
  });

  it('accepts a tools:read token for the recall check', async () => {
    const t = setup();
    const server = await fakeServer();
    const reader = { id: 'reader', secret: `${SECRET}-r`, scopes: ['tools:read'] };

    const result = await runDeploy(
      { ...t.env, MCP_SERVER_PORT: server.port, MEMENTO_API_TOKENS: JSON.stringify([reader]) },
      ['--skip-build']
    );

    expect(result.status, result.stderr).toBe(0);
    expect(server.seen.auth).toBe(`Bearer ${SECRET}-r`);
  });

  it('refuses to start without a usable recall token and leaves the server untouched', async () => {
    const t = setup();
    // 비어 있으면 저장소 .env 를 읽으므로, 서버가 버리는 짧은 비밀과 admin 전용 토큰만 둔다. ADMIN_API_KEY 는 /tools 를 열지 않는다 (#1241).
    const unusable = JSON.stringify([
      { id: 'short', secret: 'too-short', scopes: ['tools:invoke'] },
      { id: 'ops', secret: SECRET, scopes: ['admin:destructive'] },
    ]);
    const result = await runDeploy({ ...t.env, MEMENTO_API_TOKENS: unusable, ADMIN_API_KEY: SECRET });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no usable recall token');
    expect(t.calls()).toEqual([]);
  });
});
