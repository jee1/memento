# 교정 전 기준선 측정 (T001)

**측정일**: 2026-08-27 · **브랜치**: `657-821-fix-vi-mock-config-path`
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

---

## 6. T002 직후 상태 (원자적 경로 교정)

| 확인 | 결과 |
|------|------|
| 스펙 파일 로드 | 성공 (`ReferenceError` 없음 — `vi.hoisted()` 가 TDZ 를 막았다) |
| 3단계 잔존 (동적 import / `vi.mock`) | 0 / 0 |
| 4단계 동적 import | 14 |
| 대상 스펙 | 36 / 36 통과 — **실패 0건** |
| relation 도메인 전체 | 32 files / 401 tests 통과 (부수 피해 0) |
| 소스가 읽는 config 항목 (FR-008) | `llmProvider`·`openaiApiKey`·`geminiApiKey`·`ollamaBaseUrl`·`ollamaModel` 5개 — 전부 `createMockConfig()` 에 있음 |

**모킹이 실제로 살아났다는 증거는 통과 수가 아니라 실행 로그다.**

| | `initializedProviders` |
|---|---|
| 교정 전 | `["openai","gemini"]` — 실제 `.env` 키가 소스에 도달 |
| 교정 후 | `["ollama"]` / `["openai"]` / `["gemini"]` — 각 테스트가 `mockConfig` 로 지정한 값 |

**아직 확립되지 않은 것**: §3 의 전역 플립 probe 를 교정 후에 다시 돌려도 36/36 이 유지된다. 대부분의 테스트가 `vi.spyOn(LLMClientInitializer.prototype, 'initialize')` 로 초기화 경로 자체를 대체하기 때문에 이 거친 probe 로는 민감도가 드러나지 않는다. SC-001(위양성 0)의 확립은 T006 Step 1 의 몫이다 — T003 이 `beforeEach` 를 `Object.assign(mockConfig, createMockConfig())` 로 바꾸고 나면 기준값 편집이 전 테스트에 전파되어 정밀한 측정이 가능해진다.

---

## 7. 교정 후 실패 분류 (T005)

`configModule` 우회 12블록을 `mockConfig` 직접 지정으로 통일하고, `actualConfig` 방어 분기를 제거하자 **실패 1건**이 드러났다.

| 테스트 | 실패 | 분류 | 처리 |
|--------|------|------|------|
| `should return false when no LLM service is available` | `AssertionError: expected 'ollama' to be null` | **조건 미명시** | Given 을 고침. 단언은 그대로 |

**왜 조건 미명시인가**: 이 테스트는 `llmProvider: 'auto'` + API 키 없음으로 "사용 가능한 LLM 서비스가 없는 환경" 을 만들려 했다. 그런데 `'auto'` 에서는 ollama 가 키 없이도 채택되므로(#819 가 확인한 동작) 항상 쓸 수 있는 프로바이더가 남는다. 테스트 이름이 주장하는 상태가 애초에 만들어지지 않았다. 교정 전에는 모킹이 소스에 닿지 않아 이 모순이 드러나지 않았다.

처리: Given 을 `llmProvider: 'openai'`(자격 증명이 필요한 프로바이더를 요청했는데 키가 없음)로 바꿨다. **단언 2개는 글자 하나 안 바뀌었다** — `preferredProvider` 가 `null`, `isAvailable()` 이 `false`. FR-005 를 지켰다.

**소스 결함으로 분류된 항목: 없음.** FR-011 로 분리할 이슈 없음.

이 실패 자체가 SC-001 의 증거다. 교정 전에는 `mockConfig` 값을 전부 뒤집어도 36/36 이었는데, 이제 한 테스트의 `llmProvider` 값 하나가 통과/실패를 가른다.

---

## 8. 교정 전후 대조 (T006, T007)

### SC-001 — 위양성 소멸

**T001 §3 과 글자 하나 다르지 않은 probe** 로 측정했다. `mockConfig.llmProvider = 'auto'` 전 지점(11곳) → `'gemini'`, `mockConfig.openaiApiKey = undefined` 전 지점(2곳) → 가짜 키.

| | 결과 |
|---|---|
| 교정 전 | **36 / 36 통과** — 민감도 0 |
| 교정 후 | **1 failed / 35 passed** — 민감도 발생 |

교정 전에는 모킹 값을 어떻게 뒤집어도 결과가 미동도 하지 않았다. 이제는 값 하나가 통과/실패를 가른다.

`createMockConfig()` 의 **기준값**만 뒤집는 probe 는 이제 36/36 이 나오는데, 이것은 결함이 아니라 FR-007 이 의도한 결과다 — config 에 의존하는 테스트가 전부 자기 전제를 스스로 명시하므로 기준값이 덮인다. 기준값에 의존하는 단언이 남아 있지 않다는 뜻이다.

나머지 10곳의 `llmProvider` 대입이 뒤집혀도 결과가 안 변하는 것은 그 테스트들이 `vi.spyOn(LLMClientInitializer.prototype, 'initialize')` 로 초기화 경로 자체를 대체하고 다른 것을 검증하기 때문이다. 그 단언들은 애초에 config 값을 주장하지 않는다.

### SC-002 — 환경 무관성

| `LLM_PROVIDER` | 교정 전 | 교정 후 |
|----------------|---------|---------|
| 미설정 | 36 passed | 36 passed |
| `ollama` | 36 passed | 36 passed |
| `openai` | 36 passed | 36 passed |
| `gemini` | 36 passed | 36 passed |

결과는 같지만 **이유가 달라졌다.** 교정 전에는 소스가 실 설정을 읽는데 `beforeEach` 가 우연히 `LLM_PROVIDER` 를 덮어써서 무관했고, 그 변경은 복원되지 않았다. 이제는 두 채널(`process.env.LLM_PROVIDER` + `mockConfig.llmProvider`)을 테스트가 명시적으로 고정하고 `afterEach` 가 되돌린다.

### SC-003 — 순서·반복 무관성

| 실행 | 결과 |
|------|------|
| `--sequence.shuffle` 3회 | 36 passed (3회 모두 동일) |
| 평문 반복 2회 | 36 passed (2회 모두 동일) |

`--repeat` 은 vitest 3.2.6 의 최상위 플래그에 없어 반복 실행으로 대체했다(같은 증거).
