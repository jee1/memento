# Research: FTS OR + prefix* ablation (#807)

**Feature**: `specs/660-807-fts-or-prefix`  
**Date**: 2026-08-29  
**Sources**: [spec.md](./spec.md), [#807](https://github.com/jee1/memento/issues/807), `search-engine-fts-query.ts`, `HYBRID_SEARCH` constants, `docs/agents/search-ranking.md`, `specs/061-…/fts-query-ablation.md`

## R1 — Short combinator: AND → OR (boundary unchanged)

**Decision**: Keep `FTS_OR_ABOVE_TOKEN_COUNT = 5` and `FTS_MAX_TOKENS_FOR_OR = 8` as documented short/long **classification** and long-path cap. Change short-path emission from space-separated (FTS5 implicit AND) to `OR`-joined terms. Long path remains first-N `OR`, and gains prefix (R3).

**Rationale**: Spec Out of Scope forbids redesigning the token-count boundary; issue live corpus shows 4-token AND → 0 matches while OR → 713. FR-001/FR-003/Q5.

**Alternatives considered**:
- Always-OR unify and delete `FTS_OR_ABOVE_TOKEN_COUNT` → boundary redesign; rejected for this issue.
- All-token OR without 8-cap on long queries → prior #787 ablation deferred for p95; keep cap (FR-017).

## R2 — Minimum prefix stem length = 2

**Decision**: Add `HYBRID_SEARCH.FTS_MIN_PREFIX_STEM_LENGTH = 2`. Apply `*` only when `token.length >= 2` (JS string length; Hangul syllable = 1). Shorter tokens stay exact match.

**Rationale**: Spec Q1/FR-014; 1-char prefix floods candidates. Issue examples (`가중치`, `검색`) are ≥2.

**Alternatives considered**:
- Prefix everything → candidate blast; rejected.
- Min length 3 → may miss useful 2-char Korean stems; defer unless ablation shows flood at 2.
- Script-specific rules → rejected (Q13).

## R3 — Prefix on short **and** long content words

**Decision**: After `preprocessQuery`, for each remaining content word meeting R2, append FTS5 prefix star (`term*`), then join with ` OR `. Apply on both short and long branches.

**Rationale**: Issue table: `검색* OR …` ≥ LIKE truth; morphology loss is language-side, not short-only (Q5/FR-016).

**Alternatives considered**:
- Prefix only on short path → leaves long-query morphology gap; rejected by Q5.
- Trigram tokenizer default → index rebuild; compare-only (FR-010).

## R4 — `makeFTSSafe` ordering and `*`

**Decision**: Build combinator string with intentional `OR` and trailing `*` **before** `makeFTSSafe`. Confirm `makeFTSSafe` does not strip `*` (current impl only escapes quotes and strips `[]{}()`). Do not treat user-supplied `AND`/`OR`/`"` as operators — `preprocessQuery` already strips non `[a-zA-Z0-9가-힣\s]`.

**Rationale**: FR-015/Q2; FTS5 needs literal prefix operator from our builder, not from users.

**Alternatives considered**:
- Allow quoted phrases from users → injection/confusion; rejected.
- Apply safe before adding `*` → risk of breaking tokens; prefer add-then-safe with `*` preserved.

## R5 — Ablation artifact location

**Decision**: Primary table at `specs/660-807-fts-or-prefix/fts-query-ablation.md` (plus short summary on issue #807). Cross-link from `specs/061-785-epic-search-production-recall/fts-query-ablation.md` (historical “deferred combinator” note).

**Rows to record** (minimum):
1. Current: short AND / long first-8 OR  
2. Short+long OR (no prefix)  
3. OR + prefix* (primary candidate)  
4. trigram tokenizer — compare-only / not default  

Metrics: text candidate counts on synthetic multi-concept fixture; optional live corpus counts (local only); top-10 relatedness (SC-002); English gate pass/fail; adopt/reject + reason. Vector precision columns only after #806.

**Rationale**: FR-021/SC-006/Q12; mirrors 061 pattern without inventing a new docs site.

## R6 — Adoption vs parallel work (#806 / #808)

**Decision**:
- **Ship candidate-fix tests** (SC-001/SC-003 style) without waiting on #806.
- **Do not declare precision-absorbed global default** using relative vector scores; wait for #806 absolute scores (FR-005/Q8).
- #808 gold Recall@10 is measurement when available, not hard ship gate (FR-012).

**Rationale**: Spec Q8/Q3; fail-closed default if precision not absorbed.

## R7 — Tests that must flip

**Decision**: Update `search-engine.spec.ts` case “짧은 쿼리(토큰 5개 이하)는 공백으로만 연결(AND 유지)” to expect `OR` and prefix stars (for stems ≥2). Add focused unit tests for: single-token prefix; 1-char no prefix; punctuation stripped; long path still capped and prefixed.

**Rationale**: Constitution I; existing test encodes the bug.

## R8 — Non-FTS LIKE fallback

**Decision**: Out of scope for combinator change. LIKE fallback remains existing OR-of-fields pattern in `search-engine-sql-builder.ts`. Do not invent a second prefix policy there in this issue unless a regression proves FTS-unavailable path reintroduces zero text hits for the same fixtures — then a minimal follow-up, not default scope.

**Rationale**: FR-011 limits change to short-query **FTS** candidate generation; YAGNI.

## R9 — Observability / MCP

**Decision**: No new funnel keys; compare existing `text_candidate_count` (FR-019/Q10). No MCP request/response shape change (FR-018/Q9) — document in contracts.

## R10 — Kill switch

**Decision**: None. Reject adoption in ablation, or revert after ship (Q14).

**NEEDS CLARIFICATION**: none remaining — all Technical Context unknowns resolved above.
