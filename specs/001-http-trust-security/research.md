# Research: 네트워크 서비스 신뢰·보안 강화

**Branch**: 001-http-trust-security  
**Date**: 2026-03-19

## R-1: 민감 라우트 인증 기본 정책

**Decision**: 운영 배포에서 **비루프백 인터페이스에 바인딩**할 때는 `ADMIN_API_KEY`(또는 동등 설정) **미설정 시 서버 기동 실패(또는 민감 라우트 완전 비활성화)**를 기본으로 한다. **적용 대상**: **풀 HTTP 서버**(`http-server.ts`)처럼 `/admin`, `/api`, `/api/v1/quality` 등 **민감 라우트를 실제로 마운트하는 프로세스**. **`startSimpleMcpServer()`**( `/mcp`, `/messages`, `/health` 만 제공)는 해당 라우트가 없으므로 동일한 **ADMIN_API_KEY·비루프백 기동 차단**을 적용하지 않는다(원격 바인딩 시 **경고 로그**로 운영자 인지만 유도). **루프백 판별**: IPv4는 RFC 1122의 **127.0.0.0/8 전체**(예: `127.0.0.1`, `127.0.1.1`), IPv6는 `::1`, 호스트명은 `localhost`, IPv4-mapped는 `::ffff:127.x.x.x`를 로컬(비원격)로 간주한다. 명시적 `MEMENTO_ALLOW_INSECURE_HTTP_ADMIN=true` 같은 **문서화된 개발용 옵션**으로만 예외를 허용한다.

**Rationale**: 현재는 키가 비어 있으면 `createAdminAuthMiddleware`가 인증을 통과시켜 무인증 노출이 가능하다. 스펙 FR-001/SC-001은 무자격 성공 0%를 요구하므로, “설정 안 하면 열림” 모델과 충돌한다.

**Alternatives considered**:

- **A**: 키 없으면 현행 유지(하위 호환 최우선) — 스펙 대비 보안 공백 지속.
- **B**: 경고 로그만 — 운영자가 놓치기 쉬움.
- **C**: 항상 키 필수 — 로컬 단일 개발자 UX 저하; 루프백 예외로 완화.

## R-2: 브라우저 교차 출처(MCP SSE 등)

**Decision**: `Access-Control-Allow-Origin: *`를 쓰는 MCP 전송 경로는 **`CORS_ALLOWED_ORIGINS`와 정합**되게 조정한다. 허용 목록이 비어 있으면 브라우저 크로스 오리진은 거부(또는 same-origin만)하고, 허용 오리진이 있으면 그 목록에 대해서만 반사(reflect)한다. **반사형 ACAO**를 쓰는 응답에는 HTTP **`Vary: Origin`** 을 포함해, 중간 캐시/CDN이 한 `Origin`에 대한 응답을 다른 `Origin` 클라이언트에 재사용하지 않도록 한다. `simple-mcp-server`는 `cors()` 무조건 사용을 피하고 메인 서버와 동일 정책을 공유한다.

**Rationale**: 메인 `http-server`는 이미 `cors` 미들웨어로 빈 목록 시 크로스 오리진 비허용. MCP 라우트 수준 헤더만 `*`이면 공격면이 남는다.

**Alternatives considered**:

- **A**: MCP만 예외 유지 — 스펙 P2와 불일치.
- **B**: 역프록시에서만 CORS 해제 — 배포 의존만으로는 라이브러리 단독 실행 시 공백.

## R-3: 품질 HTML 리포트 XSS

**Decision**: `quality-reporter.ts`는 대부분의 텍스트에 `escapeHtml`을 적용 중이다. 구현에서는 (1) **HTML에 삽입되는 모든 동적 문자열**을 감사하여 누락 분을 보완하고, (2) **`class` 등 속성값**은 enum/allowlist에서만 선택해 사용자 입력이 속성을 탈출하지 못하게 한다. (3) **회귀 테스트**: 악성 `namespace`/`metric_key`/`context` 문자열을 DB 또는 픽스처에 넣고 HTML에 `<script`·이벤트 핸들러·속성 탈출 패턴이 원문 그대로 출력되는지 검증한다.

