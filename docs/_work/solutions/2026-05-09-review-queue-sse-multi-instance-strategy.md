# Review Queue Admin SSE — 멀티 인스턴스 전략 (GitHub #300)

- **상태:** Accepted (문서 확정; 본 이슈 범위에서 코드 변경 없음)
- **상위 ADR:** [`docs/adr/2026-05-05-issue-277-review-queue-scaling-strategy.md`](../../adr/2026-05-05-issue-277-review-queue-scaling-strategy.md)
- **관련 구현:** `review-candidates-sse-hub.ts`, `review-candidates-changed-fanout.ts`, `static/js/review-candidates-panel.js`

## 배경

- SSE 허브는 **in-process `Set<Response>`** 로만 fan-out 하며 Redis/공유 버스가 없다 (`review-candidates-sse-hub.ts`).
- `broadcastReviewCandidatesChanged` 는 로컬 SSE 알림 후, 선택적으로 HTTP POST 릴레이(#297)를 **best-effort** 로 수행한다.
- 대시보드는 **EventSource + 폴링 폴백**(#276)으로 목록·메트릭을 갱신한다.

## 문제 정의

HTTP admin **인스턴스 A**에서 후보 변경이 일어나면 `changed` 이벤트는 **A에 붙은 SSE 연결**에만 전달된다. **인스턴스 B**에 연결된 브라우저는 A의 메모리 내 클라이언트 집합을 볼 수 없다.

## 사용자 체감 일관성 기준 (완료 조건)

1. **정합성(필수):** 대시보드가 표시하는 pending 목록·메트릭은 **폴링 경로**를 통해 실제 저장 상태와 수렴한다. SSE 유무·교차 인스턴스 여부와 무관하게 “항상 곧 맞는다”가 보장된다.
2. **저지연(권장):** 단일 인스턴스 또는 **sticky 세션**으로 동일 인스턴스에 머무는 클라이언트는 SSE로 즉시 갱신 트리거를 받을 수 있다.
3. **교차 인스턴스 저지연(선택):** 공유 버스 또는 **피어 ingest + 로컬 notify** 등은 ADR의 A→B 게이트 및 운영 요구가 있을 때만 도입한다.

## 채택 전략 (계층화)

### Tier 1 — 기본 (YAGNI, 추가 브로커 없음)

| 요소 | 역할 |
|------|------|
| **SSE** | **동일 인스턴스**에서 처리된 변경에 대한 저지연 **힌트**. 멀티 인스턴스 전역 브로드캐스트가 아니다. |
| **폴링** | `pollIntervalMs` / 에러 백오프가 **멀티 인스턴스 정합성의 기본 경로**. |
| **로드밸런싱** | 가능하면 admin 대시보드에 **세션(또는 쿠키) sticky**를 적용해 API·SSE가 같은 인스턴스를 보도록 한다. |

### Tier 2 — 관측·실험 (#297)

- `MEMENTO_REVIEW_CANDIDATES_CHANGED_RELAY_URLS` 로 논리 이벤트를 프로세스 밖으로 보내 지연·손실·중복(at-least-once)을 측정한다.
- **현재 한계:** 릴레이는 **송신 전용**이다. 다른 memento 프로세스의 SSE 클라이언트를 자동 갱신하지 않는다.
- **선택적 후속:** 피어의 **수신 엔드포인트**가 검증된 봉투만 받아 `notifyReviewCandidatesChanged` 만 호출하고 **재릴레이는 금지**(루프 방지)하면, 릴레이 URL을 피어 admin URL로 두는 패턴으로 교차 인스턴스 SSE에 가까운 효과를 낼 수 있다. 이는 별도 이슈·보안 검토(인증, 소스 검증) 후 구현한다.

### Tier 3 — 공유 버스 (ADR Gate A→B 이후)

- Redis 등 중앙 스트림 + 소비자가 모든 인스턴스에서 동일 이벤트를 구독하는 형태.
- idempotency·재시도·DLQ는 [`2026-05-09-review-queue-boundary-idempotency-contract.md`](./2026-05-09-review-queue-boundary-idempotency-contract.md), [`2026-05-09-review-queue-retry-backoff-dlq-runbook.md`](./2026-05-09-review-queue-retry-backoff-dlq-runbook.md) 를 따른다.

## 이번 이슈에서 명시적으로 하지 않는 것

- 브로커 또는 전역 SSE 프록시를 **즉시** 도입해 교차 인스턴스 실시간 일치를 완성하는 것.

## 검증

- 단일 노드: 기존 `admin.routes.spec` SSE 시나리오, 패널 스모크.
- 멀티 노드: sticky 없이 두 인스턴스를 번갈아 호출하면 한쪽 브라우저의 SSE는 다른 인스턴스의 변경을 놓칠 수 있음(설계 허용); **폴링으로 수렴**함을 수동 확인.
- 릴레이: fan-out PoC 문서의 수신기 집계·`idempotency_key` 중복 카운트.
