#!/usr/bin/env node
/**
 * 운영 Docker 배포를 한 명령으로 한다 (#1798).
 *
 *   preflight recall -> build -> stop -> pre-docker-deploy(백업 + integrity_check) -> up -d -> /health -> 첫 recall
 *
 * 단계가 실패하면 다음 단계로 가지 않는다. 백업이 실패하면 새 이미지로 바꾸지 않고
 * 정지했던 컨테이너를 그대로 다시 띄운다. 끝에 끊긴 시간과 DB 상태를 한 줄로 찍는다.
 *
 * 정지 뒤에 백업하는 이유: online backup 은 복사 중 다른 프로세스가 원본을 쓰면 처음부터
 * 다시 복사해 writer 가 살아 있으면 끝나지 않는다 (#1041).
 *
 * Usage:
 *   npm run deploy:docker
 *   npm run deploy:docker -- --skip-build
 *   npm run deploy:docker -- --skip-preflight   # 서버가 이미 내려가 있을 때
 *
 * 대상은 docker compose 의 표준 변수(COMPOSE_PROJECT_NAME, COMPOSE_FILE)와
 * MEMENTO_COMPOSE_SERVICE, MCP_SERVER_PORT 로 바꾼다. 시험은 별도 compose 프로젝트로 한다.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { parseArgs } from './lib/cli-runtime.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    'skip-build': { type: 'boolean', default: false },
    'skip-preflight': { type: 'boolean', default: false },
    'timeout-sec': { type: 'string', default: '180' },
  },
  allowPositionals: false,
  strict: true,
});
const service = process.env.MEMENTO_COMPOSE_SERVICE ?? 'memento-mcp-server';
const timeoutMs = Number(values['timeout-sec']) * 1000;
const POLL_MS = 250;

function log(message) {
  console.log(`[deploy] ${message}`);
}

function fail(message) {
  console.error(`[deploy] FAILED: ${message}`);
  process.exit(1);
}

function run(command, args, { capture = false } = {}) {
  const child = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
  });
  return { ok: child.status === 0, stdout: child.stdout ?? '' };
}

function compose(...args) {
  return run('docker', ['compose', ...args]);
}

function readDotenv() {
  try {
    return parseEnv(readFileSync(path.join(root, '.env'), 'utf8'));
  } catch {
    return {};
  }
}

const dotenv = readDotenv();

/** compose 와 같은 순서로 값을 찾는다. 셸 환경 변수(빈 값도 설정으로 본다), 그다음 저장소 루트 .env. */
const setting = key => process.env[key] ?? dotenv[key] ?? '';

/**
 * recall 을 부를 수 있는 tools:invoke 나 tools:read 토큰을 고른다. ADMIN_API_KEY 는 #1241 부터 /tools 를 열지 않는다.
 * 서버가 버리는 항목(비밀 32자 미만)은 건너뛰고, agent 에 묶이지 않은 토큰을 먼저 쓴다.
 * 그 밖의 서버 검증과 어긋나는 경우는 정지 전 preflight recall 이 잡는다.
 */
const RECALL_SCOPES = ['tools:invoke', 'tools:read'];

function pickToolsToken() {
  let entries;
  try {
    entries = JSON.parse(setting('MEMENTO_API_TOKENS') || '[]');
  } catch {
    return null;
  }
  if (!Array.isArray(entries)) return null;
  const usable = entries
    .map(t => ({
      secret: typeof t?.secret === 'string' ? t.secret.trim() : '',
      agentId: typeof (t?.agent_id ?? t?.agentId) === 'string' ? (t.agent_id ?? t.agentId).trim() : '',
      scopes: Array.isArray(t?.scopes) ? t.scopes : [],
    }))
    .filter(t => t.secret.length >= 32 && RECALL_SCOPES.some(scope => t.scopes.includes(scope)));
  return usable.find(t => !t.agentId) ?? usable[0] ?? null;
}

// 0.0.0.0 이나 :: 로 게시하면 루프백으로도 닿는다. 특정 주소로 게시하면 그 주소로만 닿는다.
const publishHost = setting('MCP_PUBLISH_HOST');
const host = !publishHost || publishHost === '0.0.0.0' || publishHost === '::' ? '127.0.0.1' : publishHost;
const baseUrl = `http://${host}:${setting('MCP_SERVER_PORT') || '9001'}`;

/**
 * 연결 오류와 5xx 는 기동 중으로 보고 다시 묻는다. 그 밖의 4xx 는 설정 문제라 기다려도 풀리지 않는다.
 * /tools 는 15분에 100회 rate limit 이라 recall 은 maxAttempts 로 횟수를 막는다. 넘기면 배포 뒤
 * 에이전트 호출까지 429 로 막힌다.
 */
async function waitFor(label, deadline, request, { intervalMs = POLL_MS, maxAttempts = Infinity } = {}) {
  let last = 'no response';
  for (let attempt = 1; attempt <= maxAttempts && Date.now() < deadline; attempt++) {
    try {
      const res = await request();
      if (res.ok) return res;
      last = `HTTP ${res.status}`;
      if (res.status < 500 && res.status !== 429) fail(`${label} returned ${last}: ${(await res.text()).slice(0, 200)}`);
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  const limit = Number.isFinite(maxAttempts) ? ` or ${maxAttempts} attempts` : '';
  fail(`${label} did not succeed within ${values['timeout-sec']}s${limit} (${last})`);
}

const getHealth = () => fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(5000) });

