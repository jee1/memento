# Tasks: npm audit error JSON fail-closed (#925)

**Input**: Design documents from `/specs/678-925-fix-npm-audit-error-json/`  
**Prerequisites**: plan.md, spec.md (Brainstormed), research.md  

**Tests**: Principle I — TDD required.

## Phase 1: Setup

- [x] T001 Create `progress.yml`; confirm branch `feature/npm-audit-json-ci` (no create-new-feature checkout)

## Phase 2: Foundational — report validator [TDD]

- [x] T002 [TDD] Write failing unit tests in `scripts/lib/production-audit-report.spec.ts` for `assertValidProductionAuditReport` (E503 error, missing auditReportVersion/metadata.vulnerabilities/vulnerabilities, non-object vulnerabilities, error+vulns coexistence, valid empty report, valid with entries)
- [x] T003 [TDD] Implement `scripts/lib/production-audit-report.js` to satisfy T002

## Phase 3: User Stories 1–3 — wire gate (P1)

- [x] T004 [US1][US2] In `scripts/check-production-audit-fixable.mjs`, after parse (and for file-arg path), call assert; on failure print reason to stderr and `process.exit(1)`
- [x] T005 [US2] On live `spawnSync`, if `result.error` set, fail closed with message (do not treat empty/invalid stdout as OK)
- [x] T006 [US3] Preserve fixable vs accepted classification; do not fail solely because `status !== 0` when schema valid (FR-005)

## Phase 4: Workflow assertion (FR-008)

- [x] T007 [P] Extend `tests/security-check-workflow.spec.ts` to assert Production npm audit step still runs `node scripts/check-production-audit-fixable.mjs`

## Phase 5: Polish / gates

- [x] T008 Run `npm test -- scripts/lib/production-audit-report.spec.ts tests/security-check-workflow.spec.ts`
- [x] T009 File-arg smoke: error JSON fixture → non-zero; valid accepted-only fixture → 0
- [x] T010 `npm run lint` / `npm run type-check` as needed for touched paths
- [x] T011 Rebuild graphify after script changes
- [x] T012 Update `progress.yml` + tasks checkboxes; summary (no commit/push unless asked)

## Dependencies

- T002 → T003 → T004/T005/T006
- T007 [P] with T004–T006
- T008–T012 after implementation

## Parallel opportunities

- T007 parallel with wire-up after T003
- T010 parallel with T008
