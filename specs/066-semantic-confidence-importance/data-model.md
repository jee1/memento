# Data Model: semantic confidence와 conversion execution

이 기능은 새 영속 엔티티나 컬럼을 만들지 않는다. 아래 모델은 기존 SQLite row와 실행 중 logical snapshot을
명시해 구현·테스트의 단일 의미를 제공한다.

## Existing persisted entities

### Episodic Source (`memory_item`, `type='episodic'`)

| Field | Contract |
|---|---|
| `id` | 비공백 source ID. |
| `content` | extractor 직전에도 비공백 string이어야 한다. |
| `importance` | NULL이면 `0.5`; non-NULL이면 유한한 `[0,1]`. |
| `owner_id`, `project_id` | null-safe scope key. |
| `is_deleted` | active source만 변환 가능. |
| `triple_extracted` | success이면 `1`, failed/abandoned이면 `0`; unprocessed는 `NULL`/`0`. |
| `triple_extracted_status` | `NULL`, `success`, `failed`, `abandoned`의 일관된 tuple만 batch eligibility에 사용. |
| `triple_extraction_metadata` | 상태별 canonical JSON object. |

Source snapshot은 `id`, `type`, active flag, content, importance, owner/project, conversion tuple을 포함한다.
commit 시 값이 달라지면 stale attempt이며 primary와 failure state 모두 쓰지 않는다.

### Automatic Semantic Memory (`memory_item`, `type='semantic'`)

| Field | Contract |
|---|---|
| `subject`, `predicate`, `object` | validated normalized snapshot의 SPO. 비공백 string. |
| `confidence` | 신규 항목은 non-NULL finite `[0,1]`; legacy candidate의 non-NULL invalid 값은 격리. |
| `importance` | latest accepted episodic importance와 aggregate confidence에서 계산한 finite `[0,1]`. |
| `num_times` | accepted evidence occurrence 수. 양의 safe integer이며 merge마다 정확히 1 증가. |
| `recall_count` | 검색 사용량. evidence merge에서는 변경하지 않는다. |
| `owner_id`, `project_id` | source scope를 복사하고 candidate eligibility를 제한한다. |
| `origin_source` | automatic extraction임을 나타내는 기존 provenance. |
| `is_deleted` | active 항목만 candidate가 된다. |
| `created_at` | candidate tie-break의 첫 키. |

Legacy `confidence=NULL` candidate는 새 confidence로 초기화한다. 해당 값은 기존 `num_times` evidence에도 같은
대표값으로 적용된 것으로 간주하며 새 occurrence를 더한 뒤 `num_times`는 1 증가한다.

### KG Triple (`kg_triple`)

전역 `(subject,predicate,object)` unique와 optional `representative_memory_id`를 유지한다. 현재 scope에 eligible
representative가 있을 때만 fast path로 사용한다. 다른 scope/사용자/삭제/손상 representative는 변경하지 않으며,
scoped semantic memory가 KG 대표권 없이 존재할 수 있다.

### Provenance Relations (`memory_relation`)

- `semantic --extracted_from--> episodic`
- `episodic --supported_by--> semantic`

각 방향은 existing unique `(source_id,target_id,relation_type)`를 이용해 duplicate no-op으로 처리한다. relation
confidence에는 accepted occurrence confidence를 사용한다. primary commit 뒤 독립적으로 settle되며 관계 row는
source success의 원자 경계에 포함되지 않는다.

## Runtime logical entities

### Invocation Policy Snapshot

`episodicMemoryId`, importance의 provided/value 쌍, confidence threshold, similarity threshold를 가진다. 모든 값은
non-empty request의 DB 접근 전에 복사·검증한다. 숫자 문자열, boolean, NULL, NaN, Infinity, 범위 밖 값은
coerce/clamp하지 않는다.

### Invocation Input Snapshot

원본 위치별 `{ index, subject, predicate, object }`와 필요한 `extractionInfo.steps` boolean을 값으로 복사한다.
호출자 mutation은 현재 실행에 영향을 주지 않는다. sparse/non-object 위치는 그 위치만 skipped로 분류한다.

### Normalized Triple Snapshot

`index`, subject/predicate/object의 value/success 쌍, confidence, normalized SPO key를 가진다. 유효 fallback value와
`success=false`는 보존해 confidence 감점으로 사용한다. 예외, non-string, empty normalized value는 candidate,
embedding, write 전 triple-local failure다.

