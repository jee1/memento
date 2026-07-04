# Feature Specification: Triple Extraction Gemini 재시도 WARN 로그 완화

**Feature Branch**: `issue-551-gemini-retry-warn`  
**Created**: 2026-07-04  
**Issue**: [#551](https://github.com/jee1/memento/issues/551) — App warning: TripleExtractionService: Gemini API 호출 재시도

## Problem

운영 로그 모니터가 `TripleExtractionService: Gemini API 호출 재시도` WARN을 20회 감지했다. 원인은 Gemini `503 Service Unavailable`(고수요) 등 **예상 가능한 일시 오류**마다 재시도 시도마다 WARN이 기록되는 것이다 (#446 타임아웃 WARN 패턴과 유사).

## User Scenarios

### User Story 1 — 일시 용량 오류 시 로그 노이즈 감소 (P1)

Gemini 503/502/429 등 일시 용량 오류 재시도는 DEBUG로 기록하고, 예상치 못한 재시도만 WARN으로 남긴다.

**Acceptance**: 503 high-demand 재시도 시 WARN 미발생, DEBUG에만 기록.

### User Story 2 — primary provider 실패 시 대체 provider 시도 (P2)

`auto` 또는 사용 가능한 대체 provider가 있을 때, primary LLM 호출이 재시도 가능 오류로 실패하면 다음 provider로 1회 폴백한다.

**Acceptance**: Gemini 503 exhaust 후 OpenAI 사용 가능 시 추출 성공.

## Requirements

- **FR-001**: `isTransientCapacityError` — 503, 502, 429, `service unavailable`, `high demand` 감지.
- **FR-002**: `logExternalApiRetry` — transient capacity → `logger.debug`, 그 외 → `logger.warn`.
- **FR-003**: `triple-extraction-llm-providers.ts`, `triple-extractor.ts`에 공통 로깅 적용.
- **FR-004**: `extractWithLLM`에서 primary 실패 시 대체 provider 순차 시도 (openai → gemini → ollama).
- **FR-005**: 폴백 시 INFO 로그 1회 (`TripleExtractionService: LLM provider 폴백`).

## Out of Scope

- `llm-client-initializer.ts` 분해 (TD-002)
- 전역 `retry-options.toml` 지연 변경
- relation-extractor·embedding 서비스 일괄 적용 (후속 이슈 가능)

## Success Criteria

- transient 503 재시도 WARN 제거
- 관련 Vitest·lint·type-check 통과
- CHANGELOG Unreleased 항목 추가
