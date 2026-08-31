# Implementation Plan: 한국어 recall gold set 구축 및 #785 recall 재측정

**Branch**: `feature/test-quality-recall-gold-set-785-recall` | **Date**: 2026-08-31 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/661-808-korean-recall-gold/spec.md`
**Issue**: [#808](https://github.com/jee1/memento/issues/808) · Epic [#803](https://github.com/jee1/memento/issues/803)

**Setup note**: `setup-plan.sh --json` failed (`check_feature_branch` — branch lacks `NNN-` prefix). Paths taken from `.specify/feature.json` → `specs/661-808-korean-recall-gold`.

## Summary

#785 수정 후 `memento_prod` LoCoMo 1,536을 **재측정·기록**하고, 조사 융합·짧은 다개념을 담은 **합성 한국어 gold**를 기존 `agent-memory-benchmark` 하네스에 `--fixture` arm으로 연결한다. #804/#807 전후 비교는 동일 gold·동일 scorecard 스키마 + `reproduction.git_sha` / `ranking_version`으로 남긴다. 수치 quality gate·신규 nightly·새 평가 프레임워크는 없다 (measure-only).

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js ≥24, ES modules  
**Primary Dependencies**: 기존 `scripts/agent-memory-benchmark.ts` (+ adapter/production-adapter), Vitest; 신규 npm 의존성 없음  
**Storage**: JSON fixture + `.local/` scorecard artifacts (gitignore). DB 스키마 변경 없음  
**Testing**: Vitest — gold 스키마 검증·loader fail-closed·arm CLI smoke; LoCoMo 1536은 로컬(취득 시)  
**Target Platform**: CLI quality harness (로컬/야간 문서 절차)  
**Project Type**: npm workspaces monorepo — scripts + `tests/fixtures`  
**Performance Goals**: CI는 스키마/arm만 (초소형); 1536은 CI 밖  
**Constraints**: LoCoMo/라이브 원문 비커밋; 빈 `relevantIds` 금지; arm 미지정 에러; measure-only 라벨; MCP 스키마·ranking-weights 미변경  
**Scale/Scope**: 합성 gold ≥15 질의 + loader/검증 + CLI/docs + remasure/비교 기록 절차 (~6–12 파일)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Principle | Status | Notes |
|------|-----------|--------|-------|
| Test-First Delivery | I (MUST) | PASS | Gold 스키마·fail-closed·arm 선택 Red→Green 필수 |
| Backward Compatibility | II (MUST) | PASS | MCP/공개 검색 스키마 불변; scorecard 필드는 additive |
| Schema / Migration | III (MUST) | N/A | SQLite 마이그레이션 없음 |
| Quality Gates | IV (MUST) | PASS | lint / type-check / test; production core 미터치 시 graphify N/A — scripts만이면 docs/spec 예외 준수, core 건드리면 rebuild |
| Observability | V (SHOULD) | PASS | scorecard + reproduction; 실패는 abort/라벨 (가짜 수치 금지) |
| Additional Constraints | Additional | PASS | 합성 픽스처만 커밋; LoCoMo CC BY-NC 원본/파생 금지 |

**Post-design re-check**: Still PASS — contracts are fixture schema + scorecard arm labels; no DB migration; LoCoMo stays `.local/`.

## Project Structure

### Documentation (this feature)

```text
specs/661-808-korean-recall-gold/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── korean-gold-fixture.md
│   └── scorecard-korean-arm.md
├── remasure-locomo.md          # US1 측정 기록 템플릿 (구현 시 채움; 집계만)
├── before-after-804-807.md     # US4 비교 템플릿 (구현 시 채움)
├── redaction-checklist.md      # FR-025
├── spec.md
├── tasks.md
└── checklists/requirements.md
```

### Source Code (repository root)

```text
tests/fixtures/agent-memory-benchmark-ko/   # NEW — synthetic Korean gold (FR-012+)
  ├── manifest.json
  ├── corpus.jsonl
  ├── queries.json              # opaque id + query + relevantIds + tags[]
  ├── graph-edges.json
  ├── e2e-cases.json            # minimal for assertDatasetSafe patterns
  └── README.md

scripts/
  ├── agent-memory-benchmark.ts           # --arm / measure-only label; arm required when multi
  ├── agent-memory-benchmark-adapter.ts   # optional taskCases/tags load; assert tags
  ├── korean-gold-validate.ts             # NEW — CI schema validator (FR-013/021/026/028)
  ├── korean-gold-validate.spec.ts
  └── quality.ts                          # optional alias: korean:benchmark

docs/guides/ko/benchmark-datasets.md      # Korean arm + remasure 절차 링크
docs/agents/AGENTS.md or agent-workflow   # measure-only vs CI gate 한 줄 (필요 시)
```

**Structure Decision**: Extend **agent-memory-benchmark** `--fixture` path (not search-quality benchmark-v3). New fixture tree + validator; minimal CLI/docs. Do not overwrite `benchmark-v3` (empty relevantIds legacy).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |

## Architecture

```text
US1 LoCoMo remasure (local, acquired corpus)
  quality locomo acquire → agent-memory-benchmark --locomo --production
  → .local/locomo/latest/results.json  (reproduction.git_sha + ranking_version)
  → specs/.../remasure-locomo.md aggregates only

US2–US3 Korean gold arm
  tests/fixtures/agent-memory-benchmark-ko/
        │
        ▼
  korean-gold-validate (CI) ── fail-closed schema/tags/IDs
        │
        ▼
  agent-memory-benchmark --fixture …-ko --production --arm korean
        │
        ▼
  runProductionRecallBenchmark → scorecard.recall_at_10 / mrr
  report.reproduction.git_sha + ranking_version + embedding_provider
  label: measure_only=true

US4 before/after
  same fixture + SHA pairs → before-after-804-807.md
```

## Implementation Phases (design intent for `/speckit.tasks`)

1. **Foundational** — Fixture schema contract + `korean-gold-validate` Red→Green; closed tags; opaque ids; non-empty relevantIds; synthetic fixture IDs only.
2. **US2** — Author ≥15 synthetic queries (particle + multi-concept); corpus self-contained.
3. **US3** — Wire `--fixture` ko dir; `--arm korean` / measure-only label; optional `quality.ts` alias; docs.
4. **US1** — Document remasure procedure; fill `remasure-locomo.md` when `.local/locomo/` present (block complete until measured).
5. **US4** — Comparison template + optional ablation on/off / quarantine snapshot recording.
6. **Polish** — lint, type-check, targeted tests; redaction checklist; no LoCoMo commit.

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Fake LoCoMo numbers | FR-016/018 abort; no baseline promote on incomplete |
| Mixing EN+KO aggregates | FR-019 arm required; separate keys |
| Live IDs in gold | FR-015 validator rejects non-fixture ID prefixes |
| Using benchmark-v3 as gold | Explicitly out; empty relevantIds fail FR-028 |
| Turning measure into #731 gate | FR-024 out of scope |

## Setup note

Run `.specify/scripts/bash/update-agent-context.sh cursor-agent` after Phase 1 to append Recent Changes for 661-808.
