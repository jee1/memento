# Implementation Plan: Issue #551

**Branch**: `issue-551-gemini-retry-warn`

## Changes

| Module | Change |
|--------|--------|
| `shared/utils/external-api-retry-logging.ts` | transient capacity 감지·로그 레벨 분기 |
| `shared/utils/__tests__/external-api-retry-logging.spec.ts` | 단위 테스트 |
| `triple-extraction-llm-providers.ts` | `logExternalApiRetry` 사용 |
| `triple-extractor.ts` | 동일 적용 |
| `triple-extraction-errors.ts` | 503 → `rate_limit` 분류 |
| `triple-extraction-llm-pipeline.ts` | `invokeTripleProviderWithFallback` |
| `triple-extraction-service.ts` | 폴백 파이프라인 연동 |
| `triple-extraction-service.spec.ts` | 폴백·로깅 테스트 |
| `CHANGELOG.md` | Unreleased 항목 |

## Test Strategy

- `external-api-retry-logging.spec.ts` — capacity vs non-capacity 로그 레벨
- `triple-extraction-service.spec.ts` — Gemini 실패 → OpenAI 폴백
- `npm run lint && npm run type-check`
- domain spec: `triple-extraction-service.spec.ts`
