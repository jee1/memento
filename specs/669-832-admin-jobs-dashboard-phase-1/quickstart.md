# Quickstart: 669-832 Admin Jobs Dashboard Phase 1

## Dev

```bash
npm run dev:http
# open Admin dashboard → Jobs tab → Refresh
curl -H "Authorization: Bearer $ADMIN_API_KEY" http://localhost:PORT/admin/batch/stats
```

## Test focus

```bash
npm test -- packages/memento-core/src/infrastructure/scheduler/__tests__/job-queue
# or path to new job-queue snapshot spec
npm test -- packages/memento-server/src/server/routes/admin.routes.spec.ts
npm test -- packages/memento-server/src/server/dashboard-jobs-panel.spec.ts
```

## Verify manually

1. Jobs tab visible when signed in.
2. Refresh loads schedule table + queue + run-history.
3. Wait 60s — no automatic `/admin/batch/stats` repeats.
4. `/admin/batch/status` still returns prior shape.
