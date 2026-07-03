# Implementation Plan: 038-ollama-connection-debt-markers

## Context

`LLMClientInitializer.initialize()`는 이미 async이며 `testOllamaConnection`·`addWarning`이 구현되어 있다. 테스트의 TODO는 TDD RED 단계 잔재로, GREEN 검증만 활성화하면 된다.

## Changes

| 파일 | 변경 |
|------|------|
| `packages/memento-core/.../ollama-connection.spec.ts` | TODO 제거, warn/warnings 검증 활성화, RED 주석 정리, `LLM_PROVIDER=ollama` 명시 |

## Expected Warning Messages

| 시나리오 | `result.warnings` 패턴 |
|----------|------------------------|
| HTTP 404 | `Ollama 서버 연결 실패: HTTP 404 Not Found` |
| 타임아웃 | `Ollama 연결 타임아웃 (5초)` |
| 네트워크 | `Ollama 네트워크 에러: fetch failed` |

## Test Strategy

- `npm test -- packages/memento-core/src/shared/services/__tests__/llm-client-initializer/ollama-connection.spec.ts`
- `npm run lint && npm run type-check`
