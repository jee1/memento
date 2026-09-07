# Implementation Plan: npm audit error JSON fail-closed (#925)

**Branch**: `feature/npm-audit-json-ci` | **Date**: 2026-09-07 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/678-925-fix-npm-audit-error-json/spec.md`  
**Issue**: [#925](https://github.com/jee1/memento/issues/925)

## Summary

`check-production-audit-fixable.mjs` 가 JSON 파싱만 하고 스키마/오류를 무시하는 fail-open 을 고친다.
순수 검증 함수 `assertValidProductionAuditReport(report)` 를 `scripts/lib/` 에 두고 TDD 로 고정한 뒤,
로드 경로에서 spawn 기동 실패·파싱 실패·스키마 실패를 모두 비0 으로 보낸다.
유효 스키마에서는 기존 fixable/accepted 분류를 그대로 유지하고, npm 의 vulnerability exit≠0 은 스키마가 유효하면 무시한다(FR-005).

## Technical Context

**Language/Version**: Node.js ≥24, ESM JavaScript  
**Primary Dependencies**: 없음 (신규 패키지 금지)  
**Storage**: N/A  
**Testing**: Vitest (`scripts/lib/*.spec.ts`); 스크립트는 파일 인자로 픽스처 검증 가능  
**Target Platform**: GitHub Actions `security-check.yml`  
**Project Type**: CI security gate script  
**Performance Goals**: N/A  
**Constraints**: #756 분류 유지; #909 업그레이드 비범위; graphify if shipping scripts change  
**Scale/Scope**: ~3 files (lib + spec + gate script); optional workflow test assert

## Constitution Check

| Gate | Principle | Status | Notes |
|------|-----------|--------|-------|
| Test-First Delivery | I (MUST) | PASS | 순수 검증 함수 RED→GREEN |
| Backward compatibility MCP | II (MUST) | PASS | MCP 계약 불변; CI gate만 강화(보안 fail-closed) |
| Schema/migration | III (MUST) | N/A | DB 없음 |
| Quality gates | IV (MUST) | PASS | lint/type-check/관련 test + graphify on script change |
| Observability | V (SHOULD) | PASS | 실패 시 stderr 에 사유(error code/summary 또는 missing fields) |
| Additional Constraints | | PASS | Node 24 ESM; security scope 명시(#925); no LoCoMo |

## Project Structure

### Documentation (this feature)

```text
specs/678-925-fix-npm-audit-error-json/
├── plan.md
├── research.md
├── quickstart.md
├── progress.yml
├── spec.md
└── tasks.md
```

### Source Code (touched)

```text
scripts/lib/production-audit-report.js       # assertValidProductionAuditReport
scripts/lib/production-audit-report.spec.ts  # TDD
scripts/check-production-audit-fixable.mjs  # load + validate + existing classify
tests/security-check-workflow.spec.ts        # optional: assert Production npm audit step
```

## Complexity Tracking

없음.

## Execution Strategy

1. TDD: `assertValidProductionAuditReport` (error JSON, missing fields, valid empty, valid with vulns).
2. Wire into `loadReport` / post-parse path; spawn `error` → exit 1; keep non-zero status if schema OK.
3. Confirm file-arg path uses same assert.
4. Optional workflow spec assert for FR-008.
5. Run targeted vitest + lint; rebuild graphify.
6. No commit/push unless asked. Note `tech-debt-approved` needed before PR.

Human checkpoints: user authorized full Speckit pipeline (`speckit으로 이거 처리해줘`).
