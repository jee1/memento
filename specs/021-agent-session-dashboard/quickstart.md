# Quickstart: Agent Session Dashboard

## Read Order

1. `spec.md`
2. `research.md`
3. `data-model.md`
4. `plan.md`
5. `tasks.md`

## API Smoke

```bash
curl -H "Authorization: Bearer $ADMIN_API_KEY" \
  "http://127.0.0.1:9001/api/v1/agent/sessions?limit=20"

curl -H "X-API-Key: $ADMIN_API_KEY" \
  "http://127.0.0.1:9001/api/v1/agent/sessions/session-id/observations?limit=50"
```

## Transcript Dry Run

```bash
curl -X POST \
  -H "Authorization: Bearer $ADMIN_API_KEY" \
  -H "Content-Type: application/json" \
  --data '{"jsonl":"{\"contract_version\":1,...}"}' \
  http://127.0.0.1:9001/api/v1/agent/transcripts/import
```

Commit requires explicit `"dry_run": false`.

## Dashboard

1. Sign in to dashboard.
2. Open Agent Sessions.
3. Enter the programmatic API key for this tab.
4. Load sessions, select one, filter/load timeline.
5. Use provenance lookup or transcript dry-run/import.

The key remains in page memory only and is cleared on reload.

## Verification

```bash
npm run lint
npm run type-check
npx tsx scripts/check-sql-injection.ts --ci
npx tsx scripts/check-pii-masking.ts --ci
npx tsx scripts/check-path-traversal.ts --ci
```
