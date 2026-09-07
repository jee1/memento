# Feature Specification: Hybrid 랭커가 importance 0을 0.5로 평가한다

**Feature Branch**: `feature/hybrid-importance-0-0.5`
**Spec Directory**: `specs/677-924-fix-hybrid-importance-zero`
**Created**: 2026-09-07
**Status**: Executed — review PASS
**Issue**: [#924](https://github.com/jee1/memento/issues/924)
**Input**: 하이브리드 검색 랭커가 유효한 `importance=0`을 기본값 `0.5`로 바꿔 랭킹을 역전시킨다

## Problem Statement

하이브리드 검색 결과 랭킹에서 `importance`가 `0`인 기억이 “없음”으로 취급되어
기본값 `0.5`로 대체된다. 같은 관련도·날짜 조건에서 importance `0`이 `0.1`보다
높은 최종 점수를 받아, 사용자가 낮게 둔 기억이 과대 노출된다.

재현(동일 관련도·날짜):
- importance 0 → finalScore 0.2125 (importance 기여 0.10) — 0.5와 동일
- importance 0.1 → finalScore 0.1325 (importance 기여 0.02)

기존 회귀는 0.95 vs 0.5만 비교해 0 경계값을 잡지 못한다.

## Goals

- 명시된 `importance=0`은 기본값으로 치환되지 않고 점수 계산에 그대로 사용된다.
- 동일 다른 신호에서 importance 점수 기여가 `0 < 0.1 < 0.5` 단조 증가한다.
- 누락(null/undefined) importance만 기본값 `0.5`를 쓴다.
- 검색 도메인 회귀 테스트·type-check가 통과한다.
- simplify 검토(불필요한 추상화·범위 확장 없음)를 완료한다.

## Non-Goals

- `anchor-reanchor-service` 등 검색 밖 `importance || 0.5` 패턴 일괄 수정.
- importance 스키마/마이그레이션 변경.
- 랭킹 가중치·공식 재조정.
- Admin UI·MCP 계약 변경.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - 중요도 0이 과대 노출되지 않는다 (Priority: P1)

운영자/에이전트가 importance를 0으로 둔 기억이, 동일 관련도에서
importance 0.1인 기억보다 높게 랭크되지 않는다.

**Why this priority**: 이슈의 핵심 버그. 랭킹 신호 역전.

**Independent Test**: 동일 text/vector 점수·타임스탬프로 importance 0/0.1/0.5
후보를 랭킹했을 때 finalScore(및 importance 기여)가 단조 증가.

**Acceptance Scenarios**:

1. **Given** 동일 관련도·날짜의 세 후보(importance 0, 0.1, 0.5), **When** hybrid rank,
   **Then** finalScore(0) < finalScore(0.1) < finalScore(0.5).
2. **Given** importance=0 후보, **When** score_breakdown 포함 랭킹, **Then** importance
   기여가 0.5 기본값 기여와 같지 않고 0에 비례한다.

---

### User Story 2 - 누락 importance는 기존 기본값을 유지한다 (Priority: P2)

importance가 비어 있는(null/undefined) 후보는 이전과 같이 0.5로 취급된다.

**Why this priority**: 하위 호환. 미설정 경로의 급격한 랭킹 드리프트 방지.

**Independent Test**: importance 미설정 후보와 importance=0.5 후보의 동일 신호 비교.

**Acceptance Scenarios**:

1. **Given** importance undefined(또는 null) 후보와 importance 0.5 후보, 동일 다른 신호,
   **When** hybrid rank, **Then** 두 후보의 finalScore가 같다(허용 오차 내).

### Edge Cases

- importance `0` (유효 경계) — 기본값 치환 금지.
- importance `null` / `undefined` — 기본값 `0.5`.
- importance `0.5` — 기존과 동일.
- 음수/범위 밖 값은 DB CHECK로 차단된다고 가정; 본 스펙 범위 밖.
- 기존 0.95 vs 0.5 회귀는 계속 통과해야 한다.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Hybrid result ranking MUST use an explicit numeric `importance` of `0` as-is in score features (MUST NOT replace `0` with the default).
- **FR-002**: When `importance` is null or undefined, ranking MUST default to `0.5`.
- **FR-003**: Holding other ranking signals fixed, final scores MUST be strictly monotonic for importance values `0 < 0.1 < 0.5`.
- **FR-004**: A regression test MUST cover the `0` / `0.1` / `0.5` boundary; existing importance-vs-relevance slot tests MUST remain green.
- **FR-005**: Fix scope MUST stay on hybrid result ranking for #924 (no drive-by changes outside the issue impact path unless required for the test).

### Key Entities

- **Hybrid search candidate**: memory item with relevance signals and `importance` ∈ [0, 1].
- **Score features**: inputs to final score (relevance, recency, importance, usage, …).

### Assumptions

- DB/schema already constrains importance to [0, 1]; no migration needed.
- Default for missing importance remains `0.5` (product convention).
- `anchor-reanchor-service` same pattern is separate debt, out of scope.

## Success Criteria *(mandatory)*

- **SC-001**: With equal non-importance signals, ranked order by finalScore is importance 0 then 0.1 then 0.5 (ascending score).
- **SC-002**: importance=0 candidate’s importance contribution ≠ the contribution produced by defaulting to 0.5.
- **SC-003**: Search-domain regression for the ranker module passes; project type-check passes.
- **SC-004**: simplify review finds no unnecessary abstraction or out-of-scope edits.

## Brainstorm Log

| Date | Session | Insights |
|------|---------|----------|
| 2026-09-07 | 1 | Q1–Q4 auto-select recommended (see Open Questions). Scope = HybridResultRanker nullish default only; monotonicity regression mandatory; anchor path deferred. |

## Open Questions

| # | Question | Status | Resolution |
|---|----------|--------|------------|
| Q1 | Scope: ranker only vs all `importance \|\| 0.5` in repo? | Resolved | A — #924 impact path만 (HybridResultRanker). anchor는 Non-Goal. |
| Q2 | null/undefined default? | Resolved | A — `?? 0.5` 유지 (누락만 기본값). |
| Q3 | Assert finalScore만 vs breakdown importance 기여도? | Resolved | B — finalScore 단조성 + breakdown importance 기여가 0≠0.5 기본. |
| Q4 | 추가 brainstorm 필요? | Resolved | A — 불필요. plan으로 진행. |
