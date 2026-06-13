import { spawn } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { arch, platform, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  runClaudeCodeHook,
} from '../packages/memento-agent-integration/src/claude-code/runner.js';
import {
  applyClaudeCodeSettings,
} from '../packages/memento-agent-integration/src/claude-code/settings.js';
import {
  runCodexHook,
} from '../packages/memento-agent-integration/src/codex/runner.js';
import {
  applyCodexHooks,
} from '../packages/memento-agent-integration/src/codex/settings.js';
import type {
  AgentEventEnvelope,
  CaptureReason,
  Transport,
} from '../packages/memento-agent-integration/src/types.js';

import { runAgentOpsCommand, type AgentOpsRequest } from '../packages/memento-server/src/cli/agent-ops.js';

const LIFECYCLE_FIXTURES = [
  ['SessionStart', 'session-start.json'],
  ['UserPromptSubmit', 'user-prompt-submit.json'],
  ['PostToolUse', 'post-tool-use.json'],
  ['PreCompact', 'pre-compact.json'],
  ['Stop', 'stop.json'],
] as const;

type AdapterName = 'codex' | 'claude_code';
type CheckStatus = 'pass' | 'fail' | 'skip';

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface CliCheck {
  status: CheckStatus;
  version?: string;
  reason_code?: string;
  evidence?: string;
}

interface LifecycleCheck {
  event: string;
  normalized_event?: AgentEventEnvelope['event_type'];
  status: CheckStatus;
  reason_code: string;
}

interface FailureCheck {
  scenario: 'server_down' | 'auth_failure' | 'timeout';
  status: CheckStatus;
  reason_code: string;
  non_blocking: boolean;
  elapsed_ms: number;
}

interface ConnectCheck {
  status: CheckStatus;
  preserved: boolean;
  backup_verified: boolean;
  reconnect_idempotent: boolean;
  hook_count: number;
  reason_code: string;
}

interface AdapterReport {
  connect: ConnectCheck;
  lifecycle: LifecycleCheck[];
  failures: FailureCheck[];
}

interface OperationsReport {
  simulated: Record<string, CheckStatus>;
  live: {
    status: CheckStatus;
    reason_code: string;
    commands: Record<string, CheckStatus>;
  };
}

export interface AgentSmokeReport {
  schema_version: 1;
  generated_at: string;
  ok: boolean;
  environment: {
    os: string;
    arch: string;
    node: string;
    codex: CliCheck;
    claude_code: CliCheck;
  };
  adapters: Record<AdapterName, AdapterReport>;
  operations: OperationsReport;
  live_agent_sessions: Record<AdapterName, {
    status: CheckStatus;
    reason_code: string;
    command_configured: boolean;
  }>;
  compatibility_matrix: Array<{
    os: string;
    arch: string;
    node: string;
    agent: string;
    agent_version: string | null;
    server: string;
    result: CheckStatus;
    evidence: string;
  }>;
  constraints: Array<{
    area: string;
    status: CheckStatus;
    reason_code: string;
    action: string;
  }>;
}

export interface AgentSmokeDependencies {
  root?: string;
  now?: () => Date;
  platform?: {
    os: string;
    arch: string;
    node: string;
  };
  probeCommand?: (command: string, args: readonly string[]) => Promise<CommandResult>;
  configPaths?: {
    codex: string;
    claudeCode: string;
  };
  env?: NodeJS.ProcessEnv;
}

function command(
  executable: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = 10_000,
): Promise<CommandResult> {
  return new Promise(resolveCommand => {
    const child = spawn(executable, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: timeoutMs,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += String(chunk);
    });
    child.stderr.on('data', chunk => {
      stderr += String(chunk);
    });
    child.on('error', error => {
      resolveCommand({
        status: null,
        stdout,
        stderr: `${stderr}${error.message}`,
      });
    });
    child.on('close', code => {
      resolveCommand({ status: code, stdout, stderr });
    });
  });
}

function codexVersion(output: string): string | undefined {
  return /codex-cli\s+([0-9][^\s]*)/.exec(output)?.[1];
}

