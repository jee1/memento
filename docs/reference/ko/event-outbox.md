# 이벤트 Outbox

`event_outbox`는 외부 자동화를 위한 Memento의 durable 전달 지점입니다. 기본값은 비활성화이며, 성공한 메모리 경계에서 이벤트를 적재하려면 `MEMENTO_EVENT_OUTBOX_ENABLED=true`를 설정합니다.

## 이벤트 vocabulary

| 이벤트 | 기존 telemetry 대응 | payload 핵심 |
| --- | --- | --- |
| `memory.remembered` | `memory.write.completed` | `memory_id`, `memory_type`, `content_hash`, `target_uri` |
| `procedure.updated` | `memory.write.completed` | 절차 기억 갱신과 `target_uri` |
| `memory.recalled` | `memory.search.selected` | 선택된 `memory_id`, `query_hash`, `target_uri` |
| `memory.forgotten` | 신규 외부 이벤트 | 삭제 방식, 사유, `target_uri` |
| `relation.added` | 신규 외부 이벤트 | 관계 source, target, `target_uri` |

모든 row는 `memento://owner-a/memory/mem_123` 형태의 canonical `target_uri`, 같은 URI를 포함하는 JSON payload, 호출자가 지정한 idempotency key를 보관합니다.

## 전달 계약

`EventOutboxService.publishPending()`은 `EventOutboxPublisher` adapter로 전달할 시점이 된 row를 polling합니다. `publish()`가 성공한 뒤에만 `processed_at`을 기록하고, 실패하면 `attempts`와 `last_error`를 갱신한 뒤 bounded exponential backoff로 재시도하므로 at-least-once 전달을 제공합니다.

core는 네트워크 목적지를 구성하지 않습니다. Redis Stream과 webhook은 adapter interface 뒤에서 독립 배포하며, outbox 테이블은 SQLite 백업 대상에 포함해야 합니다.
