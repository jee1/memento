import { randomUUID } from 'node:crypto';

import {
  readServerInfo,
  resolveServerInfoConfigDir,
} from '../server/server-info.js';

type AgentOpsCommand = 'doctor' | 'status' | 'demo';
type ResultStatus = 'pass' | 'fail' | 'warn' | 'skip';

export type AgentOpsRequest = (
  path: string,
  init?: RequestInit,
) => Promise<{ status: number; body: unknown }>;

interface AgentOpsDependencies {
  request?: AgentOpsRequest;
  resolveEndpoint?: (
    explicitEndpoint: string | undefined,
    env: NodeJS.ProcessEnv,
  ) => Promise<string>;
  now?: () => Date;
  randomId?: () => string;
  writeStdout?: (message: string) => void | Promise<void>;
  writeStderr?: (message: string) => void | Promise<void>;
  env?: NodeJS.ProcessEnv;
}

interface AgentOpsOptions {
  endpoint?: string;
  apiKey?: string;
  json: boolean;
  timeoutMs: number;
  since: string;
  limit: number;
}

interface ResultItem {
  name: string;
  status: ResultStatus;
  reason_code: string;
  message: string;
}

interface ReasonGuide {
  reason_code: string;
  category:
    | 'connectivity'
    | 'auth'
    | 'schema'
    | 'compatibility'
    | 'capacity'
    | 'security'
    | 'lifecycle'
    | 'internal';
  action: string;
}

const REQUIRED_EVENTS = [
  'SESSION_START',
  'USER_PROMPT',
  'TOOL_RESULT',
  'PRE_COMPACT',
  'STOP',
] as const;
const SYNTHETIC_MARKER = 'memento-doctor-secret';

const REASON_GUIDES: Record<string, Omit<ReasonGuide, 'reason_code'>> = {
  NONE: {
    category: 'internal',
    action: '추가 조치가 필요하지 않습니다.',
  },
  SERVER_UNAVAILABLE: {
    category: 'connectivity',
    action: 'Memento 서버와 endpoint가 실행 중인지 확인하세요.',
  },
  TIMEOUT: {
    category: 'connectivity',
    action: '서버 상태와 네트워크 지연을 확인하고 timeout을 조정하세요.',
  },
  AUTH_FAILED: {
    category: 'auth',
    action: 'CLI의 API key가 서버 ADMIN_API_KEY와 일치하는지 확인하세요.',
  },
  SCHEMA_NOT_READY: {
    category: 'schema',
    action: 'DB migration을 적용하고 Memento 서버를 재시작하세요.',
  },
  UNSUPPORTED_CONTRACT_VERSION: {
    category: 'compatibility',
    action: '서버, CLI, adapter를 contract version 1 지원 버전으로 맞추세요.',
  },
  UNSUPPORTED_EVENT_TYPE: {
    category: 'compatibility',
    action: 'adapter와 서버의 lifecycle event 지원 matrix를 확인하세요.',
  },
  QUEUE_OVERFLOW: {
    category: 'capacity',
    action: 'capture 부하와 drop count를 확인하고 queue 유입량을 줄이세요.',
  },
  BATCH_TOO_LARGE: {
    category: 'capacity',
    action: 'event batch 크기와 개수를 server capability limit 이하로 줄이세요.',
  },
  PAYLOAD_TOO_LARGE: {
    category: 'capacity',
    action: 'tool output과 event payload를 축소하세요.',
  },
  SENSITIVE_PATH: {
    category: 'security',
    action: '민감 경로 차단이 의도된 것인지 확인하고 파일 원문 전송을 중단하세요.',
  },
  PRIVATE_KEY_MATERIAL: {
    category: 'security',
    action: 'private key material을 event payload에서 제거하세요.',
  },
  BINARY_CONTENT: {
    category: 'security',
    action: 'binary body 대신 안전한 metadata만 전송하세요.',
  },
  SESSION_NOT_STARTED: {
    category: 'lifecycle',
    action: 'SESSION_START 전달과 adapter hook 순서를 확인하세요.',
  },
  INVALID_SESSION_STATE: {
    category: 'lifecycle',
    action: 'STOP 이후 event 재전송 여부와 lifecycle 순서를 확인하세요.',
  },
  IDEMPOTENCY_CONFLICT: {
    category: 'lifecycle',
    action: '동일 event ID가 다른 payload로 재사용되지 않는지 확인하세요.',
  },
};

