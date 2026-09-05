# Implementation Plan: PIIMasker 전화번호 경계 부재로 epoch·memory_id 파괴

**Branch**: `feature/fix-logging-piimasker-epoch-memory_id-phone` | **Date**: 2026-09-06 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/667-854-fix-logging-piimasker-epoch-memory_id-phone/spec.md`
**Issue**: [#854](https://github.com/jee1/memento/issues/854)

## Summary

`PIIMasker` 한국 전화번호 regex에 숫자 경계가 없고 `0?` 가 optional 이라
`1` 로 시작하는 긴 숫자열(epoch-ms) 내부를 `[PHONE]` 으로 치환한다.
`logger` 가 모든 메시지/메타에 `PIIMasker.mask` / `maskObject` 를 적용하므로
로그 추적성이 전면 붕괴한다.

기술 접근 (이슈 제안 + brainstorm Q1–Q3):

1. `koreanPhonePattern` 을 선행 `01x` / `+82…1x` + `(?<![0-9])` / `(?![0-9])` 로 교체.
2. `internationalPhonePattern` 에 후행(필요 시 선행) 숫자 경계 추가.
3. 신규 회귀 스펙으로 ID/epoch/포트 보존 + 기존 전화 마스킹 유지 검증 (TDD).
4. logger / 호출부 변경 없음.

참고: `packages/memento-agent-integration/src/redaction.ts` PHONE lookaround —
철학만 정렬, API 통합 없음 (Q3).

## Technical Context

**Language/Version**: TypeScript 5.x, Node.js ≥24, ESM
**Primary Dependencies**: none new (`PIIMasker` in `@memento/core`)
**Storage**: N/A (log-time string transform only)
**Testing**: Vitest — `packages/memento-core/src/shared/utils/__tests__/`
**Target Platform**: all logger consumers (stdio MCP, HTTP admin, batch jobs)
**Project Type**: monorepo bugfix in shared util
**Performance Goals**: same O(n) regex passes as today
**Constraints**: no MCP contract change; Principle I TDD; graphify after production edit
**Scale/Scope**: 1 production file + 1 new (or extended) test file

## Constitution Check

| Gate | Principle | Status | Notes |
|------|-----------|--------|-------|
| Test-First Delivery | I (MUST) | PASS | RED tests for epoch/ID preserve before pattern change |
| Backward compatibility MCP | II (MUST) | PASS | MCP tools unchanged; masking still masks real phones |
| Schema/migration | III (MUST) | N/A | no DB schema |
| Quality gates | IV (MUST) | PASS | lint / type-check / test + graphify |
| Observability | V (SHOULD) | PASS | restores log correlation IDs (primary intent) |
| Additional Constraints | | PASS | Node 24 ESM; no LoCoMo |

## Project Structure

### Documentation (this feature)

```text
specs/667-854-fix-logging-piimasker-epoch-memory_id-phone/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/phone-mask-boundary.md
├── checklists/requirements.md
├── progress.yml
├── spec.md
└── tasks.md
```

### Source Code (touched)

```text
packages/memento-core/src/shared/utils/
├── pii-masker.ts
└── __tests__/pii-masker-phone-boundary.spec.ts   # new
```

## Complexity Tracking

없음.

## Execution Strategy

- Setup: confirm existing phone tests still list expected cases.
- Foundational [TDD]: write failing boundary tests → fix patterns → green.
- Polish: lint / type-check / focused + related pii-masker tests / graphify.
- Human checkpoints: user authorized full Speckit pipeline (`진행해줘` + canonical auto-advance).
