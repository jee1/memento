/**
 * `memento doctor --report` 가 만드는 보고서 (#1769, ADR 2026-11-18-issue-1768-local-usage-aggregate)
 *
 * 외부 설치에서 문제가 생겼을 때 사용자가 GitHub 이슈 초안을 직접 올릴 수 있게 환경과 오류 집계를 모은다.
 * 자동 전송은 하지 않는다. 이 모듈은 파일, 네트워크, 프로세스 상태를 읽지 않는 순수 함수만 둔다.
 *
 * 새는 길을 막는 방법은 허용 목록 하나다. 보고서의 모든 칸은 열거값, 구간, 정해진 모양의 숫자와 버전 중
 * 하나다. 자유 문자열 칸이 없다. 보고서는 `buildUsageReport` 가 칸을 하나씩 정규화해 채우고 입력 객체를
 * 펼쳐 넣지 않는다. 마지막으로 `validateUsageReport` 가 키와 값의 모양을 한 번 더 확인한다.
 */

import {
  CLIENT_NAMES,
  OTHER_CLIENT,
  normalizeClientName,
  normalizeErrorCode,
  normalizeSemverCore,
  normalizeTool,
  type ClientName,
  type UsageErrorCode,
} from './usage-vocabulary.js';

export const DOCTOR_REPORT_HINT =
  '문제를 보고하려면 `memento doctor --report` 로 이슈 초안을 만드세요(내용을 확인한 뒤 직접 올립니다. 자동 전송은 없습니다).';

export const REPORT_WINDOW_DAYS = 7;
const MAX_ROWS = 5;
/** 이슈 초안을 링크에 담는 한도. 넘으면 링크 대신 복사용 출력으로 바꾼다. */
const MAX_LINK_BODY_BYTES = 2048;
const ISSUE_NEW_URL = 'https://github.com/jee1/memento/issues/new';

export const OS_KINDS = ['linux', 'darwin', 'win32', 'other'] as const;
export const CPU_KINDS = ['x64', 'arm64', 'other'] as const;
export const INSTALL_KINDS = ['npm-global', 'npx', 'docker', 'source', 'unknown'] as const;
export const EMBEDDING_PROVIDERS = ['tfidf', 'lightweight', 'minilm', 'openai', 'gemini', 'other'] as const;
export const MEMORY_COUNT_BUCKETS = ['unknown', '0', '1-99', '100-999', '1000-9999', '10000+'] as const;
export const NATIVE_MODULE_STATES = ['ok', 'load_failed'] as const;
export const DATABASE_STATES = ['ok', 'missing', 'open_failed'] as const;

type Kind<T extends readonly string[]> = T[number];

export interface UsageClientRow {
  client_name: ClientName;
  client_version: string;
  requests: number;
  errors: number;
}

export interface UsageFailingToolRow {
  tool: string;
  error_code: UsageErrorCode;
  count: number;
}

export interface UsageReport {
  report_version: 1;
  memento_version: string;
  node_major: number;
  os: Kind<typeof OS_KINDS>;
  cpu: Kind<typeof CPU_KINDS>;
  install: Kind<typeof INSTALL_KINDS>;
  embedding_provider: Kind<typeof EMBEDDING_PROVIDERS>;
  memory_count: Kind<typeof MEMORY_COUNT_BUCKETS>;
  native_module: Kind<typeof NATIVE_MODULE_STATES>;
  database: Kind<typeof DATABASE_STATES>;
  schema_version: string;
  window_days: typeof REPORT_WINDOW_DAYS;
  requests: number;
  errors: number;
  clients: UsageClientRow[];
  failing_tools: UsageFailingToolRow[];
}

export const USAGE_REPORT_KEYS: readonly (keyof UsageReport)[] = [
  'report_version',
  'memento_version',
  'node_major',
  'os',
  'cpu',
  'install',
  'embedding_provider',
  'memory_count',
  'native_module',
  'database',
  'schema_version',
  'window_days',
  'requests',
  'errors',
  'clients',
  'failing_tools',
];

/** `usage_daily_count` 를 (클라이언트, 버전, 도구, 결과, 오류 코드) 로 묶어 합친 한 줄. */
export interface UsageRowInput {
  client_name: unknown;
  client_version: unknown;
  tool: unknown;
  outcome: unknown;
  error_code: unknown;
  count: unknown;
}

/** 값의 출처가 환경이라 모양을 믿지 않는다. 그래서 칸마다 unknown 으로 받는다. */
export interface UsageReportInput {
  mementoVersion: unknown;
  nodeVersion: unknown;
  platform: unknown;
  arch: unknown;
  install: unknown;
  embeddingProvider: unknown;
  /** 세지 못했으면 null */
  memoryCount: number | null;
  nativeModule: unknown;
  database: unknown;
  schemaVersion: unknown;
  usageRows: readonly UsageRowInput[];
  registeredTools: ReadonlySet<string>;
}

