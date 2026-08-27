# 교정 전 기준선 측정 (T001)

**측정일**: 2026-08-27 · **브랜치**: `jee1/relation-spec-2-vi.mock-config`
**대상**: `packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts`

모든 실행은 저장소 루트에서 `npx vitest run <spec> --reporter=basic`.

## 1. 결함 확인 (Step 1)

| 확인 | 결과 |
|------|------|
| 모킹 대상 `src/domains/shared/config/index.ts` | **부재** (`No such file`) |
| 소스가 읽는 `src/shared/config/index.ts` | 존재 |
| 3단계 팬텀 동적 import | **13** |
| 4단계 실 모듈 동적 import | **1** (line 720, #819 도입) |
| 같은 파일의 `shared/` 정적 import (line 93-95) | 이미 **4단계** 사용 |

교정 방향에 모호함이 없다. 같은 파일이 `shared/` 를 4단계로 쓰고 있고, 3단계는 `domains/` 형제(`embedding/`)용으로 옳다.

## 2. 교정 전 통과 상태 (Step 2)

```
Test Files  1 passed (1)
     Tests  36 passed (36)
```

**교정 전에도 전량 통과한다. 통과는 품질 신호가 아니다.**

실행 로그에서 결정적 증거가 나왔다.

```
INFO | LLM provider initialized | {"preferredProvider":"openai","llmModel":"gpt-4o-mini",
                                   "initializedProviders":["openai","gemini"]}
```

모킹된 설정은 `openaiApiKey: undefined`, `geminiApiKey: undefined` 다. 모킹이 적용됐다면 사용 가능한 프로바이더가 **하나도 없어야** 한다. 그런데 소스는 openai·gemini 를 둘 다 초기화했다 — 즉 **실제 `.env` 의 API 키를 읽었다**. 모킹이 소스에 닿지 않는다는 직접 증거다.

## 3. 위양성 측정 (Step 3)

`createMockConfig()` 의 기본값만 바꾸면 아무것도 측정되지 않는다 — `beforeEach`(line 216)와 개별 테스트 6곳이 `mockConfig.llmProvider` 를 다시 대입하기 때문이다. 그래서 **모든 대입 지점을 한꺼번에** 뒤집었다.

| 조작 | 지점 수 |
|------|---------|
| `mockConfig.llmProvider = 'auto'` → `'gemini'` | 7 |
| `mockConfig.openaiApiKey = undefined` → `'MOCK-KEY-SHOULD-NOT-REACH-SOURCE'` | 2 |

```
Test Files  1 passed (1)
     Tests  36 passed (36)
```

**모킹 값을 전부 뒤집어도 결과가 하나도 변하지 않는다.** 이 스펙의 config 의존 단언은 전부 위양성이다. 측정 후 파일은 원복했다(`git diff` 빈 출력 확인).

## 4. 환경 변수 측정 (Step 4)

`.env` 에 `LLM_PROVIDER`(line 71), `OPENAI_API_KEY`(line 53), `GEMINI_API_KEY`(line 56) 가 모두 설정돼 있다.

| `LLM_PROVIDER` | 결과 |
|----------------|------|
| 미설정 | 36 passed |
| `ollama` | 36 passed |
| `openai` | 36 passed |
| `gemini` | 36 passed |

**바깥 `LLM_PROVIDER` 는 이미 무관하다.** 다만 이유가 규율이 아니다 — `beforeEach` 가 `process.env.LLM_PROVIDER = 'auto'` 로 무조건 덮어쓰기 때문이다(그리고 그 변경을 되돌리지 않는다).

진짜 환경 의존은 **API 키 채널**에 있다. 소스가 읽는 실제 `mementoConfig.openaiApiKey`·`geminiApiKey` 는 설정 모듈이 만들어질 때 `.env` 에서 한 번 읽히고, 그 뒤로는 아무도 고정하지 않는다. 위 §2 로그가 그 값이 소스까지 도달한 것을 보여준다. `.env` 에 키가 없는 기계(예: CI)에서는 `preferredProvider` 가 `null` 이 되어 다른 경로를 탄다.

→ 이 항목은 교정 후 T006 Step 2 에서 다시 측정한다. 교정 후에는 두 채널 모두 테스트가 고정하므로 어느 쪽도 결과에 영향을 주지 않아야 한다(SC-002, SC-008).

## 5. 교정 후 대조표 (T006 이 채운다)

| 측정 | 교정 전 | 교정 후 | 기대 |
|------|---------|---------|------|
| 통과 수 | 36 / 36 | | 36 / 36 (FR-004) |
| 모킹 값 전부 뒤집었을 때 | 36 / 36 (**변화 없음**) | | **실패 발생** (SC-001) |
| `LLM_PROVIDER` 4종 | 전부 36 passed | | 전부 동일 (SC-002) |
| 실행 로그의 `initializedProviders` | `["openai","gemini"]` (실 키 도달) | | 모킹 값에서 유래 |
