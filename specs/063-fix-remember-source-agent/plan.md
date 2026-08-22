# Implementation Plan: Issue #696

**Branch**: `issue-696-remember-source-agent`  
**Spec**: `specs/063-fix-remember-source-agent/spec.md`

## Changes

| Module | Change |
|--------|--------|
| `shared/validation/source-uri.ts` | `agent:` URI + bare id → `normalizedSource` |
| `shared/validation/__tests__/source-uri.spec.ts` | agent·정규화·free-text 거절 테스트 |
| `domains/memory/remember/remember-tool.ts` | `normalizedSource` 저장, 유효 시 WARN 생략 |
| `docs/reference/ko/source-field.md` | `agent:`·bare 정규화 문서 |
| `CHANGELOG.md` | Unreleased Fixed/Changed |

## Design Notes

- bare id charset = `doc:` id와 동일 → `#671` 기계 파싱 가능 형식 유지
- 저장 값은 항상 `agent:<id>`로 통일 (round-trip·export 일관성)
- free-text(공백 등)는 기존 warn/strict 유지

## Test Strategy

1. Red: `source-uri.spec.ts`에 agent·bare·spaces 케이스 추가
2. Green: `source-uri.ts` + remember 저장 경로
3. `npm test -- packages/memento-core/src/shared/validation/__tests__/source-uri.spec.ts`
4. remember-tool 관련 회귀 1건(선택) 또는 기존 semantic source 테스트가 통과하는지 확인
5. `npm run lint && npm run type-check`