**Rationale**: 보안 리뷰에서 지적된 HTML 보간 위험에 대응. 이스케이프만으로 부족한 속성 맥락은 allowlist로 보강.

**Alternatives considered**:

- **A**: 외부 템플릿 엔진 도입 — 의존성 증가; 현 단계 YAGNI.
- **B**: HTML 대신 JSON만 공식 지원 — 스펙의 웹 보고서 요구와 충돌.

## R-4: 검증·회귀 (FR-006)

**Decision**: (1) 관리/품질 라우트에 대한 **통합 테스트**: 키 없음/틀림/정상. (2) CORS: `Origin` 헤더 시뮬레이션. (3) 품질 HTML: 문자열 스냅샷 또는 DOM 파싱 없이 “위험 패턴 미포함” assert. CI 기존 `npm test`에 포함.

**Rationale**: 스펙의 반복 검증 요구를 자동화로 충족.

## R-5: 문서·온보딩 (SC-004)

**Decision**: `env.example` 및 `quickstart.md`에 “원격 노출 시 필수: `ADMIN_API_KEY`, `CORS_ALLOWED_ORIGINS`” 체크리스트와 15분 이내 따라 할 수 있는 순서를 명시한다.

**Rationale**: 측정 가능한 온보딩 기준 충족.

## R-6: 프로그래밍 방식 기동과 `process.exit`

**Decision**: `startServer()`, `startSseServer()`, `startSimpleMcpServer()` 등 **모듈로 임포트되어 호출되는 기동 API**는 바인드·자격 설정 위반 시 **`process.exit`로 호스트 프로세스를 종료하지 않고**, `MementoHttpSecurityStartupError`(또는 초기화 실패 시 동일하게 **거부된 Promise / throw**)로 호출자에게 전달한다. **프로세스 종료(exit)**는 CLI 전용 진입점이 필요할 때만 수행한다.

**Rationale**: 임베딩·테스트·래퍼가 서버를 서브프로세스가 아닌 동일 프로세스에서 기동할 때, 기동 실패를 catch하여 복구·리포트할 수 있어야 한다.

## R-7: 풀 HTTP 서버 기동 순서·실패 시 정리

**Decision**: `startServer()`는 **DB·코어·백그라운드 스케줄러 기동 전에** `validateConfig` 및 **비루프백+ADMIN_API_KEY** 정책(`getMementoHttpSecurityStartupViolationMessage`)을 검사한다. `initializeServer()`가 실패하면 **`cleanup()`으로 WAL/스케줄러/DB 등을 정리**한 뒤 예외를 전파한다. `cleanup()`이 끝나면 **재시도 가능하도록** 정리 락 플래그를 해제한다.

**Rationale**: 보안 검사를 초기화 이후에만 수행하면 위반 시에도 코어가 이미 열려 타이머·핸들이 남고, 임베딩/테스트 프로세스가 깔끔히 종료되지 않을 수 있다.

## R-8: 기본 바인드 주소·IPv6 표기

**Decision**: `MEMENTO_HTTP_BIND_HOST` 미설정 시 **기본값은 `127.0.0.1`**(루프백)으로 한다. 과거 `0.0.0.0` 기본은 ADMIN 가드와 결합 시 **키 없이 기동 불가**가 되어 신규 클론·`npm run dev:http` 등이 깨지므로, **안전하고 문서 플로우와 호환되는 기본**으로 맞춘다. 모든 인터페이스 노출이 필요하면 **`0.0.0.0`/`::` + `ADMIN_API_KEY`(또는 문서화된 insecure)** 를 **명시**한다. 환경 변수에 **URL 스타일 IPv6** `[::1]` 을 쓴 경우, **루프백 판별**에는 그대로 두고 **`server.listen(port, host)` 에 넘기기 전에** 대괄호를 제거해 `::1` 형태로 정규화한다(Node `getaddrinfo` 호환). 로그·URL 표시에는 IPv6를 다시 `[::1]` 형태로 쓴다.

**Rationale**: 보안 정책(비루프백 시 키 필수)과 개발자 경험(클론 즉시 기동)을 동시에 만족시키고, 루프백 허용과 실제 소켓 바인드 실패의 모순을 제거한다.
