#!/usr/bin/env node
/**
 * 운영 Docker 배포를 한 명령으로 한다 (#1798, #1802).
 *
 *   preflight recall -> build -> 백업 컨테이너 + 원본 integrity_check -> stop -> 복사 -> up -d
 *   -> /health (사본 integrity_check 를 나란히) -> 첫 recall -> 오래된 백업 정리
 *
 * 단계가 실패하면 다음 단계로 가지 않는다. 복사가 실패하면 새 이미지로 바꾸지 않고
 * 정지했던 컨테이너를 그대로 다시 띄운다. 끝에 끊긴 시간과 DB 상태를 한 줄로 찍는다.
 *
 * 정지 뒤에 복사하는 이유: online backup 은 복사 중 다른 프로세스가 원본을 쓰면 처음부터
 * 다시 복사해 writer 가 살아 있으면 끝나지 않는다 (#1041).
 *
 * 정지 구간에는 복사만 둔다. 원본 검사는 서버가 도는 동안 읽기 전용으로 하고, 사본 검사는 새 서버
 * 기동과 나란히 한다. 그래서 정지 전 검사와 정지 사이 몇 초 동안 생긴 손상은 기동 전에 못 잡는다.
 * 사본 검사가 실패하면 0 이 아닌 코드로 끝나고 직전 백업 경로를 찍으며, 오래된 백업을 지우지 않는다.
 *
 * 백업은 컨테이너 안에서 한다. 운영 DB 디렉터리는 컨테이너 사용자 소유라 호스트가 WAL DB 를
 * 못 연다 (#1001). 컨테이너는 정지 전에 만들어 두고 docker exec 로 쓴다. 정지 구간에서 만들면
 * 생성에 약 1초가 든다. uid, gid, 마운트는 scripts/backup-in-docker.sh 와 같다.
 *
 * Usage:
 *   npm run deploy:docker
 *   npm run deploy:docker -- --skip-build
 *   npm run deploy:docker -- --skip-preflight   # 서버가 이미 내려가 있을 때
 *
 * 대상은 docker compose 의 표준 변수(COMPOSE_PROJECT_NAME, COMPOSE_FILE)와
 * MEMENTO_COMPOSE_SERVICE, MCP_SERVER_PORT 로 바꾼다. 시험은 별도 compose 프로젝트로 한다.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, renameSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { parseArgs, resolveBackupDir } from './lib/cli-runtime.js';

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

// up 뒤에는 새 이미지 서버가 떠 있으므로 어떤 실패에도 되돌리는 명령을 붙인다.
let afterUpHint = '';

function fail(message) {
  console.error(`[deploy] FAILED: ${message}${afterUpHint}`);
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
async function waitFor(label, deadline, request, { intervalMs = POLL_MS, maxAttempts = Infinity, hint = '' } = {}) {
  const suffix = hint ? `; ${hint}` : '';
  let last = 'no response';
  for (let attempt = 1; attempt <= maxAttempts && Date.now() < deadline; attempt++) {
    try {
      const res = await request();
      if (res.ok) return res;
      last = `HTTP ${res.status}`;
      if (res.status < 500 && res.status !== 429) fail(`${label} returned ${last}: ${(await res.text()).slice(0, 200)}${suffix}`);
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  const limit = Number.isFinite(maxAttempts) ? ` or ${maxAttempts} attempts` : '';
  fail(`${label} did not succeed within ${values['timeout-sec']}s${limit} (${last})${suffix}`);
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

// 컨테이너 안 backup-memory-db.mjs 와 같은 규칙으로 푼다(~ 와 상대 경로를 절대 경로로). -v 는 절대 경로만 받는다.
const backupDir = resolveBackupDir(process.env.MEMENTO_BACKUP_DIR || undefined);
let backupContainer = null;
let backupPath = null;
let copyVerified = false;
const unverifiedName = file => `${file}.unverified`;

/**
 * 백업 컨테이너를 띄운다. 이 스크립트가 죽어 rm 을 못 해도 sleep 이 끝나면 --rm 으로 사라진다.
 * 서비스 이미지를 쓰므로 build 뒤라면 새 이미지다.
 */