function claudeVersion(output: string): string | undefined {
  return /^([0-9][^\s]*)/m.exec(output)?.[1];
}

async function probeCli(
  probe: AgentSmokeDependencies['probeCommand'],
  name: 'codex' | 'claude',
): Promise<CliCheck> {
  const versionResult = await probe!(name, ['--version']);
  if (versionResult.status === null) {
    return {
      status: 'skip',
      reason_code: 'CLI_NOT_INSTALLED',
      evidence: versionResult.stderr.trim(),
    };
  }
  if (versionResult.status !== 0) {
    return {
      status: 'fail',
      reason_code: 'CLI_VERSION_FAILED',
      evidence: versionResult.stderr.trim(),
    };
  }

  const featureResult = name === 'codex'
    ? await probe!(name, ['features', 'list'])
    : await probe!(name, ['--help']);
  const version = name === 'codex'
    ? codexVersion(versionResult.stdout)
    : claudeVersion(versionResult.stdout);
  const compatible = name === 'codex'
    ? /\bhooks\s+\S+\s+true\b/.test(featureResult.stdout)
    : featureResult.stdout.includes('--include-hook-events');

  return {
    status: compatible ? 'pass' : 'fail',
    version,
    reason_code: compatible ? 'NONE' : 'HOOK_CAPABILITY_MISSING',
    evidence: compatible
      ? name === 'codex' ? 'hooks enabled' : '--include-hook-events available'
      : featureResult.stderr.trim() || featureResult.stdout.trim().slice(0, 240),
  };
}

function countHooks(
  settings: Record<string, unknown>,
  expectedCommand: string,
): number {
  const hooks = settings.hooks;
  if (typeof hooks !== 'object' || hooks === null || Array.isArray(hooks)) return 0;
  return Object.values(hooks).filter(value => {
    if (!Array.isArray(value)) return false;
    return value.some(group => {
      if (typeof group !== 'object' || group === null || Array.isArray(group)) return false;
      const handlers = (group as { hooks?: unknown }).hooks;
      return Array.isArray(handlers) && handlers.some(handler =>
        typeof handler === 'object'
        && handler !== null
        && !Array.isArray(handler)
        && (handler as { command?: unknown }).command === expectedCommand
      );
    });
  }).length;
}

async function verifyConnect(
  adapter: AdapterName,
  configPath: string,
): Promise<ConnectCheck> {
  const original = adapter === 'codex'
    ? '{"state":{"trusted":true},"hooks":{"Other":[{"hooks":[{"type":"command","command":"other"}]}]}}\n'
    : '{"permissions":{"allow":["Read"]},"plugins":{"existing":true}}\n';
  await mkdir(dirname(configPath), { recursive: true });
  await writeFile(configPath, original, 'utf8');
  const fixedNow = () => new Date('2026-06-13T00:00:00.000Z');
  const connect = adapter === 'codex'
    ? () => applyCodexHooks({ hooksPath: configPath, now: fixedNow })
    : () => applyClaudeCodeSettings({ settingsPath: configPath, now: fixedNow });
  const first = await connect();
  const configured = JSON.parse(await readFile(configPath, 'utf8')) as Record<string, unknown>;
  const backup = first.backupPath
    ? await readFile(first.backupPath, 'utf8').catch(() => '')
    : '';
  const preserved = adapter === 'codex'
    ? JSON.stringify(configured.state) === '{"trusted":true}'
    : JSON.stringify(configured.permissions) === '{"allow":["Read"]}'
      && JSON.stringify(configured.plugins) === '{"existing":true}';
  const hookCount = countHooks(
    configured,
    adapter === 'codex' ? 'memento hook codex' : 'memento hook claude-code',
  );
  const beforeReconnect = await readFile(configPath, 'utf8');
  const reconnect = await connect();
  const afterReconnect = await readFile(configPath, 'utf8');
  const reconnectIdempotent = reconnect.changed === false
    && reconnect.backupPath === undefined
    && beforeReconnect === afterReconnect;
  const ok = first.changed === true
    && preserved
    && backup === original
    && reconnectIdempotent
    && hookCount === 5;

  return {
    status: ok ? 'pass' : 'fail',
    preserved,
    backup_verified: backup === original,
    reconnect_idempotent: reconnectIdempotent,
    hook_count: hookCount,
    reason_code: ok ? 'NONE' : 'CONNECT_VALIDATION_FAILED',
  };
}