export function reasonGuide(reasonCode: string): ReasonGuide {
  const guide = REASON_GUIDES[reasonCode] ?? {
    category: 'internal' as const,
    action: '서버와 CLI 버전을 확인하고 해당 reason code의 server log를 검토하세요.',
  };
  return { reason_code: reasonCode, ...guide };
}

function parsePositiveInteger(value: string, name: string, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be between 1 and ${maximum}`);
  }
  return parsed;
}

function parseOptions(argv: readonly string[]): AgentOpsOptions {
  const parsed: AgentOpsOptions = {
    json: false,
    timeoutMs: 5_000,
    since: '24h',
    limit: 20,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      parsed.json = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value) throw new Error(`${arg} requires a value`);
    if (arg === '--endpoint') parsed.endpoint = value;
    else if (arg === '--api-key') parsed.apiKey = value;
    else if (arg === '--timeout-ms') {
      parsed.timeoutMs = parsePositiveInteger(value, '--timeout-ms', 60_000);
    } else if (arg === '--since') parsed.since = value;
    else if (arg === '--limit') parsed.limit = parsePositiveInteger(value, '--limit', 100);
    else throw new Error(`Unknown agent operations option: ${arg}`);
    index += 1;
  }
  return parsed;
}

function normalizeEndpoint(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('endpoint must use http or https');
  }
  return url.origin;
}

async function defaultResolveEndpoint(
  explicitEndpoint: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  if (explicitEndpoint) return normalizeEndpoint(explicitEndpoint);
  if (env.MEMENTO_ENDPOINT?.trim()) return normalizeEndpoint(env.MEMENTO_ENDPOINT.trim());
  const serverInfo = await readServerInfo(resolveServerInfoConfigDir({ env }));
  if (!serverInfo) throw new Error('Memento server endpoint is unavailable');
  return `http://127.0.0.1:${serverInfo.port}`;
}

