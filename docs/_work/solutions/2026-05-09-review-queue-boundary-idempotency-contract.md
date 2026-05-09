# 리뷰 큐 경계 인터페이스 · Idempotency 계약 (GitHub #277 후속 / #296)

- **상태:** 설계 확정(구현 전)
- **기준:** [ADR: 리뷰 후보 산출/전달 확장 전략](../../adr/2026-05-05-issue-277-review-queue-scaling-strategy.md), [후속 구현 계획 §Track B-4](../../superpowers/plans/2026-05-05-issue-277-review-queue-scaling-followup-plan.md)
- **목표:** in-process 배치·SSE와 향후 외부 큐/워커가 **동일한 계약**으로 교체될 수 있도록 producer/consumer 경계와 중복 전달 안전 규칙을 명문화한다.

## 1. 경계 정의

### 1.1 현재 (옵션 A)

| 구간 | Producer | Consumer | 비고 |
|------|----------|----------|------|
| 후보 선정 → DB 반영 | `BatchScheduler.runMemoryReviewCandidatesJob` | `upsertPendingMemoryReviewCandidates` | SQLite 동기 호출 |
| 변경 알림 → UI | `notifyReviewCandidatesChanged` | Admin SSE `/admin/memory/review-candidates/stream` | in-process, 단일 노드 |

경계는 **함수 호출 + 공유 DB**로 흡수되어 있으며, 별도 메시지 버스는 없다.

### 1.2 목표 (옵션 B/C 대비)

외부 브로커(예: Redis stream, SQS)를 끼우더라도 다음 **논리 경계**는 동일해야 한다.

1. **작업 단위(Work Unit):** “이 `memory_id`에 대해 pending 후보를 특정 이유·우선순위·메타로 맞춘다”는 의미의 멱등 가능한 갱신.
2. **완료 신호(Completion / Fan-out):** 배치 또는 워커 실행이 끝났을 때 대시보드·다운스트림이 구독할 수 있는 **changed** 알림 (내용은 최소화, 조회는 DB/API로).

## 2. 공통 메시지 봉투 (Envelope)

모든 큐 메시지는 아래 필드를 **필수**로 포함한다. JSON 직렬화를 기본으로 한다 (`application/json` 또는 broker-native JSON body).

| 필드 | 타입 | 설명 |
|------|------|------|
| `schema_version` | `number` | 계약 버전. 초기값 `1`. 하위 호환만 additive. |
| `kind` | `string` | 아래 §3 이벤트 종류 중 하나. |
| `idempotency_key` | `string` | §4 규칙. 최대 길이 256, `[a-zA-Z0-9_:.-]` 권장. |
| `correlation_id` | `string` (UUID) | 한 배치 실행·한 발행 세션을 묶는 ID. |
| `occurred_at` | `string` | RFC3339 UTC. **생산 시각**(큐에 넣은 시각이 아니라 도메인 이벤트 시각이면 `effective_at` 별도). |
| `producer` | `object` | `{ "name": "memento-batch-scheduler" \| "memento-worker" \| string, "instance_id"?: string }` |
| `payload` | `object` | `kind`별 페이로드(§3). |

**버전 정책:** `schema_version` 불일치 시 consumer는 **거부(nack)** 하고 DLQ/재처리 정책에 따른다 — [`2026-05-09-review-queue-retry-backoff-dlq-runbook.md`](./2026-05-09-review-queue-retry-backoff-dlq-runbook.md).

## 3. 이벤트 종류(`kind`)

### 3.1 `review_candidate_upsert_requested` (핵심 Work Unit)

배치가 선택한 **단일 후보**에 대한 멱등 upsert 의도를 표현한다. 현재 `runMemoryReviewCandidatesJob`의 `inputs` 원소와 1:1 대응 가능.

**`payload` (schema_version 1):**

```json
{
  "memory_id": "mem_…",
  "priority": 0,
  "reason": "string",
  "due_at": "2026-05-09T12:00:00.000Z",
  "metadata_json": "{\"score_breakdown\":{…}}",
  "selection_fingerprint": "sha256:…"
}
```

- `selection_fingerprint`: producer가 이번 선정에 사용한 입력(예: recall 점수·임계값·규칙 버전)을 해시한 값. **동일 후보라도 선정 근거가 바뀌면 키가 달라져야** 한다(§4).

**Consumer 의미:** `upsertPendingMemoryReviewCandidates`와 동등한 트랜잭션 경로로 처리. 실 실패 시 재시도 가능(at-least-once).

### 3.2 `review_candidates_batch_completed` (관측·스냅샷 트리거)

배치 전체가 끝난 뒤 발행. 운영 메타용.

**`payload`:**

```json
{
  "job_type": "memory_review_candidates",
  "run_started_at": "…",
  "run_finished_at": "…",
  "selected_count": 42,
  "upsert": { "inserted": 3, "updated": 10 },
  "success": true,
  "errors": []
}
```

- Consumer(s): 로그 집계, `recordMemoryReviewQueueHealthSnapshot` 유사 동작, 외부 모니터링.
- **Idempotency:** 배치 단위 키(§4.2). 동일 키 재전달 시 스냅샷/메트릭은 중복 집계되지 않도록 consumer 측 **seen-set** 또는 DB unique 권장.

