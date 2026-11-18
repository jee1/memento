/**
 * 사용 집계의 허용 값 단일 원본 (#1768, ADR 2026-11-18-issue-1768-local-usage-aggregate)
 *
 * 마이그레이션 069 의 CHECK 와 앱의 정규화 함수가 이 목록을 함께 쓴다. 집계 표에는 여기서 정한
 * 값만 들어간다. 클라이언트가 보낸 문자열, 도구 인자, 오류 메시지는 이 모듈을 거쳐 열거값이나
 * 모양이 정해진 값으로 바뀌고, 그러지 못하면 `other`/`unknown`/빈 값이 된다.
 */

export const CLIENT_NAMES = ['claude-code', 'cursor', 'opencode'] as const;
export type KnownClientName = (typeof CLIENT_NAMES)[number];
export type ClientName = KnownClientName | 'other' | 'unknown';

export const CONNECTION_METHODS = ['stdio', 'http-streamable', 'http-sse', 'websocket', 'rest'] as const;
export type ConnectionMethod = (typeof CONNECTION_METHODS)[number];

export const PROTOCOL_ERAS = ['legacy', 'modern', 'none'] as const;
export type ProtocolEra = (typeof PROTOCOL_ERAS)[number];

export const REQUEST_KINDS = ['initialize', 'tools/list', 'tools/call'] as const;
export type RequestKind = (typeof REQUEST_KINDS)[number];

export const OUTCOMES = ['success', 'error'] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** 0 은 성공. -1 은 목록 밖의 그 밖 오류. */
export const ERROR_CODES = [0, -32602, -32603, -32003, -32009, -32601, -1] as const;
export type UsageErrorCode = (typeof ERROR_CODES)[number];

const OTHER_TOOL = 'other';
const UNKNOWN_CLIENT: ClientName = 'unknown';
export const OTHER_CLIENT: ClientName = 'other';

const SEMVER_CORE = /^(\d{1,6})\.(\d{1,6})\.(\d{1,6})(?:[-+].*)?$/;
const TOOL_SHAPE = /^[a-z0-9_]{1,64}$/;

/** 클라이언트가 보낸 이름을 소문자로 바꿔 알려진 목록과 맞춘다. 목록 밖이면 other, 값이 없으면 unknown. */
export function normalizeClientName(raw: unknown): ClientName {
  if (typeof raw !== 'string' || raw.trim() === '') return UNKNOWN_CLIENT;
  const lowered = raw.trim().toLowerCase();
  return (CLIENT_NAMES as readonly string[]).includes(lowered) ? (lowered as KnownClientName) : OTHER_CLIENT;
}

/**
 * major.minor.patch 세 조각만 남긴다. 접미사(prerelease, build)는 버린다. 모양이 맞지 않으면 빈 문자열.
 * 이름이 other/unknown 이면 버전은 항상 빈 문자열이다(행 수 상한, 결정 5).
 */
export function normalizeClientVersion(raw: unknown, name: ClientName): string {
  if (name === OTHER_CLIENT || name === UNKNOWN_CLIENT) return '';
  if (typeof raw !== 'string') return '';
  const m = SEMVER_CORE.exec(raw.trim());
  return m ? `${Number(m[1])}.${Number(m[2])}.${Number(m[3])}` : '';
}

/** 등록된 도구 이름이면 그대로, 아니면 other. */
export function normalizeTool(raw: unknown, registered: ReadonlySet<string>): string {
  return typeof raw === 'string' && TOOL_SHAPE.test(raw) && registered.has(raw) ? raw : OTHER_TOOL;
}

/** JSON-RPC 오류 코드를 허용 목록으로 줄인다. 성공은 0. */
export function normalizeErrorCode(code: unknown): UsageErrorCode {
  return typeof code === 'number' && (ERROR_CODES as readonly number[]).includes(code) ? (code as UsageErrorCode) : -1;
}

/** 새로 알게 된 클라이언트 이름을 로그에 남길 때 쓰는 값: 소문자 영숫자와 `.-_` 만, 40자까지. */
export function sanitizeClientNameForLog(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.toLowerCase().replace(/[^a-z0-9._-]/g, '').slice(0, 40);
}
