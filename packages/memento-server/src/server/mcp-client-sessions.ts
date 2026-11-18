/**
 * 옛 방식 MCP HTTP 연결의 클라이언트 정보 기억소 (#1768, ADR 결정 2)
 *
 * 옛 방식은 `initialize` 에서만 clientInfo 를 보내고 뒤 요청에는 `mcp-session-id` 헤더만 다시 보낸다
 * (opencode, cursor-agent 로 2026-11-18 확인). 그래서 세션 ID 로 (이름, 버전)을 기억해 둔다.
 *
 * - 키는 클라이언트가 보낸 헤더 값이라 길이를 128자로 막는다. 넘으면 기억하지 않는다.
 * - 개수는 1,000개이고, 읽을 때마다 최근 사용으로 갱신한다(LRU). 오래 열린 세션이 새 세션에 밀려나지 않는다.
 * - 값은 원문이 아니라 정규화 전 (이름, 버전) 두 값만 둔다. 정규화는 센 다음에 usage-recording 이 한다.
 * - 메모리에만 둔다. 서버를 다시 띄우면 다음 `initialize` 까지 그 연결은 unknown 이다.
 */

export interface ClientIdentity {
  name: string;
  version: string;
}

export const MAX_SESSION_KEY_LENGTH = 128;
const MAX_REMEMBERED_SESSIONS = 1_000;
/** clientInfo 의 이름과 버전 원문을 이 길이로 자른 뒤 기억한다. 정규화가 다시 거른다. */
const MAX_IDENTITY_FIELD_LENGTH = 64;

export class McpClientSessions {
  /** Map 의 삽입 순서를 LRU 순서로 쓴다: 맨 앞이 가장 오래 안 쓴 것. */
  private readonly sessions = new Map<string, ClientIdentity>();

  constructor(private readonly capacity: number = MAX_REMEMBERED_SESSIONS) {}

  /** `initialize` 의 params.clientInfo 를 세션 ID 에 묶는다. 키가 너무 길거나 값이 없으면 기억하지 않는다. */
  remember(sessionId: unknown, clientInfo: unknown): void {
    if (typeof sessionId !== 'string' || sessionId === '' || sessionId.length > MAX_SESSION_KEY_LENGTH) return;
    const identity = readClientInfo(clientInfo);
    if (!identity) return;
    this.sessions.delete(sessionId);
    this.sessions.set(sessionId, identity);
    while (this.sessions.size > this.capacity) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
    }
  }

  /** 세션 ID 로 찾는다. 찾으면 최근 사용으로 올린다. */
  recall(sessionId: unknown): ClientIdentity | undefined {
    if (typeof sessionId !== 'string' || sessionId.length > MAX_SESSION_KEY_LENGTH) return undefined;
    const identity = this.sessions.get(sessionId);
    if (!identity) return undefined;
    this.sessions.delete(sessionId);
    this.sessions.set(sessionId, identity);
    return identity;
  }

  /** 연결이 닫힐 때 지운다. */
  forget(sessionId: unknown): void {
    if (typeof sessionId === 'string') this.sessions.delete(sessionId);
  }

  size(): number {
    return this.sessions.size;
  }
}

/** clientInfo(Implementation) 에서 이름과 버전 문자열을 꺼낸다. 이름이 없으면 undefined. */
export function readClientInfo(raw: unknown): ClientIdentity | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const { name, version } = raw as { name?: unknown; version?: unknown };
  if (typeof name !== 'string' || name === '') return undefined;
  return {
    name: name.slice(0, MAX_IDENTITY_FIELD_LENGTH),
    version: typeof version === 'string' ? version.slice(0, MAX_IDENTITY_FIELD_LENGTH) : '',
  };
}

/** 프로세스 전체에서 쓰는 기억소(옛 방식 streamable HTTP 와 SSE 가 함께 쓴다). */
export const mcpClientSessions = new McpClientSessions();
