# Issue 351: llm-based-relation-extractor 모듈 분리 설계

## 목표

GitHub 이슈 351: `llm-based-relation-extractor.ts` 잔여 복잡도 정리. 관계 추출 결과 및 provider별 동작은 유지한다.

## 구조

- `packages/memento-core/src/domains/relation/services/llm-relation-extractor/` 하위에 전용 모듈 배치.
- `llm-based-relation-extractor.ts`는 공개 클래스·오케스트레이션과 테스트 스파이용 얇은 private 래퍼만 유지.

### 모듈

| 파일 | 책임 |
|------|------|
| `types.ts` | `ParseResult` (공개 타입) |
| `token-bucket-rate-limiter.ts` | 토큰 버킷 rate limiter |
| `provider-selection.ts` | Ollama 슬롯 가용성, `determineRelationLlmProvider` |
| `embedding-candidate-filter.ts` | 임베딩 기반 후보 필터 |
| `llm-response-parse.ts` | JSON 추출·정리·관계 파싱 |
| `ollama-chat-support.ts` | Ollama 태그 확인, 에러 로그 컨텍스트, NDJSON/JSON 페이로드 파싱 |
| `extract-relations-openai.ts` | OpenAI 호출·재시도·비용 로깅·파싱 |
| `extract-relations-gemini.ts` | Gemini 동일 |
| `extract-relations-ollama.ts` | Ollama 동일 |

### 클래스 측 래퍼

기존 단위 테스트가 `determineProvider`, `extractWithOpenAI` 등 private 메서드를 스파이하므로, 동일 시그니처의 private 메서드를 두고 구현은 위 모듈에 위임한다.

## 비범위

이슈 351 본문과 동일: triple 파이프라인 재설계, embedding 정책 변경, provider 지원 범위 변경 없음.

## 검증

- `npm run type-check --workspace=@memento/core`
- `npx vitest run packages/memento-core`
- `npm run lint` (기존 경고는 유지, 신규 error 없음)
