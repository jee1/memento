# Issue #173 — `triple-extraction-service.ts` 복잡도 감소 설계

## 목표

- God function·과도한 중첩 완화, 공개 API(`TripleExtractionService`, `extractTriples`, `getCostMetrics` 등) 및 동작 동일 유지.
- `any` 제거 및 테스트 회귀 없음.

## 구조

| 모듈 | 책임 |
|------|------|
| `triple-extraction-rate-limiter.ts` | 토큰 버킷 rate limit |
| `triple-extraction-errors.ts` | 실패 사유·재시도·에러 타입 순수 분류 |
| `triple-extraction-result-helpers.ts` | 실패 결과 생성, steps 추적, 결과 정규화 |
| `triple-extraction-llm-providers.ts` | OpenAI/Gemini/Ollama 원시 출력 호출, Ollama `/api/tags` 확인 (`unknown` + 가드) |
| `triple-extraction-service.ts` | 캐시·통계·초기화·`extractWithLLM` 오케스트레이션 |

## 데이터 흐름

기존과 동일: `extractTriples` → 캐시/테스트 가드 → `extractWithLLM` → rate limit → 프로바이더별 추출 → 파서 → 정규화 → 통계·로깅.

## 검증

- `npm run build -w @memento/core`
- `triple-extraction-service.spec.ts`, AriGraph 통합 스펙 등 관련 테스트 통과.

## 비범위

- 스키마·프롬프트 문구 변경, 새 LLM 프로바이더 추가.
