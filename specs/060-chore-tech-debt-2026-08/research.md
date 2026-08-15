# Research: Epic #748 — chore tech-debt 2026-08

Phase 0 codebase verification for child issues #749–#756.  
Read-only inspection of production code; statuses are **Confirmed** / **Partial** / **Not confirmed**.

**Summary:** Confirmed **7** · Partial **1** · Not confirmed **0**

---

## #752 — 배포 tarball 런타임 의존성 closure 검증

**Status:** Confirmed

### Evidence

| Claim | Location |
|-------|----------|
| Root publishes `dist/server` bins | `package.json:15-18` (`memento-mcp-server`, `memento-dev`, `memento-mcp` → `./dist/server/...`) |
| Server runtime deps include packages absent from root | `packages/memento-server/package.json:24-35`: `@memento/agent-integration`, `express-rate-limit`, `helmet`, `umap-js` |
| Root `dependencies` omit those four | `package.json:162-177` — has `@memento/core`, `express`, `ws`, etc.; **no** `express-rate-limit` / `helmet` / `umap-js` / `@memento/agent-integration` |
| Compiled server imports them | `packages/memento-server/src/server/http-server.ts:27` (`helmet`); `.../middleware/http-rate-limit.middleware.ts:2` (`express-rate-limit`); `.../admin/admin-embedding-map-response.ts:6` (`umap-js`); multiple `routes/agent.*` + CLI hooks import `@memento/agent-integration` |
| Pack verify checks only `@memento/core` | `scripts/verify-npm-pack-bundle.js:22` — `REQUIRED = 'package/node_modules/@memento/core/dist/index.js'`; success log at `:86-92` only asserts that path |
| `@memento/agent-integration@0.1.0` not a published registry product | `packages/memento-agent-integration/package.json`: `version` `0.1.0`, no `publishConfig`; workspace-only risk stands |

### Recommended approach

Keep current pack/prepack path; extend root runtime deps (and/or existing `prepack-bundle-core` / verify script) so the installed tarball’s external import closure matches `dist/server`. Teach `verify-npm-pack-bundle.js` to fail on missing server runtime packages, not only `@memento/core`.

### Risks / open questions

- Bundling `@memento/agent-integration` vs publishing it — decide before CI smoke “empty temp dir install”.
- Whether `umap-js` is optional-admin-only (fail-soft vs hard dep of every install).
- Empty-dir install smoke may need native rebuild (`better-sqlite3` / `sqlite-vec`) — scope of gate vs smoke.

---

## #754 — recall 필터 wire contract 정렬 및 채널 격리 복원

**Status:** Confirmed

### Evidence

| Claim | Location |
|-------|----------|
| Client sends nested `filters` | `packages/memento-client/src/client/search-client.ts:25-28` — `post('/tools/recall', { query, filters, limit, ... })` |
| HTTP tools pass body through unchanged | `packages/memento-server/src/server/routes/tools.routes.ts:50-66` — `params = req.body` → `executeTool(name, params, ...)` (no flatten) |
| Core `RecallTool` reads top-level fields | `packages/memento-core/src/domains/memory/tools/recall-tool.ts:76-86` — destructures `type`, `tags`, `privacy_scope`, etc. from `params` (not `params.filters`) |
| Channel isolation E2E skipped | `packages/memento-assistant/test/e2e/channel-isolation.e2e.spec.ts:12` — `it.skip('... server does not enforce tags filter ...')` |
| Assistant builds channel tags into `filters.tags` | `packages/memento-assistant/src/lifecycle/before-user-turn.spec.ts:71-78`; `scoping/channel-scope.ts` adds `channel:*` when `crossChannelRecall=off` |
| Assistant CI runs `src` only | `packages/memento-assistant/package.json:16` — `"test:ci": "vitest --run src --reporter=basic"`; `.github/workflows/ci.yml` `test-assistant` runs `npm run test:ci -w @memento/assistant` |

### Recommended approach

