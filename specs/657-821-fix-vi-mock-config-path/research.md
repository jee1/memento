# Phase 0 Research: relation 도메인 config 모킹 교정

**Feature**: 657-821-fix-vi-mock-config-path | **Date**: 2026-08-27
**Input**: [spec.md](./spec.md), [plan.md](./plan.md)

Technical Context 에 `NEEDS CLARIFICATION` 은 없다. 아래는 계획을 실행 가능하게 만들기 위해 저장소를 실측해 확정한 결정들이다. 모든 수치는 이 브랜치에서 직접 측정했다.

---

## R1. 왜 틀린 경로가 조용히 통과하는가 (결함 메커니즘)

**Decision**: 결함을 "경로 오타" 가 아니라 **모킹 선언과 실행 중 재가져오기가 이루는 닫힌 팬텀 쌍**으로 규정한다. 교정 단위도 그 쌍 전체다.

**Rationale**:
- `vi.mock('<없는 경로>')` 는 그 경로를 mock 레지스트리에 등록한다. 이후 같은 경로로 들어오는 `await import('<같은 없는 경로>')` 는 레지스트리에 걸려 **파일 시스템에 닿지 않는다**. 그래서 대상 부재가 끝까지 드러나지 않는다.
- 실측: `llm-based-relation-extractor.spec.ts` 의 config 동적 import 14곳 중 3단계(팬텀) 13곳, 4단계(실 모듈) 1곳(line 720, #819 이 추가). `(configModule.mementoConfig as any).X = ...` 대입 20곳 중 19곳이 팬텀 객체에 쓴다.
- 소스 `llm-based-relation-extractor.ts` 는 `services/` 에 있어 같은 문자열이 `src/shared/config/index.js` 로 풀린다. 스펙은 `__tests__/` 에 있어 `src/domains/shared/config/index.js`(부재)로 풀린다. **한 단계 차이**가 원인이다.
- 같은 파일이 이미 `shared/` 는 4단계로 쓰고 있다: line 93·95 의 `LLMClientInitializer`·`logger` import. 3단계는 `domains/` 형제(`embedding/`)용으로 옳다. 즉 교정 방향에 모호함이 없다.
- 교정 전 스펙 36 tests 전량 통과. **통과는 품질 신호가 아니다.**

**Alternatives considered**:
- *경로만 고치고 재가져오기는 그대로 둔다* — 기각. 남은 3단계 import 가 해석에 실패해 스펙이 깨진다.
- *재가져오기만 고친다* — 더 위험해서 기각. 그쪽이 **실제 전역 설정 객체**를 받게 되고, 모킹 없이 실 전역을 조작하는 상태로 조용히 되돌아간다.

---

## R2. 교정 후 스펙 파일이 로드조차 안 될 수 있다 (TDZ)

**Decision**: `createMockConfig`/`mockConfig` 를 `vi.hoisted()` 안으로 옮긴다. 경로 교정과 **같은 편집**에서 한다.

**Rationale**:
- 현재 구조(실측): line 88 `import { LLMBasedRelationExtractor } from '../llm-based-relation-extractor.js';` (정적) → line 120 `const mockConfig = createMockConfig();` → line 122 `vi.mock(..., () => ({ mementoConfig: mockConfig }))`.
- `vi.mock` 은 파일 최상단으로 호이스팅되지만 **factory 는 지연 호출**된다. 지금은 그 모듈을 아무도 정적으로 요구하지 않아 factory 가 실행 중에야 돌고, 그때는 `mockConfig` 가 이미 초기화돼 있다.
- 경로를 교정하면 line 88 의 정적 import 가 `llm-based-relation-extractor.ts` 를 로드하고, 그 파일의 `import { mementoConfig } from '../../../shared/config/index.js'` 가 **로드 시점에** factory 를 부른다. 이때 `mockConfig` 는 아직 TDZ → `ReferenceError: Cannot access 'mockConfig' before initialization` → 단언 실패가 아니라 **스펙 파일 전체 로드 실패**.
- 형태:
  ```ts
  const { createMockConfig, mockConfig } = vi.hoisted(() => {
    const createMockConfig = () => ({ /* ... */ });
    return { createMockConfig, mockConfig: createMockConfig() };
  });
  ```
  `createMockConfig` 도 함께 끌어올려야 R5 의 기준 상태 복원에서 쓸 수 있다.

**Alternatives considered**:
- *정적 import 를 동적으로 바꿔 회피* — 기각. 2185줄 스펙의 구조를 바꾸는 큰 수술이고, `vi.hoisted()` 는 정확히 이 문제를 위한 표준 수단이다.
- *factory 안에서 객체 리터럴을 직접 만든다* — 기각. 기준 상태 복원이 factory 밖에서 같은 객체를 참조해야 하므로 결국 호이스팅이 필요하다.

---

## R3. factory 가 부분 모듈을 반환하는 위험

**Decision**: 현행 `{ mementoConfig: mockConfig }` 그대로 간다. 실측상 충분하다. 로드 오류가 나면 그때 `importOriginal` 확산으로 승격한다.

**Rationale**:
- `vi.mock` 의 factory 는 모듈을 **통째로** 대체한다. `shared/config/index.ts` 의 실제 export 는 `mementoConfig`, `searchRankingWeights`, `defaultTags`, `validateConfig` 4개인데 factory 는 1개만 준다.
- 실측: 나머지 3개를 이 모듈에서 import 하는 프로덕션 파일은 `packages/memento-core/src/index.ts`(배럴, `validateConfig` 재수출) 하나뿐이고, 대상 스펙의 import 그래프에는 배럴이 없다. → 현재는 안전하다.
- 승격 형태(필요 시 1줄):
  ```ts
  vi.mock('../../../../shared/config/index.js', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../../../shared/config/index.js')>()),
    mementoConfig: mockConfig,
  }));
  ```

**Alternatives considered**:
- *처음부터 `importOriginal` 확산* — 보류. 실측으로 불필요함이 확인됐고, 실 config 모듈을 로드하는 부작용이 늘어난다. 오류가 실제로 나면 그때 붙인다.

---

## R4. 모킹이 제공해야 할 설정 항목 전수 (FR-008)

**Decision**: 현행 `createMockConfig()` 항목 집합을 유지한다. 전이 조회 범위를 덮는다.

**Rationale** — `llm-based-relation-extractor.ts` 에서 도달 가능한 `mementoConfig` 읽기 실측:

| 항목 | 읽는 곳 |
|------|---------|
| `llmProvider` | `llm-based-relation-extractor.ts:442,455,491`, `llm-client-initializer/shared-helpers.ts:34` |
| `openaiApiKey` | `llm-client-initializer.ts:108`, `llm-client-initializer/openai.ts:18,35` |
| `geminiApiKey` | `llm-client-initializer.ts:109`, `llm-client-initializer/gemini.ts:22,39` |
| `ollamaBaseUrl` | `llm-client-initializer/ollama.ts:99`, `llm-relation-extractor/extract-relations-ollama.ts:32,215` |
| `ollamaModel` | `llm-relation-extractor/extract-relations-ollama.ts:197,216` |

현행 대체 값 객체는 위 5개에 `openaiModel`·`openaiLlmModel`·`geminiModel`·`geminiLlmModel`·`llmModelOverrides` 를 더한 상위집합이다. **부족분 없음.**

주의: `mementoConfig.nodeEnv` 는 `triple-extraction-service.ts:234` 가 읽지만 이 스펙의 도달 범위 밖이다. 도달 범위가 넓어지면 항목을 추가해야 한다.

**Alternatives considered**:
- *실 config 를 spread 해서 채운다* — 기각. 실 환경 값이 새어 들어와 FR-003(환경 무관성)을 깬다.

---

## R5. 기준 상태 복원 방식 (FR-007, SC-004)

**Decision**: `beforeEach` 에서 `Object.assign(mockConfig, createMockConfig())`.

**Rationale**:
- 대체 값 객체는 **모듈이 붙잡고 있는 같은 참조**여야 한다. 재할당(`mockConfig = createMockConfig()`)하면 모킹된 모듈은 옛 객체를 계속 들고 있으므로 무효다. 제자리 갱신이 유일하게 맞다.
- 기준 상태는 `createMockConfig()` 한 곳에만 정의된다 → spec 의 "기준 상태는 스펙 전체에서 하나로 정의된다" 를 그대로 만족.
- 루트 `vitest.config.ts` 에 `restoreMocks` 가 없다(`relation-extractor.spec.ts:153` 이 이미 지적). 전역 설정을 켜면 저장소 전체 스펙의 동작이 바뀌므로 이번 범위 밖이다.

**Alternatives considered**:
- *루트에 `restoreMocks: true` 추가* — 기각. `vi.fn()` 복원과 평범한 객체 프로퍼티 복원은 다른 문제이고, 전역 변경은 이번 범위를 크게 넘는다.
- *각 테스트 `afterEach` 에서 개별 되돌리기* — 기각. 빠뜨리기 쉽고 항목 수만큼 코드가 는다.

---

## R6. line 288 `actualConfig` — 이름과 실제가 어긋난 지점

**Decision**: Phase C 의 전수 정리에 포함한다. 주석과 분기 전제를 실제와 맞춘다.

**Rationale**:
- line 288: `const actualConfig = await import('../../../shared/config/index.js');` — 주석은 "실제 mementoConfig를 가져와서" 라고 말하지만, 3단계 경로라 **팬텀 mock 을 받는다**. 즉 이름·주석·실제가 전부 어긋나 있다.
- 게다가 그 값은 앞선 테스트들이 남긴 `mockConfig.llmProvider` 변형에 좌우된다 — 지금도 이미 순서 의존이다.
- 교정 후에는 소스와 이 지점이 **같은** 대체 값 객체를 보므로 `actualLLMProvider !== 'ollama'` 분기가 결정적이 된다. 환경에 따라 갈리던 방어 분기가 죽은 코드가 되므로 정리 대상이다.

---

## R7. 재발 방지 게이트의 구현 형태 (FR-009/010/013/014)

**Decision**: `scripts/check-vi-mock-paths.ts` (tsx 실행, `--ci` 시 exit 1) + `scripts/vi-mock-path-baseline.json`. CI 는 `ci.yml` 의 `lint` 잡에 스텝 1줄로 붙인다.

**Rationale**:
- 저장소에 이미 같은 모양의 선례가 3개 있다: `check-retry-usage.ts`, `count-console-logs.ts`, `check-debt-markers.ts`. 전부 `scripts/` 에 살고 `--ci` 로 차단하며 `scripts/lib/cli.ts` 의 `parseArgs` 를 쓴다. `ci.yml` lint 잡에는 이미 `npx tsx scripts/count-console-logs.ts --core-only --ci` 와 `npx tsx scripts/check-retry-usage.ts --ci` 가 이웃해 있다.
- 해석 규칙(실측으로 검증된 것): specifier 가 `.` 로 시작하지 않으면 **건너뛴다**(FR-010, 패키지 모킹 오탐 방지). `.js` 는 `.ts`/`.tsx` 로 치환해 본 뒤, 원본·`.ts`·`.tsx`·`<dir>/index.ts` 순으로 후보를 확인한다. 이 규칙으로 저장소를 돌리면 상대경로 58건 중 10건이 미해석 — 알려진 결함 지점과 정확히 일치하고 정상 48건은 오탐이 없다.
- 게이트 자체도 spec 을 가진다(`scripts/lib/quarantine-gates.spec.ts` 선례). Constitution I 을 만족시키는 방법이자 SC-005 의 "의도적 위반 검출" 을 자동화한다.

**Alternatives considered**:
- *ESLint 커스텀 룰* — 기각. 새 룰 패키지·설정 배선이 필요하고, spec 의 Assumptions 가 "본격적인 정적 분석 규칙 도입은 후속 과제" 로 이미 못박았다.
- *Vitest 실행 시점 검사* — 기각. `vi.mock` 이 요구되지 않으면 factory 자체가 안 돌기 때문에(= `relation-extractor.spec.ts` 사례) 런타임으로는 죽은 선언을 잡을 수 없다. 정적 스캔이어야 한다.

---

## R8. baseline 예외 목록 설계 (FR-013, FR-014)

**Decision**: 키는 `file` + `specifier`. **줄 번호는 키에 넣지 않는다.** 항목마다 `reason`·`followUp` 필수. 미사용 항목은 `--ci` 에서도 **보고하되 차단하지는 않는다**.

**Rationale**:
- 줄 번호는 무관한 편집에도 밀린다. 키에 넣으면 예외가 조용히 풀려 CI 가 엉뚱하게 빨개진다. `file+specifier` 조합은 실측 10건 안에서 유일하다.
- `reason`·`followUp` 이 없으면 목록이 그 자체로 새로운 조용한 통과 경로가 된다(spec Edge Case).
- 해소된 항목까지 차단하면 "고쳤는데 CI 가 빨개지는" 역인센티브가 생긴다. 보고만 하고, 정리는 다음 손길에 맡긴다.

**등재 대상 8건 (실측, 2026-08-27)**:

| file | specifier |
|------|-----------|
| `packages/memento-core/src/domains/embedding/providers/__tests__/embedding-provider-factory.spec.ts` | `../config/index.js` |
| 〃 | `../services/lightweight-embedding-service.js` |
| 〃 | `../services/gemini-embedding-service.js` |
| 〃 | `../services/openai-embedding-service.js` |
| 〃 | `./model-availability-service.js` |
| `packages/memento-core/src/domains/memory/services/__tests__/memory-embedding-service.spec.ts` | `./unified-embedding-service.js` |
| `packages/memento-core/src/domains/search/algorithms/__tests__/hybrid-search-engine.spec.ts` | `../services/embedding-service.js` |
| `packages/memento-server/src/server/routes/quality.routes.spec.ts` | `../../shared/utils/logger.js` |

범위 내 2건(`llm-based-relation-extractor.spec.ts:122`, `relation-extractor.spec.ts:24`)은 이번에 해소되므로 **등재하지 않는다**. 게이트 도입 시점에 전체 위반이 이 8건으로 정확히 설명되어야 한다(SC-007).

---

## R9. 검증 실행 방법

**Decision**: 대상 스펙 실행은 **저장소 루트에서** 한다.

**Rationale**: 루트 `vitest.config.ts` 의 `include` 가 `packages/{memento-core,memento-client,memento-server}/src/**/*.{test,spec}.{js,ts}` 로 **루트 기준** 이다. `packages/memento-core` 안에서 `npx vitest run <path>` 를 돌리면 `No test files found` 가 난다(실측). CI 도 루트에서 `npm run test:ci:core` 를 돈다.

**환경 무관성 측정(SC-002)**: 이 저장소 `.env` 에 `LLM_PROVIDER=ollama` 가 있다(line 71). 교정 전에는 이 값이 소스 동작을 좌우하므로 위양성이 재현되고, 교정 후에는 미설정/`ollama`/다른 값 3회 실행이 모두 같은 결과여야 한다.

---

## R10. 환경 변수가 대체 값보다 우선한다 (FR-015, SC-008)

**Decision**: `beforeEach` 에서 **두 경로를 함께 고정**하고, `afterEach` 에서 환경 변수를 실행 전 상태로 되돌린다. 효과 없는 환경 변수 조작은 제거한다.

**Rationale** — 실측:

- `shared/services/llm-client-initializer/shared-helpers.ts:33-34`
  ```ts
  const envProvider = getRawEnvValue('LLM_PROVIDER');
  return (envProvider as LLMProvider) || mementoConfig.llmProvider || 'auto';
  ```
  `getRawEnvValue` 는 `shared/config/environment.ts:253` 에서 `return process.env[key];` — **호출할 때마다 라이브로 읽는다**. 따라서 `process.env.LLM_PROVIDER` 가 모킹된 `mementoConfig.llmProvider` 를 **덮는다**. 설정 모듈만 대체해서는 프로바이더 조건을 통제하지 못한다.
- 이 우선순위는 의도된 것이다 — `llm-client-initializer.ts:7` 이 "1. `process.env['LLM_PROVIDER']` (최우선) / 2. `mementoConfig.llmProvider` (차순위)" 라고 명시한다. **소스 결함이 아니므로 FR-011 분리 대상이 아니다.**
- 도달 범위 안의 **라이브** 환경 변수 읽기는 정확히 2개뿐이다:

  | 키 | 위치 |
  |----|------|
  | `LLM_PROVIDER` | `llm-client-initializer/shared-helpers.ts:33` |
  | `RELATION_EXTRACT_BATCH_SIZE` | `llm-based-relation-extractor.ts:542` |

- `OPENAI_API_KEY`·`GEMINI_API_KEY` 는 **라이브 읽기가 없다**. 설정 모듈이 만들어질 때 `resolveOptionalString` 로 한 번만 읽는다. 그 시점은 스펙 로드보다 앞서므로, 현재 `beforeEach` 의 `delete process.env.OPENAI_API_KEY` / `delete process.env.GEMINI_API_KEY` 는 **효과가 없다**. 교정 후에는 그 값들이 대체 값 객체에서 오므로 더더욱 무의미하다 → 제거 대상.
- 현재 `beforeEach`(line 204-206)는 `originalOpenAIKey`·`originalGeminiKey`·`originalLLMProvider` 3개를 지역 변수에 담지만 **어디에서도 쓰지 않는다**. `afterEach`(line 260)에는 "환경 변수 복원은 필요 없음" 주석만 있다. 즉 `process.env.LLM_PROVIDER = 'auto'` 변경이 되돌려지지 않는다.

**측정하지 않은 것(주장하지 않음)**: 이 미복원이 다른 스펙 파일까지 번지는지는 확인하지 않았다. 루트 설정에 `isolate` 명시가 없어 기본값에 의존하므로, 파급 범위를 단정하지 않는다. 복원은 파급 범위와 무관하게 규율(FR-015)로서 정당하다.

**Alternatives considered**:
- *환경 변수만 고정하고 대체 값은 두 채널 중 하나로만 본다* — 기각. 소스가 `mementoConfig.llmProvider` 도 직접 읽는다(`llm-based-relation-extractor.ts:442,455,491`). 두 경로가 어긋나면 같은 테스트 안에서 서로 다른 조건이 보인다.
- *`vi.stubEnv` 도입* — 검토 후 보류. `vi.unstubAllEnvs()` 배선이 추가로 필요하고, 이 스펙은 이미 `beforeEach`/`afterEach` 를 갖고 있어 순수 저장·복원으로 충분하다. 새 API 를 들이지 않는다.