async function fixture(path: string): Promise<string> {
  return readFile(resolve(path), 'utf8');
}

function successfulTransport(events: AgentEventEnvelope[]): Transport {
  return async incoming => {
    events.push(...incoming);
    return { ok: true };
  };
}

async function verifyLifecycle(adapter: AdapterName): Promise<LifecycleCheck[]> {
  const captured: AgentEventEnvelope[] = [];
  const base = adapter === 'codex'
    ? 'packages/memento-agent-integration/src/codex/fixtures'
    : 'packages/memento-agent-integration/src/claude-code/fixtures';
  const checks: LifecycleCheck[] = [];
  for (const [event, file] of LIFECYCLE_FIXTURES) {
    const input = await fixture(join(base, file));
    const result = adapter === 'codex'
      ? await runCodexHook({
          input,
          transport: successfulTransport(captured),
          timeoutMs: 250,
          maxRetries: 0,
        })
      : await runClaudeCodeHook({
          input,
          transport: successfulTransport(captured),
          timeoutMs: 250,
          maxRetries: 0,
        });
    const accepted = result.exitCode === 0
      && result.dispatch?.status === 'ACCEPTED'
      && result.dispatch.reason === 'NONE'
      && result.event !== undefined;
    checks.push({
      event,
      normalized_event: result.event?.event_type,
      status: accepted ? 'pass' : 'fail',
      reason_code: accepted ? 'NONE' : result.dispatch?.reason ?? result.capture.reason,
    });
  }
  return checks;
}

function failureTransport(
  scenario: FailureCheck['scenario'],
): Transport {
  if (scenario === 'timeout') {
    return async (_events, signal) => new Promise(resolveFailure => {
      signal.addEventListener('abort', () => {
        resolveFailure({ ok: false, reason: 'TIMEOUT' });
      }, { once: true });
    });
  }
  const reason: CaptureReason = scenario === 'auth_failure'
    ? 'AUTH_FAILED'
    : 'SERVER_UNAVAILABLE';
  return async () => ({ ok: false, reason });
}

async function verifyFailures(adapter: AdapterName): Promise<FailureCheck[]> {
  const base = adapter === 'codex'
    ? 'packages/memento-agent-integration/src/codex/fixtures/session-start.json'
    : 'packages/memento-agent-integration/src/claude-code/fixtures/session-start.json';
  const input = await fixture(base);
  const checks: FailureCheck[] = [];
  for (const scenario of ['server_down', 'auth_failure', 'timeout'] as const) {
    const started = performance.now();
    const result = adapter === 'codex'
      ? await runCodexHook({
          input,
          transport: failureTransport(scenario),
          timeoutMs: 50,
          maxRetries: 0,
        })
      : await runClaudeCodeHook({
          input,
          transport: failureTransport(scenario),
          timeoutMs: 50,
          maxRetries: 0,
        });
    const elapsed = Math.round(performance.now() - started);
    const expected = scenario === 'auth_failure'
      ? 'AUTH_FAILED'
      : scenario === 'timeout' ? 'TIMEOUT' : 'SERVER_UNAVAILABLE';
    const nonBlocking = result.exitCode === 0 && elapsed < 1_000;
    checks.push({
      scenario,
      status: nonBlocking && result.dispatch?.reason === expected ? 'pass' : 'fail',
      reason_code: result.dispatch?.reason ?? 'INTERNAL_ERROR',
      non_blocking: nonBlocking,
      elapsed_ms: elapsed,
    });
  }
  return checks;
}

function response(status: number, body: unknown) {
  return { status, body };
}

