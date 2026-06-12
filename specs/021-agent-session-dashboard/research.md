# Research: Agent Session Dashboard

## Existing Boundaries

- `/api/v1/agent`는 `createProgrammaticAuthMiddleware` 아래 mount되어 Bearer/X-API-Key만 허용한다.
- `SqliteAgentIntegrationRepository.listObservations()`는 cursor, limit, event type, status, 기간 filter와 aggregate를 이미 제공한다.
- `observationDto()`는 payload를 제외한다. 이 경계를 유지하고 redaction metadata는 count만 파싱한다.
- injection 결정과 usage는 `telemetry_events`의 `agent.injection.completed` / `agent.injection.used`에 안전한 metadata로 저장된다.
- dashboard는 browser session 기반 admin fetch를 사용하므로 agent API용 key를 sessionStorage나 영속 저장소에 보관하지 않는다. panel-local memory에서만 header를 구성한다.

## Decisions

### Session Read Model

repository에 cursor 기반 `listSessions`와 전체 aggregate를 추가한다. 목록 aggregate는 correlated subquery 대신 page session ID에 대한 grouped query로 계산해 page 크기에 비례시킨다.

### Timeline DTO

raw payload를 반환하지 않는다. `event_category`, `redaction_count`, `has_payload`, status/reason/time만 반환한다. `redaction_metadata_json`의 replacement count만 합산하고 key/value는 반사하지 않는다.

### Provenance Detail

기존 graph trace와 별도로 dashboard용 bounded detail DTO를 제공한다. memory content는 preview 길이로 제한하고 observation은 safe DTO, session은 session DTO로 반환한다.

### Injection Detail

새 table을 만들지 않고 기존 telemetry를 read model로 사용한다. completed event의 selected/exclusions와 used event의 `used_memory_ids`를 injection ID로 합쳐 `used` boolean을 계산한다.

### Transcript Import

1. request body size는 Express 기존 JSON limit 안에서 `jsonl` string으로 받는다.
2. 빈 line을 제외하고 모든 line을 JSON parse한다.
3. 모든 event에 기존 `prepareEvent` pipeline을 적용한다.
4. duplicate와 conflict를 write 전에 조회한다.
5. 신규 event 전체의 session ordering/identity를 in-memory simulation으로 검증한다.
6. dry-run이면 결과만 반환한다.
7. commit이면 outer SQLite transaction 안에서 lifecycle capture를 실행한다. better-sqlite3 nested transaction/savepoint semantics를 사용하고 오류 시 전체 rollback한다.

### UI

기존 dashboard tab pattern을 확장한다. agent panel은 API key 입력, session list, aggregate cards, timeline/detail, provenance lookup, injection detail, transcript import를 한 tab에 둔다. CSS는 token만 사용한다.

## Alternatives Rejected

- `/admin` 아래 duplicate API: programmatic auth 요구와 agent contract ownership을 깨뜨린다.
- raw payload 반환 후 browser masking: secret이 API 경계를 통과하므로 기각한다.
- transcript line별 즉시 write: import-before-write와 atomicity를 위반한다.
- 신규 JSONL/parser dependency: 표준 `JSON.parse`와 line splitting으로 충분하다.
- injection table migration: 기존 telemetry가 요구 필드를 이미 보유한다.
