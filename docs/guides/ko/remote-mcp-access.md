# 원격 MCP 접속 가이드

memento 는 OAuth 를 구현하지 않습니다. 다른 기기나 원격 클라이언트에서 `/mcp` 를 쓰려면 TLS 를 끝내는 리버스 프록시·터널 뒤에 두고, 인증은 스코프드 API 토큰(`MEMENTO_API_TOKENS`)으로 합니다. 결정 근거는 [ADR #1343](../../adr/2026-10-13-issue-1343-remote-mcp-auth.md)에 있습니다.

## 원칙

- **memento 는 루프백에 둡니다.** Docker 기본값(`MCP_PUBLISH_HOST=127.0.0.1`)을 바꾸지 말고, 같은 호스트의 프록시가 `127.0.0.1:9001` 로 넘기게 합니다. `MCP_PUBLISH_HOST=0.0.0.0` 은 평문 HTTP 를 LAN 에 여는 것이라 쓰지 않습니다.
- **TLS 는 프록시가 맡습니다.** 토큰이 매 요청 헤더에 실리므로 원격 구간은 반드시 HTTPS 입니다.
- **토큰은 클라이언트마다 하나씩, `agent_id` 를 묶어 발급합니다.** 바인딩된 토큰은 그 agent 의 기억만 다룹니다(#1287). 토큰 하나가 새도 그 토큰만 빼면 됩니다.
- **토큰을 URL 에 넣지 않습니다.** `Authorization: Bearer <secret>` 헤더로만 보냅니다.

## 1. 토큰 발급

`.env` 의 `MEMENTO_API_TOKENS` 에 원격 클라이언트용 항목을 추가합니다. 원격에는 `tools:invoke` 만 줍니다.

```json
[
  { "id": "laptop-claude-code", "secret": "<openssl rand -hex 32>", "scopes": ["tools:invoke"], "agent_id": "laptop" }
]
```

기존 기억은 `owner_id` 가 비어 있어 `agent_id` 를 묶은 토큰으로는 보이지 않습니다. 같은 기억을 원격에서도 봐야 하면 `agent_id` 없이 발급하고, 그 대신 아래 네트워크 제한을 꼭 겁니다. 토큰을 바꾼 뒤에는 컨테이너를 다시 띄웁니다(`.env` 를 셸에서 `source` 하지 마세요 — 따옴표가 벗겨져 파싱 에러에 secret 이 찍힙니다).

## 2. 노출 방법 고르기

| 방법 | 맞는 경우 | 네트워크 제한 |
|---|---|---|
| **Tailscale `serve`** (권장) | 내 기기들에서만 쓴다 | tailnet 밖에서는 닿지 않음 |
| 리버스 프록시(Caddy·nginx) + 공개 도메인 | tailnet 에 못 넣는 클라이언트(claude.ai 커넥터 등) | IP allowlist 필수 |
| Cloudflare Tunnel | 공인 IP·포트 개방 없이 공개 도메인이 필요하다 | WAF IP 규칙. Access(SSO 로그인)는 헤더만 보내는 MCP 클라이언트를 막으므로 서비스 토큰이나 IP 규칙으로 예외를 둔다 |

### Tailscale serve

```bash
tailscale serve --bg 9001
# → https://<host>.<tailnet>.ts.net 이 127.0.0.1:9001 로 프록시된다
```

클라이언트 설정(Claude Code 예):

```bash
claude mcp add --transport http memento https://<host>.<tailnet>.ts.net/mcp \
  --header "Authorization: Bearer <secret>"
```

### 공개 리버스 프록시 (Caddy 예)

```caddy
memento.example.com {
  @allowed remote_ip 160.79.104.0/21 203.0.113.10
  handle @allowed {
    reverse_proxy 127.0.0.1:9001
  }
  respond 403
}
```

- `160.79.104.0/21` 은 Anthropic 의 나가는 트래픽 대역입니다. claude.ai 커넥터를 붙일 때만 넣습니다.
- claude.ai·Claude mobile 커넥터는 조직에 **Request headers(`static_headers`, 베타)** 가 열려 있어야 정적 토큰을 보냅니다. 없으면 OAuth 가 필요해 지금 memento 로는 붙지 않습니다 — ADR 의 "A 로 옮기는 조건" 참고.

## 3. 프록시 뒤 설정

| 설정 | 값 | 이유 |
|---|---|---|
| `MEMENTO_TRUST_PROXY` | `loopback` (같은 호스트 프록시) | 미인증 요청의 rate limit 키가 프록시 IP 하나로 뭉치지 않게. `true` 는 쓰지 않습니다 |
| `CORS_ALLOWED_ORIGINS` | 비워 둠 | CLI·에이전트 클라이언트는 `Origin` 을 보내지 않아 그대로 통과합니다. 브라우저에서 `/mcp` 를 부를 때만 그 오리진을 넣습니다 |
| `MEMENTO_HTTP_RATE_LIMIT_MCP` | 기본 1500/15분 | 여러 기기가 같은 토큰을 쓰면 429 가 나기도 합니다. 토큰을 나누거나 값을 올립니다 |

새 env 키는 `docker-compose.base.yml` 화이트리스트에 있어야 컨테이너로 넘어갑니다.

## 4. 확인

```bash
curl -s https://<원격 주소>/health                         # 200
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<원격 주소>/mcp   # 토큰 없이 401
```

원격 호출은 감사 로그(`/api/v1/audit/entries`, `admin:destructive` 스코프)에 토큰 `key_id` 로 남습니다. 모르는 `key_id` 가 보이면 그 토큰을 `MEMENTO_API_TOKENS` 에서 빼고 재배포합니다.