Normalize once at the shared executeTool / HTTP recall entry (accept nested `filters` **or** top-level, prefer one canonical shape) so client/assistant tags reach `RecallTool`. Unskip channel-isolation E2E; widen assistant `test:ci` to include `test/` (or a tagged E2E path) without per-caller shims.

### Risks / open questions

- MCP stdio callers already use top-level fields — flattening must remain backward-compatible.
- Whether “server enforces channel tags” means core always applies them vs only when client sends them (assistant already sends; core must honor).
- E2E needs live HTTP server helper — CI time/flake budget.

---

## #750 — 운영 스크립트 monorepo import 경로 복구

**Status:** Confirmed

### Evidence

| Claim | Location |
|-------|----------|
| Scripts still import root `../src/...` | e.g. `scripts/migrate-embedding-data.js:16` — `from '../src/infrastructure/database/database/init.js'`; same pattern across maintenance/quality scripts |
| File count | **25** files under `scripts/` (incl. `scripts/archive/*`) match `../src/` or `/src/` imports (issue said “20 active” — archive explains most of the delta) |
| Root npm scripts wired to broken paths | **16** root `package.json` script entries, including `migrate:embedding` / `:analyze` / `:rollback` (`:107-109`), `backup:embeddings` / `regenerate:embeddings` / `debug:embeddings` / `fix:vector-dimensions` (`:123-128`), `quality:*` / `db:check-trigger` / `db:fix-trigger` (`:54-55`, `:61-69` region) |
| Integration test reimplements SQL, does not run CLI | `scripts/__tests__/migrate-embedding-data.integration.spec.ts:57-223` — uses `@memento/core/.../init.js` + inline SQL; never spawns `migrate-embedding-data.js` |
| PR CI excludes script integration specs | `package.json:43` — `test:ci:scripts` … `--exclude '**/*.integration.spec.ts'` |

### Recommended approach

Point registered ops scripts at `@memento/core` public (or workspace) exports; delete unused legacy/archive scripts that still point at root `src/`. Replace duplicated SQL “integration” tests with one parameterized CLI/import smoke; include that smoke in CI (not under the integration exclude).

### Risks / open questions

- Which of the 16 npm commands are still supported ops vs dead docs — delete vs fix.
- Deep imports (`@memento/core/infrastructure/...`) vs public barrel — prefer existing public exports to avoid new API surface.
- Some quality scripts also import `../src/test/helpers/...` — may need fixtures package path or keep as test-only.

---

## #755 — `memory_embedding` 재구축 migration 원자성

**Status:** Confirmed

### Evidence

| Claim | Location |
|-------|----------|
| Rebuild entry | `packages/memento-core/src/infrastructure/database/database/migrate.ts:91` (`if (needsRebuild)`) |
| Create new table | `:98-116` `CREATE TABLE memory_embedding__new` |
| Copy data | `:139-170` `INSERT INTO memory_embedding__new ... SELECT ... FROM memory_embedding` |
| Drop live / rename | `:172` `DROP TABLE memory_embedding`; `:175` `ALTER TABLE ... RENAME TO memory_embedding` |
| No explicit transaction | `migrateDatabase` `:41-263` — no `db.transaction` / `BEGIN`/`COMMIT`; failures only log+rethrow (`:256-259`) |
| Shipped CLI path | `packages/memento-core/package.json:61` — `"db:migrate": "node dist/infrastructure/database/database/migrate.js"`; root `package.json:51` delegates `db:migrate` to that workspace |

### Recommended approach

Wrap create/copy/drop/rename in a single `better-sqlite3` `db.transaction(...)` (existing API). Add a failure-injection test that aborts after copy or before rename and asserts the live table+rows remain.

### Risks / open questions

- SQLite DDL in transactions: most DDL is transactional in SQLite, but confirm vec triggers dropped just before rebuild (`:94-96`) belong inside or outside the atomic unit.
- Concurrent readers during rebuild — ops lock/docs expectation.
- Idempotency when `needsRebuild` is false must stay unchanged.

---

## #751 — nightly MigrationRunner 테스트 실제 실행

**Status:** Confirmed

### Evidence