function pick<T extends readonly string[]>(values: T, raw: unknown, fallback: Kind<T>): Kind<T> {
  return typeof raw === 'string' && (values as readonly string[]).includes(raw) ? (raw as Kind<T>) : fallback;
}

function boundedInt(raw: unknown, max: number): number {
  return typeof raw === 'number' && Number.isSafeInteger(raw) && raw >= 0 ? Math.min(raw, max) : 0;
}

function memoryBucket(count: number | null): Kind<typeof MEMORY_COUNT_BUCKETS> {
  if (count === null || !Number.isSafeInteger(count) || count < 0) return 'unknown';
  if (count === 0) return '0';
  if (count < 100) return '1-99';
  if (count < 1000) return '100-999';
  if (count < 10000) return '1000-9999';
  return '10000+';
}

const SCHEMA_VERSION_SHAPE = /^\d{1,4}(\.\d{1,4})?$/;
const COUNT_MAX = 1_000_000_000_000;

export function buildUsageReport(input: UsageReportInput): UsageReport {
  const nodeMajor = typeof input.nodeVersion === 'string' ? Number.parseInt(input.nodeVersion, 10) : 0;
  const schemaVersion = typeof input.schemaVersion === 'string' ? input.schemaVersion.trim() : '';

  const clients = new Map<string, UsageClientRow>();
  const failing = new Map<string, UsageFailingToolRow>();
  let requests = 0;
  let errors = 0;
  for (const row of input.usageRows) {
    const count = boundedInt(row.count, COUNT_MAX);
    if (count === 0) continue;
    const name = normalizeClientName(row.client_name);
    const version = name === OTHER_CLIENT || name === 'unknown' ? '' : normalizeSemverCore(row.client_version);
    const failed = row.outcome === 'error';
    requests += count;
    if (failed) errors += count;

    const clientKey = `${name}|${version}`;
    const client = clients.get(clientKey) ?? { client_name: name, client_version: version, requests: 0, errors: 0 };
    client.requests += count;
    if (failed) client.errors += count;
    clients.set(clientKey, client);

    if (failed) {
      const tool = normalizeTool(row.tool, input.registeredTools);
      const errorCode = normalizeErrorCode(row.error_code);
      const toolKey = `${tool}|${errorCode}`;
      const entry = failing.get(toolKey) ?? { tool, error_code: errorCode, count: 0 };
      entry.count += count;
      failing.set(toolKey, entry);
    }
  }

  return {
    report_version: 1,
    memento_version: normalizeSemverCore(input.mementoVersion),
    node_major: Number.isSafeInteger(nodeMajor) && nodeMajor >= 0 && nodeMajor < 1000 ? nodeMajor : 0,
    os: pick(OS_KINDS, input.platform, 'other'),
    cpu: pick(CPU_KINDS, input.arch, 'other'),
    install: pick(INSTALL_KINDS, input.install, 'unknown'),
    embedding_provider: pick(EMBEDDING_PROVIDERS, typeof input.embeddingProvider === 'string' ? input.embeddingProvider.toLowerCase() : null, 'other'),
    memory_count: memoryBucket(input.memoryCount),
    native_module: pick(NATIVE_MODULE_STATES, input.nativeModule, 'load_failed'),
    database: pick(DATABASE_STATES, input.database, 'open_failed'),
    schema_version: SCHEMA_VERSION_SHAPE.test(schemaVersion) ? schemaVersion : '',
    window_days: REPORT_WINDOW_DAYS,
    requests,
    errors,
    clients: [...clients.values()].sort((a, b) => b.requests - a.requests || a.client_name.localeCompare(b.client_name)).slice(0, MAX_ROWS),
    failing_tools: [...failing.values()].sort((a, b) => b.count - a.count || a.tool.localeCompare(b.tool)).slice(0, MAX_ROWS),
  };
}

const EXACT_SEMVER = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;
const TOOL_SHAPE = /^[a-z0-9_]{1,64}$/;
const ERROR_CODES: readonly number[] = [-32602, -32603, -32003, -32009, -32601, -1];

const isOneOf = (values: readonly string[], v: unknown) => typeof v === 'string' && values.includes(v);
const isCount = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= COUNT_MAX;

/**
 * 보고서의 키가 타입의 키와 같고 모든 값이 정해진 모양에 맞는지 확인한다. 위반 목록을 돌려준다(비면 통과).
 * 출력 직전에 한 번 더 돌려, 나중에 칸을 잘못 더하는 변경이 값을 새게 하지 못하도록 한다.
 */