function simulatedRequest(): AgentOpsRequest {
  const sessions = new Set<string>();
  return async (path, init) => {
    if (path === '/health') {
      return response(200, { status: 'healthy', version: '1.17.0' });
    }
    if (path === '/api/v1/agent/capabilities') {
      return response(200, {
        contract_versions: [1],
        event_types: ['SESSION_START', 'USER_PROMPT', 'TOOL_RESULT', 'PRE_COMPACT', 'STOP'],
        schema_ready: true,
      });
    }
    if (path === '/api/v1/agent/operations/status?since=2026-06-12T00%3A00%3A00.000Z&limit=20') {
      return response(200, {
        counts: { captures: 5, injections: 1, dropped: 0, degraded: 0 },
        recent_events: [],
      });
    }
    if (path === '/api/v1/agent/observations:ingest') {
      return response(200, {
        results: [
          { status: 'ACCEPTED', reason_code: 'NONE' },
          { status: 'ACCEPTED', reason_code: 'NONE' },
        ],
      });
    }
    if (path.endsWith('/export')) {
      return response(200, {
        observations: [{
          status: 'REDACTED',
          payload_json: '{"password":"[REDACTED:SECRET_KEY]"}',
        }],
      });
    }
    if (path.endsWith(':stop')) {
      return response(200, { summary_job_id: 'summary-memory-1' });
    }
    if (path === '/tools/forget') return response(200, { forgotten: true });
    if (path === '/api/v1/agent/sessions' && init?.method === 'POST') {
      const body = JSON.parse(String(init.body)) as { session_id: string };
      sessions.add(body.session_id);
      return response(201, {
        initial_injection: body.session_id.endsWith('-2')
          ? { status: 'ok', items: [{ memory_id: 'summary-memory-1' }] }
          : { status: 'empty', items: [] },
      });
    }
    if (init?.method === 'DELETE') {
      sessions.delete(path.split('/').at(-1) ?? '');
      return response(204, null);
    }
    return response(500, { reason_code: 'INTERNAL_ERROR' });
  };
}

async function verifySimulatedOperations(): Promise<Record<string, CheckStatus>> {
  const result: Record<string, CheckStatus> = {};
  for (const mode of ['human', 'json'] as const) {
    for (const operation of ['doctor', 'status', 'demo'] as const) {
      const stdout: string[] = [];
      const stderr: string[] = [];
      const code = await runAgentOpsCommand(
        operation,
        mode === 'json' ? ['--json'] : [],
        {
          request: simulatedRequest(),
          resolveEndpoint: async () => 'http://127.0.0.1:8080',
          now: () => new Date('2026-06-13T00:00:00.000Z'),
          randomId: () => `${operation}-${mode}`,
          writeStdout: value => {
            stdout.push(value);
          },
          writeStderr: value => {
            stderr.push(value);
          },
          env: {},
        },
      );
      const output = stdout.join('');
      const validOutput = mode === 'json'
        ? (() => {
            try {
              return (JSON.parse(output) as { ok?: unknown }).ok === true;
            } catch {
              return false;
            }
          })()
        : output.includes(`memento ${operation}: OK`);
      result[`${operation}_${mode}`] = code === 0
        && validOutput
        && stderr.length === 0 ? 'pass' : 'fail';
    }
  }
  return result;
}

async function verifyLiveOperations(
  env: NodeJS.ProcessEnv,
): Promise<OperationsReport['live']> {
  const endpoint = env.MEMENTO_SMOKE_ENDPOINT?.trim();
  if (!endpoint) {
    return {
      status: 'skip',
      reason_code: 'LIVE_SERVER_NOT_CONFIGURED',
      commands: {},
    };
  }
  const commands: Record<string, CheckStatus> = {};
  for (const mode of ['human', 'json'] as const) {
    for (const operation of ['doctor', 'status', 'demo'] as const) {
      const code = await runAgentOpsCommand(operation, [
        '--endpoint',
        endpoint,
        ...(env.MEMENTO_SMOKE_API_KEY
          ? ['--api-key', env.MEMENTO_SMOKE_API_KEY]
          : []),
        ...(mode === 'json' ? ['--json'] : []),
      ], {
        writeStdout: () => undefined,
        writeStderr: () => undefined,
        env,
      });
      commands[`${operation}_${mode}`] = code === 0 ? 'pass' : 'fail';
    }
  }
  const ok = Object.values(commands).every(status => status === 'pass');
  return {
    status: ok ? 'pass' : 'fail',
    reason_code: ok ? 'NONE' : 'LIVE_OPERATIONS_FAILED',
    commands,
  };
}

