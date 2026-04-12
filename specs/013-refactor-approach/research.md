# Phase 0 Research: 013-refactor-approach

**Purpose**: Resolve Technical Context unknowns and record **Decision / Rationale / Alternatives** for the production maintainability refactoring program.

## 1. Integration line (FR-018)

- **Decision**: Use **`main`** as the **integration line** named in `plan.md` for FR-013/FR-014 merge counting.
- **Rationale**: Matches common Git default for long-lived integration; aligns with “merge target” language in the spec; easy for contributors to find.
- **Alternatives considered**:
  - **`develop` / feature-integration branch** — Rejected as default *unless* the team already standardizes on it; would require explicit rename in `plan.md`.
  - **Per-increment branch names** — Rejected; FR-018 requires a **single** named line for consistent gate interpretation.

## 2. SC-002 primary defect source (FR-023)

- **Decision**: **GitHub Issues** in the **`memento`** repository is the **primary** authoritative channel for customer-reported defects used in SC-002 trend comparisons.
- **Rationale**: Open-source projects typically centralize reports in Issues; supports labels, milestones, and API export for metrics; satisfies FR-023 “explicitly named in plan.md.”
- **Alternatives considered**:
  - **External support desk only** — Rejected as sole primary (harder to link to code/releases in-repo); may be **secondary** with merge rules in §4.
  - **Multiple primaries** — Rejected; FR-023 requires **one** primary source.

## 3. SC-002 operational definition (FR-016)

- **Decision**: Do **not** fix numeric thresholds in `spec.md` (per user clarifications). The **operational definition** lives in this program’s artifacts:
  - **Recall/search–related (classification)**: **GitHub Issues** in this repo count when **any** of: (a) labels `area:recall` or `area:search`; (b) title or body matches saved query `label:bug (recall OR search)` (document exact query URL in **`specs/013-refactor-approach/maintainer-map.md`**); (c) manually triaged into the recall/search bucket per maintainer agreement (record triage rules in the same map). **Baseline comparison window**: **Prior three releases** (git tags or semver), compared to **each of two consecutive releases** after program start—exact tag names recorded per release in **`specs/013-refactor-approach/maintainer-map.md`** or release notes.
  - **“Statistically meaningful increase”**: **Not** a single p-value in spec; use **programmatic** rules: e.g. (a) proportion of recall/search issues above rolling median + **N**σ, or (b) **strict increase** in **P0/P1** counts vs baseline window, with **N** chosen by maintainers and recorded in **`specs/013-refactor-approach/maintainer-map.md`** under “SC-002 measurement.” **N** and σ are **team parameters**—document once and reuse. (Canonical path for the N value and measurement notes: **`specs/013-refactor-approach/maintainer-map.md`** — FR-016 forward reference.)
- **Rationale**: FR-016 explicitly delegates numerics to plan/release verification; this research locks **structure** without pretending precision unavailable at plan time.
- **Alternatives considered**:
  - **Fixed % threshold in spec** — Rejected by clarification (Option A — delegated to plan).
  - **Manual judgment only** — Acceptable for **interpretation** but SC-002 needs **written rules** to avoid drift; hybrid rule-based + human review recommended.

## 4. Secondary defect channels & deduplication (FR-023)

- **Decision**: If **Discord/email/internal tracker** duplicates GitHub Issues, **merge rules**: (1) **Primary** count = GitHub Issue if an issue exists; (2) **secondary** reports without a GitHub Issue → **one** synthetic row when triaged into GitHub, or excluded from trend to avoid double-count; (3) **precedence**: GitHub label/milestone wins over informal reports.
- **Rationale**: Prevents SC-002 inflation from multi-channel noise.
- **Alternatives considered**: **Union of all channels without dedup** — Rejected (violates FR-023 intent).

## 5. Manual regression vs automation (FR-013, FR-024, FR-026)

- **Decision**: **CI** (`npm run lint`, `npm run type-check`, `npm test`) is **always** required before merge to the integration line. **Manual checklist** is **mandatory** only when an increment **directly** changes recall/search/admin HTTP **runtime behavior or request paths**; **not** mandatory for documentation-only, type-only/emit-equivalent (per FR-026), or changes **only** in other capability areas (**indirect** effects insufficient for mandatory FR-013).
- **Rationale**: Matches clarified spec (Session 2026-04-12); avoids gate inflation.
- **Alternatives considered**:
  - **Mandatory manual for every increment** — Rejected (too heavy; contradicts FR-026).
  - **Mandatory manual for any embedding change** — Rejected (contradicts “indirect-only” clarification).

## 6. Maintainer documentation location (FR-025, FR-027)

- **Decision**: Single authoritative **`maintainer-map.md`** and **`manual-regression-checklist.md`** under **`specs/013-refactor-approach/`** (relative to repository root), with `plan.md` entry points (FR-020, FR-027).
- **Rationale**: Co-located with `spec.md`; version-controlled; obvious canonical path.
- **Alternatives considered**:
  - **`docs/` only** — Valid; rejected as default here to keep program artifacts together (still **in-repo**).
  - **Wiki as authority** — Rejected (FR-025).

## 7. Refactoring tactics (non-prescriptive)

- **Decision**: Prefer **extract module / reduce nesting / replace `any` at boundaries / clarify ownership** within existing packages; **no** new persistence layer in wave 1.
- **Rationale**: Aligns with spec FR-001–FR-006 without mandating a specific pattern (Strategy vs façade left to tasks).
- **Alternatives considered**: **Big-bang rewrite** — Out of scope (incremental program).

## 8. SC-004 survey scale (FR-021)

- **Decision**: Use a **5-point Likert scale** as the primary instrument for SC-004 perceived-time reduction surveys.
  - Example prompt: *"Compared to before this program, how long does it take you to locate the correct ownership area for a recall tweak?"* (repeat for search tweak)
  - Scale: 1 = Much longer · 2 = Somewhat longer · 3 = About the same · 4 = Somewhat shorter · 5 = Much shorter
  - **Pass criterion for a quarter**: ≥30% of respondents rate **4 or 5** ("Somewhat shorter" or better) across both recall and search prompts in aggregate.
- **Rationale**: Likert requires no recall of absolute durations (which are unreliable), is widely understood, and supports median/proportion aggregation. Satisfies FR-021 "pick one primary scale" requirement; documented here before first response collection.
- **Alternatives considered**:
  - **Estimated minutes before/after** — Rejected as primary (anchoring on unrecallable durations); acceptable as supplemental note.
  - **% improvement self-estimate** — Rejected as primary (anchoring bias; harder to aggregate consistently across respondents).
- **Instrument version**: v1.0 (2026-04-12). Increment version and document here if the instrument changes between quarters.

---

**Status**: All items above close **NEEDS CLARIFICATION** gaps for `plan.md` Technical Context. Numeric **N** for SC-002 (if using σ-style rule) should be set by maintainers in **`maintainer-map.md`** under "SC-002 measurement" before first SC-002 assessment period (confirmed by T005).