### Evidence Occurrence

한 source + invocation + semantic target에 최대 하나다. 첫 입력 위치, 최고 confidence 대표 위치, episodic
importance, candidate kind(exact/similar/create), optional target ID, duplicate input indexes를 가진다.

### Processing Outcome

각 원본 위치는 정확히 하나의 terminal kind를 가진다.

| Kind | Meaning |
|---|---|
| `created` | 해당 위치가 대표인 occurrence가 새 semantic을 durable commit. |
| `updated` | 해당 위치가 대표인 occurrence가 기존 semantic을 durable commit. |
| `duplicate` | 같은 invocation의 다른 대표 occurrence에 coalesced. |
| `skipped` | policy, malformed input, normalization/confidence/candidate operational failure로 primary 없음. |

`created + updated + duplicate + skipped = input triples length`이며 `semanticMemoryIds`는 committed created/updated
target만 first-input order로 unique하게 포함한다.

### Prepared Semantic Plan

외부/fallible 계산을 끝낸 immutable-by-convention value graph다. source/policy/input snapshots, ordered occurrences,
per-index outcomes, confidence samples, expected candidate snapshots와 post-commit intents를 포함한다. DB row나 service
instance를 소유하지 않는다.

### Conversion Commit Unit

한 episodic source의 모든 prepared primary occurrences와 source success tuple을 같은 DB transaction에서
commit/rollback한다. candidate stale이면 rollback 후 transaction 밖에서 한 번 재판정하고 새 unit을 시도한다.
Primary가 0건이고 전부 policy exclusion이면 success이고, 입력·정규화·confidence·candidate operational failure가
하나라도 있으면 genuine pre-commit failure다.

### Source Transition Metadata

| State | Exact key set |
|---|---|
| `success` | `triple_count`, optional `confidence_avg`, `extracted_at` |
| `failed` | `failureReason`, `retry_count`, `last_attempt`, `next_retry_after_days` |
| `abandoned` | `failureReason`, `retry_count`, `last_attempt`, `abandoned_at` |

한 전이는 한 UTC ISO timestamp를 재사용한다. 상태 변경 시 metadata 전체를 교체해 이전 상태 키를 제거한다.
raw content/triple/LLM output/arbitrary error string은 포함하지 않는다.

## Source state transitions

```text
unprocessed ──commit primary/policy-only success──> success
unprocessed ──genuine pre-commit failure──────────> failed | abandoned
failed (due) ──commit primary/policy-only success─> success
failed (due) ──genuine pre-commit failure─────────> failed | abandoned
success ──forced reprocess success────────────────> success (new occurrence)
success ──forced reprocess failure────────────────> success (tuple preserved)
abandoned ────────────────────────────────────────> excluded
stale / losing attempt ───────────────────────────> unchanged
```

`maxRetries`는 최초 시도를 포함한 maximum genuine pre-commit attempts다. 새 count가 max에 도달한 동일 failure
commit에서 abandoned가 된다.

## Batch execution models

### Batch Execution Policy Snapshot

Resolved fields는 `batchSize`, `timeout`, `maxRetries`, copied `retryBackoffDays`, `chunkSize`, `chunkDelayMs`,
`parallelism=1`이다. Count는 positive safe integer, timeout/delay/backoff는 non-negative finite number다.

### Retry Eligibility Snapshot

Execute wall-clock 시작시각, persisted status tuple, parsed retry metadata와 due instant를 가진다. `due = last_attempt +
backoffDays * 24h`; exact due는 eligible이다. Invalid JSON/object/number/time/overflow는 warning과 함께 제외하고 repair하지
않는다.

### Batch Candidate Set

Eligibility 적용 뒤 `(created_at ASC, id ASC)` 순으로 limit을 채운 고정 source snapshot 배열이다. chunk는 이 배열의
consecutive non-overlapping slices다. stale/timeout으로 빈 자리가 생겨도 top-up하지 않는다.

### Batch Result Snapshot

Fresh `Date`, arrays and `Map`을 execute마다 소유한다. durable terminal source만 한 번 집계하며 모든 반환에서
`processed = details.processed = details.success + details.failed + details.skipped`를 만족한다.
`semanticMemoriesCreated/Updated`는 durable primary outcome occurrences의 합이고, `retryCounts`는 현재 execute에서
failed/abandoned transition이 durable commit된 source와 persisted new count만 포함한다.

