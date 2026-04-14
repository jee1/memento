# Requirements Writing Quality Checklist: 대시보드 앵커 맵 검색 안정화

**Purpose**: 요구사항 문서(영문/국문 스펙) 자체의 완전성·명확성·일관성·측정 가능성을 검증하는 "요구사항 단위 테스트"(구현/QA 검증 아님)  
**Created**: 2026-04-14  
**Feature**: [spec.md](../spec.md) · [plan.md](../plan.md) · [contracts/](../contracts/)  
**Audience / Depth**: PR 리뷰어 · 표준 깊이(사용자 입력 없음 시 기본값)

**Note**: `/speckit.checklist` 생성. 구현 동작 확인 항목은 포함하지 않는다.

## Requirement Completeness

- [ ] CHK001 Are functional expectations for the **successful search response path** when the map view is **empty** or **loading** fully stated as outcomes (not only as negative "no crash")? [Completeness, Spec § User Story 1, FR-001–002]
- [ ] CHK002 Is the expected behavior documented when **search results exist but no corresponding map node** exists, beyond listing it as an edge case bullet? [Completeness, Gap?, Spec § Edge Cases, FR-002]
- [ ] CHK003 Are **Out of Scope** exclusions (search API rules, MCP, non-dashboard clients, a11y certification) sufficient so readers do not infer unstated obligations? [Completeness, Spec § Out of Scope]
- [ ] CHK004 Does the spec document whether **concurrent or overlapping searches** require correctness guarantees, or only absence of fatal failure? [Completeness, Spec § Edge Cases]

## Requirement Clarity

- [ ] CHK005 Is **"치명적 오류"** defined in terms stakeholders can apply without referencing scripts or stack traces? [Clarity, Spec § Assumptions]
- [ ] CHK006 Are the map view states **empty**, **loading**, and **ready** defined consistently wherever they gate acceptance (stories, FRs, SCs)? [Clarity, Consistency, Spec § Key Entities, User Stories, SC-001–002]
- [ ] CHK007 Is **"무음 생략"** vs any optional non-blocking messaging distinguished so acceptance is not under-specified? [Clarity, Spec § Clarifications, User Story 1]
- [ ] CHK008 Is **"실사용에 허용되는 지연"** in Quality Attributes either quantified or explicitly deferred without blocking interpretation of "done"? [Clarity, Spec § Quality Attributes]

## Requirement Consistency

- [ ] CHK009 Do **Assumptions** (search succeeds then map-side safety) align with **Out of Scope** (search API behavior changes) without contradiction? [Consistency, Spec § Assumptions, Out of Scope]
- [ ] CHK010 Are **SC-001** (10 repetitions, empty/loading) and **SC-003** (issue reproduction procedure) mutually reinforcing rather than conflicting definitions of completion? [Consistency, Spec § Success Criteria]
- [ ] CHK011 Does the **telemetry omission** in Assumptions align with **Quality Attributes** (observability not mandated) without implying conflicting operational duties? [Consistency, Spec § Assumptions, Quality Attributes]

## Acceptance Criteria Quality

- [ ] CHK012 Can **"수정 직전 릴리스와 동등"** (SC-002, Clarifications) be assessed from requirements alone, or does it rely on unstated baseline artifacts? [Measurability, Spec § SC-002, Clarifications]
- [ ] CHK013 Are success criteria **SC-001–003** each verifiable without naming implementation artifacts (files, frameworks)? [Measurability, Spec § Success Criteria]
- [ ] CHK014 Is the **10회 반복** in SC-001 justified or arbitrary in the requirements narrative (sampling rationale)? [Clarity, Spec § SC-001]

## Scenario Coverage (requirements narrative)

- [ ] CHK015 Are **P1** vs **P2** user stories tied to distinct, independently testable requirement sets in the text? [Coverage, Spec § User Scenarios]
- [ ] CHK016 Is the **loading → ready** timing scenario reflected in both edge cases and success criteria where needed? [Coverage, Spec § Edge Cases, FR-004]
- [ ] CHK017 Are **primary** (no fatal error) vs **alternate** (highlight when ready) flows both covered without overlap that obscures MVP boundaries? [Coverage, Spec § User Stories]

## Edge Case Coverage (as stated in requirements)

- [ ] CHK018 Are **boundary conditions** (empty map, async map update, ID mismatch) each mapped to at least one FR or SC where applicable? [Coverage, Spec § Edge Cases, FR-001–005]
- [ ] CHK019 Is **session continuity** after error-risk paths specified as a requirement outcome, not only as narrative intent? [Completeness, Spec § User Story 1, FR-004]

## Non-Functional Requirements (as requirements text)

- [ ] CHK020 Are **performance** expectations in Quality Attributes stated such that "regression" vs "improvement" is judgeable from requirements? [Clarity, Spec § Quality Attributes]
- [ ] CHK021 Are **security / privacy** boundaries (e.g., local vs internet, trust model) explicit enough that scope creep is visible? [Completeness, Spec § Quality Attributes, Assumptions]
- [ ] CHK022 Is **accessibility** exclusion in Out of Scope clear about **what is not being newly promised** vs what must not regress? [Clarity, Spec § Out of Scope]

## Dependencies, Assumptions & Traceability

- [ ] CHK023 Are **external dependencies** (e.g., successful search response) and **failure of search** distinguished so contract boundaries are clear? [Traceability, Spec § Assumptions, Out of Scope]
- [ ] CHK024 Does the spec (or linked **contracts/**) make the **post-success UI obligation** on the dashboard unambiguous for reviewers? [Traceability, Spec § contracts/dashboard-anchor-map-search.md, FR-001–003]
- [ ] CHK025 Is a **requirement ID scheme** (FR-xxx, SC-xxx) used consistently for cross-referencing in plans and tasks? [Traceability, Spec § Requirements, Success Criteria]

## Ambiguities & Conflicts

- [ ] CHK026 Are any terms (e.g., "정상적으로 반응", "동등한 수준") flagged where **multiple interpretations** would change acceptance? [Ambiguity, Spec § User Story 1–2, SC-002]
- [ ] CHK027 If **plan.md** or **tasks.md** introduce obligations not present in **spec.md**, is that gap called out for governance (spec/plan/tasks consistency)? [Conflict, Gap, cross-ref ../plan.md, ../tasks.md]

## Notes

- 항목은 **요구사항 문장의 품질**을 검사한다; 버튼 클릭·API 200·코드 동작 검증은 범위 밖이다.
- 검토 시 `[x]` 처리하고, 실패 항목은 스펙 개정 또는 명시적 "의도적 제외" 기록을 권장한다.
