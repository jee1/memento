# Maintainer map: Production maintainability program (013-refactor-approach)

**Status**: Living document (FR-007, FR-017). **Authoritative copy** — in-repo path per FR-025.  
**Related**: `plan.md`, `spec.md`, `manual-regression-checklist.md`.

## FR-015 (program-level heuristic / static quality)

Heuristic or static quality scores (e.g. complexity, deficit-style metrics) MAY inform prioritization and code review but are NOT mandatory merge gates for this program unless a separate engineering policy mandates them.

## Capability boundaries (six areas)

| Area | Owning paths | What belongs here |
|------|----------------|-------------------|
| **Agent memory recall** | `packages/memento-core/src/domains/memory/` (tools: `tools/recall-tool.ts`, `tools/recall-tool-telemetry.ts`; services: neighbors, anchors, core memory, embeddings used by recall) | MCP `recall` orchestration, filters, hybrid vs FTS paths, anchors, neighbors, procedural/version options on recall |
| **Hybrid search** | `packages/memento-core/src/domains/search/` — `algorithms/hybrid-search-engine.ts`, `search-ranking.ts`, `search-result-combiner.ts`, `search-engine.ts`, vector helpers | Ranking composition, provider execution, merging text+vector results, adaptive weights (not MCP recall-only glue) |
| **Scheduled background** | `packages/memento-core/src/infrastructure/scheduler/` (`batch-scheduler.ts`, jobs, `job-queue.ts`, `retry-manager.ts`) | Config intervals, job execution, retries, failure handling — not domain recall/search HTTP |
| **Relationship extraction** | `packages/memento-core/src/domains/relation/` — `services/relation-extractor.ts`, `services/triple-extraction/triple-extraction-service.ts` | Provider selection vs orchestration vs persistence hooks for triples/relations |
| **Administrative HTTP** | `packages/memento-server/src/server/http-server.ts` (mount + auth), `packages/memento-server/src/server/routes/admin.routes.ts`, `packages/memento-server/src/server/routes/admin/*.routes.ts` | `/admin/*` registration; must stay behind `createAdminAuthMiddleware` |
| **Embedding pipeline** | `packages/memento-core/src/domains/embedding/` — `providers/embedding-provider-factory.ts`, `services/unified-embedding-service.ts` | Provider selection, untyped boundary safety, unified embedding API |

### Layering: hybrid search (ranking vs providers vs merge)

- **Ranking / scoring**: `search-ranking.ts` (features → score), feedback weights from `FeedbackRepository`.
- **Provider execution**: `MemoryEmbeddingService`, `vector-search-engine.ts`, FTS via `SearchEngine` inside `hybrid-search-engine.ts`.
- **Merge / dedupe**: `search-result-combiner.ts` — combines text + vector lists after retrieval.

### Memory recall — file anchors (US1)

- **Orchestration**: `packages/memento-core/src/domains/memory/tools/recall-tool.ts`
- **Telemetry helpers (extracted)**: `packages/memento-core/src/domains/memory/tools/recall-tool-telemetry.ts`
- **Neighbors / anchors**: `packages/memento-core/src/domains/memory/services/memory-neighbor-service.ts` (and anchor services under `domains/memory/` / `domains/anchor/` as wired by bootstrap)
- **FR-011 (recall increment)**: Telemetry `memory.search.*` / recall-related events when enabled; structured debug logs in recall path; no new alerts required for this structural pass.

### Administrative HTTP — structured outline (US2)

| Route group | Capability | Auth expectation |
|-------------|------------|------------------|
| `/admin/memory/*`, `/admin/database/*` | Cleanup, optimize, convert, meta-stats | Authenticated admin only (same as pre-refactor) |
| `/admin/stats/*`, `/admin/alerts/*`, `/admin/performance/*` | Stats, alerts, performance metrics | Authenticated admin |
| `/admin/batch/*`, `/admin/consolidation/*` | Scheduler / consolidation triggers | Authenticated admin |
| `/admin/relations/*` | Relation CRUD, extract, visualize | Authenticated admin (`admin-relations.routes.ts`) |
| `/admin/anchors/*`, `/admin/embeddings/*` | Anchors restore, embedding migration | Authenticated admin |
| `/admin/telemetry/*` | Telemetry quality / events | Authenticated admin (`admin-telemetry.routes.ts`) |
| `/admin/graph` | Graph JSON for memory graph UI | Authenticated admin (`admin-graph.routes.ts`) |

