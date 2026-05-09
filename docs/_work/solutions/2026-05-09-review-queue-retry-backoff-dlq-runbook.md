# 리뷰 큐 재시도 · 백오프 · DLQ 정책 및 장애 런북 (GitHub #277 후속 / #298, Track B-6)

- **상태:** 운영 정책 문서 (현재 코드·향후 브로커 도입 모두 대비)
- **관련:** [경계·멱등 계약](./2026-05-09-review-queue-boundary-idempotency-contract.md), [changed fan-out PoC](./2026-05-09-review-queue-changed-event-fan-out-poc.md), [후속 구현 계획 §Track B](../../superpowers/plans/2026-05-05-issue-277-review-queue-scaling-followup-plan.md)
- **목표:** 리뷰 큐 경로별 **재시도·백오프·사실상 DLQ** 기준을 한곳에 모으고, 장애 시 **확인 순서·수동 복구**를 재현 가능하게 한다.

## 1. 범위 (레이어망)

| 레이어 | 역할 | at-least-once / 멱등 |
|--------|------|----------------------|
| **L1** 배치 `memory_review_candidates` | SQLite 동기 upsert | DB·유니크로 수렴 (계약 §4.1) |
| **L2** HTTP `review_candidates_changed` 릴레이 | 다운스트림 알림 (PoC) | best-effort; **재시도 없음** (아래 §3) |
| **L3** Admin SSE `/admin/memory/review-candidates/stream` | 단일 노드 실시간 푸시 | 연결 끊기면 브라우저 재연결 (`retry` 힌트) |
| **L4** 대시보드 폴링 | 백업 경로 | 폴링 주기 + 오류 시 백오프 시퀀스 |

향후 **외부 브로커·워커**를 끼우면 L1 발행/소비가 큐 기반으로 바뀌고, 본 문서 **§5 권장값**을 제품 기본 정책으로 삼는다.

## 2. 현재 구현 기준 동작

### 2.1 배치 스케줄러 (`BatchScheduler` + `RetryManager`)

- 기본값: `retryAttempts: 3`, `retryDelay: 1000` ms, `maxErrorCount`는 `RetryManager` 생성 시 `retryAttempts * 3`과 연동 (`packages/memento-core/src/infrastructure/scheduler/batch-scheduler.ts`).
- `memory_review_candidates` 잡도 동일 스케줄러를 타므로, **잡 단위 실패 시** 스케줄러·`RetryManager`가 정의하는 재시도·오류 누적 규칙이 적용된다 (세부는 core 구현 및 잡 등록 경로 참고).
- **의미:** 동기 DB 작업이 반복 실패하면 배치 메타·모니터링(health snapshot 등)에서 드러나야 한다. 큐 **메시지 DLQ**는 아직 없고, **관측 + 수동 재실행**이 1차 복구다.

### 2.2 HTTP 릴레이 fan-out (`review-candidates-changed-fanout.ts`)

- `MEMENTO_REVIEW_CANDIDATES_CHANGED_RELAY_URLS`가 설정된 경우, 각 URL로 `POST` (JSON 봉투 §3.3 계약).
- **타임아웃:** 3000 ms (`RELAY_TIMEOUT_MS`).
- **실패 처리:** 네트워크 예외 또는 비-2xx → **`logger.warn` 한 줄**; **재시도·큐 적재 없음** (PoC 성격, fan-out 문서와 동일).
- **인증(선택):** `MEMENTO_REVIEW_CANDIDATES_CHANGED_RELAY_SECRET` → `Authorization: Bearer …`.

### 2.3 SSE 클라이언트 힌트

- 스트림 시작 시 `retry: 3000` 전송 → 표준 SSE 클라이언트는 재연결 간격 힌트로 사용할 수 있음 (`review-candidates-sse-hub.ts`).

### 2.4 대시보드 폴링 백오프

- `MEMENTO_REVIEW_QUEUE_POLL_INTERVAL_MS` — 성공 경로 폴링 주기 (기본 60s, 최소 10s로 클램프).
- `MEMENTO_REVIEW_QUEUE_POLL_ERROR_BACKOFF_MS` — **쉼표 구간** 밀리초 시퀀스; 연속 API 오류 시 단계별 대기 (`review-queue-dashboard-boot.ts`). 미설정 시 빈 배열(즉시 다음 폴링 시도).

## 3. “DLQ”를 이 코드베이스에서 정의하는 법

외부 브로커가 없을 때 **물리적 DLQ 토픽은 없다**. 대신 아래를 **사실상 DLQ / poison / 정책 위반**으로 취급한다.

