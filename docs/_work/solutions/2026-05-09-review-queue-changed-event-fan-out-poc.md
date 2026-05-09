# 리뷰 큐 `review_candidates_changed` 이벤트 fan-out PoC (GitHub #297)

- **상태:** 구현 반영 (실험 경로)
- **기준 계약:** [`2026-05-09-review-queue-boundary-idempotency-contract.md`](./2026-05-09-review-queue-boundary-idempotency-contract.md) 의 `kind: review_candidates_changed` 봉투
- **목표:** in-process SSE(#276) 외에 **HTTP POST 릴레이**로 동일 논리 이벤트를 내보내, 브로커/다중 구독자 시나리오에서 지연·실패를 재현·측정할 수 있게 한다.

## 동작

1. `POST /admin/memory/review-candidates/:id/review|dismiss` 성공 또는 `POST /admin/batch/run` 의 `memory_review_candidates` 완료 시, 기존과 같이 SSE `event: changed` 가 발행된다.
2. `MEMENTO_REVIEW_CANDIDATES_CHANGED_RELAY_URLS` 가 비어 있지 않으면, 같은 시점에 **비동기**로 각 URL에 JSON 봉투를 POST 한다 (응답 경로는 릴레이 완료를 기다리지 않음).
3. 선택값 `MEMENTO_REVIEW_CANDIDATES_CHANGED_RELAY_SECRET` 이 있으면 `Authorization: Bearer …` 헤더를 붙인다.

로그 키워드: `review_candidates_changed fan-out relay finished` / `… relay failed` (`relayHost`, `relayMs`, `relayStatus`).

## 단일 노드 측정

- 릴레이 미설정: SSE만 — 기존 `admin.routes.spec` 의 SSE 시나리오와 동일.
- 릴레이 1개(로컬 수신기): 수신 측에서 POST 수신 시각과 본문의 `occurred_at` 의 차이를 기록하면 **프로세스 내 SSE + HTTP 홉** 지연을 대략 확인할 수 있다.

## 다중 노드(시뮬레이션)

- **노드 A:** Memento HTTP admin (실제 인스턴스).
- **노드 B:** 릴레이 URL로 들어오는 POST를 구독하는 경량 서버(예: `node -e` 로 `http.createServer` 수신).
- A에서 리뷰/배치 트리거 시 B가 수신하면 “한 프로세스 밖으로 이벤트가 나간” 경로가 열린 것이다. SSE는 여전히 A에 붙은 브라우저에만 도달한다(기존 한계).

전면 멀티 노드 SSE 정합성은 Track C / 별도 브로커 도입 후 검증한다. **운영 채택 기준(폴링·sticky·Tier 구조)** 은 [#300](https://github.com/jee1/memento/issues/300) [`2026-05-09-review-queue-sse-multi-instance-strategy.md`](./2026-05-09-review-queue-sse-multi-instance-strategy.md) 를 따른다.

## 손실(loss)

- 릴레이는 best-effort이다. `fetch` 예외나 비-2xx는 경고 로그만 남긴다. 재시도·DLQ·런북: [`2026-05-09-review-queue-retry-backoff-dlq-runbook.md`](./2026-05-09-review-queue-retry-backoff-dlq-runbook.md).
- **관측:** 수신기가 요청 수를 집계하고, 동일 `idempotency_key` 중복을 카운트하면 at-least-once 전달과 중복 refresh 비용을 평가할 수 있다.

## 환경 변수

| 변수 | 설명 |
|------|------|
| `MEMENTO_REVIEW_CANDIDATES_CHANGED_RELAY_URLS` | 쉼표 구분 POST 대상 URL 목록 |
| `MEMENTO_REVIEW_CANDIDATES_CHANGED_RELAY_SECRET` | 선택, Bearer 토큰 |

코드: `packages/memento-server/src/server/review-candidates-changed-fanout.ts`
