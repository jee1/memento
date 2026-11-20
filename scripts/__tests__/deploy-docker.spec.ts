import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

const scriptPath = resolve('scripts/deploy-docker.mjs');
const TOKENS = JSON.stringify([{ id: 'deploy', secret: 'deploy-secret', scopes: ['tools:invoke'] }]);

let roots: string[] = [];
let servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.map(s => new Promise(r => s.close(r))));
  servers = [];
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
});

function setup() {
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
  *" exec "*) echo '{"quick_check":"ok","memory_item":1}' ;;
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
      ADMIN_API_KEY: '',
    },
    calls: () => readFileSync(callLog, 'utf8').trim().split('\n').filter(Boolean),
  };
}

/** /health 와 /tools/recall 만 흉내 내는 서버. 받은 recall 요청을 센다. */
async function fakeServer(opts: { health?: number; recall?: number } = {}) {
  const seen = { recall: 0, auth: '', agent: '' };
  const server = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(opts.health ?? 200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'healthy', version: '9.9.9' }));
      return;
    }
    seen.recall++;
    seen.auth = req.headers.authorization ?? '';
    seen.agent = String(req.headers['x-memento-agent-id'] ?? '');
    res.writeHead(opts.recall ?? 200, { 'content-type': 'application/json' });
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
  it('backs up after stop, starts the new image, waits for a real recall and prints one summary line', async () => {
    const t = setup();
    const server = await fakeServer();

    const result = await runDeploy({ ...t.env, MCP_SERVER_PORT: server.port });

    expect(result.status, result.stderr).toBe(0);
    expect(t.calls()).toEqual([
      'compose build memento-mcp-server',
      'compose stop memento-mcp-server',
      'compose up -d --no-build memento-mcp-server',
      expect.stringMatching(/^compose exec -T memento-mcp-server node -e /),
    ]);
    expect(server.seen).toEqual({ recall: 1, auth: 'Bearer deploy-secret', agent: 'deploy-check' });
    expect(result.stdout).toContain('[pre-docker-deploy] Backup OK');
    expect(result.stdout).toMatch(
      /\[deploy\] downtime=\d+\.\ds recall_ready=\d+\.\ds \(stop=.* memory_item=1 quick_check=ok version=9\.9\.9/
    );
  });

  it('restarts the previous container and never runs up when the backup fails', async () => {
    const t = setup();
    const server = await fakeServer();

    const result = await runDeploy({
      ...t.env,
      DB_PATH: join(t.dbPath, '..', 'missing.db'),
      MCP_SERVER_PORT: server.port,
    }, ['--skip-build']);

    expect(result.status).toBe(1);
    expect(t.calls()).toEqual(['compose stop memento-mcp-server', 'compose start memento-mcp-server']);
    expect(result.stderr).toContain('[deploy] FAILED: pre-docker-deploy');
    expect(server.seen.recall).toBe(0);
  });

  it('fails when /health never turns healthy within the timeout', async () => {
    const t = setup();
    const server = await fakeServer({ health: 503 });

    const result = await runDeploy({ ...t.env, MCP_SERVER_PORT: server.port }, ['--skip-build', '--timeout-sec', '1']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('/health did not succeed within 1s');
    expect(server.seen.recall).toBe(0);
  });

  it('stops after one recall when the server rejects it with 4xx (keeps the /tools rate limit untouched)', async () => {
    const t = setup();
    const server = await fakeServer({ recall: 400 });

    const result = await runDeploy({ ...t.env, MCP_SERVER_PORT: server.port }, ['--skip-build']);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('first recall returned HTTP 400');
    expect(server.seen.recall).toBe(1);
  });

  it('refuses to start without a tools:invoke token and leaves the server untouched', async () => {
    const t = setup();

    // 비어 있으면 저장소 .env 를 읽으므로, tools:invoke 가 없는 토큰 목록으로 막는다.
    const adminOnly = JSON.stringify([{ id: 'ops', secret: 'ops-secret', scopes: ['admin:destructive'] }]);
    const result = await runDeploy({ ...t.env, MEMENTO_API_TOKENS: adminOnly });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no tools:invoke token');
    expect(t.calls()).toEqual([]);
  });
});
