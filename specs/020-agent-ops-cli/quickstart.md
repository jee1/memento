# Quickstart: Agent Operations CLI

## Doctor

```bash
memento doctor
memento doctor --json
memento doctor --endpoint http://127.0.0.1:9001
```

확인 항목:

- endpoint/health
- programmatic auth
- agent schema와 contract version 1
- Claude Code/Codex lifecycle compatibility
- synthetic test event redaction과 cleanup

API key는 `ADMIN_API_KEY` 또는 `MEMENTO_API_KEY`를 사용하며 출력되지 않는다.

## Status

```bash
memento status
memento status --since 24h --limit 20 --json
```

출력은 capture/injection/drop/degraded 집계와 payload-free recent event만 포함한다.

## Demo

```bash
memento demo
memento demo --json
```

첫 session 수집/종료 summary가 두 번째 session initial injection에 포함되는지 검증한다.
생성한 session은 성공/실패와 관계없이 정리된다.

## Reason Codes

- `SERVER_UNAVAILABLE`: endpoint와 server process를 확인한다.
- `AUTH_FAILED`: `ADMIN_API_KEY`와 CLI API key가 같은지 확인한다.
- `SCHEMA_NOT_READY`: migration과 server 재시작을 확인한다.
- `UNSUPPORTED_CONTRACT_VERSION`: server/adapter/CLI 버전을 맞춘다.
- `QUEUE_OVERFLOW`: capture queue와 drop count를 확인하고 부하를 줄인다.
- `SENSITIVE_PATH`, `PRIVATE_KEY_MATERIAL`, `BINARY_CONTENT`: 의도된 fail-closed drop인지 확인한다.
- `INVALID_SESSION_STATE`, `SESSION_NOT_STARTED`: lifecycle 순서와 adapter 설정을 확인한다.

JSON 출력의 `guidance`가 전체 안정 reason code의 authoritative CLI 가이드다.

## Verification

```bash
npx vitest run \
  packages/memento-server/src/cli/agent-ops.spec.ts \
  packages/memento-server/src/server/routes/agent.routes.spec.ts \
  packages/memento-client/src/agent-api.spec.ts
npm run lint
npm run type-check
npx tsx scripts/check-sql-injection.ts --ci
npx tsx scripts/check-pii-masking.ts --ci
npx tsx scripts/check-path-traversal.ts --ci
npm test
```
