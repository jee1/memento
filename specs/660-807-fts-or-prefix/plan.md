# Implementation Plan: 짧은 다개념 검색이 텍스트 후보를 잃는다

**Branch**: `660-807-fts-or-prefix` | **Date**: 2026-08-29 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/660-807-fts-or-prefix/spec.md`
**Issue**: [#807](https://github.com/jee1/memento/issues/807) · Epic [#803](https://github.com/jee1/memento/issues/803)

## Summary

짧은 FTS 쿼리의 암시적 AND 결합자를 **OR + 접두(`*`) 확장**으로 바꿔, 다개념·한국어 조사 표면형에서도 텍스트 후보가 0이 되지 않게 한다. 변경은 공유 `buildFTSQuery` 한 곳(및 상수·문서·회귀 테스트)에 한정한다. 채택 전 ablation 표를 feature 산출물에 남기고, 정밀도 판정은 #806 절대 벡터 점수 이후(텍스트 후보 교정·합성 게이트는 병렬). `ranking-weights.toml`·MCP 스키마·토큰 경계 재설계·trigram 기본값 전환·kill-switch env는 하지 않는다.

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js ≥24, ES modules  
**Primary Dependencies**: `@memento/core` search engine (SQLite FTS5), Vitest; 신규 npm 의존성 없음  
**Storage**: SQLite FTS5 `memory_item_fts` (unicode61) — **스키마/인덱스 재구축 없음** (기본 경로)  
**Testing**: Vitest — `search-engine.spec.ts` / 신규 FTS 쿼리·픽스처 회귀; 선택적 in-memory FTS5 후보 수 검증; 영어 벤치는 기존 nightly/게이트  
**Target Platform**: MCP server / HTTP admin (동일 core 검색 경로)  
**Project Type**: npm workspaces library (`packages/memento-core`) + agent docs  
**Performance Goals**: 기존 텍스트 후보 LIMIT·하이브리드 p95 예산 유지; 무제한 후보 풀 금지  
**Constraints**: MCP/검색 도구 스키마 불변; 랭킹 가중치 미튜닝; LoCoMo 원본 커밋 금지; 사용자 FTS 연산자 주입 금지; 최소 어간 길이 미만 접두 미적용  
**Scale/Scope**: ~1 쿼리 빌더 + constants + docs + ablation artifact + 회귀 테스트 (대략 5–8 파일)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Test-First | PASS | 짧은 쿼리 AND 가정 테스트 → OR+prefix 기대값으로 Red 먼저; `text_candidate_count > 0` 픽스처 Red→Green |
| II. Backward Compatibility | PASS | 공개 MCP/검색 **스키마** 불변(FR-018/SC-008). 결과 **집합/순위**는 품질 교정으로 바뀔 수 있음 — 문서·ablation에 명시 |
| III. Schema / Migration | PASS | 기본 경로 마이그레이션 없음. trigram은 비교 기록만(Out of Scope) |
| IV. Quality Gates | PASS (at completion) | lint / type-check / test + graphify rebuild after production code |
| V. Observability | PASS | 기존 `text_candidate_count` funnel 재사용(FR-019); 새 텔레메트리 키 없음 |
| Additional: security | PASS | 연산자 주입 차단(FR-015); 신규 auth 없음 |
| Additional: LoCoMo | PASS | 합성 픽스처만 커밋; 원본/파생 코퍼스 금지(FR-013) |

**Post-design re-check**: Still PASS — contracts are internal FTS combinator + “schema unchanged”; no DB migration; fail-closed adoption (미채택 시 기본값 유지).

## Project Structure

### Documentation (this feature)

```text
specs/660-807-fts-or-prefix/
├── plan.md                 # This file
├── research.md             # Phase 0
├── data-model.md           # Phase 1
├── quickstart.md           # Phase 1
├── contracts/              # Phase 1
│   ├── fts-query-combinator.md
│   └── mcp-search-schema-unchanged.md
├── fts-query-ablation.md   # Ablation 표 (구현/측정 시 채움; FR-021)
├── spec.md
└── tasks.md                # Phase 2 (/speckit.tasks — not this command)
```

### Source Code (repository root)

```text
packages/memento-core/src/
├── domains/search/algorithms/
│   ├── search-engine/search-engine-fts-query.ts   # buildFTSQuery / preprocess / makeFTSSafe
│   └── __tests__/search-engine.spec.ts            # short AND→OR+prefix 기대값 갱신
├── shared/config/constants.ts                     # + FTS_MIN_PREFIX_STEM_LENGTH (=2)
└── (optional) domains/search/.../__tests__/
    └── fts-or-prefix-candidates.spec.ts           # 합성 픽스처 text 후보 > 0

docs/agents/search-ranking.md                      # combinator 계약 갱신
specs/061-785-epic-search-production-recall/
└── fts-query-ablation.md                          # 교차 링크만 (본 이슈 표는 660 산출물)
```

**Structure Decision**: Touch the existing shared FTS query builder only. No new package, no ranking-weights edit, no MCP tool schema files.

## Complexity Tracking

> No constitution violations requiring justification.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |

## Architecture

```text
recall / memory_injection / admin search / reflection notes
        │
        ▼
HybridSearchEngine / SearchEngine
        │
        ▼
buildFTSQuery(query)          ◄── single combinator+prefix policy (FR-020)
  preprocessQuery             # strip punctuation → content words; stopwords
  per-token prefix* if len ≥ FTS_MIN_PREFIX_STEM_LENGTH
  join with OR (short and long); long still capped at FTS_MAX_TOKENS_FOR_OR
  makeFTSSafe                 # quotes/brackets; keep trailing *
        │
        ▼
FTS5 MATCH … LIMIT (existing caps) → text candidates → hybrid rank
```

## Implementation Phases (design intent for `/speckit.tasks`)

1. **Red tests** — Update/add `buildFTSQuery` expectations (short contains `OR` + `*`); synthetic multi-concept fixture expects `text_candidate_count > 0`; morphology fixture (조사 붙은 본문 vs 어간 쿼리).
2. **Constants** — `HYBRID_SEARCH.FTS_MIN_PREFIX_STEM_LENGTH = 2` (Q1/R2).
3. **Query builder** — Implement OR+prefix for all content-word paths; preserve empty → `""`; preserve max-token cap on long path.
4. **Ablation artifact** — Fill `specs/660-807-fts-or-prefix/fts-query-ablation.md` (candidate rows + adopt/reject); trigram = compare-only note.
5. **Docs** — `docs/agents/search-ranking.md` FTS combinator paragraph; link #807.
6. **Adoption gate** — Text/synth gates can land without #806; vector-precision adoption judgment waits on #806 (Q8). English = existing nightly/bench (Q7).
7. **Verify** — lint, type-check, targeted + relevant search tests, graphify rebuild.

## Risks & mitigations

| Risk | Mitigation |
|------|------------|
| Precision↓ after OR | Fail-closed: do not flip global default if SC-002 / English gates fail (FR-006/Q3) |
| Prefix flood on 1-char stems | Min stem length 2 (FR-014) |
| Operator injection | preprocess strips non-content; no raw user operators (FR-015) |
| Test drift (short = AND) | Update `search-engine.spec.ts` in same change set |
| Confounding with #806 | Separate “candidate fix” vs “precision adopt” in ablation notes |

## Setup note

`update-agent-context.sh cursor-agent` after Phase 1 to append Recent Changes for 660-807.
