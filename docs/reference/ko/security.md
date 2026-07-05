# 보안 참고 (Security Notes)

## HTTP API 인증·인가

- **현재 상태**: HTTP 서버는 **분리된 신뢰 모델**을 사용합니다.
  - `/auth/session` — 쿠키 기반 브라우저 세션 시작
  - `/admin/*`, `/api/*` — **브라우저 세션이 필요합니다**
  - `/tools/*`, `/mcp`, `/messages`, `/api/v1/agent` — **`tools:invoke` 스코프** 토큰 (`Authorization: Bearer` 또는 `X-API-Key`)
  - `/api/v1/quality/*` — **`admin:destructive` 스코프** 토큰 (programmatic quality API)
- **스코프드 토큰 (`MEMENTO_API_TOKENS`)**: JSON 배열로 여러 키를 설정합니다. 예:
  ```json
  [
    { "id": "agent-tools", "secret": "<hex>", "scopes": ["tools:invoke"] },
    { "id": "ops-admin", "secret": "<hex>", "scopes": ["admin:destructive", "tools:invoke"] }
  ]
  ```
  `tools:invoke`만 있는 토큰은 quality API에 **403 Forbidden** 됩니다.
- **Legacy `ADMIN_API_KEY`**: `MEMENTO_API_TOKENS`가 없을 때만 synthetic `legacy-admin` 토큰(양쪽 스코프)으로 동작하며, 기동 시 deprecation 경고가 1회 기록됩니다. 신규 배포는 `MEMENTO_API_TOKENS`로 이전하세요.
- **권장 사용**: 특별한 이유가 없다면 HTTP 서버는 **루프백 또는 내부망**에만 두세요. 브라우저 대시보드/그래프는 서버와 동일 출처에서 열어 세션 쿠키가 다른 오리진으로 퍼지지 않게 유지하세요.
- **운영 환경**: programmatic 접근에는 스코프드 토큰을 사용하고, 의도적으로 노출하는 경우가 아니면 `MEMENTO_HTTP_BIND_HOST`를 루프백으로 유지하세요.
- **브라우저 비밀 처리**: 서버는 브라우저 자산에 API secret을 전달하지 않습니다. 운영자는 `/auth/session`으로 로그인하고(legacy `ADMIN_API_KEY` 또는 admin 스코프 secret), 서버는 HTTP-only 세션 쿠키로 교환합니다. **`/dashboard`가 권장 진입점**이며, **`/graph`를 직접 열어도 같은 세션 모델로 로그인/재인증**할 수 있습니다. **브라우저 세션이 생긴 뒤에만 그래프 화면이 열립니다.** 두 정적 페이지 모두 secret을 JavaScript로 부트스트랩하지 않습니다.
- **CORS**: `CORS_ALLOWED_ORIGINS` 환경 변수로 허용 오리진을 제한할 수 있습니다. 비어 있으면 크로스 오리진 요청을 허용하지 않습니다.

## 다중 에이전트 owner scope (HTTP)

- **`/tools/recall`·`/tools/memory_injection`**: 기본 `MEMENTO_OWNER_SCOPE_MODE=strict` — `owner_id` 미지정 시 `X-Memento-Agent-Id` 또는 `MEMENTO_HTTP_DEFAULT_AGENT_ID`로 자동 필터. 식별자가 없으면 **400**.
- **레거시 opt-out**: `owner_id = NULL` 데이터를 HTTP recall에서 전역 조회하려면 `MEMENTO_OWNER_SCOPE_MODE=warn`(경고만) 또는 `off`(강제 없음)로 완화하세요. 상세: [`docs/guides/ko/multi-agent-usage.md`](../../guides/ko/multi-agent-usage.md).
