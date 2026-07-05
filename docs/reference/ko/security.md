# 보안 참고 (Security Notes)

## HTTP API 인증·인가

- **현재 상태**: HTTP 서버는 **분리된 신뢰 모델**을 사용합니다. `/auth/session`은 쿠키 기반 브라우저 세션을 시작합니다. `/admin/*`, `/api/*`는 해당 브라우저 세션이 필요합니다. `/api/v1/quality/*`, `/tools/*`, `/mcp`, `/messages`는 `Authorization: Bearer <ADMIN_API_KEY>` 또는 `X-API-Key: <ADMIN_API_KEY>`가 필요합니다.
- **권장 사용**: 특별한 이유가 없다면 HTTP 서버는 **루프백 또는 내부망**에만 두세요. 브라우저 대시보드/그래프는 서버와 동일 출처에서 열어 세션 쿠키가 다른 오리진으로 퍼지지 않게 유지하세요.
- **운영 환경**: `ADMIN_API_KEY`를 설정하고, 의도적으로 노출하는 경우가 아니면 `MEMENTO_HTTP_BIND_HOST`를 루프백으로 유지하세요. `/api/v1/quality`, `/tools/*`, `/mcp`, `/messages`는 키 기반 프로그램용 표면이며, `/admin/*`, `/api/*`는 브라우저 세션 전용입니다.
- **브라우저 비밀 처리**: 서버는 브라우저 자산에 `ADMIN_API_KEY`를 전달하지 않습니다. 운영자는 `/auth/session`으로 로그인하고, 서버는 입력된 키를 HTTP-only 세션 쿠키로 교환합니다. `/dashboard`가 권장 진입점이며, `/graph`를 직접 열어도 같은 세션 모델로 로그인/재인증할 수 있습니다. 브라우저 세션이 생긴 뒤에만 그래프 화면이 열립니다. 두 정적 페이지 모두 키를 JavaScript로 부트스트랩하지 않습니다.
- **CORS**: `CORS_ALLOWED_ORIGINS` 환경 변수로 허용 오리진을 제한할 수 있습니다. 비어 있으면 크로스 오리진 요청을 허용하지 않습니다.

## HTTP programmatic 감사 로그 (JSONL)

- **범위**: `/tools/*`, `/api/v1/agent/*`, `/api/v1/quality/*`, 보호된 MCP HTTP 경로(`/mcp`, `/messages`)의 programmatic 호출을 **best-effort**로 JSONL에 기록합니다.
- **기본 경로**: `MEMENTO_HTTP_AUDIT_LOG_PATH` 미설정 시 DB 파일과 같은 디렉터리의 `http-audit.jsonl` (`{dirname(DB_PATH)}/http-audit.jsonl`).
- **필드 계약**: `{ ts, key_id, route, tool, owner_id, agent_id, latency_ms, status }` — #660 hash-chained audit과 병합 가능하도록 동일 키를 사용합니다 (#660에서 `previous_hash`/`current_hash`·`transport`·`action` 확장 예정).
- **key_id**: `req.programmaticAuth.keyId`(향후 #662 API 키 테이블) 우선, 없으면 Bearer/X-API-Key 자격 증명 SHA-256 접두(12자), 비표준 `Authorization`은 `legacy-key`, 브라우저 세션 쿠키는 `session`, 그 외 `anonymous`.
- **정책**: 기본 `MEMENTO_HTTP_AUDIT_MODE=best-effort` — append 실패 시 stderr 경고만 하고 요청은 계속 처리합니다. `strict`는 #660 통합 시 audit 실패 시 거절용으로 예약되어 있습니다.
- **owner_id / agent_id**: 요청 body의 `owner_id`·`agent_id`, 헤더 `X-Agent-Id`, ToolContext(`agentId`)에서 best-effort 추출합니다.

## HTTP rate limit

- **버킷**: `/tools/*`와 `/admin/*`는 **별도** 한도입니다 (`express-rate-limit`, 15분 고정 창).
- **기본값**: tools 100회/15분, admin 30회/15분.
- **환경 변수**: `MEMENTO_HTTP_RATE_LIMIT_TOOLS`, `MEMENTO_HTTP_RATE_LIMIT_ADMIN` (정수, 창당 최대 요청 수). `MEMENTO_HTTP_RATE_LIMIT_DISABLED=1` 또는 `NODE_ENV=test`면 비활성화.
- **429 응답**: 초과 시 `429 Too Many Requests`와 `Retry-After`(초) 헤더를 반환합니다.