function startBackupContainer() {
  mkdirSync(backupDir, { recursive: true });
  const result = run(
    'docker',
    [
      'compose', 'run', '-d', '--rm', '--no-deps',
      '--user', `${process.env.MEMENTO_CONTAINER_UID || '1001'}:${process.getgid()}`,
      '-v', `${backupDir}:${backupDir}`,
      '-e', `MEMENTO_BACKUP_DIR=${backupDir}`,
      '--entrypoint', 'sleep', service, '3600',
    ],
    { capture: true }
  );
  backupContainer = result.ok ? result.stdout.trim().split('\n').pop() || null : null;
  return backupContainer;
}

// 검사를 통과하지 못한(또는 끝내지 못한) 사본은 완성 백업 이름을 떼어, 정리의 개수 상한에 들거나
// 직전 백업으로 골라지지 않게 한다.
process.on('exit', () => {
  if (backupContainer) spawnSync('docker', ['rm', '-f', backupContainer], { stdio: 'ignore' });
  if (backupPath && !copyVerified) {
    try {
      renameSync(backupPath, unverifiedName(backupPath));
      console.error(`[deploy] the backup copy was not verified; renamed to ${unverifiedName(backupPath)}`);
    } catch {
      console.error(`[deploy] the backup copy was not verified and could not be renamed: ${backupPath}`);
    }
  }
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(130));

// 인자로 받은 파일을, 없으면 컨테이너의 DB_PATH 를 읽기 전용으로 열어 integrity_check 첫 줄을 찍는다.
const INTEGRITY_CHECK = [
  "const db = new (require('better-sqlite3'))(process.argv[1] ?? process.env.DB_PATH, { readonly: true, fileMustExist: true });",
  "console.log(db.pragma('integrity_check', { simple: true }));",
].join(' ');

/** 백업 컨테이너에서 integrity_check 를 돌린다. 'ok', 첫 오류 줄, 실행 실패면 null. */
function integrityCheck(file) {
  return new Promise(resolve => {
    const args = ['exec', backupContainer, 'node', '-e', INTEGRITY_CHECK, ...(file ? [file] : [])];
    const child = spawn('docker', args, { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', chunk => (out += chunk));
    child.on('error', () => resolve(null));
    child.on('close', code => resolve(code === 0 ? out.trim().split('\n').pop() || null : null));
  });
}

/** 이번 사본을 뺀 가장 최근 백업. 사본 검사가 실패했을 때 돌아갈 곳이다. */
function previousBackup(current) {
  try {
    return readdirSync(backupDir)
      .filter(name => /^memory-backup-.+\.db$/.test(name) && name !== path.basename(current))
      .map(name => ({ file: path.join(backupDir, name), mtime: statSync(path.join(backupDir, name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)[0]?.file ?? null;
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
const runningId = run('docker', ['compose', 'ps', '-q', '--status', 'running', service], { capture: true }).stdout.trim();
const wasRunning = runningId !== '';
if (!values['skip-preflight'] && !wasRunning) {
  fail(`${service} is not running in this compose project (COMPOSE_PROJECT_NAME, run from the main checkout); server untouched`);
}

// up 이 컨테이너를 새로 만들면 옛 이미지 id 를 다시 알 길이 없어 지금 적어 둔다. /health 실패 때 되돌리는 명령에 쓴다.
const [previousImage, imageName] = wasRunning
  ? run('docker', ['inspect', '-f', '{{.Image}} {{.Config.Image}}', runningId], { capture: true }).stdout.trim().split(' ')
  : [];

log('start the backup container and run integrity_check on the live DB (read-only)');
if (!startBackupContainer()) fail('docker compose run (backup container); server untouched');
// --skip-build 로 #1802 전에 만든 이미지를 쓰면 복사 단계가 정지 뒤에야 인자 오류로 실패한다. 정지 전에 거른다.
if (!run('docker', ['exec', backupContainer, 'grep', '-q', '-e', '--skip-integrity-check', 'scripts/backup-memory-db.mjs']).ok) {
  fail('the image predates #1802 (backup-memory-db.mjs has no --skip-integrity-check); rebuild without --skip-build; server untouched');
}
const liveCheck = await integrityCheck();
if (liveCheck !== 'ok') fail(`integrity_check on the live DB returned ${liveCheck ?? 'nothing (check failed to run)'}; server untouched`);

const stoppedAt = Date.now();
log(`stop ${service}`);
if (!compose('stop', service).ok) fail('docker compose stop');
const stopDoneAt = Date.now();

const copy = run('docker', ['exec', backupContainer, 'node', 'scripts/backup-memory-db.mjs', '--skip-integrity-check'], {
  capture: true,
});
try {
  backupPath = copy.ok ? JSON.parse(copy.stdout).backupPath : null;
} catch {}
if (!backupPath) {
  if (!wasRunning) fail('backup copy failed; the server was already down and stays down');
  log('backup copy failed; restarting the previous container without the new image');
  if (!compose('start', service).ok) {
    fail(`backup copy failed and docker compose start failed too; the server is down, run: docker compose start ${service}`);
  }
  await waitFor('/health after restarting the previous container', Date.now() + timeoutMs, getHealth, {
    hint: `the previous container is started but not healthy; see docker compose logs --tail 100 ${service}`,
  });
  fail('backup copy failed; the previous container is running again and healthy');
}
const copyDoneAt = Date.now();
log(`copied to ${backupPath}`);

const copyCheck = integrityCheck(backupPath);
log(`up -d ${service}`);
if (!compose('up', '-d', '--no-build', service).ok) {
  fail(`docker compose up -d; the server is stopped, run: docker compose up -d ${service}`);
}
if (previousImage) {
  afterUpHint = `; to roll back: docker tag ${previousImage} ${imageName} && docker compose up -d --no-build ${service}`;
}

const healthRes = await waitFor('/health', Date.now() + timeoutMs, getHealth, {
  hint: `the new container is running but not healthy; see docker compose logs --tail 100 ${service}`,
});
const health = await healthRes.json().catch(() => ({}));
const healthyAt = Date.now();
await waitFor('first recall', Date.now() + timeoutMs, recall(token), { intervalMs: 2000, maxAttempts: 5 });
const readyAt = Date.now();
const copyResult = await copyCheck;

const status = dbStatus();
const line = [
  `downtime=${seconds(healthyAt - stoppedAt)}`,
  `recall_ready=${seconds(readyAt - stoppedAt)}`,
  `(stop=${seconds(stopDoneAt - stoppedAt)}`,
  `copy=${seconds(copyDoneAt - stopDoneAt)}`,
  `start=${seconds(healthyAt - copyDoneAt)}`,
  `first_recall=${seconds(readyAt - healthyAt)})`,
  `copy_check=${copyResult ?? 'unknown'}`,
  `memory_item=${status?.memory_item ?? 'unknown'}`,
  `quick_check=${status?.quick_check ?? 'unknown'}`,
  `version=${health.version ?? 'unknown'}`,
].join(' ');
log(line);
copyVerified = copyResult === 'ok';
if (!copyVerified) {
  console.error(
    [
      '[deploy] ==================================================================',
      `[deploy] FAILED: integrity_check on the backup copy returned ${copyResult ?? 'nothing (check failed to run)'}`,
      `[deploy]   copy:            ${unverifiedName(backupPath)}`,
      `[deploy]   previous backup: ${previousBackup(backupPath) ?? 'none found'}`,
      `[deploy]   The new server is running. The live DB passed integrity_check before stop and quick_check=${status?.quick_check ?? 'unknown'} after start.`,
      '[deploy]   Damage written between that check and stop is not caught before start.',
      '[deploy]   Old backups were not pruned.',
      '[deploy] ==================================================================',
    ].join('\n')
  );
  process.exit(1);
}
if (!run('docker', ['exec', backupContainer, 'node', 'scripts/backup-memory-db.mjs', '--cleanup', '--apply'], { capture: true }).ok) {
  log('pruning old backups failed; the deploy itself succeeded');
}
if (!status) fail('the server is up, but the post-deploy DB check (docker compose exec) could not run; check by hand');
if (status.quick_check !== 'ok') fail(`quick_check after deploy returned ${status.quick_check}`);
