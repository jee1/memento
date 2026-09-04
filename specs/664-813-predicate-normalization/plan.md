# Implementation Plan: triple predicate 정규화 게이트 (#813)

**Branch**: `fix-semantic-triple-2026-08-11.6-predicate` | **Date**: 2026-09-04 | **Spec**: [spec.md](./spec.md)
**Issue**: [#813](https://github.com/jee1/memento/issues/813) | **Epic**: [#803](https://github.com/jee1/memento/issues/803)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Spec Kit next step: `/speckit.tasks` → `tasks.md`.

**Goal:** Block non-canonical / unreassemblable predicates from semantic + `kg_triple` persist, surface skip reasons, and ship a read-only quality CLI — without MCP or schema changes.

**Architecture:** Single choke-point gate in `TripleNormalizer`: no canonicalize pass-through; Hangul OOV single-token accepted only if `buildTripleSentence` succeeds; otherwise drop with fixed reason codes. Wire skips into extraction metadata and soft-success when all triples are gated. Operator CLI aggregates `kg_triple` predicate quality (synthetic fixtures in CI).

**Tech Stack:** TypeScript 5.x, Node ≥24, Vitest, better-sqlite3, existing `@memento/core` triple-extraction / semantic conversion paths.

**Spec:** [specs/664-813-predicate-normalization/spec.md](./spec.md)

## Global Constraints

- No `kg_triple` / `memory_item` schema migration
- No MCP tool contract or search response schema change (FR-008)
- No bulk backfill of existing form-(2) / polluted `kg_triple` (OQ-4)
- No head-word heuristic; no `conjugatePredicate` English/phrase rules
- Synthetic fixtures only (FR-010); CI asserts gated-path form-(2) **0%**, not live <1%
- AGENTS #768: use `buildTripleSentence()` only; never append `합니다` to canonical predicates
- TDD Red-Green-Refactor (Constitution I)

---

## Summary

August 2026 form-(2) fallback surge (11.6%) is driven by phrase / non-Hangul-terminating predicates that `PredicateCanonicalizer` fails to map, while `TripleNormalizer` still passes the raw predicate through. `tripleToNaturalLanguage` then stores episodic source text. This plan closes the gate at normalize time, records `predicate_empty` | `predicate_canonicalize_failed` | `predicate_reassembly_failed`, keeps partial success / remember primary path up, and adds `npm run memory:kg-triple-predicate-quality` for ops observation. Details: [research.md](./research.md), [data-model.md](./data-model.md), [quickstart.md](./quickstart.md).

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js ≥24, ES modules  
**Primary Dependencies**: `@memento/core` (triple-extraction, semantic conversion), better-sqlite3, Vitest  
**Storage**: SQLite `memory_item` + `kg_triple` (read/write gated predicates; no DDL)  
**Testing**: Vitest colocated domain + script specs; synthetic DB only  
**Target Platform**: memento-server MCP (unchanged contracts) + operator CLI  
**Performance Goals**: O(n) normalize filter; CLI aggregates + sample cap ≤20  
**Constraints**: No MCP/schema/backfill; FR-006 no abs path / full ID dumps in CLI stdout  
**Scale/Scope**: Extraction + persist gate; one npm quality report; ~5–8 production files + tests

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design — **all PASS**.*

| Gate | Principle | Status | Notes |
|------|-----------|--------|-------|
| Test-First Delivery: failing tests precede implementation (Red-Green-Refactor). N/A only under the structural-refactoring exception. | I (MUST) | PASS | RED first for normalizer drop/OOV, conversion soft-success, CLI report; see Testing strategy |
| Backward compatibility of MCP tool contracts and stable API behavior; unavoidable breaks carry migration and compatibility notes in spec/plan/tasks. | II (MUST) | PASS | FR-008: recall/remember schemas unchanged; internal ExtractionInfo/metadata additive only |
| Schema changes ship with migration files and synchronized schema artifacts and type definitions. | III (MUST) | PASS | No DDL/migration; discipline satisfied by Non-Goal (gated upserts only on existing `kg_triple`) |
| Quality gates before completion: `npm run lint`, `npm run type-check`, `npm test` pass; production-code changes also rebuild graphify and confirm `graphify-out/GRAPH_REPORT.md`. | IV (MUST) | PASS | SC-004; graphify after prod code edits |
| Operational failures are observable via structured logs and degrade gracefully without breaking primary response paths. | V (SHOULD) | PASS | FR-007/009 skip reasons + partial success; remember not hard-failed by gate |
| Additional Constraints: Node.js 24+ / TypeScript ESM, npm workspaces, security/auth scope changes specified explicitly, no non-redistributable corpora or derived data committed (LoCoMo CC BY-NC). | Additional Constraints | PASS | Node 24 workspaces; FR-010 synthetic fixtures; no auth scope change |

## Project Structure

### Documentation (this feature)

```text
specs/664-813-predicate-normalization/
├── spec.md           # Ready for Planning
├── plan.md           # This file
├── research.md       # Phase 0
├── data-model.md     # Phase 1
├── quickstart.md     # Phase 1
├── progress.yml
└── tasks.md          # Phase 2 (/speckit.tasks — not created here)
```

### Source Code (repository root)

```text
packages/memento-core/src/
├── domains/relation/services/triple-extraction/
│   ├── triple-normalizer.ts              # GATE: filter + reasons
│   ├── interfaces.ts                     # ITripleNormalizer / report types
│   ├── predicate-canonicalizer.ts        # unchanged behavior (dictionary)
│   ├── triple-extraction-service.ts      # fold skips into ExtractionInfo
│   └── __tests__/triple-normalizer.spec.ts
├── domains/memory/semantic/
│   ├── triple-sentence.ts                # buildTripleSentence (consume only)
│   ├── semantic-memory-scoring.ts        # form-(2) fallback remains for legacy; gated path avoids it
│   ├── semantic-memory-crud.ts           # create + kg_triple upsert (consumes gated triples)
│   ├── semantic-memory-update-pipeline.ts
│   ├── episodic-semantic-conversion.ts   # all-gate-empty soft success
│   ├── triple-extraction-metadata.ts     # additive skip keys
│   └── shared types: packages/memento-core/src/shared/types/triple-extraction.ts
scripts/
├── kg-triple-predicate-quality.ts        # NEW CLI entry
├── lib/kg-triple-predicate-quality.ts    # NEW pure report builder (preferred)
└── kg-triple-predicate-quality.spec.ts   # NEW
package.json                              # memory:kg-triple-predicate-quality script
```

**Structure Decision**: Stay inside existing relation triple-extraction + semantic conversion packages; add operator CLI under `scripts/` mirroring `db:residue` / `memory:repair-triple-sentences`. No new package.

## Complexity Tracking

No constitution violations.

---

## Architecture / gate flow

```text
LLM parse → Triple[]
    ↓
TripleNormalizer.normalizeWithReport
    ├─ empty/whitespace     → skip predicate_empty
    ├─ canonicalize OK
    │     └─ buildTripleSentence OK? → accept canonical
    │        else → skip predicate_reassembly_failed
    └─ canonicalize FAIL
          ├─ hangul single-token (no space) + buildTripleSentence OK → accept OOV
          ├─ hangul single-token + reassembly null → skip predicate_reassembly_failed
          └─ else (phrase / Latin / …) → skip predicate_canonicalize_failed
    ↓
accepted Triple[] + skips[]
    ↓
TripleExtractionService → ExtractionInfo.predicateSkips / counts
    ↓
convertEpisodicSource / remember augmentation
    ├─ accepted.length ≥ 1 → updateSemanticMemoryWithEvidence (create + kg_triple)
    ├─ accepted.length = 0 && had LLM triples → soft success + skip metadata (FR-009)
    └─ true LLM empty / parse fail → existing failure path
    ↓
createSemanticMemory: buildTripleSentence succeeds for gated preds → no form-(2)
```

**Invariant:** `TripleNormalizer` MUST NOT return a predicate that failed canonicalize unless the Hangul OOV rule passed. Pass-through (`success ? canonical : triple.predicate`) is deleted.

**OOV caveat:** Do not treat “`buildTripleSentence` succeeded” alone as OOV accept — phrases ending in Hangul can conjugate. Require **no whitespace** + Hangul terminal + reassembly.

---

## Files to create / modify

| Action | Path | Why |
|--------|------|-----|
| Modify | `triple-normalizer.ts` | Gate + report |
| Modify | `interfaces.ts` | Types for report / skip reason |
| Modify | `shared/types/triple-extraction.ts` | Additive ExtractionInfo fields; export `PredicateSkipReason` |
| Modify | `triple-extraction-service.ts` | Attach skips to result |
| Modify | `__tests__/triple-normalizer.spec.ts` | Replace pass-through expectations; add FR scenarios |
| Modify | `triple-extraction-metadata.ts` | Skip count/reason keys |
| Modify | `episodic-semantic-conversion.ts` | Soft success when all gated |
| Modify | `package.json` | npm script |
| Create | `scripts/lib/kg-triple-predicate-quality.ts` | Pure report |
| Create | `scripts/kg-triple-predicate-quality.ts` | CLI |
| Create | `scripts/kg-triple-predicate-quality.spec.ts` (or under lib) | CLI tests |
| Optional | `semantic-memory-scoring.spec.ts` / quality-persistence | Assert no form-(2) for gated fixtures |
| Optional | CHANGELOG / AGENTS gotcha one-liner | Ops discoverability (minimal) |

**Do not modify (v1):** `predicate-canonicalizer.ts` dictionary growth; `triple-sentence.ts` conjugation rules; MCP tool schemas; migrations; #804 quarantine FR-001b.

---

## Testing strategy (TDD)

1. **Normalizer unit (P1)** — RED: phrase `관련 작업` dropped with `predicate_canonicalize_failed`; `use` without dict dropped; `use` with dict → `사용함`; `사용함` accepted; `배포함` OOV accepted iff reassembly OK; hangul OOV reassembly-null → `predicate_reassembly_failed`; empty → `predicate_empty`; mixed batch → partial accept + skips. Rewrite existing “unknownPredicate kept” test.
2. **Extraction service** — skips appear on `ExtractionInfo`; accepted list only.
3. **Conversion** — all-skipped after LLM triples → not `buildFailureOutcome` / not hard fail; metadata has skip aggregates; ≥1 good triple persists; SC-007.
4. **Persist / form-(2)** — synthetic path: bad predicate never yields content === episodic fallback (SC-001/002); good → `buildTripleSentence` content; `kg_triple.predicate` Hangul-terminating / gated.
5. **CLI** — seed 9 hangul + 1 non-hangul; rate ≈ 0.9; row count unchanged; no abs path in output (SC-003/FR-006).
6. **Regression** — `npm run lint`, `type-check`, domain suites; MCP contract smoke if present (SC-004/005).

---

## Execution strategy

| Tag | Meaning |
|-----|---------|
| `[P]` | Parallelizable after deps land (docs, CLI vs core gate once types exist) |
| `[TDD]` | Red → Green → Refactor mandatory |
| `[SUBAGENT]` | Suitable for fresh subagent per task with review gate |

| Phase | Focus | Tags | Verify |
|-------|-------|------|--------|
| 0 | Research locked (this folder) | — | research.md done |
| 1 | Types + normalizer gate | `[TDD]` `[SUBAGENT]` | normalizer.spec green |
| 2 | ExtractionInfo + service wiring | `[TDD]` `[SUBAGENT]` | service/metadata specs |
| 3 | convertEpisodicSource soft success | `[TDD]` `[SUBAGENT]` | conversion + SC-007 |
| 4 | Persist form-(2) zero fixture | `[TDD]` | quality-persistence / scoring |
| 5 | Quality CLI + npm script | `[TDD]` `[P]` `[SUBAGENT]` | CLI spec + quickstart |
| 6 | Polish: lint/type-check/graphify; optional CHANGELOG | `[P]` | SC-004 |

---

## Phase plan (for later `tasks.md`)

### Phase 1 — Gate core `[TDD]` `[SUBAGENT]`

**Files:** `triple-normalizer.ts`, `interfaces.ts`, `shared/types/triple-extraction.ts`, `__tests__/triple-normalizer.spec.ts`

- [ ] **Step 1: Write failing tests** for FR-001 scenarios 1–5 and empty/partial batch (see Testing strategy). Expect current pass-through to fail new assertions.
- [ ] **Step 2: Run** `npm test -- .../triple-normalizer.spec.ts` — expect RED.
- [ ] **Step 3: Implement** `normalizeWithReport` + hangul-single-token helper (shared or private); `normalize` returns accepted only.
- [ ] **Step 4: GREEN** same test file.
- [ ] **Step 5: Commit** (when user requests) `fix(triple): gate predicates in TripleNormalizer (#813)`.

### Phase 2 — Extraction wiring `[TDD]` `[SUBAGENT]`

**Files:** `triple-extraction-service.ts`, `triple-extraction.ts` types, related specs

- [ ] Attach `skips` to `ExtractionInfo`; structured log reason codes (FR-007).
- [ ] Ensure `result.triples` contains only accepted rows.

### Phase 3 — Conversion / metadata `[TDD]` `[SUBAGENT]`

**Files:** `episodic-semantic-conversion.ts`, `triple-extraction-metadata.ts`, conversion specs

- [ ] Extend `buildTripleExtractionSuccessMetadata` with skip aggregates.
- [ ] All-gate-empty → soft success (FR-009 / OQ-7); LLM-true-empty unchanged.
- [ ] Partial success: good triples persist; skips recorded.

### Phase 4 — Persist zero form-(2) `[TDD]`

**Files:** semantic quality/persistence specs (prefer existing harnesses)

- [ ] Fixture: phrase/Latin predicates → 0 semantic form-(2), 0 bad `kg_triple`.
- [ ] Fixture: canonical / OOV hangul → reassembled content only.

### Phase 5 — CLI `[TDD]` `[P]` `[SUBAGENT]`

**Files:** `scripts/lib/kg-triple-predicate-quality.ts`, `scripts/kg-triple-predicate-quality.ts`, spec, `package.json`

- [ ] Report builder + CLI (db:residue style).
- [ ] `memory:kg-triple-predicate-quality` script.
- [ ] Read-only + sample cap + no abs path (FR-005/006).

### Phase 6 — Handoff

- [ ] `npm run lint && npm run type-check` + domain tests.
- [ ] graphify rebuild after prod code.
- [ ] Quickstart commands match shipped script name.

---

## Spec coverage checklist (self-review)

| Requirement | Plan locus |
|-------------|------------|
| FR-001 / FR-002 gate | Phase 1 Architecture |
| FR-003 no form-(2) | Phase 4 + gate |
| FR-004 kg_triple gated | Phase 1+4 (same accepted list) |
| FR-005 / FR-006 CLI | Phase 5 |
| FR-007 reasons | Decision 3 + Phase 2 |
| FR-008 MCP unchanged | Global Constraints |
| FR-009 partial / soft success | Phase 3 |
| FR-010 synthetic | Global + CLI tests |
| SC-001..007 | Testing strategy |
| OQ-1..8 | research.md |

## Dependencies / risks

- Existing `triple-normalizer.spec.ts` **documents** pass-through — must rewrite first (expected churn).
- `convertEpisodicSource` empty-triple failure is a **behavior change** only for gate-filtered empties; keep true `no_triple` failure intact.
- Remember augmentation shares `convertEpisodicSource` (#805) — soft success protects primary remember path.

## Out of scope reminder

Dictionary harvest, admin telemetry HTTP, #804 FR-001b change, bulk backfill, conjugatePredicate expansion.
