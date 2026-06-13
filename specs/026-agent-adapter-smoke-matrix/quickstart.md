# Quickstart: Agent Adapter Smoke Matrix

## CI / Local default

```bash
npm run quality:agent-smoke:test
npm run quality:agent-smoke -- --output test-results/agent-smoke-matrix.json
```

## Live server (optional)

```bash
MEMENTO_SMOKE_ENDPOINT=http://127.0.0.1:8080 \
MEMENTO_SMOKE_API_KEY=your-key \
npm run quality:agent-smoke -- --output test-results/agent-smoke-live.json
```

## Require live for release gate

```bash
MEMENTO_SMOKE_ENDPOINT=... npm run quality:agent-smoke -- --require-live
```

See `docs/operations/ko/agent-smoke-matrix.md` for controlled live-agent procedure.
