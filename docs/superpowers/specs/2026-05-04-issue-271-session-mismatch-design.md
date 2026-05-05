# 설계: 이슈 #271 — MCP 세션 불일치 로그 재분류

**상태**: 구현 전 검토용  
**날짜**: 2026-05-04  
**이슈**: [GitHub #271](https://github.com/jee1/memento/issues/271)

---

## 1. 목표·비목표

**목표**

- `POST /messages?sessionId=...` 호출 시 활성 SSE transport가 없더라도, 이를 항상 운영 장애로 기록하지 않도록 로그 의미를 바로잡는다.
- HTTP 계약은 유지한다. 즉, 없는 세션에 대한 응답은 계속 `404 Session not found`로 둔다.
- 회귀 테스트를 추가해 `unknown/stale session`과 실제 서버 장애 로그가 다시 섞이지 않도록 한다.

**비목표**

- `log-issue-monitor`의 일반 승격 정책 자체를 이번 이슈에서 재설계하지 않는다.
- MCP SSE 프로토콜을 streamable HTTP 단일 경로로 완전히 대체하지 않는다.
- 세션 저장 방식, 세션 TTL, 재시도 정책 같은 클라이언트 동작까지 이번 이슈 범위에 포함하지 않는다.

---

## 2. 문제 정의

현재 MCP HTTP 라우터는 다음 두 경로를 함께 제공한다.

- `GET /mcp`: SSE 스트림을 열고 서버가 생성한 `sessionId`를 `event: endpoint`로 전달
- `POST /messages?sessionId=...`: 해당 `sessionId`에 연결된 SSE transport를 통해 JSON-RPC 응답을 스트림으로 돌려줌

문제는 [mcp.routes.ts](../../../packages/memento-server/src/server/routes/mcp.routes.ts) 에서 세션이 없을 때 현재 동작이 다음과 같다는 점이다.

- HTTP 응답: `404 Session not found`
- 애플리케이션 로그: `logger.error('No active transport found for session ID', { sessionId })`

한편 [detectors.ts](../../../scripts/log-issue-monitor/detectors.ts)는 모든 `error` 레벨 앱 로그를 즉시 운영 이슈 후보로 본다. 이 조합 때문에 실제 서버 장애가 아닌 다음 케이스도 GitHub 이슈로 승격된다.

- 클라이언트가 이미 종료된 SSE 세션으로 `/messages`를 재호출
- 잘못된 세션 ID를 수동 또는 테스트 코드가 호출
- 외부 호출자가 MCP 세션 핸드셰이크 없이 `/messages`를 직접 호출

이번 이슈의 로그에 남은 `sessionId`가 `session_<timestamp>_<suffix>` 형식이 아닌 `test123`라는 점도, 실제 정상 세션 만료보다는 잘못된 호출 쪽 가능성을 높인다.

---

## 3. 원인 요약

근본 원인은 서버 동작과 모니터링 의미의 경계가 어긋난 데 있다.

- 서버 관점에서 `unknown session`은 대체로 **클라이언트 상태 불일치** 또는 **잘못된 사용**이다.
- 모니터 관점에서 `error` 레벨은 **운영 장애 후보**다.

즉, 서버는 클라이언트 입력 오류를 `error`로 기록하고 있고, 모니터는 그 분류를 신뢰해 운영 장애로 승격하고 있다. 이 경계가 잘못 설정되어 있다.

---

## 4. 접근안 비교

| 안 | 요약 | 장점 | 단점 | 판단 |
|----|------|------|------|------|
| A | `log-issue-monitor`에서 특정 메시지를 승격 제외 | 변경 범위가 작음 | 모니터가 앱 로그 의미를 보정해야 함 | 비채택 |
| B | `mcp.routes.ts`에서 `unknown session`을 비장애 로그로 재분류하고 404는 유지 | 서버 의미와 모니터 의미가 일치 | 로그 문구/테스트 조정 필요 | **채택** |
| C | B + 모니터에 404성 세션 미스매치 별도 집계 추가 | 운영 가시성 향상 | 이번 이슈 범위를 넘김 | 후속 후보 |

이번 이슈는 B로 해결하고, C는 필요하면 후속 이슈로 분리한다.

---

## 5. 설계

### 5.1 변경 원칙

- **HTTP 계약 유지**: 잘못된 `sessionId`는 계속 `404`
- **로그 의미 조정**: 서버 fault와 클라이언트 state mismatch를 분리
- **모니터 우회가 아니라 원인 계층 수정**: detector 예외 규칙보다 앱 로그 의미를 먼저 바로잡는다

### 5.2 서버 라우터 변경

대상: [mcp.routes.ts](../../../packages/memento-server/src/server/routes/mcp.routes.ts)

`transport`가 없는 분기에서 다음과 같이 조정한다.

- `logger.error('No active transport found for session ID', { sessionId })` 제거
- `warn` 또는 `info` 수준의 구조화 로그로 대체
- 메시지는 장애처럼 읽히지 않게 바꾼다

권장 형태:

- 메시지: `MCP message received for inactive or unknown session`
- 필드:
  - `sessionId`
  - `reason: 'inactive_session'`
  - 필요 시 `method`

이 설계의 목적은 “문제가 있었다”는 사실을 숨기는 것이 아니라, 그 문제를 **운영 장애**가 아니라 **잘못된 세션 호출**로 분류하는 것이다.

### 5.3 유지할 에러 로그

다음은 계속 `error`로 남긴다.

- `sessionId`는 존재하지만 실제 `processMcpMessage` 처리 중 예외 발생
- SSE 응답 쓰기 실패
- SSE 연결 수립 실패

즉, 서버 내부 상태나 처리 실패는 `error`, 세션 미존재는 `warn/info`로 분리한다.

---

## 6. 테스트 설계

### 6.1 필수 회귀 테스트

대상 후보:

- [mcp.routes.streamable-http.spec.ts](../../../packages/memento-server/src/server/mcp.routes.streamable-http.spec.ts)
- 또는 라우터 단위 스펙 파일

추가 케이스:

- `GET /mcp`를 열지 않은 상태에서 `POST /messages?sessionId=test123`
- 기대값:
  - 응답 코드 `404`
  - 응답 본문 `Session not found`

이 테스트는 HTTP 계약을 고정한다.

### 6.2 로그 분류 테스트

가능하면 같은 테스트 또는 더 작은 단위 테스트에서 로거를 스파이해 다음을 검증한다.

- `unknown session` 케이스에서 `logger.error`가 호출되지 않음
- 새 구조화 로그가 `warn` 또는 `info`로 호출됨

로그 스파이가 기존 테스트 패턴과 맞지 않으면, 최소한 HTTP 계약 테스트는 반드시 추가하고 로그 검증은 보조 테스트로 분리한다.

### 6.3 비목표 테스트

이번 이슈에서는 다음까지 검증 범위를 넓히지 않는다.

- `log-issue-monitor` 통합 승격 억제 E2E
- 실제 GitHub 이슈 생성 여부
- 세션 TTL 또는 재연결 정책

---

## 7. 구현 메모

- 이 변경은 `mcp.routes.ts`의 `unknown session` 분기와 관련 테스트에 국한한다.
- `log-issue-monitor`는 이번 수정의 수혜자이며, 직접 수정 대상은 아니다.
- 향후 동일 패턴이 다른 라우트에도 있으면 “클라이언트 오류를 `error`로 기록하는가”를 점검하는 운영 로그 가이드로 확장할 수 있다.

---

## 8. 검증 계획

- 대상 테스트 실행:
  - 관련 MCP 라우터/HTTP 서버 스펙
- 확인 포인트:
  - `unknown session`은 계속 `404`
  - 실제 처리 실패 케이스의 `error` 로깅은 유지
  - 새 케이스가 기존 streamable HTTP 동작을 깨지 않음

---

## 9. 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-05-04 | 초안: 이슈 #271 원인 분석, 로그 재분류 설계, 회귀 테스트 범위 정의 |
