# Quickstart: Issue #453 Contracts

## Read Order

1. `spec.md`
2. `research.md`
3. `data-model.md`
4. `contracts/event-envelope.md`
5. `contracts/security-failure-matrix.md`
6. `contracts/api-capabilities.md`
7. `tasks.md`

## #454 Start

1. migration/repository failing tests.
2. three additive tables and `schema.sql`.
3. core state/idempotency pure rules.
4. programmatic `/api/v1/agent` routes.
5. client capability/transport.
6. MCP/assistant compatibility tests.

Stop: persistence/API contract tests pass with no public regression.

## #461 Start

1. lifecycle TS/JSON Schema failing fixtures.
2. create `@memento/agent-integration`.
3. allowlist → block → redact → size → hash pipeline.
4. priority queue and bounded retry shell.
5. non-throwing capture result mapping.
6. secret marker count 0 across DB/log/telemetry/queue/error.

Stop: F01~F22 pass and server failure never throws through hook.

## Compatibility Gates

```bash
npm run lint
npm run type-check
npm test
```

- assistant public exports unchanged
- MCP tool schemas unchanged
- programmatic auth behavior unchanged
- `memory_item.session_id` semantics unchanged

## Security Review

다음 중 하나라도 yes면 계약 위반이다.

- redaction 전 값이 logger/error/telemetry로 전달되는가?
- hash를 redaction 전에 계산하는가?
- capture redaction을 환경변수로 끌 수 있는가?
- sensitive file body를 읽은 뒤 차단하는가?
- truncation이 JSON/UTF-8을 손상시키는가?
- retry queue가 원문을 disk에 기록하는가?