function parseCommandArgv(value: string): string[] | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      && parsed.length > 0
      && parsed.every(item => typeof item === 'string')
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

async function verifyLiveAgentSession(
  env: NodeJS.ProcessEnv,
  adapter: AdapterName,
  probe: AgentSmokeDependencies['probeCommand'],
): Promise<AgentSmokeReport['live_agent_sessions'][AdapterName]> {
  const key = adapter === 'codex'
    ? 'MEMENTO_SMOKE_CODEX_COMMAND'
    : 'MEMENTO_SMOKE_CLAUDE_COMMAND';
  const configured = env[key]?.trim();
  if (!configured) {
    return {
      status: 'skip',
      reason_code: 'LIVE_AGENT_COMMAND_NOT_CONFIGURED',
      command_configured: false,
    };
  }
  const argv = parseCommandArgv(configured);
  if (!argv) {
    return {
      status: 'fail',
      reason_code: 'LIVE_AGENT_COMMAND_INVALID',
      command_configured: true,
    };
  }
  const result = probe === command
    ? await command(argv[0]!, argv.slice(1), env, 180_000)
    : await probe!(argv[0]!, argv.slice(1));
  const lastLine = result.stdout.trim().split('\n').at(-1) ?? '';
  let evidence: {
    ok?: unknown;
    lifecycle_events?: unknown;
    manual_remember?: unknown;
  } = {};
  try {
    evidence = JSON.parse(lastLine) as typeof evidence;
  } catch {
    return {
      status: 'fail',
      reason_code: 'LIVE_AGENT_EVIDENCE_INVALID',
      command_configured: true,
    };
  }
  const events = Array.isArray(evidence.lifecycle_events)
    ? new Set(evidence.lifecycle_events)
    : new Set();
  const complete = LIFECYCLE_FIXTURES.every(([event]) => events.has(event));
  const passed = result.status === 0
    && evidence.ok === true
    && evidence.manual_remember === false
    && complete;
  return {
    status: passed ? 'pass' : 'fail',
    reason_code: passed ? 'NONE' : 'LIVE_AGENT_LIFECYCLE_INCOMPLETE',
    command_configured: true,
  };
}

function adapterOk(report: AdapterReport): boolean {
  return report.connect.status === 'pass'
    && report.lifecycle.every(item => item.status === 'pass')
    && report.failures.every(item => item.status === 'pass');
}