/** 기억 호출 한 번. 임베딩 모델은 첫 호출 때 올라오므로 /health 200 만으로는 기억 호출이 된다는 보장이 없다. */
const recall = token => () =>
  fetch(`${baseUrl}/tools/recall`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token.secret}`,
      'x-memento-agent-id': token.agentId || 'deploy-check',
    },
    body: JSON.stringify({ query: 'deploy readiness check', type: 'episodic', limit: 1, auto_set_anchor: false }),
    signal: AbortSignal.timeout(60_000),
  });

const DB_CHECK = [
  "const db = new (require('better-sqlite3'))(process.env.DB_PATH, { readonly: true });",
  'console.log(JSON.stringify({',
  "  quick_check: db.pragma('quick_check', { simple: true }),",
  "  memory_item: db.prepare('SELECT count(*) AS c FROM memory_item').get().c,",
  '}));',
].join(' ');

function dbStatus() {
  const result = run(
    'docker',
    ['compose', 'exec', '-T', service, 'node', '-e', DB_CHECK],
    { capture: true }
  );
  try {
    return result.ok ? JSON.parse(result.stdout.trim().split('\n').pop()) : null;
  } catch {
    return null;
  }
}

const seconds = ms => `${(ms / 1000).toFixed(1)}s`;

if (!(timeoutMs > 0)) fail(`--timeout-sec must be a positive number: ${values['timeout-sec']}`);
const token = pickToolsToken();
if (!token) fail('no usable recall token (tools:invoke or tools:read) in MEMENTO_API_TOKENS (.env); server untouched');

// 토큰, 포트, 게시 주소가 맞는지 떠 있는 서버로 먼저 확인한다. 틀리면 정지 전에 끝난다.
if (!values['skip-preflight']) {
  const untouched = 'server untouched; pass --skip-preflight only when the server is already down';
  let res;
  try {
    res = await recall(token)();
  } catch (error) {
    fail(`preflight recall on ${baseUrl} failed (${error instanceof Error ? error.message : error}); ${untouched}`);
  }
  if (!res.ok) fail(`preflight recall returned HTTP ${res.status}; ${untouched}`);
}

if (!values['skip-build']) {
  log(`build ${service}`);
  if (!compose('build', service).ok) fail('docker compose build; server untouched');
}

// preflight 가 답한 서버가 이 compose 프로젝트의 컨테이너인지 본다. 다른 프로젝트(예: worktree 이름)로
// 돌리면 stop 이 아무것도 세우지 않아 운영 서버가 떠 있는 채로 백업이 돈다 (#1041).
const wasRunning = run('docker', ['compose', 'ps', '-q', '--status', 'running', service], { capture: true }).stdout.trim() !== '';
if (!values['skip-preflight'] && !wasRunning) {
  fail(`${service} is not running in this compose project (COMPOSE_PROJECT_NAME, run from the main checkout); server untouched`);
}

const stoppedAt = Date.now();
log(`stop ${service}`);
if (!compose('stop', service).ok) fail('docker compose stop');
const stopDoneAt = Date.now();

if (!run(process.execPath, [path.join(root, 'scripts', 'pre-docker-deploy.mjs')]).ok) {
  if (!wasRunning) fail('pre-docker-deploy (backup or integrity_check); the server was already down and stays down');
  log('backup failed; restarting the previous container without the new image');
  if (!compose('start', service).ok) {
    fail(`pre-docker-deploy failed and docker compose start failed too; the server is down, run: docker compose start ${service}`);
  }
  fail('pre-docker-deploy (backup or integrity_check); the previous container is running again');
}
const backupDoneAt = Date.now();

log(`up -d ${service}`);
if (!compose('up', '-d', '--no-build', service).ok) {
  fail(`docker compose up -d; the server is stopped, run: docker compose up -d ${service}`);
}

const health = await (await waitFor('/health', Date.now() + timeoutMs, getHealth)).json().catch(() => ({}));
const healthyAt = Date.now();
await waitFor('first recall', Date.now() + timeoutMs, recall(token), { intervalMs: 2000, maxAttempts: 5 });
const readyAt = Date.now();

const status = dbStatus();
const line = [
  `downtime=${seconds(healthyAt - stoppedAt)}`,
  `recall_ready=${seconds(readyAt - stoppedAt)}`,
  `(stop=${seconds(stopDoneAt - stoppedAt)}`,
  `backup=${seconds(backupDoneAt - stopDoneAt)}`,
  `start=${seconds(healthyAt - backupDoneAt)}`,
  `first_recall=${seconds(readyAt - healthyAt)})`,
  `memory_item=${status?.memory_item ?? 'unknown'}`,
  `quick_check=${status?.quick_check ?? 'unknown'}`,
  `version=${health.version ?? 'unknown'}`,
].join(' ');
log(line);
if (!status) fail('the server is up, but the post-deploy DB check (docker compose exec) could not run; check by hand');
if (status.quick_check !== 'ok') fail(`quick_check after deploy returned ${status.quick_check}`);