**SC-003 session (template)**: Time-box ≤60 min using this outline; record actual duration, pass/fail vs time box, reviewer notes in PR or appendix here.

### Scheduled background (FR-014 increment)

- **Code**: `packages/memento-core/src/infrastructure/scheduler/batch-scheduler.ts` — configuration vs interval registration vs per-job execution/failure paths.
- **FR-011 touchpoints**: Structured logs via `logger` / `mcpLogger`; admin `/admin/batch/status` for queue visibility; no new metrics required for this structural pass.

### Relationship extraction (FR-014 increment)

- **Code**: `relation-extractor.ts` + `triple-extraction-service.ts` — keep provider selection and orchestration boundaries clear.
- **FR-011 touchpoints**: Triple-extraction logger; admin `POST /admin/relations/extract` for manual runs.

### Embedding pipeline (FR-014 increment)

- **Code**: `embedding-provider-factory.ts`, `unified-embedding-service.ts` — tighten types at module boundaries.
- **FR-011 touchpoints**: Provider selection logs; embedding migration remains `POST /admin/embeddings/migrate`.

## Increment map

| Increment / PR | Capability | Merged (Y/N) | Notes |
|----------------|------------|--------------|-------|
| 013 docs + recall telemetry extract | recall | Y | `recall-tool-telemetry.ts` |
| 013 admin route modules | admin HTTP | Y | `routes/admin/*.routes.ts` |
| 013 search/batch/relation/embedding refactors | search / scheduler / relation / embedding | N | Track per PR |

## FR-014 first-wave tracking

All **six** rows in **Capability boundaries** must have ≥1 merged increment on `main` for first-wave completion. Update this table when each lands.

## SC-002 measurement (FR-016, FR-023)

- **Primary defect source**: GitHub Issues — this repository.
- **Recall/search relevance**: Issues with labels `area:recall` OR `area:search`, OR saved GitHub search as documented in team runbook (mirror query text in release notes if labels missing).
- **Baseline window**: Prior **three** releases (tags recorded in `maintainer-map.md` or release notes).
- **Post-program**: Two consecutive releases after program start; same counting rules as baseline.
- **Meaningful worsening (fixed parameters)**:
  - **σ-rule**: Flag worsening if recall/search defect **count** for a release exceeds **rolling median of the baseline window + N×σ** (σ = sample std dev of those three baseline counts; **N = 2** for this program).
  - **Alternate rule (either/or with σ-rule)**: **Strict increase** in **P0+P1** recall/search counts vs the maximum of the baseline window counts.
- **Release comparison template** (repeat each snapshot):

| Release | Recall/search count | P0+P1 | Baseline ref | Rule applied | Pass/Fail |
|---------|---------------------|-------|--------------|--------------|-----------|
| *tag* | | | prior 3 releases | N=2 σ or P0/P1 | |

## SC-001 / SC-004 quarterly retrospectives (FR-021, FR-022)

- **SC-001**: Cohort size, first-attempt correctness %, pool limitations — **minimum 3 participants** when &lt;5 available.
- **SC-004**: Primary instrument — **5-point Likert** (see `research.md` §8). **≥30%** “somewhat shorter or better” (4–5) target when **≥3** responses (or ≥5 when enough contributors). Document participant counts each quarter.

### SC-004 instrument (pre-condition — T028)

Primary scale: **5-point Likert** per `research.md` §8 (instrument v1.0, 2026-04-12). Reuse across quarters; bump version if prompts change.

### SC-001 / SC-004 schedule placeholders

| Wave | SC-001 exercise | SC-004 survey | Notes |
|------|-----------------|---------------|-------|
| Q1 program | *Scheduled: TBD* | *Scheduled: TBD* | Record cohort & limitations when run |

## SC-002 cadence (T029 placeholder)

After T005 parameters are fixed (this document §SC-002 measurement), run defect snapshots for **two consecutive releases** post program-start using GitHub Issues + rules in `research.md` §3–4. Add rows to the release comparison template above.

## Links

- Program spec: `spec.md`
- Merge gates contract: `contracts/merge-gates.md`
- Manual regression: `manual-regression-checklist.md`
- Research / SC-004 instrument: `research.md`
