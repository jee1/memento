/**
 * 사용 집계 기록의 서버 쪽 접합부 (#1768, ADR 결정 2, 3)
 *
 * 진입점(stdio, HTTP, WebSocket, REST)이 연결 정보를 `UsageConnection` 으로 채우고, 이 모듈이 그것을
 * 정규화해 core 의 집계기에 센다. 기록은 호출 경로를 막지 않는다: 집계기는 메모리 Map 만 만지고,
 * 이 모듈의 어떤 함수도 예외를 던지지 않는다.
 *
 * 인자, 결과, 오류 메시지는 받지 않는다. 받는 것은 연결 정보와 도구 이름, 결과 코드뿐이다.
 */

import {
  getAllTools,
  getUsageAggregator,
  normalizeClientName,
  normalizeClientVersion,
  normalizeErrorCode,
  normalizeTool,
  loggableClientName,
  type ClientName,
  type ConnectionMethod,
  type ProtocolEra,
  type RequestKind,
} from '@memento/core';
import type Database from 'better-sqlite3';
import { mcpLogger } from './mcp-logger.js';

/** 진입점이 아는 연결 정보. 클라이언트 이름과 버전은 정규화 전 원문이다. */
export interface UsageConnection {
  connectionMethod: ConnectionMethod;
  era: ProtocolEra;
  /** MCP clientInfo 의 name. 없으면 unknown 으로 센다. */
  clientName?: unknown;
  clientVersion?: unknown;
}

let registeredTools: ReadonlySet<string> | null = null;

/** 등록된 전체 도구 이름. 기본 core 모드는 4개만 노출하므로 getExposedTools 가 아니라 getAllTools 를 쓴다. */
function registeredToolNames(): ReadonlySet<string> {
  registeredTools ??= new Set(getAllTools().map((t) => t.name));
  return registeredTools;
}

const MAX_LOGGED_UNRECOGNIZED = 32;
const unrecognizedLogged = new Set<string>();

/** 이름을 로그에 남길 수 없는 모양일 때 한 번만 남기는 표식(중복 제거 열쇠). */
const UNLOGGABLE = '\u0000unloggable';

/**
 * 목록에 없는 새 클라이언트를 프로세스마다 한 번 로그에 남긴다(Set 은 32개까지만).
 * 이름은 영문자와 하이픈만 있는 20자 이하일 때만 남기고, 그 밖의 모양(숫자, 점, 밑줄, 긴 값)은 이름 대신
 * 「이름은 남기지 않음, 길이 N」만 한 번 남긴다. 새 클라이언트가 있다는 신호는 잃지 않되 값은 새지 않는다.
 */
function noteUnrecognized(raw: unknown, name: ClientName): void {
  if (name !== 'other') return;
  const shown = loggableClientName(raw);
  const key = shown || UNLOGGABLE;
  if (unrecognizedLogged.has(key) || unrecognizedLogged.size >= MAX_LOGGED_UNRECOGNIZED) return;
  unrecognizedLogged.add(key);
  if (shown) {
    mcpLogger.logServer('info', `client_name_unrecognized ${shown}`);
  } else {
    const length = typeof raw === 'string' ? raw.length : 0;
    mcpLogger.logServer('info', `client_name_unrecognized (이름은 남기지 않음: 허용 모양이 아님, 길이 ${length})`);
  }
}

function countSafely(fn: () => void): void {
  try {
    fn();
  } catch (error) {
    // 집계 실패가 도구 호출이나 연결을 막으면 안 된다.
    mcpLogger.logServer('warn', `usage aggregate count failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function resolveClient(connection: UsageConnection): { clientName: ClientName; clientVersion: string } {
  const clientName = normalizeClientName(connection.clientName);
  noteUnrecognized(connection.clientName, clientName);
  return { clientName, clientVersion: normalizeClientVersion(connection.clientVersion, clientName) };
}

/** 연결 신호(initialize, tools/list)를 센다. */
export function countConnectionSignal(
  db: Database.Database,
  connection: UsageConnection,
  requestKind: Exclude<RequestKind, 'tools/call'>,
): void {
  countSafely(() => {
    getUsageAggregator(db).count({
      ...resolveClient(connection),
      connectionMethod: connection.connectionMethod,
      era: connection.era,
      requestKind,
      tool: '',
      outcome: 'success',
      errorCode: 0,
    });
  });
}

/** 도구 호출 한 건을 센다. errorCode 는 JSON-RPC 코드이고 성공이면 0 이다. */
export function countToolCall(
  db: Database.Database,
  connection: UsageConnection,
  toolName: unknown,
  errorCode: number,
): void {
  countSafely(() => {
    const code = normalizeErrorCode(errorCode);
    getUsageAggregator(db).count({
      ...resolveClient(connection),
      connectionMethod: connection.connectionMethod,
      era: connection.era,
      requestKind: 'tools/call',
      tool: normalizeTool(toolName, registeredToolNames()),
      outcome: code === 0 ? 'success' : 'error',
      errorCode: code,
    });
  });
}

/** audit 컨텍스트의 transport 만 아는 진입점(REST, WebSocket 등)이 쓰는 기본 연결 정보. */
export function defaultConnectionForTransport(transport: string): UsageConnection {
  switch (transport) {
    case 'mcp_stdio':
      return { connectionMethod: 'stdio', era: 'legacy' };
    case 'mcp_ws':
      return { connectionMethod: 'websocket', era: 'none' };
    case 'rest':
    case 'http_admin':
      return { connectionMethod: 'rest', era: 'none' };
    case 'mcp_http':
    default:
      // HTTP 진입점은 항상 usage 를 채우므로 여기까지 오면 모양을 알 수 없다.
      return { connectionMethod: 'http-streamable', era: 'legacy' };
  }
}

/** 테스트용: 인식하지 못한 이름 기록과 도구 이름 캐시를 비운다. */
export function resetUsageRecordingForTests(): void {
  unrecognizedLogged.clear();
  registeredTools = null;
}

/** 새 방식 요청 `_meta` 의 클라이언트 정보 키(SDK 의 CLIENT_INFO_META_KEY 와 같은 값). HTTP 와 stdio 가 함께 쓴다. */
export const CLIENT_INFO_META_KEY = 'io.modelcontextprotocol/clientInfo';
const PROTOCOL_VERSION_META_KEY = 'io.modelcontextprotocol/protocolVersion';

/**
 * stdio 서버의 연결 정보 (#1768, ADR 결정 2).
 * 새 방식은 요청마다 envelope 에 clientInfo 가 실려 오고(SDK 가 `ctx.mcpReq.envelope` 로 올려 준다),
 * 옛 방식은 `initialize` 에서 받은 값을 `server.getClientVersion()` 이 돌려준다.
 */
export function stdioUsageConnection(
  envelope: unknown,
  getClientVersion: () => { name?: unknown; version?: unknown } | undefined,
): UsageConnection {
  const env = envelope && typeof envelope === 'object' ? (envelope as Record<string, unknown>) : undefined;
  const modern = env !== undefined && (CLIENT_INFO_META_KEY in env || PROTOCOL_VERSION_META_KEY in env);
  if (modern) {
    const info = env[CLIENT_INFO_META_KEY] as { name?: unknown; version?: unknown } | undefined;
    return { connectionMethod: 'stdio', era: 'modern', clientName: info?.name, clientVersion: info?.version };
  }
  const info = getClientVersion();
  return { connectionMethod: 'stdio', era: 'legacy', clientName: info?.name, clientVersion: info?.version };
}