| 상황 | 현재 동작 | 운영 해석 |
|------|-----------|-----------|
| 릴레이 POST 실패 | 로그만 | 이벤트 **유실 가능** — 다운스트림은 폴링·주기 배치·수동 새로고침으로 정합 |
| 스키마/계약 불일치 (향후 consumer) | 계약: **nack** | 메시지를 **수동 검토 큐**(스프레드시트/이슈/브로커 DLQ)로 옮기고, 원인 수정 후 **동일 `idempotency_key`로 재주입** (계약 §4.4) |
| 동일 메시지 무한 재시도 | 브로커 도입 후 방지 | **최대 전달 시도(§5)** 초과 시 DLQ 이동, 알람 |

**수동 재처리 (모든 레이어 공통):**

1. **원인 분류:** 일시 네트워크 / 다운스트림 장애 / 잘못된 페이로드 / 스키마 불일치.
2. **멱등 키 보존:** 재주입·재전송 시 `idempotency_key` **변경 금지** (계약 §4.4).
3. **검증:** `GET /admin/memory/review-candidates`·metrics·health snapshot으로 기대 상태 확인.
4. **필요 시:** `POST /admin/batch/run` (`memory_review_candidates`) 또는 리뷰/-dismiss API로 도메인 상태를 맞춘 뒤, changed 알림이 기대대로 나가는지 로그로 확인.

## 4. 장애 런북 (운영 순서)

### R1 — “대시보드가 안 갱신된다”

1. 브라우저: SSE 연결 여부(개발자 도구 네트워크), 동일 출처·인증 만료.
2. 서버 로그: `review_candidates_changed fan-out relay failed` 유무, `relayStatus`.
3. 폴링: `MEMENTO_REVIEW_QUEUE_POLL_INTERVAL_MS`·`…_BACKOFF_MS`가 과도하게 크지 않은지 확인.
4. 데이터: API·DB에서 후보 행이 실제로 변했는지 확인 (UI만 뒤처진 경우 vs 데이터 미반영).

### R2 — “릴레이 수신기가 이벤트를 못 받는다”

1. URL·방화벽·`RELAY_SECRET` 불일치 확인.
2. 3s 타임아웃·비-2xx는 **의도적으로 drop** — 수신기 응답 시간·상태 코드를 점검.
3. **근본 완화:** 브로커 수신측 idempotent ingest + 본 문서 §5 재시도 정책 도입(향후 이슈).

### R3 — “배치는 도는데 pending이 쌓인다”

1. `memory_review_candidates` 실행 결과·에러 카운트 (배치 히스토리·로그).
2. Gate A 지표(후속 계획 Track A)로 증가율 vs 처리량 비교.
3. 스케일링 게이트 충족 시 Track B/C 계획 항목으로 에스컬레이션 — **본 문서만으로 큐 용량은 늘지 않는다.**

### R4 — (향후) “consumer가 메시지를 거부(nack)한다”

1. `schema_version`·`kind`·필수 필드 일치 여부.
2. DLQ에 보관된 원문 JSON에서 `idempotency_key`·`correlation_id` 기록.
3. 코드·계약 수정 후 **재주입**; duplicate 안전은 consumer 멱등 테이블(계약 §4.3)으로 보장.

## 5. 브로커 도입 시 권장 기본값 (아직 코드 아님)

Gate A→B 이후 워커/브로커를 붙일 때 아래를 **기본 제안**으로 삼는다. 실제 수치는 SLO·트래픽에 맞게 조정.

| 항목 | 권장 |
|------|------|
| 최대 소비 시도 | **8회** (초기 + 7 재시도) |
| 백오프 | **지수 + 전체 상한**(예: 1s × 2^n cap 5m) + **jitter 0~20%** |
| poison / 파싱 실패 | **즉시 DLQ** (재시도 금지) |
| `schema_version` 불일치 | 계약대로 nack → DLQ (§경계 문서) |
| 처리 시간 초과 | DLQ 또는 별도 “slow” 큐 + 알람 |
| DLQ 재주입 | 온콜 승인 후, **동일 `idempotency_key`**, 소량Canary부터 |

SSE·브라우저 폴링은 **최종 일관성**용이므로, 브로커 정책과 **독립**으로 튜닝한다.

## 6. 검증 체크리스트 (릴리스·장애 훈련)

- [ ] 릴레이 URL을 일부러 500으로 두었을 때 서버가 경고 로그만 남기고 요청 경로는 블로킹하지 않는다.
- [ ] 릴레이를 끈 상태에서도 대시보드 폴링·수동 새로고침으로 후보 목록이 복구 가능하다.
- [ ] (브로커 도입 후) 동일 `idempotency_key` 이중 전달 시 도메인 행 수·의미가 깨지지 않는다.

## 7. 변경 이력

- 2026-05-09: 초안 작성 (#298). 릴레이 best-effort·배치 RetryManager·대시보드 백오프·향후 DLQ 권장안 정리.
