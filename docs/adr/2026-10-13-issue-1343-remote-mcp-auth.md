# ADR: 원격 MCP 접속 인증 방식 (이슈 #1343)

- 상태: Accepted
- 날짜: 2026-10-13
- 이슈: https://github.com/jee1/memento/issues/1343
- 관련: #1258·#1287(토큰 → agent 바인딩), #1280(`/mcp` 인증 마운트), #1290(rate limit)

## Context

원격(비 loopback) MCP 접속 인증은 정적 API 토큰(`MEMENTO_API_TOKENS`, 선택적 `agent_id` 바인딩)뿐이다. MCP 사양의 HTTP 인증은 OAuth 2.1 기반이라, 원격 클라이언트를 붙일 방식을 정해야 했다.

확인한 사실 (2026-10-13 기준):

- MCP 사양에서 인증은 **선택**이다. "Authorization is OPTIONAL for MCP implementations." 지원한다면 HTTP 전송은 사양을 따라야 하고(SHOULD), 그때 MCP 서버는 OAuth 2.1 **Resource Server** 역할을 한다. 토큰 발급(Authorization Server)은 별도 주체여도 된다 — [MCP Authorization (2025-06-18)](https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization).
- 지금 쓰는 클라이언트(Claude Code·Codex·Cursor·Gemini CLI)는 모두 설정 파일에 고정 헤더(`Authorization: Bearer …`)를 넣는다. 정적 토큰으로 이미 동작한다.
- Claude 커넥터(claude.ai·Desktop·mobile)는 OAuth 2.0(DCR·CIMD, PKCE S256 필수), **정적 헤더(`static_headers`, 베타·일부 조직만)**, 무인증을 받는다. `client_credentials` 는 받지 않는다. Anthropic 의 나가는 트래픽은 `160.79.104.0/21` 이다 — [Authentication for connectors](https://claude.com/docs/connectors/building/authentication.md).
- 주 용도는 단일 사용자 자가 호스팅이다. 운영 인스턴스는 루프백(`127.0.0.1:9001`)에만 게시하고, 운영 토큰 2개는 agent 바인딩이 없다.

## Decision

**C안: OAuth 는 구현하지 않는다.** 원격 접속은 TLS 를 끝내는 리버스 프록시·터널 뒤에 두고, memento 인증은 지금의 스코프드 토큰을 그대로 쓴다. 노출 방법은 [원격 MCP 접속 가이드](../guides/ko/remote-mcp-access.md)에 적는다.

- 프록시·터널은 전송 암호화와 네트워크 접근 제어(Tailscale tailnet, IP allowlist 등)를 맡는다.
- memento 는 계속 `tools:invoke` 스코프 토큰을 검사한다. 프록시 인증이 뚫려도 토큰 없이 `/mcp` 를 부를 수 없다.
- 클라이언트·agent 마다 토큰을 따로 발급하고 `agent_id` 를 묶으면(#1258) owner 경계(#1287)가 원격에서도 그대로 걸린다.

## Decision Drivers

| 기준 | A. 외부 IdP 위임 | B. 내장 Authorization Server | C. 프록시 + 정적 토큰 |
|---|---|---|---|
| 단일 사용자 자가 호스팅 적합 | IdP 를 따로 운영·구독해야 함 | 사용자 1명에 AS 전체 | 맞음 |
| 지금 클라이언트 지원 | 대부분 OAuth 지원, 설정이 늘어남 | 동일 | 이미 동작 |
| 토큰 → agent 바인딩(#1287) 연결 | `sub`/`client_id` → agent 매핑 필요 | 직접 매핑 | 토큰 항목의 `agent_id` 그대로 |
| 구현·유지 비용 | PRM(RFC 9728) + JWT 검증(aud·iss·exp) + 401 `WWW-Authenticate` | DCR·PKCE·refresh rotation·동의 화면·키 관리까지 직접 — 보안 핵심 코드를 떠안음 | 문서만 |

B 는 버렸다. 사용자가 사실상 한 명인 서버에 보안 핵심인 Authorization Server 를 직접 만들고 유지할 이유가 없다. A 는 아래 조건이 생길 때의 이행 경로로 남긴다.

## Revisit — A 로 옮기는 조건

다음 중 하나가 생기면 A(외부 IdP + memento = Resource Server) 구현 이슈를 만든다.

1. `static_headers` 가 없는 조직에서 claude.ai·Claude mobile 커넥터로 붙여야 한다 (이 클라이언트들은 정적 헤더 없이는 OAuth 나 무인증만 받는다. 무인증은 선택지가 아니다).
2. 여러 사람이 각자 계정으로 한 인스턴스를 쓴다 — 공유 토큰으로는 사람을 구분할 수 없다.

A 의 범위 메모: `/.well-known/oauth-protected-resource` 제공, 인증 실패 시 `401` + `WWW-Authenticate: Bearer resource_metadata=…`, JWT 의 `aud` 가 memento URL 인지 검증(토큰 passthrough 금지), 검증된 subject 를 `ToolContext.boundAgentId` 로 매핑. 정적 토큰은 로컬 클라이언트용으로 병행한다.

## Consequences

- 코드 변경 없음. 원격 노출은 운영자가 프록시를 고르고 설정하는 운영 작업이다.
- claude.ai 커넥터는 조직에 `static_headers` 가 열려 있을 때만 붙는다. 그 경우 클라이언트가 Anthropic 망에서 오므로 tailnet 안에 둘 수 없고, 공개 HTTPS 엔드포인트 + `160.79.104.0/21` allowlist 가 필요하다.
- Cloudflare Access 같은 SSO 게이트는 사람용 로그인이라 헤더만 보내는 MCP 클라이언트 앞에 두면 막힌다. 서비스 토큰·IP 규칙으로 예외를 두거나, tailnet 처럼 네트워크 단에서 거른다.