### 3.3 `review_candidates_changed` (얇은 알림)

현재 SSE `notifyReviewCandidatesChanged(reason)` 대체. **상태 전부를 실을 필요 없음.**

**`payload`:**

```json
{
  "reason": "batch_memory_review_candidates",
  "approx_pending_delta_hint": null
}
```

UI/SSE는 수신 후 `GET /admin/memory/review-candidates` 또는 metrics를 당겨(refresh)온다.

## 4. Idempotency 계약

### 4.1 도메인 멱등성 (이미 존재)

- `memory_review_candidate`에 대해 **pending 상태에서는 `memory_id`당 최대 1행**(부분 유니크 인덱스).  
- `upsertPendingMemoryReviewCandidates`는 동일 입력 반복 시 **삽입 대신 갱신**으로 수렴한다.  
→ **정확히 한 번** 전달이 아니라 **최소 한 번(at-least-once) + 수렴** 모델이 자연스럽다.

### 4.2 메시지 `idempotency_key` 생성 규칙

| kind | 권장 형식 | 안정 조건 |
|------|-----------|-----------|
| `review_candidate_upsert_requested` | `mrc:v1:upsert:{memory_id}:{selection_fingerprint}` | 동일 선정 결과 재발행 시 동일 키 |
| `review_candidates_batch_completed` | `mrc:v1:batch:{correlation_id}` | 한 실행·한 번의 완료 이벤트 |
| `review_candidates_changed` | `mrc:v1:changed:{correlation_id}:{reason}` 또는 `…:{monotonic_seq}` | UI 새로고침이 과도해도 무방하면 느슨하게 허용 |

**금지:** 랜덤 UUID만으로 upsert 키를 구성하면 동일 도메인 작업이 중복 실행될 수 있다.

### 4.3 Consumer 의무

1. **Upsert 메시지:** 동일 `idempotency_key`를 이미 성공 처리한 경우, 재전달 시 **HTTP 200 / ack**와 동등한 노옵(또는 저장된 결과 반환).  
2. **Batch completed:** 집계·스냅샷이 **정확히 한 번만** 필요하면 `idempotency_key`를 비즈니스 테이블 또는 Redis SET에 **TTL ≥ 48h**로 기록.  
3. **Changed:** 멱등 필수 아님; 중복이면 클라이언트가 추가 refresh만 수행.

### 4.4 Producer 의무

- `correlation_id`: 배치 한 번의 실행 내 모든 메시지에 동일 값 사용.
- 큐 재전파·DLQ 재주입 시 **`idempotency_key` 불변** 유지.

## 5. 어댑터(병행 가능 초안)

Structured Shell 쪽에 두 포트를 두고, 구현체만 교체한다.

```typescript
/** 발행: 현재는 no-op 뒤 DB 직접 호출, 향후는 broker publish */
export interface ReviewQueueWorkPublisher {
  publishUpsert(correlationId: string, msg: Envelope<'review_candidate_upsert_requested'>): Promise<void>;
  publishBatchCompleted(correlationId: string, msg: Envelope<'review_candidates_batch_completed'>): Promise<void>;
  publishChanged(correlationId: string, msg: Envelope<'review_candidates_changed'>): Promise<void>;
}

/** 소비: 현재는 Scheduler가 직접 DB, 향후는 worker가 동일 핸들러 호출 */
export interface ReviewQueueWorkHandler {
  handleUpsert(db: Database, envelope: Envelope<'review_candidate_upsert_requested'>): Promise<void>;
  handleBatchCompleted(db: Database, envelope: Envelope<'review_candidates_batch_completed'>): Promise<void>;
}
```

- **InProcessPublisher / InProcessHandler:** 현재 동작과 동일(메시지를 직렬화만 하고 곧바로 handler 호출 가능 — 계약 테스트용).
- **RedisStreamPublisher / WorkerConsumer:** Gate A→B 시 교체.

## 6. 현재 코드 매핑

| 코드 | 계약 대응 |
|------|-----------|
| `runMemoryReviewCandidatesJob` | `correlation_id` = 새 UUID, 루프마다 `review_candidate_upsert_requested` (또는 인프로세스 배치에서는 handler 직호출) |
| `recordMemoryReviewQueueHealthSnapshot` | `review_candidates_batch_completed` 처리의 일부 |
| `notifyReviewCandidatesChanged('batch_memory_review_candidates')` | `review_candidates_changed` |

## 7. 검증·후속 이슈

- **단위:** `idempotency_key` 파서·생성기, 동일 키 두 번 처리 시 DB 행 수 불변.
- **통합:** broker mock으로 at-least-once 중복 전달 시나리오.
- **다음 작업(계획 §5~6):** fan-out PoC(완료 #297), retry/DLQ 런북([`2026-05-09-review-queue-retry-backoff-dlq-runbook.md`](./2026-05-09-review-queue-retry-backoff-dlq-runbook.md), #298).

이 문서가 Track B 항목 4의 산출물이며, 구현 이슈는 어댑터 인터페이스 도입 + InProcess 구현체 추출부터 분해하면 된다.
