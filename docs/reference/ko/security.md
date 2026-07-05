# 보안 참고 (Security Notes)

## HTTP API 인증·인가

- **현재 상태**: HTTP 서버는 **분리된 신뢰 모델**을 사용합니다. `/auth/session`은 쿠키 기반 브라우저 세션을 시작합니다. `/admin/*`, `/api/*`는 해당 브라우저 세션이 필요합니다. `/api/v1/quality/*`, `/tools/*`, `/mcp`, `/messages`는 `Authorization: Bearer <ADMIN_API_KEY>` 또는 `X-API-Key: <ADMIN_API_KEY>`가 필요합니다.
- **권장 사용**: 특별한 이유가 없다면 HTTP 서버는 **루프백 또는 내부망**에만 두세요. 브라우저 대시보드/그래프는 서버와 동일 출처에서 열어 세션 쿠키가 다른 오리진으로 퍼지지 않게 유지하세요.
- **운영 환경**: `ADMIN_API_KEY`를 설정하고, 의도적으로 노출하는 경우가 아니면 `MEMENTO_HTTP_BIND_HOST`를 루프백으로 유지하세요. `/api/v1/quality`, `/tools/*`, `/mcp`, `/messages`는 키 기반 프로그램용 표면이며, `/admin/*`, `/api/*`는 브라우저 세션 전용입니다.
- **브라우저 비밀 처리**: 서버는 브라우저 자산에 `ADMIN_API_KEY`를 전달하지 않습니다. 운영자는 `/auth/session`으로 로그인하고, 서버는 입력된 키를 HTTP-only 세션 쿠키로 교환합니다. `/dashboard`가 권장 진입점이며, `/graph`를 직접 열어도 같은 세션 모델로 로그인/재인증할 수 있습니다. 브라우저 세션이 생긴 뒤에만 그래프 화면이 열립니다. 두 정적 페이지 모두 키를 JavaScript로 부트스트랩하지 않습니다.
- **CORS**: `CORS_ALLOWED_ORIGINS` 환경 변수로 허용 오리진을 제한할 수 있습니다. 비어 있으면 크로스 오리진 요청을 허용하지 않습니다.

## 다중 에이전트 owner scope (HTTP)

- **`/tools/recall`·`/tools/memory_injection`**: 기본 `MEMENTO_OWNER_SCOPE_MODE=strict` — `owner_id` 미지정 시 `X-Memento-Agent-Id` 또는 `MEMENTO_HTTP_DEFAULT_AGENT_ID`로 자동 필터. 식별자가 없으면 **400**.
- **레거시 opt-out**: `owner_id = NULL` 데이터를 HTTP recall에서 전역 조회하려면 `MEMENTO_OWNER_SCOPE_MODE=warn`(경고만) 또는 `off`(강제 없음)로 완화하세요. 상세: [`docs/guides/ko/multi-agent-usage.md`](../../guides/ko/multi-agent-usage.md).
