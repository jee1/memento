# 설계: LLM 용도별 모델 설정 분리

**상태**: 승인됨 (옵션 2)  
**날짜**: 2026-05-24  
**배경**: #441 triage — `GEMINI_MODEL`(임베딩)이 LLM `generateContent`에 사용되어 404 발생

---

## 1. 목표

- **임베딩 vs LLM** env 분리 (OpenAI 패리티 + `GEMINI_LLM_MODEL`)
- **용도(use-case)별** 모델 override env 지원
- 모든 LLM call site가 **단일 resolver**를 통해 model 선택

**비목표**

- TOML 프로파일 파일
- Personal Agent(`MEMENTO_AGENT_*`) 설정 변경
- provider별 이중 override (`OPENAI_LLM_MODEL_TRIPLE_...` 등)

---

## 2. 환경 변수

| 변수 | 용도 |
|------|------|
| `OPENAI_MODEL` | OpenAI 임베딩 |
| `OPENAI_LLM_MODEL` | OpenAI LLM 기본 |
| `GEMINI_MODEL` | Gemini 임베딩 |
| `GEMINI_LLM_MODEL` | Gemini LLM 기본 |
| `OLLAMA_MODEL` | Ollama LLM |
| `LLM_MODEL_TRIPLE_EXTRACTION` | triple 추출 override (선택) |
| `LLM_MODEL_RELATION_EXTRACTION` | 관계 추출 override (선택) |
| `LLM_MODEL_PROCEDURAL` | procedural LLM override (선택) |
| `LLM_MODEL_CONSOLIDATION` | sleep consolidation 요약 override (선택) |

**해석 순서**

1. use-case override (설정 시 provider 무관하게 사용)
2. provider LLM default (`OPENAI_LLM_MODEL` / `GEMINI_LLM_MODEL` / `OLLAMA_MODEL`)
3. 코드 fallback (`gpt-4o-mini` / `gemini-2.0-flash` / `llama3`)

**하위 호환**: `GEMINI_LLM_MODEL` 미설정 시 **`GEMINI_MODEL`로 fallback하지 않음** (임베딩 모델 혼용 방지).

---

## 3. 코드

- 신규: `packages/memento-core/src/shared/config/llm-model-resolver.ts`
- `resolveLlmModel(provider, useCase?)` export
- `mementoConfig`에 `geminiLlmModel`, `llmModelOverrides` 추가

**교체 call site**

- `triple-extraction-llm-providers.ts` → `triple_extraction`
- `triple-extractor.ts` → `triple_extraction`
- `extract-relations-openai.ts` / `extract-relations-gemini.ts` → `relation_extraction`
- `procedural-llm-extractor.ts` → `procedural`
- `summarization-service.ts` → `consolidation` (env 직접 접근 제거)
- `llm-client-initializer.ts` → provider default label

---

## 4. 테스트

- resolver unit: override → provider default → fallback
- regression: `GEMINI_MODEL=text-embedding-004` + LLM call → `geminiLlmModel` 사용

---

## 5. 문서

- `env.example`, `docker-compose.base.yml`, `docs/guides/ko|en/llm-provider-configuration.md`
