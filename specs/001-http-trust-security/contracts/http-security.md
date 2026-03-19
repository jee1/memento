# Contract: HTTP 민감 라우트 보안

**소비자**: 운영자, 자동화 클라이언트, 브라우저 기반 도구  
**제공자**: Memento HTTP 서버 (`packages/memento-server`)

## 보호 대상 경로 (현행 코드 기준)

다음 접두사는 **보호 정책 활성화 시** 유효 자격 없이 성공 응답을 받아서는 안 된다.

| Prefix | 용도 |
|--------|------|
| `/admin` | 관리·운영 API |
| `/api` | 일반 API (민감 조작 포함 시) |
| `/api/v1/quality` | 품질 리포트·임계값·메트릭 |

`/health`, 정적 `/dashboard`, `/tools` 등은 본 스펙 범위 밖으로 둘 수 있으나, 스펙 확장 시 목록을 문서에 갱신한다.

## 자격 증명 (클라이언트 → 서버)

클라이언트는 다음 중 하나로 동일 비밀을 전달한다.

- 헤더 `Authorization: Bearer <secret>`
- 헤더 `X-API-Key: <secret>`

**실패 시**: HTTP 401, 본문에 성공으로 오해하지 않는 메시지(현행 JSON `error`/`message` 형태 유지).

## CORS (브라우저)

- 서버는 **허용 출처 목록**이 비어 있지 않을 때만 해당 `Origin`에 대해 크로스 오리진 자격 증명/읽기를 허용한다.
- MCP SSE 등 **수동 `Access-Control-*` 헤더**를 쓰는 엔드포인트는 위 목록과 **동일한 정책**을 따른다; 운영 기본값으로 `*` 반사를 사용하지 않는다.
- 위 수동 경로에서 **`Access-Control-Allow-Origin`을 요청 `Origin`에 따라 반사**할 때는, 공유 캐시·리버스 프록시가 오리진별 응답을 혼동하지 않도록 응답에 **`Vary: Origin`** 을 포함한다(허용 목록이 비어 있어 반사가 일어나지 않는 경우는 제외).

## 품질 HTML 응답

- 사용자·운영자가 저장한 식별자·문자열이 HTML에 포함될 때, 뷰어 브라우저에서 **실행 가능한 마크업으로 해석되지 않아야** 한다(이스케이프 + 속성 allowlist).

## 버전 호환

- 기존 클라이언트: 키 미설정 배포에 의존했다면, 마이그레이션 기간 동안 문서화된 환경 플래그(예: 루프백 전용)로 전환 경로를 제공한다.

## 프로그래밍 기동 API (라이브러리·임베딩)

- `packages/memento-server`에서 export되는 HTTP/SSE/simple-MCP **기동 함수**는 (해당 서버에 적용되는 정책상) 설정 위반 시 **`process.exit`를 호출하지 않는다**. 풀 HTTP 서버의 대표 예: 비루프백 바인드인데 `ADMIN_API_KEY` 없음 → `MementoHttpSecurityStartupError`.
- 호출자는 **거부된 `Promise`** 또는 `MementoHttpSecurityStartupError`(`code`: `MEMENTO_HTTP_SECURITY_STARTUP`)를 처리할 수 있어야 한다.
- **CLI/바이너리** 전용 진입점에서만 프로세스 종료(exit 코드 1)로 사용자에게 실패를 알릴 수 있다.

### 민감 라우트 기동 가드의 적용 범위

- **`startServer()` / `startSseServer()`**(풀 HTTP 스택): `/admin`, `/api`, `/api/v1/quality`를 마운트하므로 **비루프백 바인드 시 `ADMIN_API_KEY`(또는 문서화된 insecure 플래그)** 정책을 적용한다.
- **`startSimpleMcpServer()`**: 위 민감 접두사를 **제공하지 않으므로** 동일한 **기동 차단**을 적용하지 않는다. 원격 바인딩 시 **경고 로그**로 노출 범위를 알린다.

### 기동 순서·래퍼 상태

- 풀 HTTP 서버는 **코어/DB 초기화 전에** 구성·보안 검사를 수행하고, 초기화 실패 시 **`cleanup()`**으로 리소스를 정리한 뒤 예외를 전달한다.
- `SseServer` 등 래퍼는 기동 `Promise`가 **거부되면** “이미 실행 중” 플래그를 **되돌려** 재시도 가능해야 한다.

### 기본 바인드·IPv6 (`MEMENTO_HTTP_BIND_HOST`)

- **미설정 시 기본값**: `127.0.0.1`. 원격 인터페이스(`0.0.0.0`, `::`, 사설 IP 등)는 **명시**하고, 풀 HTTP 서버는 **`ADMIN_API_KEY` 또는 문서화된 insecure**와 함께 쓴다.
- **`[::1]` 표기**: 정책(루프백 여부) 판단에는 허용하되, 실제 **`listen` 호스트 인자**는 `::1` 등 Node가 수용하는 형태로 **정규화**한다. URL·로그용 문자열은 IPv6에 **대괄호**를 포함할 수 있다.