export function validateUsageReport(report: unknown): string[] {
  const problems: string[] = [];
  if (typeof report !== 'object' || report === null || Array.isArray(report)) return ['보고서가 객체가 아니다'];
  const r = report as Record<string, unknown>;
  const keys = Object.keys(r).sort();
  const expected = [...USAGE_REPORT_KEYS].sort();
  if (keys.join(',') !== expected.join(',')) problems.push(`키가 타입과 다르다: ${keys.join(',')}`);

  const check = (name: string, ok: boolean) => {
    if (!ok) problems.push(`${name} 값의 모양이 맞지 않다`);
  };
  check('report_version', r.report_version === 1);
  check('memento_version', typeof r.memento_version === 'string' && (r.memento_version === '' || EXACT_SEMVER.test(r.memento_version)));
  check('node_major', typeof r.node_major === 'number' && Number.isSafeInteger(r.node_major) && r.node_major >= 0 && r.node_major < 1000);
  check('os', isOneOf(OS_KINDS, r.os));
  check('cpu', isOneOf(CPU_KINDS, r.cpu));
  check('install', isOneOf(INSTALL_KINDS, r.install));
  check('embedding_provider', isOneOf(EMBEDDING_PROVIDERS, r.embedding_provider));
  check('memory_count', isOneOf(MEMORY_COUNT_BUCKETS, r.memory_count));
  check('native_module', isOneOf(NATIVE_MODULE_STATES, r.native_module));
  check('database', isOneOf(DATABASE_STATES, r.database));
  check('schema_version', typeof r.schema_version === 'string' && (r.schema_version === '' || SCHEMA_VERSION_SHAPE.test(r.schema_version)));
  check('window_days', r.window_days === REPORT_WINDOW_DAYS);
  check('requests', isCount(r.requests));
  check('errors', isCount(r.errors));

  const knownClients: readonly string[] = [...CLIENT_NAMES, 'other', 'unknown'];
  check(
    'clients',
    Array.isArray(r.clients) &&
      r.clients.length <= MAX_ROWS &&
      r.clients.every((c: unknown) => {
        if (typeof c !== 'object' || c === null) return false;
        const row = c as Record<string, unknown>;
        return (
          Object.keys(row).sort().join(',') === 'client_name,client_version,errors,requests' &&
          isOneOf(knownClients, row.client_name) &&
          typeof row.client_version === 'string' &&
          (row.client_version === '' || EXACT_SEMVER.test(row.client_version)) &&
          isCount(row.requests) &&
          isCount(row.errors)
        );
      }),
  );
  check(
    'failing_tools',
    Array.isArray(r.failing_tools) &&
      r.failing_tools.length <= MAX_ROWS &&
      r.failing_tools.every((t: unknown) => {
        if (typeof t !== 'object' || t === null) return false;
        const row = t as Record<string, unknown>;
        return (
          Object.keys(row).sort().join(',') === 'count,error_code,tool' &&
          typeof row.tool === 'string' &&
          TOOL_SHAPE.test(row.tool) &&
          typeof row.error_code === 'number' &&
          ERROR_CODES.includes(row.error_code) &&
          isCount(row.count)
        );
      }),
  );
  return problems;
}

/** 이슈에 붙는 본문. 마지막 절은 사용자가 직접 채운다. */
export function renderReportMarkdown(report: UsageReport): string {
  const clients = report.clients.length
    ? report.clients.map((c) => `- ${c.client_name}${c.client_version ? ` ${c.client_version}` : ''}: 요청 ${c.requests}, 오류 ${c.errors}`)
    : ['- 없음'];
  const failing = report.failing_tools.length
    ? report.failing_tools.map((t) => `- ${t.tool}, 오류 코드 ${t.error_code}: ${t.count}회`)
    : ['- 없음'];
  return [
    '## 환경 (`memento doctor --report`)',
    `- memento ${report.memento_version || '(알 수 없음)'}, Node ${report.node_major}, ${report.os}/${report.cpu}, 설치 방식 ${report.install}`,
    `- 임베딩 ${report.embedding_provider}, 기억 수 ${report.memory_count}, 스키마 ${report.schema_version || '(알 수 없음)'}`,
    `- 네이티브 모듈 ${report.native_module}, DB ${report.database}`,
    '',
    `## 최근 ${report.window_days}일 이 기기의 사용 집계`,
    `- 요청 ${report.requests}, 오류 ${report.errors}`,
    '클라이언트',
    ...clients,
    '오류가 난 도구',
    ...failing,
    '',
    '## 무슨 일이 있었나요?',
    '(여기에 적어 주세요)',
    '',
  ].join('\n');
}

export interface IssueDraft {
  title: string;
  body: string;
  /** 본문이 한도 안일 때만 있다. 없으면 본문을 복사해 붙여 넣는다. */
  url: string | null;
}

export function buildIssueDraft(report: UsageReport, options: { maxLinkBodyBytes?: number } = {}): IssueDraft {
  const limit = options.maxLinkBodyBytes ?? MAX_LINK_BODY_BYTES;
  const title = `[환경 보고] memento ${report.memento_version || '(알 수 없음)'}`;
  const body = renderReportMarkdown(report);
  const fits = Buffer.byteLength(body, 'utf8') <= limit;
  const url = fits ? `${ISSUE_NEW_URL}?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}` : null;
  return { title, body, url };
}