export async function runAgentSmokeMatrix(
  dependencies: AgentSmokeDependencies = {},
): Promise<AgentSmokeReport> {
  const env = dependencies.env ?? process.env;
  const now = dependencies.now ?? (() => new Date());
  const system = dependencies.platform ?? {
    os: platform(),
    arch: arch(),
    node: process.version,
  };
  const probe = dependencies.probeCommand ?? command;
  const ownsRoot = !dependencies.root;
  const root = dependencies.root
    ?? await mkdtemp(join(tmpdir(), 'memento-agent-smoke-'));
  const configPaths = dependencies.configPaths ?? {
    codex: join(root, 'codex', 'hooks.json'),
    claudeCode: join(root, 'claude', 'settings.json'),
  };

  try {
    const [codex, claudeCode] = await Promise.all([
      probeCli(probe, 'codex'),
      probeCli(probe, 'claude'),
    ]);
    const [codexConnect, claudeConnect, codexLifecycle, claudeLifecycle] = await Promise.all([
      verifyConnect('codex', configPaths.codex),
      verifyConnect('claude_code', configPaths.claudeCode),
      verifyLifecycle('codex'),
      verifyLifecycle('claude_code'),
    ]);
    const [codexFailures, claudeFailures, simulated, live] = await Promise.all([
      verifyFailures('codex'),
      verifyFailures('claude_code'),
      verifySimulatedOperations(),
      verifyLiveOperations(env),
    ]);
    const adapters: AgentSmokeReport['adapters'] = {
      codex: {
        connect: codexConnect,
        lifecycle: codexLifecycle,
        failures: codexFailures,
      },
      claude_code: {
        connect: claudeConnect,
        lifecycle: claudeLifecycle,
        failures: claudeFailures,
      },
    };
    const [codexLiveSession, claudeLiveSession] = await Promise.all([
      verifyLiveAgentSession(env, 'codex', probe),
      verifyLiveAgentSession(env, 'claude_code', probe),
    ]);
    const liveAgentSessions = {
      codex: codexLiveSession,
      claude_code: claudeLiveSession,
    };
    const serverVersion = env.MEMENTO_SMOKE_SERVER_VERSION ?? '1.17.0';
    const compatibilityMatrix = [
      { name: 'codex', cli: codex, adapter: adapters.codex },
      { name: 'claude-code', cli: claudeCode, adapter: adapters.claude_code },
    ].map(entry => ({
      os: system.os,
      arch: system.arch,
      node: system.node,
      agent: entry.name,
      agent_version: entry.cli.version ?? null,
      server: serverVersion,
      result: entry.cli.status === 'pass' && adapterOk(entry.adapter)
        ? 'pass' as const
        : entry.cli.status === 'skip' ? 'skip' as const : 'fail' as const,
      evidence: 'installed CLI probe + isolated connect + lifecycle replay + failure fallback',
    }));
    const constraints = [
      ...(live.status === 'skip'
        ? [{
            area: 'live_server',
            status: 'skip' as const,
            reason_code: live.reason_code,
            action: 'Set MEMENTO_SMOKE_ENDPOINT and optionally MEMENTO_SMOKE_API_KEY.',
          }]
        : []),
      ...Object.entries(liveAgentSessions)
        .filter(([, value]) => value.status === 'skip')
        .map(([agent, value]) => ({
          area: `${agent}_live_session`,
          status: 'skip' as const,
          reason_code: value.reason_code,
          action: 'Run the documented controlled live-agent procedure with credentials and usage approval.',
        })),
    ];
    const simulatedOk = Object.values(simulated).every(value => value === 'pass');
    const requiredOk = codex.status === 'pass'
      && claudeCode.status === 'pass'
      && Object.values(adapters).every(adapterOk)
      && simulatedOk
      && live.status !== 'fail';

    return {
      schema_version: 1,
      generated_at: now().toISOString(),
      ok: requiredOk,
      environment: {
        ...system,
        codex,
        claude_code: claudeCode,
      },
      adapters,
      operations: { simulated, live },
      live_agent_sessions: liveAgentSessions,
      compatibility_matrix: compatibilityMatrix,
      constraints,
    };
  } finally {
    if (ownsRoot) await rm(root, { recursive: true, force: true });
  }
}

interface CliOptions {
  output?: string;
  requireLive: boolean;
}

function parseOptions(argv: readonly string[]): CliOptions {
  const options: CliOptions = { requireLive: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--require-live') {
      options.requireLive = true;
      continue;
    }
    if (arg === '--output' && argv[index + 1]) {
      options.output = argv[index + 1];
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

async function main(): Promise<number> {
  try {
    const options = parseOptions(process.argv.slice(2));
    const report = await runAgentSmokeMatrix();
    const liveSatisfied = !options.requireLive
      || (
        report.operations.live.status === 'pass'
        && Object.values(report.live_agent_sessions).every(item => item.status === 'pass')
      );
    const output = `${JSON.stringify(report, null, 2)}\n`;
    if (options.output) {
      const path = resolve(options.output);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, output, 'utf8');
    }
    process.stdout.write(output);
    return report.ok && liveSatisfied ? 0 : 1;
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = await main();
}