| Claim | Location |
|-------|----------|
| Nightly sets `CI: true` | `.github/workflows/nightly-tests.yml:12-17` |
| Same job explicitly runs migration-runner integration spec | `:63-71` — `npx vitest --run` … `migration-runner.integration.spec.ts` (+ lock + embedding integration) |
| Vitest excludes that file when `CI` is truthy | `vitest.config.ts:50-62` — `...(process.env.CI && { exclude: [..., '**/migration-runner.integration.spec.ts'] })` |

Net effect: nightly “integration subset” step can collect **0** tests for the migration-runner path while still exiting 0 (Vitest “No test files” / empty run depending on other listed files’ CI excludes).

### Recommended approach

On that nightly step only: unset `CI` / set a dedicated flag (e.g. `VITEST_INCLUDE_MIGRATION_RUNNER=1`) and gate the exclude on that flag — **do not** add a second vitest config. Fail the step if collected test count is 0.

### Risks / open questions

- Sibling files in the same step (`database-lock-scenarios.integration.spec.ts`, `memory-embedding-service.integration.spec.ts`) may also match broader `**/test/**/*integration*` exclude patterns — verify all three actually run after the fix.
- PR CI must keep excluding heavy migration-runner work.

---

## #756 — fixable production 취약점 + audit gate

**Status:** Confirmed

### Evidence

| Claim | Location |
|-------|----------|
| Security workflow has no `npm audit` gate | `.github/workflows/security-check.yml` — type-check, lint, SQL/PII/path scripts, unit/E2E security tests (`:39-69`); **no** `npm audit` step. Repo-wide: `rg "npm audit" .github/workflows` → none |
| Related prior work | Issue references completed #581, #637 |