function createRequest(
  endpoint: string,
  apiKey: string | undefined,
  timeoutMs: number,
): AgentOpsRequest {
  return async (path, init = {}) => {
    try {
      const response = await fetch(`${endpoint}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          ...init.headers,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = response.status === 204 ? '' : await response.text();
      let body: unknown = null;
      if (text) {
        try {
          body = JSON.parse(text) as unknown;
        } catch {
          body = null;
        }
      }
      return { status: response.status, body };
    } catch {
      return { status: 0, body: { reason_code: 'SERVER_UNAVAILABLE' } };
    }
  };
}

function objectBody(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function responseReason(status: number, body: unknown): string {
  const record = objectBody(body);
  if (typeof record.reason_code === 'string') return record.reason_code;
  if (status === 0) return 'SERVER_UNAVAILABLE';
  if (status === 401 || status === 403) return 'AUTH_FAILED';
  if (status === 503) return 'SCHEMA_NOT_READY';
  if (status >= 400) return 'INTERNAL_ERROR';
  return 'NONE';
}

function item(
  name: string,
  status: ResultStatus,
  reasonCode: string,
  message: string,
): ResultItem {
  return { name, status, reason_code: reasonCode, message };
}

function compatibility(capabilities: Record<string, unknown>) {
  const versions = Array.isArray(capabilities.contract_versions)
    ? capabilities.contract_versions
    : [];
  const eventTypes = new Set(
    Array.isArray(capabilities.event_types)
      ? capabilities.event_types.filter((value): value is string => typeof value === 'string')
      : [],
  );
  const missingEvents = REQUIRED_EVENTS.filter(eventType => !eventTypes.has(eventType));
  const compatible = versions.includes(1) && missingEvents.length === 0;
  return ['claude-code', 'codex'].map(adapter => ({
    adapter,
    baseline: '0.1.x',
    required_contract: 1,
    status: compatible ? 'compatible' : versions.includes(1) ? 'degraded' : 'incompatible',
    missing_events: missingEvents,
  }));
}

function uniqueGuidance(items: readonly ResultItem[]): ReasonGuide[] {
  return [...new Set(
    items
      .filter(result => result.status === 'fail' || result.status === 'warn')
      .map(result => result.reason_code),
  )].map(reasonGuide);
}

function envelope(
  eventType: typeof REQUIRED_EVENTS[number],
  sessionId: string,
  sequenceNo: number,
  occurredAt: string,
  payload: Record<string, unknown>,
  scope: Record<string, string>,
) {
  return {
    contract_version: 1,
    event_id: `${sessionId}-${sequenceNo}-${eventType.toLowerCase()}`,
    event_type: eventType,
    occurred_at: occurredAt,
    adapter_name: 'memento-cli',
    adapter_version: '1.0.0',
    session_id: sessionId,
    sequence_no: sequenceNo,
    scope,
    payload,
  };
}

async function runDoctor(
  endpoint: string,
  request: AgentOpsRequest,
  now: () => Date,
  randomId: () => string,
) {
  const checks: ResultItem[] = [];
  const healthResponse = await request('/health', { method: 'GET' });
  if (healthResponse.status !== 200) {
    const reason = responseReason(healthResponse.status, healthResponse.body);
    checks.push(item('endpoint', 'fail', reason, '서버 health endpoint에 연결하지 못했습니다.'));
    return {
      command: 'doctor',
      ok: false,
      checked_at: now().toISOString(),
      endpoint,
      checks,
      compatibility: [],
      guidance: uniqueGuidance(checks),
    };
  }
  checks.push(item('endpoint', 'pass', 'NONE', '서버 endpoint가 응답했습니다.'));
  const health = objectBody(healthResponse.body);
  const version = typeof health.version === 'string' ? health.version : null;
  checks.push(item(
    'version',
    version ? 'pass' : 'warn',
    version ? 'NONE' : 'INTERNAL_ERROR',
    version ? `서버 버전 ${version}을 확인했습니다.` : '서버 버전을 확인하지 못했습니다.',
  ));

  const capabilitiesResponse = await request('/api/v1/agent/capabilities', { method: 'GET' });
  if (capabilitiesResponse.status !== 200) {
    const reason = responseReason(capabilitiesResponse.status, capabilitiesResponse.body);
    checks.push(item('auth', 'fail', reason, 'Agent API 인증 또는 capability 조회에 실패했습니다.'));
    return {
      command: 'doctor',
      ok: false,
      checked_at: now().toISOString(),
      endpoint,
      checks,
      compatibility: [],
      guidance: uniqueGuidance(checks),
    };
  }
  checks.push(item('auth', 'pass', 'NONE', 'Programmatic auth가 동작합니다.'));
  const capabilities = objectBody(capabilitiesResponse.body);
  const schemaReady = capabilities.schema_ready === true;
  checks.push(item(
    'schema',
    schemaReady ? 'pass' : 'fail',
    schemaReady ? 'NONE' : 'SCHEMA_NOT_READY',
    schemaReady ? 'Agent schema가 준비되었습니다.' : 'Agent schema가 준비되지 않았습니다.',
  ));
  const versions = Array.isArray(capabilities.contract_versions)
    ? capabilities.contract_versions
    : [];
  const contractReady = versions.includes(1);
  checks.push(item(
    'contract',
    contractReady ? 'pass' : 'fail',
    contractReady ? 'NONE' : 'UNSUPPORTED_CONTRACT_VERSION',
    contractReady ? 'Agent contract version 1을 지원합니다.' : 'Agent contract version 1을 지원하지 않습니다.',
  ));

  const sessionId = `memento-doctor-${randomId()}`;
  let created = false;
  try {
    if (!schemaReady || !contractReady) {
      checks.push(item('redaction', 'skip', 'SCHEMA_NOT_READY', '선행 check 실패로 redaction probe를 생략했습니다.'));
    } else {
      const occurredAt = now().toISOString();
      const startResponse = await request('/api/v1/agent/sessions', {
        method: 'POST',
        body: JSON.stringify(envelope(
          'SESSION_START',
          sessionId,
          0,
          occurredAt,
          {
            client_version: '1.0.0',
            extensions: { password: SYNTHETIC_MARKER },
          },
          { project_id: 'memento-doctor', process_id: 'memento-doctor' },
        )),
      });
      created = startResponse.status === 201;
      if (!created) {
        const reason = responseReason(startResponse.status, startResponse.body);
        checks.push(item('redaction', 'fail', reason, 'Synthetic redaction event 수집에 실패했습니다.'));
      } else {
        const exportResponse = await request(
          `/api/v1/agent/sessions/${encodeURIComponent(sessionId)}/export`,
          { method: 'GET' },
        );
        const serialized = JSON.stringify(exportResponse.body);
        const exported = objectBody(exportResponse.body);
        const observations = Array.isArray(exported.observations) ? exported.observations : [];
        const redacted = exportResponse.status === 200
          && !serialized.includes(SYNTHETIC_MARKER)
          && serialized.includes('[REDACTED:')
          && observations.some((observation) =>
            objectBody(observation).status === 'REDACTED'
          );
        checks.push(item(
          'redaction',
          redacted ? 'pass' : 'fail',
          redacted ? 'NONE' : 'INTERNAL_ERROR',
          redacted
            ? 'Synthetic marker가 저장 전에 redaction되었습니다.'
            : 'Synthetic marker redaction 검증에 실패했습니다.',
        ));
      }
    }
  } finally {
    if (created) {
      const cleanup = await request(
        `/api/v1/agent/sessions/${encodeURIComponent(sessionId)}`,
        { method: 'DELETE' },
      );
      checks.push(item(
        'cleanup',
        cleanup.status === 204 ? 'pass' : 'warn',
        cleanup.status === 204 ? 'NONE' : responseReason(cleanup.status, cleanup.body),
        cleanup.status === 204 ? 'Synthetic session을 삭제했습니다.' : 'Synthetic session 정리를 확인하세요.',
      ));
    } else {
      checks.push(item('cleanup', 'skip', 'NONE', '생성된 synthetic session이 없습니다.'));
    }
  }
  const matrix = compatibility(capabilities);
  const ok = checks.every(check => check.status === 'pass' || check.status === 'skip')
    && matrix.every(entry => entry.status === 'compatible');
  return {
    command: 'doctor',
    ok,
    checked_at: now().toISOString(),
    endpoint,
    checks,
    compatibility: matrix,
    guidance: uniqueGuidance(checks),
  };
}

function parseSince(value: string, now: Date): string {
  const match = /^(\d+)(m|h|d)$/.exec(value);
  if (match) {
    const amount = Number(match[1]);
    const unitMs = match[2] === 'm'
      ? 60_000
      : match[2] === 'h'
        ? 3_600_000
        : 86_400_000;
    return new Date(now.getTime() - Math.min(amount * unitMs, 7 * 86_400_000)).toISOString();
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed > now) {
    throw new Error('--since must be an ISO timestamp or duration such as 24h');
  }
  return new Date(Math.max(parsed.getTime(), now.getTime() - 7 * 86_400_000)).toISOString();
}

async function runStatus(
  endpoint: string,
  request: AgentOpsRequest,
  options: AgentOpsOptions,
  now: () => Date,
) {
  const query = new URLSearchParams({
    since: parseSince(options.since, now()),
    limit: String(options.limit),
  });
  const response = await request(
    `/api/v1/agent/operations/status?${query.toString()}`,
    { method: 'GET' },
  );
  const reason = responseReason(response.status, response.body);
  return {
    command: 'status',
    ok: response.status === 200,
    checked_at: now().toISOString(),
    endpoint,
    summary: response.status === 200 ? response.body : null,
    guidance: response.status === 200 ? [] : [reasonGuide(reason)],
  };
}

async function runDemo(
  endpoint: string,
  request: AgentOpsRequest,
  now: () => Date,
  randomId: () => string,
) {
  const rootId = randomId();
  const firstSession = `memento-demo-${rootId}-1`;
  const secondSession = `memento-demo-${rootId}-2`;
  const scope = {
    owner_id: `memento-demo-${rootId}`,
    project_id: `memento-demo-${rootId}`,
    process_id: `memento-demo-${rootId}`,
  };
  const steps: ResultItem[] = [];
  let firstCreated = false;
  let secondCreated = false;
  let summaryMemoryId: string | null = null;
  let injectionStatus = 'unavailable';
  let selectedCount = 0;
  let summaryReused = false;
  try {
    const startAt = now().toISOString();
    const firstStart = await request('/api/v1/agent/sessions', {
      method: 'POST',
      body: JSON.stringify(envelope(
        'SESSION_START',
        firstSession,
        0,
        startAt,
        {
          client_version: '1.0.0',
          initial_context: 'Memento agent operations demo',
        },
        scope,
      )),
    });
    firstCreated = firstStart.status === 201;
    steps.push(item(
      'first_session_start',
      firstCreated ? 'pass' : 'fail',
      responseReason(firstStart.status, firstStart.body),
      firstCreated ? '첫 session을 시작했습니다.' : '첫 session 시작에 실패했습니다.',
    ));
    if (!firstCreated) throw new Error('first session start failed');

    const observations = [
      envelope(
        'USER_PROMPT',
        firstSession,
        1,
        now().toISOString(),
        {
          content: 'Use the established agent operations CLI workflow.',
          content_format: 'text/plain',
        },
        scope,
      ),
      envelope(
        'TOOL_RESULT',
        firstSession,
        2,
        now().toISOString(),
        {
          tool_name: 'memento_demo',
          outcome: 'success',
          input: { operation: 'capture' },
          output: { result: 'verified' },
        },
        scope,
      ),
    ];
    const ingest = await request('/api/v1/agent/observations:ingest', {
      method: 'POST',
      body: JSON.stringify({ events: observations }),
    });
    const ingestBody = objectBody(ingest.body);
    const results = Array.isArray(ingestBody.results) ? ingestBody.results : [];
    const captured = ingest.status === 200
      && results.length === observations.length
      && results.every(result => {
        const status = objectBody(result).status;
        return status === 'ACCEPTED' || status === 'REDACTED';
      });
    steps.push(item(
      'capture',
      captured ? 'pass' : 'fail',
      captured ? 'NONE' : responseReason(ingest.status, ingest.body),
      captured ? 'Prompt와 tool result를 수집했습니다.' : 'Observation 수집에 실패했습니다.',
    ));
    if (!captured) throw new Error('capture failed');

    const stop = await request(
      `/api/v1/agent/sessions/${encodeURIComponent(firstSession)}:stop`,
      {
        method: 'POST',
        body: JSON.stringify(envelope(
          'STOP',
          firstSession,
          3,
          now().toISOString(),
          {
            outcome: 'completed',
            summary: 'Agent operations CLI workflow verified.',
          },
          scope,
        )),
      },
    );
    const stopBody = objectBody(stop.body);
    summaryMemoryId = typeof stopBody.summary_job_id === 'string'
      ? stopBody.summary_job_id
      : null;
    const summarized = stop.status === 200 && summaryMemoryId !== null;
    steps.push(item(
      'summary',
      summarized ? 'pass' : 'fail',
      summarized ? 'NONE' : responseReason(stop.status, stop.body),
      summarized ? '첫 session summary memory를 생성했습니다.' : 'Session summary 생성에 실패했습니다.',
    ));
    if (!summarized) throw new Error('summary failed');

    const secondStart = await request('/api/v1/agent/sessions', {
      method: 'POST',
      body: JSON.stringify(envelope(
        'SESSION_START',
        secondSession,
        0,
        now().toISOString(),
        {
          client_version: '1.0.0',
          initial_context: 'Continue the agent operations CLI workflow.',
        },
        scope,
      )),
    });
    secondCreated = secondStart.status === 201;
    const secondBody = objectBody(secondStart.body);
    const initialInjection = objectBody(secondBody.initial_injection);
    injectionStatus = typeof initialInjection.status === 'string'
      ? initialInjection.status
      : 'unavailable';
    const selected = Array.isArray(initialInjection.items) ? initialInjection.items : [];
    selectedCount = selected.length;
    summaryReused = summaryMemoryId !== null && selected.some(selectedItem =>
      objectBody(selectedItem).memory_id === summaryMemoryId
    );
    steps.push(item(
      'next_session_injection',
      secondCreated && summaryReused ? 'pass' : 'fail',
      secondCreated && summaryReused ? 'NONE' : responseReason(secondStart.status, secondStart.body),
      secondCreated && summaryReused
        ? '두 번째 session에 첫 summary memory가 주입되었습니다.'
        : '두 번째 session에서 첫 summary memory를 확인하지 못했습니다.',
    ));
  } catch {
    // Step results preserve the actionable failure without exposing request payloads.
  } finally {
    for (const [sessionId, created] of [
      [secondSession, secondCreated],
      [firstSession, firstCreated],
    ] as const) {
      if (!created) continue;
      const cleanup = await request(
        `/api/v1/agent/sessions/${encodeURIComponent(sessionId)}`,
        { method: 'DELETE' },
      );
      steps.push(item(
        `cleanup_${sessionId.endsWith('-2') ? 'second' : 'first'}`,
        cleanup.status === 204 ? 'pass' : 'warn',
        cleanup.status === 204 ? 'NONE' : responseReason(cleanup.status, cleanup.body),
        cleanup.status === 204 ? 'Demo session을 삭제했습니다.' : 'Demo session 정리를 확인하세요.',
      ));
    }
    if (summaryMemoryId) {
      const cleanup = await request('/tools/forget', {
        method: 'POST',
        body: JSON.stringify({ id: summaryMemoryId, hard: true }),
      });
      steps.push(item(
        'cleanup_summary',
        cleanup.status === 200 ? 'pass' : 'warn',
        cleanup.status === 200 ? 'NONE' : responseReason(cleanup.status, cleanup.body),
        cleanup.status === 200 ? 'Demo summary memory를 삭제했습니다.' : 'Demo summary memory 정리를 확인하세요.',
      ));
    }
  }
  const ok = summaryReused
    && steps.every(step => step.status === 'pass' || step.status === 'skip');
  return {
    command: 'demo',
    ok,
    checked_at: now().toISOString(),
    endpoint,
    steps,
    injection: {
      status: injectionStatus,
      selected_count: selectedCount,
      summary_reused: summaryReused,
    },
    guidance: uniqueGuidance(steps),
  };
}

function humanResult(result: Record<string, unknown>): string {
  const lines = [
    `memento ${String(result.command)}: ${result.ok === true ? 'OK' : 'FAILED'}`,
    `endpoint: ${String(result.endpoint)}`,
  ];
  const items = Array.isArray(result.checks)
    ? result.checks
    : Array.isArray(result.steps)
      ? result.steps
      : [];
  for (const raw of items) {
    const entry = objectBody(raw);
    lines.push(
      `${String(entry.status).toUpperCase()} ${String(entry.name)}`
      + ` [${String(entry.reason_code)}] ${String(entry.message)}`,
    );
  }
  const summary = objectBody(result.summary);
  const counts = objectBody(summary.counts);
  if (Object.keys(counts).length > 0) {
    lines.push(
      `captures=${String(counts.captures ?? 0)}`
      + ` injections=${String(counts.injections ?? 0)}`
      + ` dropped=${String(counts.dropped ?? 0)}`
      + ` degraded=${String(counts.degraded ?? 0)}`,
    );
  }
  const guidance = Array.isArray(result.guidance) ? result.guidance : [];
  const matrix = Array.isArray(result.compatibility) ? result.compatibility : [];
  for (const raw of matrix) {
    const entry = objectBody(raw);
    lines.push(
      `COMPAT ${String(entry.adapter)}: ${String(entry.status)}`
      + ` contract=${String(entry.required_contract)}`,
    );
  }
  for (const raw of guidance) {
    const entry = objectBody(raw);
    lines.push(`GUIDE ${String(entry.reason_code)}: ${String(entry.action)}`);
  }
  return `${lines.join('\n')}\n`;
}

export async function runAgentOpsCommand(
  command: AgentOpsCommand,
  argv: readonly string[],
  dependencies: AgentOpsDependencies = {},
): Promise<number> {
  const writeStdout = dependencies.writeStdout ?? (message => process.stdout.write(message));
  const writeStderr = dependencies.writeStderr ?? (message => process.stderr.write(message));
  try {
    const options = parseOptions(argv);
    const env = dependencies.env ?? process.env;
    const endpoint = await (dependencies.resolveEndpoint ?? defaultResolveEndpoint)(
      options.endpoint,
      env,
    );
    const apiKey = options.apiKey
      ?? env.ADMIN_API_KEY?.trim()
      ?? env.MEMENTO_API_KEY?.trim();
    const request = dependencies.request
      ?? createRequest(endpoint, apiKey, options.timeoutMs);
    const now = dependencies.now ?? (() => new Date());
    const randomId = dependencies.randomId ?? randomUUID;
    const result = command === 'doctor'
      ? await runDoctor(endpoint, request, now, randomId)
      : command === 'status'
        ? await runStatus(endpoint, request, options, now)
        : await runDemo(endpoint, request, now, randomId);
    await writeStdout(
      options.json
        ? `${JSON.stringify(result)}\n`
        : humanResult(result as unknown as Record<string, unknown>),
    );
    return result.ok ? 0 : 1;
  } catch (error) {
    const result = {
      command,
      ok: false,
      checked_at: new Date().toISOString(),
      reason_code: 'INVALID_ARGUMENT',
      message: error instanceof Error ? error.message : 'Agent operations command failed',
      guidance: [reasonGuide('INTERNAL_ERROR')],
    };
    if (argv.includes('--json')) {
      await writeStdout(`${JSON.stringify(result)}\n`);
    } else {
      await writeStderr(`${result.message}\n`);
    }
    return 1;
  }
}