**Fixable candidates (from issue #756 body; live `npm audit` not re-run this session):**

- `@hono/node-server` 1.19.14 → 1.19.17  
- `hono` 4.12.27 → 4.13.2  
- `fast-uri` 3.1.2 → 3.1.5  
- `ip-address` 10.2.0 → 10.5.0  
- `protobufjs` 7.6.4 → 7.6.5  

### Recommended approach

Bump only wanted/fixable lockfile ranges; add `npm audit --omit=dev` (or equivalent production audit) as a failing step in `security-check.yml`. Document upstream-blocked ML transitive deps without force-overrides.

### Risks / open questions

- Exact High/Moderate counts may have drifted since 2026-08-15 audit — re-run audit when implementing.
- Hono may be transitive (MCP SDK / other) — confirm which workspace owns the pin.
- Non-scope: `@huggingface/transformers` → `onnxruntime-node` / `sharp` overrides (issue non-goals).

---

## #753 — embedding metadata 보정을 hot path에서 migration으로 이동

**Status:** Confirmed

### Evidence

| Claim | Location |
|-------|----------|
| create path | `packages/memento-core/src/domains/memory/services/memory-embedding-service.ts:401` — `await this.ensureMetadataDefaults(db)` before insert |
| similarity search path | `:449` — same call at start of `searchBySimilarity` |
| stats path | `:534` — `getEmbeddingStats` |
| Table-wide conditional UPDATE | `:595-635` — `UPDATE memory_embedding SET ... WHERE embedding_provider IS NULL OR '' OR dimensions ...` |

### Recommended approach

Run the same UPDATE once from existing DB bootstrap / `migrate.ts` (or init path already used by ops). Remove the three hot-path calls. Add a query-count / legacy-fixture regression that create/search/stats perform **0** table-wide repair UPDATEs.

### Risks / open questions

- DBs that never run `db:migrate` after upgrade — bootstrap must still repair once.
- Write contention: repair during migrate under load vs lazy first-request (issue wants migrate).
- `created_by = 'legacy'` default semantics must stay for new rows.

---

## #749 — architecture dependency 방향 · runtime cycle 회귀 차단

**Status:** Partial

### Evidence

| Claim | Location | Notes |
|-------|----------|-------|
| Documented direction `shared ← domains ← infrastructure` | `docs/agents/architecture.md:21` (section heading is `:19`; issue cited `:19`) | Direction claim **confirmed**; line number off-by-two |
| Existing architecture test is relation-scoped only | `packages/memento-core/src/test/architecture/dependency-boundaries.spec.ts:38-88` | Checks relation cache/retry imports, relation-graph factory, concrete `RelationGraph` allowlist — **not** general domain→infra / shared→infra |
| Runtime cycle 1 | `shared/utils/database.ts:7` → `database/schema-initialization.ts:3` → `fts5-migration-status.ts:9` → `./database.js` | **Confirmed** |
| Runtime cycle 2 | `batch-scheduler/batch-scheduler-singleton.ts:1` imports `BatchScheduler` from `../batch-scheduler.js`; `batch-scheduler.ts:57-60` re-exports singleton helpers from that module | **Confirmed** circular module graph |
| AST tallies (domain→infra 18, shared→infra/server 5, cycles 2) | Spot-check: `rg -l` domain→`infrastructure` production files ≈ **18**; shared→infra ≈ **4** (server packages not in that scan) | Tallies **not fully re-audited** this session → Partial |

### Recommended approach

Extend `dependency-boundaries.spec.ts` (no new analyzer deps): fail on new domain→infrastructure and shared→infrastructure/server imports; freeze current offenders in an explicit allowlist. Break the two cycles with existing patterns (`import type`, move shared helpers out of `database.ts`, keep scheduler types in `batch-scheduler-types` / AGENTS.md guidance).

### Risks / open questions

- Allowlist size may be large on day one — enforce “allowlist growth fails CI” as stated in the issue.
- Full AST inventory should be refreshed once in plan/implement so allowlist is complete.
- graphify report is community-heavy; optional for cycle hunting (see Cross-cutting).

---

## Cross-cutting

- **Monorepo packaging:** #752 (root pack closure) and #750 (scripts still assume pre-workspace `src/`) are two faces of the same 013-refactor leftover; fix independently but avoid conflicting public-export changes.
- **CI truthfulness:** #751 (nightly empty green) and #754 (assistant `test:ci` skips `test/`) both hide real failures behind “passing” jobs.
- **DB safety:** #755 (atomic rebuild) and #753 (one-shot metadata repair) both touch `memory_embedding` lifecycle — sequence migrate/bootstrap carefully so repair runs after schema is stable.
- **Security gate:** #756 is independent of functional fixes; can ship as its own PR.
- **graphify-out/GRAPH_REPORT.md:** Large community index (6711 nodes); useful for later cycle visualization, not required to confirm the two cycles above (direct import edges suffice). Rebuild after production code changes per AGENTS.md.

---

## Decisions for plan (lock in `plan.md`)

- **#752:** Prefer aligning root runtime/`bundledDependencies` + extending `verify-npm-pack-bundle.js` over introducing a new bundler; decide publish-vs-bundle for `@memento/agent-integration`.
- **#754:** Canonical recall wire = flatten nested `filters` at HTTP/MCP execute boundary (keep top-level fields valid); channel tags enforced by honoring client filters, not per-channel forks.
- **#750:** Fix only root-registered scripts; delete unused legacy/archive; replace SQL-clone integration tests with parameterized CLI smoke included in CI.
- **#755:** Single `db.transaction` around create/copy/drop/rename only (no new migration framework).
- **#751:** Dedicated env flag or step-local `CI=` unset for migration-runner include; PR CI exclude remains; fail on zero collected tests.
- **#756:** wanted-range bumps only + `npm audit --omit=dev` gate; document upstream-blocked ML deps without overrides.
- **#753:** Move `ensureMetadataDefaults` SQL into bootstrap/migrate once; remove create/search/stats calls; query-count regression required.
- **#749:** Extend existing `dependency-boundaries.spec.ts` with allowlist; break two confirmed cycles; do not add madge/dependency-cruiser.
- **PR strategy:** One child issue per PR (`Fixes #<n>`); P0 order from epic (#752 → #754 → #750 → #755 → #751 → #756), then P1 (#753, #749).
- **Verification:** Each PR: failing repro/test first, then fix; `type-check` + `lint` + targeted tests; graphify rebuild when production code changes.
