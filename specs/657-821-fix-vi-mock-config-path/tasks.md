# relation 도메인 config 모킹 교정 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** relation 도메인 테스트 2개의 config 모킹이 실제로 소스에 적용되게 만들고, 같은 결함이 다시 들어오지 못하게 차단 게이트를 세운다.

**Architecture:** 결함은 경로 오타가 아니라 **닫힌 팬텀 쌍**이다 — `vi.mock` 이 없는 경로를 등록하고, 같은 없는 경로로 `await import` 하는 13곳이 그 등록에 가로채여 부재가 드러나지 않는다. 따라서 선언 1곳과 재가져오기 13곳을 **원자적으로** 교정하고, 동시에 `vi.hoisted()` 로 대체 값 객체를 끌어올린다(안 하면 TDZ 로 스펙 파일 전체가 로드 실패). 교정 후 대체 값 객체는 파일 전역 공유 가변 상태가 되므로 기준 상태 복원 규율을 함께 넣는다. 재발 방지는 기존 `scripts/check-*.ts` 관례를 그대로 따르는 정적 스캐너 + baseline 예외 목록이다.

**Tech Stack:** TypeScript 5.x / Node.js 24.11.0 (ESM) / Vitest 3.2.6 / tsx / npm workspaces

**Spec:** [spec.md](./spec.md) — 함께 읽을 것: [plan.md](./plan.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/vi-mock-path-checker.md](./contracts/vi-mock-path-checker.md), [quickstart.md](./quickstart.md)

## Global Constraints

- Node.js ≥ 24, npm ≥ 10. TypeScript ES modules.
- 테스트 실행은 **반드시 저장소 루트에서**. 루트 `vitest.config.ts` 의 `include` 가 루트 기준이라 `packages/memento-core` 안에서 실행하면 `No test files found` 가 난다.
- **프로덕션 코드를 수정하지 않는다.** 변경 범위는 `__tests__/` 2개 파일 + `scripts/` 신규 3개 + `.github/workflows/ci.yml` 1스텝 + `package.json` 스크립트 1개. 이 경계를 지키는 한 graphify 게이트는 비적용이다(Constitution IV).
- 교정 중 드러난 실패가 소스 결함이면 **고치지 말고** 별도 이슈로 기록한다(FR-011).
- 단언을 약화시켜 통과시키지 않는다(FR-005).
- 완료 전 `npm run lint`, `npm run type-check`, `npm test` 전부 통과(Constitution IV).
- `graphify-out/` 은 커밋하지 않는다.

**주 대상 파일 (이하 `$SPEC` 로 표기):**
`packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts`

---

## Phase 1: Setup — 위양성 기준선 측정

**Purpose**: 교정 전 상태가 "통과하지만 아무것도 보장하지 않는다" 는 것을 기록으로 남긴다. 이것이 이 작업의 RED 다.

### Task T001 [US1] [TDD] 교정 전 위양성 입증

**Files:**
- Read only: `packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts`
- Create: `specs/657-821-fix-vi-mock-config-path/baseline-measurement.md`

**Interfaces:**
- Consumes: 없음 (첫 태스크)
- Produces: `baseline-measurement.md` — T006 이 교정 후 수치와 대조할 기준값

- [x] **Step 1: 결함을 눈으로 확인**

```bash
SPEC=packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts

ls packages/memento-core/src/domains/shared/config/index.ts   # 기대: No such file (모킹 대상 = 부재)
ls packages/memento-core/src/shared/config/index.ts           # 기대: 존재 (소스가 읽는 실 모듈)

grep -c "await import('\.\./\.\./\.\./shared/config/index\.js')"      "$SPEC"   # 기대: 13
grep -c "await import('\.\./\.\./\.\./\.\./shared/config/index\.js')" "$SPEC"   # 기대: 1
sed -n '93,95p' "$SPEC"   # 같은 파일이 이미 shared/ 를 4단계로 쓰고 있다는 증거
```

- [x] **Step 2: 교정 전 스위트를 돌려 통과를 확인**

Run: `npx vitest run packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts`
Expected: **PASS — 36 tests passed.** (교정 전에도 전량 통과한다. 통과는 품질 신호가 아니다.)

- [x] **Step 3: 대체 값을 바꿔도 결과가 안 변하는지 측정 (위양성의 정의)**

**`createMockConfig()` 의 기본값(line 111)을 건드려도 아무것도 측정되지 않는다** — 교정 전 `beforeEach`(line 215)가 매 테스트 직전에 `mockConfig.llmProvider = 'auto';` 로 덮어쓰기 때문이다. 반드시 그 `beforeEach` 대입을 바꿔야 한다.

`$SPEC` line 215 의 `mockConfig.llmProvider = 'auto';` 를 임시로 `mockConfig.llmProvider = 'openai';` 로 바꾼다.

Run: `npx vitest run packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts`
Expected: 결과를 그대로 기록한다. 소스는 이 값을 아예 보지 않으므로(팬텀) 통과 수가 유지되는 것이 정상이다. 일부 테스트는 분기 자체가 `mockConfig` 를 읽으므로(line 288 `actualConfig`) 완전히 동일하지 않을 수 있다 — 무엇이 나오든 그것이 기준값이다.

바꾼 줄을 `'auto'` 로 되돌린다.

(T006 Step 1 은 이 문제가 없다. T003 이후의 `beforeEach` 는 `Object.assign(mockConfig, createMockConfig())` 이므로 `createMockConfig()` 편집이 그대로 전파된다.)

- [x] **Step 4: 환경 변수에 좌우되는지 측정**

```bash
grep -n "^LLM_PROVIDER" .env    # 기대: line 71 LLM_PROVIDER=ollama
LLM_PROVIDER=openai npx vitest run packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts
```
Expected: 결과 기록. 교정 후 T006 에서 이 값이 무관해져야 한다(SC-002).

- [x] **Step 5: 측정 결과를 파일로 남긴다**

`specs/657-821-fix-vi-mock-config-path/baseline-measurement.md` 를 아래 내용으로 만든다.

```markdown
# 교정 전 기준선 측정 (T001)

| 측정 | 값 |
|------|-----|
| 교정 전 통과 수 | 36 / 36 |
| mockConfig.llmProvider 를 'openai' 로 바꾼 뒤 | 36 / 36 (변화 없음 → 위양성) |
| LLM_PROVIDER=openai 로 실행 | (실행 결과 기입) |
| 3단계 팬텀 동적 import | 13 |
| 4단계 실 모듈 동적 import | 1 (line 720, #819) |
```

- [x] **Step 6: Commit**

```bash
git add specs/657-821-fix-vi-mock-config-path/baseline-measurement.md
git commit -m "test(821): record false-positive baseline before mock path fix"
```

**Checkpoint**: 위양성이 문서로 증명됐다. 이제 교정해도 "원래 통과했잖아" 로 되돌아갈 수 없다.

---

## Phase 2: Foundational — 원자적 경로 교정 (모든 후속 작업을 막는 단계)

**CRITICAL**: T002 가 끝나기 전에는 어떤 User Story 작업도 시작할 수 없다. 그리고 **T002 의 세 편집은 나눠서 커밋하면 안 된다** — 나누는 순간 스펙이 로드 실패하거나(선언만) 모킹 없이 실 전역을 조작하는 상태로 조용히 회귀한다(재가져오기만).

### Task T002 [US1] [REVIEW] vi.hoisted 도입 + 경로 14곳 원자적 교정

**Files:**
- Modify: `packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts:106-127` (mockConfig 선언 + vi.mock)
- Modify: 같은 파일의 3단계 동적 import 13곳 (일괄 치환)

**Interfaces:**
- Consumes: T001 의 기준선
- Produces: 파일 스코프에 `createMockConfig()` 와 `mockConfig` — T003·T004·T005 가 이 두 이름을 그대로 쓴다. `mockConfig` 는 **참조가 고정된 단일 객체**이며 절대 재할당하지 않는다.

- [x] **Step 1: mockConfig 를 vi.hoisted 로 끌어올린다**

`$SPEC` 의 line 106~121 (`// mementoConfig 모킹 - 실제 환경 변수를 고려하여 동적으로 모킹` 주석부터 `const mockConfig = createMockConfig();` 까지)을 아래로 교체한다.

```ts
// mementoConfig 모킹.
// vi.hoisted 가 필수다: 경로 교정 후에는 이 파일의 정적 import(line 88)가
// llm-based-relation-extractor.ts 를 로드하고, 그 파일의 config import 가
// 아래 vi.mock factory 를 "로드 시점에" 호출한다. hoisted 없이 두면 그때
// mockConfig 가 아직 TDZ 라 ReferenceError 로 스펙 파일 전체가 로드 실패한다.
const { createMockConfig, mockConfig } = vi.hoisted(() => {
  const createMockConfig = () => ({
    openaiApiKey: undefined as string | undefined,
    geminiApiKey: undefined as string | undefined,
    llmProvider: 'auto' as string,
    openaiModel: 'gpt-4o-mini',
    openaiLlmModel: 'gpt-4o-mini',
    geminiModel: 'gemini-1.5-flash',
    geminiLlmModel: 'gemini-2.0-flash',
    llmModelOverrides: {} as Record<string, string | undefined>,
    ollamaBaseUrl: undefined as string | undefined,
    ollamaModel: undefined as string | undefined
  });
  return { createMockConfig, mockConfig: createMockConfig() };
});
```

- [x] **Step 2: vi.mock 대상 경로를 4단계로 바꾼다**

같은 파일의 `vi.mock('../../../shared/config/index.js', ...)` 블록을 아래로 교체한다.

```ts
vi.mock('../../../../shared/config/index.js', () => {
  return {
    mementoConfig: mockConfig
  };
});
```

- [x] **Step 3: 동적 재가져오기 13곳을 같은 편집에서 일괄 치환**

```bash
SPEC=packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts
sed -i "s#await import('\.\./\.\./\.\./shared/config/index\.js')#await import('../../../../shared/config/index.js')#g" "$SPEC"
```

`await import('` 앵커 + 정확히 3개의 `../` 를 요구하므로 이미 4단계인 line 720 은 걸리지 않는다.

- [x] **Step 4: 치환 결과를 센다**

```bash
grep -c "await import('\.\./\.\./\.\./\.\./shared/config/index\.js')" "$SPEC"   # 기대: 14
grep -c "await import('\.\./\.\./\.\./shared/config/index\.js')"      "$SPEC"   # 기대: 0
grep -n "vi.mock('\.\./\.\./\.\./shared/config"                       "$SPEC"   # 기대: 출력 없음
```

- [x] **Step 5: 대체 값이 소스가 읽는 항목을 전부 덮는지 확인 (FR-008)**

```bash
grep -rhn "mementoConfig\." \
  packages/memento-core/src/domains/relation/services/llm-based-relation-extractor.ts \
  packages/memento-core/src/domains/relation/services/llm-relation-extractor/ \
  packages/memento-core/src/shared/services/llm-client-initializer.ts \
  packages/memento-core/src/shared/services/llm-client-initializer/ \
  | sed 's/.*mementoConfig\.\([A-Za-z]*\).*/\1/' | sort -u
```
Expected: `geminiApiKey`, `llmProvider`, `ollamaBaseUrl`, `ollamaModel`, `openaiApiKey` 5개. 전부 `createMockConfig()` 안에 있어야 한다(현재 10개 필드는 이 5개의 상위집합이다). 목록에 없는 이름이 나오면 그 필드를 `createMockConfig()` 에 추가한다 — 모킹이 살아난 뒤에는 빠진 항목이 `undefined` 로 소스에 흘러든다.

- [x] **Step 6: 스펙 파일이 로드되는지 확인 (이 단계의 진짜 게이트)**

Run: `npx vitest run packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts`
Expected: **테스트 실패는 허용된다. 로드 실패는 허용되지 않는다.**
- `ReferenceError: Cannot access 'mockConfig' before initialization` 가 보이면 Step 1 을 빠뜨린 것이다.
- `Failed to resolve import` 가 보이면 Step 3 의 치환이 덜 된 것이다.
- 개별 `expect` 실패는 정상이다 — 모킹이 처음으로 살아나 조건이 바뀐 결과이며, T005 에서 처리한다.

- [x] **Step 7: 실패 목록을 남긴다 (T005 의 입력)**

```bash
npx vitest run packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts \
  --reporter=basic 2>&1 | tee /tmp/821-after-fix.txt
grep -c "FAIL" /tmp/821-after-fix.txt
```

- [x] **Step 8: Commit**

```bash
git add packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts
git commit -m "fix(821): point relation extractor config mock at the module the source reads

vi.mock 대상 경로와 실행 중 재가져오기 13곳을 함께 4단계로 교정한다.
mockConfig 는 vi.hoisted 로 끌어올린다 - 교정 후에는 모킹이 정적 로드
시점에 요구되므로 그대로 두면 TDZ 로 스펙 파일 전체가 로드 실패한다."
```

**Checkpoint**: 모킹이 처음으로 실효를 갖는다. 스위트는 아직 빨갛다 — 정상이다.

---

## Phase 3: User Story 3 (P1) — 각 테스트가 조건을 스스로 지정하고 되돌린다

**Goal**: 대체 값 객체가 살아있는 공유 가변 상태가 됐으므로 복원 규율을 세운다. **US2(실패 정리)보다 먼저 한다** — 복원 없이 실패를 분류하면 순서 의존 잡음을 진짜 실패로 오진한다.

**Independent Test**: 설정 의존 테스트를 순서를 바꿔 여러 번 돌려 결과가 매번 같은지, 각 테스트 직후 대체 값 객체가 기준 상태인지로 검증한다.

### Task T003 [US3] 기준 상태 복원 + 환경 변수 두 채널 고정

**Files:**
- Modify: `packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts:194-263` (최상위 `describe` 의 `beforeEach`/`afterEach`)

**Interfaces:**
- Consumes: T002 의 `createMockConfig`, `mockConfig`
- Produces: `describe` 스코프의 `originalEnv: Record<string, string | undefined>` — 테스트 본문에서 직접 쓰지 않는다. 각 테스트는 `mockConfig.X = ...` 와 `process.env.LLM_PROVIDER = ...` 로만 조건을 만든다.

- [x] **Step 1: 왜 두 채널인지 확인한다**

```bash
sed -n '32,35p' packages/memento-core/src/shared/services/llm-client-initializer/shared-helpers.ts
sed -n '253,255p' packages/memento-core/src/shared/config/environment.ts
```
Expected: `getSelectedProvider()` 가 `getRawEnvValue('LLM_PROVIDER') || mementoConfig.llmProvider` 이고, `getRawEnvValue` 는 `process.env[key]` 를 **라이브로** 읽는다. 즉 환경 변수가 모킹된 값을 덮는다 → 대체 값만 지정해서는 조건이 안 만들어진다.

- [x] **Step 2: `describe` 상단에 환경 변수 보관함을 선언한다**

`$SPEC` line 195-201 의 `let` 선언 묶음 끝(`let mockSearchSimilar: any;` 다음)에 추가한다.

```ts
  // 환경 변수 채널 보관함. LLM_PROVIDER 는 모킹된 mementoConfig.llmProvider 보다
  // 우선하므로(shared-helpers.ts:33) 테스트마다 고정하고 끝나면 되돌린다.
  const originalEnv: Record<string, string | undefined> = {};
```

- [x] **Step 3: `beforeEach` 앞머리를 교체한다**

기존 line 204-216 (`const originalOpenAIKey = ...` 부터 `mockConfig.llmProvider = 'auto';` 까지)을 아래로 교체한다.

```ts
    // 환경 변수 채널 고정 + 원래 값 보관 (afterEach 에서 복원)
    originalEnv.LLM_PROVIDER = process.env.LLM_PROVIDER;
    process.env.LLM_PROVIDER = 'auto';

    // 대체 값 객체를 기준 상태로 되돌린다.
    // 반드시 제자리 갱신이어야 한다 - 재할당하면 모킹된 모듈이 옛 객체를 계속 참조해 무효가 된다.
    Object.assign(mockConfig, createMockConfig());
```

제거되는 것: `originalOpenAIKey`/`originalGeminiKey`/`originalLLMProvider` 3개(담아두기만 하고 아무 데도 안 씀), `delete process.env.OPENAI_API_KEY`, `delete process.env.GEMINI_API_KEY`(도달 범위 안에 이 두 키의 라이브 읽기가 없다 — 설정 모듈 생성 시점에 한 번만 읽고, 교정 후엔 그 값이 대체 값 객체에서 온다), 그리고 `mockConfig` 3개 필드 개별 대입(`Object.assign` 이 10개 전부 덮는다).

- [x] **Step 4: `afterEach` 를 교체한다**

기존 line 260-263 을 아래로 교체한다.

```ts
  afterEach(() => {
    vi.restoreAllMocks();
    // 고정한 환경 변수를 실행 전 상태로 되돌린다 (FR-015)
    if (originalEnv.LLM_PROVIDER === undefined) {
      delete process.env.LLM_PROVIDER;
    } else {
      process.env.LLM_PROVIDER = originalEnv.LLM_PROVIDER;
    }
  });
```

- [x] **Step 5: 삭제한 환경 변수 조작이 정말 죽은 코드였는지 확인**

```bash
grep -rn "getRawEnvValue\|process\.env\.OPENAI_API_KEY\|process\.env\.GEMINI_API_KEY" \
  packages/memento-core/src/shared/services/llm-client-initializer.ts \
  packages/memento-core/src/shared/services/llm-client-initializer/ \
  packages/memento-core/src/domains/relation/services/llm-based-relation-extractor.ts \
  packages/memento-core/src/domains/relation/services/llm-relation-extractor/
```
Expected: `getRawEnvValue('LLM_PROVIDER')` 한 줄만. API 키 환경 변수의 라이브 읽기는 **없다**.

- [x] **Step 6: 실행 전후 환경 변수가 같은지 확인 (SC-008)**

Run:
```bash
LLM_PROVIDER=sentinel npx vitest run \
  packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts
```
Expected: 통과. 파일 내부의 복원 여부는 T007 의 순서 무관성으로 확인한다.

- [x] **Step 7: Commit**

```bash
git add packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts
git commit -m "test(821): restore mock config baseline and pin both provider channels

교정으로 대체 값 객체가 파일 전역 공유 가변 상태가 됐다. beforeEach 에서
제자리 갱신으로 기준 상태를 복원하고, LLM_PROVIDER 는 모킹 값보다 우선하므로
함께 고정한 뒤 afterEach 에서 되돌린다. 효과 없던 API 키 환경 변수 삭제는 제거."
```

### Task T004 [US3] 실 전역 설정 직접 조작 지점 이관 (#819 잔존)

**Files:**
- Modify: `packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts:708-737` (`describe('프로바이더 판정 일관성 (FR-010)')`)

**Interfaces:**
- Consumes: T002 의 `mockConfig`, T003 의 `beforeEach`/`afterEach` 복원
- Produces: 없음 (테스트 본문 정리)

- [ ] **Step 1: 현재 상태를 본다**

Run: `sed -n '708,737p' packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts`
Expected: 주석에 "이 spec 의 config 모킹은 상대 경로가 한 단계 얕아 소스에 적용되지 않는다" 가 있고, 실 설정 모듈을 4단계로 가져와 `llmProvider` 를 직접 바꾼 뒤 `try/finally` 로 되돌린다. **교정 후 그 주석은 거짓이 된다.**

- [ ] **Step 2: 테스트 본문을 모킹 기반으로 교체한다**

```ts
  describe('프로바이더 판정 일관성 (FR-010)', () => {
    it('자동 선택 모드에서 로컬 프로바이더가 채택되면 사용 가능으로 본다', async () => {
      // Given: 클라우드 자격 증명 없이 자동 선택으로 ollama 가 채택된 환경
      vi.spyOn(LLMClientInitializer.prototype, 'initialize').mockResolvedValue({
        preferredProvider: 'ollama',
        openaiClient: null,
        geminiClient: null,
        initializedProviders: ['ollama'],
        warnings: []
      });
      // 이 테스트가 전제하는 설정 조건을 두 채널 모두에 명시한다.
      // 기준 상태 복원은 beforeEach/afterEach 가 맡으므로 try/finally 가 필요 없다.
      mockConfig.llmProvider = 'auto';
      process.env.LLM_PROVIDER = 'auto';

      const extractor = new LLMBasedRelationExtractor(await createMockEmbeddingService());
      await (extractor as any).initializationPromise;

      // Then: 가용성 판정과 실행 경로가 쓰는 판정이 일치해야 한다
      expect(extractor.isAvailable()).toBe(true);
      expect((extractor as any).isOllamaAvailable()).toBe(true);
      // @ts-expect-error - private 메서드 접근 (테스트 목적)
      expect(extractor.determineProvider('auto')).toBe('ollama');
    });
  });
```

- [ ] **Step 3: 실 설정 모듈을 직접 만지는 곳이 남았는지 확인**

```bash
SPEC=packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts
grep -n "originalProvider\|finally" "$SPEC"          # 기대: 출력 없음
grep -c "await import('\.\./\.\./\.\./\.\./shared/config/index\.js')" "$SPEC"   # 기대: 13 (720 이 빠져 14→13)
```

- [ ] **Step 4: 이 테스트만 돌린다**

Run: `npx vitest run packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts -t "자동 선택 모드에서 로컬 프로바이더가 채택되면"`
Expected: PASS. #819 가 검증하려던 의도(가용성 판정과 실행 경로 판정의 일치)가 그대로 유지된다.

- [ ] **Step 5: Commit**

```bash
git add packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts
git commit -m "test(821): move #819 real-global config mutation onto the mock

모킹이 살아났으므로 실 mementoConfig 를 직접 바꾸던 우회를 제거한다.
복원은 beforeEach/afterEach 가 맡아 try/finally 가 필요 없다."
```

**Checkpoint**: 실 전역 설정을 만지는 테스트가 0 건이다. 대체 값 객체는 매 테스트 시작 시 기준 상태다.

---

## Phase 4: User Story 2 (P1) — 드러난 실패 전수 정리

**Goal**: 모킹이 살아나며 조건이 바뀐 테스트들을 전수 확인하고, 각자 전제를 스스로 명시하게 만든다.

**Independent Test**: 두 스펙 전량 실행 통과 + 각 실패 케이스가 "조건 미명시" 인지 "소스 결함" 인지 분류된 기록.

### Task T005 [US2] 중복·모순 조건 지정 정리

**Files:**
- Modify: `packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts:287-311` (`actualConfig` 분기)
- Modify: 같은 파일 `:746-750` (동적 import + 중복 대입)
- Modify: 같은 파일의 나머지 `configModule` 사용 지점

**Interfaces:**
- Consumes: T002 의 `mockConfig`, T003 의 복원 규율
- Produces: 없음

- [ ] **Step 1: `actualConfig` 지점을 고친다 (이름·주석·실제 3중 불일치)**

line 287-289 는 주석이 "실제 mementoConfig를 가져와서" 라고 말하지만 3단계 경로라 **팬텀 mock 을 받아왔다**. 교정 후에는 소스와 같은 대체 값 객체를 보므로 분기가 결정적이 된다.

기존의 `actualConfig` 가져오기와 `if (actualLLMProvider !== 'ollama')` / `else` 방어 분기 전체를 아래로 대체한다.

```ts
      // 이 테스트가 전제하는 프로바이더 조건은 beforeEach 의 기준 상태('auto')다.
      // 소스와 이 지점이 같은 대체 값 객체를 보므로 환경에 따라 갈리던 방어 분기는 필요 없다.
      const preferredProvider = (extractor as any).preferredProvider;
      expect(preferredProvider).toBeNull();
      expect(extractor.isAvailable()).toBe(false);
```

실행해서 다른 결과가 나오면 그대로 두지 말고 Step 4 의 분류 절차로 보낸다.

- [ ] **Step 2: 중복 대입을 정리한다**

line 746-750 은 동적 import 로 얻은 객체와 `mockConfig` 에 **같은 값을 두 번** 넣는다. 교정 후 둘은 동일 객체다.

```ts
      // Given: preferredProvider가 null이고 OpenAI 클라이언트만 초기화된 상태
      mockConfig.llmProvider = 'auto';
      process.env.LLM_PROVIDER = 'auto';
```

- [ ] **Step 3: 남은 `configModule` 지점을 같은 형태로 통일한다**

```bash
SPEC=packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts
grep -n "configModule" "$SPEC"
```

각 지점의 `const configModule = await import('../../../../shared/config/index.js');` + `(configModule.mementoConfig as any).X = V;` 를 `mockConfig.X = V;` 로 바꾼다. 같은 객체를 우회해서 만지는 것뿐이라 동작이 바뀌지 않고, 무엇을 지정하는지가 코드에 드러난다(FR-005 의 "조건을 명시하는 방향").

`llmProvider` 를 지정하는 지점에는 **반드시** `process.env.LLM_PROVIDER` 도 같이 지정한다(FR-015).

- [ ] **Step 4: 전량 실행하고 실패를 분류한다**

Run: `npx vitest run packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts`

남은 실패마다 판정한다.
- **조건 미명시** → 그 테스트 안에서 `mockConfig.X = ...` (+ 필요 시 `process.env.LLM_PROVIDER`)로 전제를 명시한다. 단언은 건드리지 않는다.
- **소스 결함** → **고치지 않는다.** `baseline-measurement.md` 에 아래 표를 붙이고 기록한 뒤 넘어간다(FR-011).

```markdown
## 교정 후 실패 분류 (T005)

| 테스트 | 분류 | 처리 |
|--------|------|------|
| (기입) | 조건 미명시 / 소스 결함 | (기입) |
```

- [ ] **Step 5: 전량 통과 확인**

Run: `npx vitest run packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts`
Expected: PASS (FR-004). 소스 결함으로 분류된 항목이 있으면 그 테스트에 **별도 이슈 링크 주석**을 달고, 이 태스크 종료 시 이슈 번호를 위 표에 채운다.

- [ ] **Step 6: Commit**

```bash
git add packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts \
        specs/657-821-fix-vi-mock-config-path/baseline-measurement.md
git commit -m "test(821): make each config-dependent test declare its own condition

모킹이 살아나며 조건이 바뀐 테스트를 전수 정리한다. 우회 재가져오기를 없애고
mockConfig 를 직접 지정하며, llmProvider 는 환경 변수 채널도 함께 고정한다."
```

### Task T006 [US2] [P] 위양성이 사라졌는지 검증 (SC-001, SC-002)

**Files:**
- Modify: `specs/657-821-fix-vi-mock-config-path/baseline-measurement.md`

**Interfaces:**
- Consumes: T001 의 기준값, T005 의 통과 상태
- Produces: 없음

- [ ] **Step 1: 대체 값을 바꾸면 결과가 바뀌는지 확인 (T001 Step 3 의 역방향)**

`$SPEC` 의 `createMockConfig()` 안 `llmProvider: 'auto'` 를 임시로 `'openai'` 로 바꾼다.

Run: `npx vitest run packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts`
Expected: **실패가 발생한다.** 교정 전엔 36/36 유지였다. 값 변경이 결과에 반영된다는 증거이고, 이것이 SC-001 이 요구하는 것이다. 확인 후 `'auto'` 로 되돌린다.

- [ ] **Step 2: 환경 변수 3종으로 결과가 같은지 확인 (SC-002)**

```bash
SPEC=packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts
env -u LLM_PROVIDER npx vitest run "$SPEC"   # 미설정
LLM_PROVIDER=ollama  npx vitest run "$SPEC"  # .env 기본값
LLM_PROVIDER=openai  npx vitest run "$SPEC"  # 다른 값
```
Expected: 3회 모두 동일한 통과/실패 결과. `beforeEach` 가 `LLM_PROVIDER` 를 고정하므로 바깥 값이 무관해진다.

- [ ] **Step 3: 측정 결과를 기록하고 Commit**

```bash
git add specs/657-821-fix-vi-mock-config-path/baseline-measurement.md
git commit -m "test(821): verify false positives are gone and result is env-independent"
```

### Task T007 [US3] [P] 순서 무관성·반복 실행 동일성 (SC-003)

**Files:**
- Modify: `specs/657-821-fix-vi-mock-config-path/baseline-measurement.md`

**Interfaces:**
- Consumes: T003 의 복원 규율
- Produces: 없음

- [ ] **Step 1: 순서를 섞어 돌린다**

```bash
SPEC=packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts
npx vitest run "$SPEC" --sequence.shuffle
npx vitest run "$SPEC" --sequence.shuffle
npx vitest run "$SPEC" --sequence.shuffle
```
Expected: 3회 모두 동일 결과. 다르면 어떤 테스트가 `mockConfig` 나 `process.env` 를 기준 상태 밖으로 남긴 것이다 — T003 의 복원 대상에서 빠진 항목을 찾는다.

- [ ] **Step 2: 반복 실행 동일성**

Run: `npx vitest run packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts --repeat 2`
Expected: PASS.

- [ ] **Step 3: 기록하고 Commit**

```bash
git add specs/657-821-fix-vi-mock-config-path/baseline-measurement.md
git commit -m "test(821): confirm order independence after baseline restoration"
```

**Checkpoint**: 두 스펙 중 주 대상이 전량 통과하고, 순서·환경에 무관하다.

---

## Phase 5: User Story 1 보조 — 죽은 모킹 선언 제거

### Task T008 [US1] [P] [SUBAGENT] relation-extractor.spec.ts 의 무력한 vi.mock 제거

**Files:**
- Modify: `packages/memento-core/src/domains/relation/services/__tests__/relation-extractor.spec.ts:22-33`

**Interfaces:**
- Consumes: 없음 (T002 와 독립 — 다른 파일이라 병렬 가능)
- Produces: 없음

- [ ] **Step 1: 정말 죽었는지 확인한다**

```bash
SPEC2=packages/memento-core/src/domains/relation/services/__tests__/relation-extractor.spec.ts
sed -n '22,34p' "$SPEC2"                      # vi.mock('../config/index.js', ...) 블록
grep -n "config" "$SPEC2"                     # 기대: line 24 의 선언과 line 153 의 주석뿐
grep -rn "mementoConfig" packages/memento-core/src/domains/relation/services/relation-extractor.ts   # 기대: 출력 없음
```
Expected: 이 스펙에서 그 모듈을 가져오는 곳이 **하나도 없다** → factory 가 한 번도 실행되지 않는다. 대상 소스도 config 를 읽지 않는다. 경로를 고쳐도 아무 효과가 없으므로 **제거가 올바른 해소**다(FR-012, Q1).

- [ ] **Step 2: 블록을 통째로 지운다**

`// mementoConfig 모킹` 주석부터 그 `vi.mock(...)` 블록의 닫는 `});` 까지 (line 22~33) 삭제한다. 다른 `vi.mock('openai')`·`vi.mock('@google/genai')` 는 **건드리지 않는다**.

- [ ] **Step 3: 단언이 그대로인지 확인한다 (FR-012 후단)**

Run: `npx vitest run packages/memento-core/src/domains/relation/services/__tests__/relation-extractor.spec.ts`
Expected: PASS. 제거 전후 통과 수가 같아야 한다. 달라지면 그 선언이 사실은 죽지 않았다는 뜻이니 되돌리고 Step 1 을 다시 한다.

- [ ] **Step 4: Commit**

```bash
git add packages/memento-core/src/domains/relation/services/__tests__/relation-extractor.spec.ts
git commit -m "test(821): drop the vi.mock declaration nothing ever imports

대상 모듈을 가져오는 곳이 없어 factory 가 한 번도 실행되지 않는 선언이다.
경로 교정이 아니라 제거가 올바른 해소다(FR-012)."
```

**Checkpoint**: 두 스펙 모두 통과하고, 상대 경로 `vi.mock` 위반이 2건 줄었다.

---

## Phase 6: User Story 4 (P3) — 재발 방지 차단 게이트

**Goal**: 존재하지 않는 모듈을 가리키는 상대 경로 모킹이 다시 들어오면 CI 가 막는다.

**Independent Test**: 의도적 위반을 하나 넣고 게이트를 돌려 그 위치가 보고·차단되는지, 정상 모킹에 오탐이 0인지.

### Task T009 [US4] [TDD] 검사 스크립트 (RED → GREEN)

**Files:**
- Create: `scripts/check-vi-mock-paths.ts`
- Create: `scripts/check-vi-mock-paths.spec.ts`
- Reuse: `scripts/lib/cli.ts` (`parseArgs`)

**Interfaces:**
- Consumes: 없음
- Produces:
  - `export interface MockRef { file: string; line: number; specifier: string }`
  - `export interface BaselineEntry { file: string; specifier: string; reason: string; followUp: string }`
  - `export interface ScanResult { scanned: number; violations: MockRef[]; baselined: Array<MockRef & BaselineEntry>; staleBaseline: BaselineEntry[] }`
  - `export function resolvesToModule(fromDir: string, specifier: string): boolean`
  - `export function collectMockRefs(root: string): MockRef[]`
  - `export function scan(root: string, baseline: BaselineEntry[]): ScanResult`
  - `export function validateBaseline(entries: unknown): BaselineEntry[]` (스키마 위반 시 throw)

  T010 이 baseline 파일을, T011 이 CLI 를 쓴다.

- [ ] **Step 1: 실패하는 테스트를 쓴다**

`scripts/check-vi-mock-paths.spec.ts`:

```ts
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { collectMockRefs, resolvesToModule, scan, validateBaseline } from './check-vi-mock-paths.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'vimock-'));
  mkdirSync(join(root, 'src', '__tests__'), { recursive: true });
  writeFileSync(join(root, 'src', 'real.ts'), 'export const x = 1;\n');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const writeSpec = (body: string) =>
  writeFileSync(join(root, 'src', '__tests__', 'a.spec.ts'), body);

describe('resolvesToModule', () => {
  it('.js 를 .ts 로 치환해 해석한다', () => {
    expect(resolvesToModule(join(root, 'src', '__tests__'), '../real.js')).toBe(true);
  });

  it('실재하지 않는 경로는 해석하지 못한다', () => {
    expect(resolvesToModule(join(root, 'src', '__tests__'), '../../nope/index.js')).toBe(false);
  });
});

describe('collectMockRefs', () => {
  it('패키지 이름 모킹은 수집하지 않는다', () => {
    writeSpec("vi.mock('openai', () => ({}));\nvi.mock('../real.js', () => ({}));\n");
    const refs = collectMockRefs(root);
    expect(refs.map(r => r.specifier)).toEqual(['../real.js']);
  });

  it('줄 번호를 1-based 로 기록한다', () => {
    writeSpec("// head\nvi.mock('../real.js', () => ({}));\n");
    expect(collectMockRefs(root)[0].line).toBe(2);
  });
});

describe('scan', () => {
  it('미해석 + 미등재는 violation 이다', () => {
    writeSpec("vi.mock('../../nope/index.js', () => ({}));\n");
    const result = scan(root, []);
    expect(result.violations).toHaveLength(1);
    expect(result.baselined).toHaveLength(0);
  });

  it('미해석 + 등재는 baselined 로 통과시킨다', () => {
    writeSpec("vi.mock('../../nope/index.js', () => ({}));\n");
    const result = scan(root, [{
      file: 'src/__tests__/a.spec.ts',
      specifier: '../../nope/index.js',
      reason: 'r', followUp: '#1',
    }]);
    expect(result.violations).toHaveLength(0);
    expect(result.baselined).toHaveLength(1);
  });

  it('등재됐는데 해석되면 staleBaseline 으로 보고한다', () => {
    writeSpec("vi.mock('../real.js', () => ({}));\n");
    const result = scan(root, [{
      file: 'src/__tests__/a.spec.ts',
      specifier: '../real.js',
      reason: 'r', followUp: '#1',
    }]);
    expect(result.violations).toHaveLength(0);
    expect(result.staleBaseline).toHaveLength(1);
  });

  it('정상 모킹은 위반으로 보고하지 않는다', () => {
    writeSpec("vi.mock('../real.js', () => ({}));\n");
    expect(scan(root, []).violations).toHaveLength(0);
  });
});

describe('validateBaseline', () => {
  it('reason 이 비면 거부한다', () => {
    expect(() => validateBaseline([
      { file: 'a', specifier: 'b', reason: '', followUp: '#1' },
    ])).toThrow(/reason/);
  });

  it('followUp 이 없으면 거부한다', () => {
    expect(() => validateBaseline([{ file: 'a', specifier: 'b', reason: 'r' }])).toThrow(/followUp/);
  });
});
```

- [ ] **Step 2: 실패를 확인한다**

Run: `npx vitest run scripts/check-vi-mock-paths.spec.ts`
Expected: FAIL — `Failed to resolve import "./check-vi-mock-paths.js"`

- [ ] **Step 3: 최소 구현을 쓴다**

`scripts/check-vi-mock-paths.ts`:

```ts
#!/usr/bin/env node
/**
 * vi.mock 상대 경로 실재성 검사 (Issue #821)
 *
 * 존재하지 않는 모듈을 가리키는 상대 경로 vi.mock 을 찾아 차단한다.
 * 이런 선언은 같은 경로의 동적 import 를 함께 가로채기 때문에 실행 중에는
 * 드러나지 않는다. 정적 스캔이어야만 잡힌다.
 *
 * 사용법:
 *   npx tsx scripts/check-vi-mock-paths.ts [--ci] [--format=text|json] [--path=<dir>]
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { parseArgs as parseCliArgs } from './lib/cli.js';

export interface MockRef { file: string; line: number; specifier: string }
export interface BaselineEntry { file: string; specifier: string; reason: string; followUp: string }
export interface ScanResult {
  scanned: number;
  violations: MockRef[];
  baselined: Array<MockRef & BaselineEntry>;
  staleBaseline: BaselineEntry[];
}

const SPEC_FILE = /\.(spec|test)\.tsx?$/;
const SKIP_DIR = new Set(['node_modules', 'dist', '.git', 'coverage', 'graphify-out', 'test-results']);
const VI_MOCK = /vi\.mock\(\s*['"]([^'"]+)['"]/g;

export function resolvesToModule(fromDir: string, specifier: string): boolean {
  const base = resolve(fromDir, specifier);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')];
  if (base.endsWith('.js')) {
    const stem = base.slice(0, -3);
    candidates.push(`${stem}.ts`, `${stem}.tsx`);
  }
  return candidates.some((c) => existsSync(c));
}

function walk(dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (SPEC_FILE.test(name)) out.push(full);
  }
}

export function collectMockRefs(root: string): MockRef[] {
  const files: string[] = [];
  walk(root, files);
  const refs: MockRef[] = [];
  for (const full of files) {
    const src = readFileSync(full, 'utf-8');
    for (const m of src.matchAll(VI_MOCK)) {
      const specifier = m[1];
      // 패키지 이름 모킹은 이 게이트의 대상이 아니다 (FR-010)
      if (!specifier.startsWith('.')) continue;
      refs.push({
        file: relative(root, full),
        line: src.slice(0, m.index).split('\n').length,
        specifier,
      });
    }
  }
  return refs;
}

export function validateBaseline(entries: unknown): BaselineEntry[] {
  if (!Array.isArray(entries)) throw new Error('baseline 은 배열이어야 합니다.');
  return entries.map((e, i) => {
    for (const key of ['file', 'specifier', 'reason', 'followUp'] as const) {
      const v = (e as Record<string, unknown>)?.[key];
      if (typeof v !== 'string' || v.trim() === '') {
        throw new Error(`baseline[${i}]: '${key}' 가 비어 있습니다. 사유 없는 예외는 허용하지 않습니다.`);
      }
    }
    return e as BaselineEntry;
  });
}

export function scan(root: string, baseline: BaselineEntry[]): ScanResult {
  const refs = collectMockRefs(root);
  const key = (file: string, specifier: string) => `${file} ${specifier}`;
  const listed = new Map(baseline.map((b) => [key(b.file, b.specifier), b]));
  const matched = new Set<string>();

  const violations: MockRef[] = [];
  const baselined: Array<MockRef & BaselineEntry> = [];

  for (const ref of refs) {
    if (resolvesToModule(dirname(join(root, ref.file)), ref.specifier)) continue;
    const k = key(ref.file, ref.specifier);
    const entry = listed.get(k);
    if (entry) { matched.add(k); baselined.push({ ...ref, ...entry }); }
    else violations.push(ref);
  }
  // 등재됐지만 이제 위반이 아닌 항목 (FR-014)
  const staleBaseline = baseline.filter((b) => !matched.has(key(b.file, b.specifier)));

  return { scanned: refs.length, violations, baselined, staleBaseline };
}
```

- [ ] **Step 4: 테스트가 통과하는지 확인한다**

Run: `npx vitest run scripts/check-vi-mock-paths.spec.ts`
Expected: PASS — 10 tests.

- [ ] **Step 5: CLI 진입점을 붙인다**

같은 파일 끝에 추가한다.

```ts
const BASELINE_PATH = 'scripts/vi-mock-path-baseline.json';

function main(): void {
  const { values } = parseCliArgs({
    options: {
      ci: { type: 'boolean', default: false },
      format: { type: 'string', default: 'text' },
      path: { type: 'string', default: process.cwd() },
    },
  });
  const root = resolve(String(values.path));
  const ci = Boolean(values.ci);

  let baseline: BaselineEntry[] = [];
  try {
    const file = join(root, BASELINE_PATH);
    baseline = validateBaseline(existsSync(file) ? JSON.parse(readFileSync(file, 'utf-8')) : []);
  } catch (error) {
    console.error(`baseline 파일 오류: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(ci ? 1 : 0);
  }

  const result = scan(root, baseline);

  if (values.format === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`vi.mock 경로 검사 - 상대경로 ${result.scanned}건 스캔\n`);
    console.log(`위반 (차단) ${result.violations.length}건`);
    for (const v of result.violations) console.log(`  ${v.file}:${v.line} -> ${v.specifier}`);
    console.log(`예외 등재 (baseline) ${result.baselined.length}건`);
    for (const b of result.baselined) {
      console.log(`  ${b.file}:${b.line} -> ${b.specifier}`);
      console.log(`    사유: ${b.reason} / 후속: ${b.followUp}`);
    }
    console.log(`정리 대상 (baseline 에 있으나 위반 아님) ${result.staleBaseline.length}건`);
    for (const s of result.staleBaseline) console.log(`  ${s.file} -> ${s.specifier}`);
    console.log(result.violations.length === 0 ? '\nOK' : '\n새 위반이 있습니다.');
  }

  if (ci && result.violations.length > 0) process.exit(1);
  process.exit(0);
}

if (process.argv[1] && resolve(process.argv[1]).endsWith('check-vi-mock-paths.ts')) {
  main();
}
```

- [ ] **Step 6: 실제 저장소에 돌려 기대 수치를 확인한다**

Run: `npx tsx scripts/check-vi-mock-paths.ts`
Expected: `상대경로 57건 스캔` (T008 이 선언 1건을 통째로 지웠으므로 58 → 57. T002 는 경로만 바꿨을 뿐 선언은 남아 계속 집계된다), `위반 (차단) 8건`. baseline 미생성이라 8건 전부 violation 이고, 그 목록이 research R8 의 표와 정확히 일치해야 한다.

- [ ] **Step 7: Commit**

```bash
git add scripts/check-vi-mock-paths.ts scripts/check-vi-mock-paths.spec.ts
git commit -m "feat(821): add static gate for unresolvable relative vi.mock paths

런타임으로는 잡을 수 없다 - 모킹이 요구되지 않으면 factory 자체가 안 돌기 때문이다.
정적 스캔으로 대상 모듈 실재 여부를 확인한다. 패키지 이름 모킹은 대상 밖."
```

### Task T010 [US4] baseline 등재 + 후속 이슈

**Files:**
- Create: `scripts/vi-mock-path-baseline.json`

**Interfaces:**
- Consumes: T009 의 `BaselineEntry` 스키마와 `validateBaseline`
- Produces: 없음

- [ ] **Step 1: 후속 이슈를 먼저 연다**

`followUp` 이 `#TBD` 로 남으면 SC-007("예외 목록의 모든 항목은 후속 추적 대상을 가진다")이 도입 시점에 곧바로 깨진다. 최소 형태는 2건이다.

```bash
gh issue create --title "embedding provider 스펙의 vi.mock 상대 경로 5건 교정" \
  --body "scripts/vi-mock-path-baseline.json 에 등재된 embedding-provider-factory.spec.ts 5건. 원 이슈 #821, spec specs/657-821-fix-vi-mock-config-path/."
gh issue create --title "memory/search/server 스펙의 vi.mock 상대 경로 3건 교정" \
  --body "memory-embedding-service.spec.ts 1건, hybrid-search-engine.spec.ts 1건, quality.routes.spec.ts 1건. 원 이슈 #821."
```

- [ ] **Step 2: baseline 파일을 쓴다 (위 이슈 번호로 `#NNN`·`#MMM` 을 채운다)**

```json
[
  {
    "file": "packages/memento-core/src/domains/embedding/providers/__tests__/embedding-provider-factory.spec.ts",
    "specifier": "../config/index.js",
    "reason": "embedding provider 스펙 전반이 같은 결함을 가짐. 5건을 한 묶음으로 처리.",
    "followUp": "#NNN"
  },
  {
    "file": "packages/memento-core/src/domains/embedding/providers/__tests__/embedding-provider-factory.spec.ts",
    "specifier": "../services/lightweight-embedding-service.js",
    "reason": "embedding provider 스펙 전반이 같은 결함을 가짐. 5건을 한 묶음으로 처리.",
    "followUp": "#NNN"
  },
  {
    "file": "packages/memento-core/src/domains/embedding/providers/__tests__/embedding-provider-factory.spec.ts",
    "specifier": "../services/gemini-embedding-service.js",
    "reason": "embedding provider 스펙 전반이 같은 결함을 가짐. 5건을 한 묶음으로 처리.",
    "followUp": "#NNN"
  },
  {
    "file": "packages/memento-core/src/domains/embedding/providers/__tests__/embedding-provider-factory.spec.ts",
    "specifier": "../services/openai-embedding-service.js",
    "reason": "embedding provider 스펙 전반이 같은 결함을 가짐. 5건을 한 묶음으로 처리.",
    "followUp": "#NNN"
  },
  {
    "file": "packages/memento-core/src/domains/embedding/providers/__tests__/embedding-provider-factory.spec.ts",
    "specifier": "./model-availability-service.js",
    "reason": "embedding provider 스펙 전반이 같은 결함을 가짐. 5건을 한 묶음으로 처리.",
    "followUp": "#NNN"
  },
  {
    "file": "packages/memento-core/src/domains/memory/services/__tests__/memory-embedding-service.spec.ts",
    "specifier": "./unified-embedding-service.js",
    "reason": "memory 도메인 단독 건. #821 범위 밖이라 별도 처리.",
    "followUp": "#MMM"
  },
  {
    "file": "packages/memento-core/src/domains/search/algorithms/__tests__/hybrid-search-engine.spec.ts",
    "specifier": "../services/embedding-service.js",
    "reason": "search 도메인 단독 건. #821 범위 밖이라 별도 처리.",
    "followUp": "#MMM"
  },
  {
    "file": "packages/memento-server/src/server/routes/quality.routes.spec.ts",
    "specifier": "../../shared/utils/logger.js",
    "reason": "memento-server 단독 건. #821 범위 밖이라 별도 처리.",
    "followUp": "#MMM"
  }
]
```

- [ ] **Step 3: 도입 시점에 설명되지 않는 위반이 0인지 확인 (SC-007)**

Run: `npx tsx scripts/check-vi-mock-paths.ts --ci; echo "exit=$?"`
Expected: `위반 (차단) 0건`, `예외 등재 (baseline) 8건`, `정리 대상 0건`, `exit=0`.

- [ ] **Step 4: 스키마 검증이 도는지 확인 (계약 C5)**

임시로 첫 항목의 `"reason"` 을 `""` 로 바꾼다.

Run: `npx tsx scripts/check-vi-mock-paths.ts --ci; echo "exit=$?"`
Expected: `baseline 파일 오류: baseline[0]: 'reason' 가 비어 있습니다.` / `exit=1`. 확인 후 되돌린다.

- [ ] **Step 5: Commit**

```bash
git add scripts/vi-mock-path-baseline.json
git commit -m "chore(821): baseline the 8 pre-existing vi.mock path violations

이번 범위 밖 8건을 사유·후속 추적과 함께 등재한다. 새 위반만 차단한다."
```

### Task T011 [US4] npm 스크립트 + CI 배선

**Files:**
- Modify: `package.json` (scripts)
- Modify: `.github/workflows/ci.yml` (lint 잡)

**Interfaces:**
- Consumes: T009 의 CLI, T010 의 baseline
- Produces: 없음

- [ ] **Step 1: npm 스크립트를 추가한다**

`package.json` 의 `"check-debt-markers"` 줄 다음에 넣는다.

```json
    "check:vi-mock-paths": "tsx scripts/check-vi-mock-paths.ts",
```

- [ ] **Step 2: CI 스텝을 추가한다**

`.github/workflows/ci.yml` 의 `lint` 잡, `- run: npx tsx scripts/check-retry-usage.ts --ci` 바로 다음 줄에 넣는다.

```yaml
      - run: npx tsx scripts/check-vi-mock-paths.ts --ci
```

- [ ] **Step 3: 의도적 위반이 차단되는지 확인한다 (SC-005, 계약 C2)**

임시 파일 `packages/memento-core/src/domains/relation/services/__tests__/tmp-gate-probe.spec.ts` 를 만든다.

```ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('../../../nowhere/at/all.js', () => ({}));
describe('probe', () => { it('runs', () => { expect(1).toBe(1); }); });
```

```bash
npx tsx scripts/check-vi-mock-paths.ts --ci; echo "exit=$?"
```
Expected: `exit=1` 이고 `tmp-gate-probe.spec.ts:2 -> ../../../nowhere/at/all.js` 가 위반 목록에 나온다.

```bash
rm packages/memento-core/src/domains/relation/services/__tests__/tmp-gate-probe.spec.ts
npx tsx scripts/check-vi-mock-paths.ts --ci; echo "exit=$?"   # 기대: exit=0
```

- [ ] **Step 4: 오탐이 0인지 확인한다 (SC-005 후단, 계약 C3/C6)**

Run: `npx tsx scripts/check-vi-mock-paths.ts --format=json`
Expected: `violations` 길이 0, `baselined` 길이 8, `staleBaseline` 길이 0. 패키지 이름 모킹(`vi.mock('openai')` 등)은 `scanned` 에 아예 들어가지 않는다.

- [ ] **Step 5: Commit**

```bash
git add package.json .github/workflows/ci.yml
git commit -m "ci(821): block new unresolvable vi.mock paths in the lint job"
```

**Checkpoint**: 새 위반은 CI 에서 막히고, 기존 8건은 사유와 후속 추적을 달고 통과한다.

---

## Phase 7: Polish & 완료 게이트

### Task T012 [REVIEW] 전체 게이트 통과 + 산출물 정합성

**Files:**
- Modify: `specs/657-821-fix-vi-mock-config-path/checklists/requirements.md`

**Interfaces:**
- Consumes: T001~T011 전부
- Produces: 없음

- [ ] **Step 1: Constitution IV 게이트를 돌린다**

```bash
npm run lint
npm run type-check
npm test
```
Expected: 3개 모두 PASS. `npm test` 는 `test:prepare`(빌드) 후 전체 스위트를 돈다 — 이번 작업으로 새로 깨진 다른 스펙이 0건이어야 한다(SC-006).

- [ ] **Step 2: graphify 비적용을 확인한다**

```bash
git diff --stat main...HEAD -- packages/ | grep -v "__tests__" || echo "프로덕션 코드 변경 없음 - graphify 게이트 비적용"
```
Expected: `__tests__/` 밖의 `packages/` 변경이 없다. 있으면 FR-011 을 어긴 것이니 되돌리고 별도 이슈로 분리한다.

- [ ] **Step 3: 성공 기준을 대조한다**

| SC | 확인 방법 | 근거 태스크 |
|----|-----------|-------------|
| SC-001 | 대체 값 변경 시 실패 발생 | T006 Step 1 |
| SC-002 | 환경 변수 3종 동일 결과 | T006 Step 2 |
| SC-003 | shuffle 3회 + repeat 동일 | T007 |
| SC-004 | 실 전역 조작 지점 0 (`grep finally` 무출력) | T004 Step 3 |
| SC-005 | 의도적 위반 차단 + 오탐 0 | T011 Step 3-4 |
| SC-006 | `npm test` 전체 통과 | Step 1 |
| SC-007 | violations 0 / baselined 8 / stale 0 | T010 Step 3 |
| SC-008 | 환경 변수 복원 + 두 채널 일치 | T003 Step 4-6, T005 Step 3 |

- [ ] **Step 4: 체크리스트에 완료 기록을 남긴다**

`specs/657-821-fix-vi-mock-config-path/checklists/requirements.md` 끝에 추가한다.

```markdown
### 구현 완료 후 재검증

- Constitution IV 게이트 3종 통과. graphify 비적용(프로덕션 코드 미변경) 확인.
- SC-001~SC-008 전수 대조 완료 (tasks.md T012 Step 3 표).
- FR-011 로 분리한 소스 결함: (있으면 이슈 번호, 없으면 "없음") 기입.
```

- [ ] **Step 5: Commit**

```bash
git add specs/657-821-fix-vi-mock-config-path/checklists/requirements.md
git commit -m "docs(821): record post-implementation verification"
```

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (T001)**: 의존 없음. 즉시 시작.
- **Phase 2 (T002)**: T001 이후. **모든 후속 작업을 막는다.**
- **Phase 3 (T003 → T004)**: T002 이후. T003 이 T004 의 전제.
- **Phase 4 (T005 → T006, T007)**: T003·T004 이후. T006·T007 은 T005 이후 서로 병렬.
- **Phase 5 (T008)**: **T001~T007 과 완전 독립.** 다른 파일이라 언제든 병렬 가능.
- **Phase 6 (T009 → T010 → T011)**: T008 이후에 도는 것이 좋다 — T008 이 위반 2건을 지워야 T009 Step 6 의 기대 수치(8건)가 맞다. 나머지는 직렬.
- **Phase 7 (T012)**: 전부 완료 후.

### 왜 US3 가 US2 보다 앞인가

복원 규율(T003) 없이 실패를 분류하면(T005) 순서 의존 잡음을 진짜 실패로 오진한다. spec 의 우선순위는 둘 다 P1 이고, 실행 순서만 US3 가 앞선다.

### 원자성 제약 (깨면 안 됨)

- **T002 의 Step 1-3 은 한 커밋**. 선언만 고치면 남은 재가져오기가 해석 실패로 요란하게 깨지고, 재가져오기만 고치면 **모킹 없이 실 전역을 조작하는 상태로 조용히 회귀한다**. 뒤쪽이 더 위험하다.
- **T010 의 Step 1(이슈 생성)은 Step 2(baseline 작성)보다 먼저**. 아니면 `#TBD` 가 남아 SC-007 이 깨진다.

### Parallel Opportunities

- `[P]` T006 · T007 — 둘 다 T005 이후, 서로 다른 검증이라 동시 가능.
- `[P] [SUBAGENT]` T008 — `relation-extractor.spec.ts` 단독 파일, 나머지와 파일 충돌 없음. T001 직후부터 언제든 별도 작업자/서브에이전트에 넘길 수 있다.

### Parallel Example

```bash
# T005 완료 후:
Task: "T006 위양성 소멸 검증 (SC-001, SC-002)"
Task: "T007 순서 무관성·반복 실행 동일성 (SC-003)"

# 초반부터 독립적으로:
Task: "T008 relation-extractor.spec.ts 의 죽은 vi.mock 선언 제거"
```

---

## Implementation Strategy

### MVP (US1 만)

1. T001 기준선 → T002 원자적 교정 → T003 복원 규율.
2. **STOP and VALIDATE**: 대체 값을 바꾸면 결과가 바뀌는가(T006 Step 1)?
3. 여기까지가 최소 가치다 — 위양성이 사라진다.

### Incremental Delivery

1. T001-T003 → 모킹이 실효를 갖는다 (MVP)
2. + T004-T007 → 두 스펙 전량 통과, 순서·환경 무관
3. + T008 → 죽은 선언 제거
4. + T009-T011 → 재발 차단
5. + T012 → 완료 게이트

각 단계가 앞 단계를 깨지 않는다.

---

## Notes

- `[P]` = 다른 파일, 의존 없음 / `[TDD]` = RED-GREEN 순서 강제 / `[REVIEW]` = 사람 리뷰 후 진행 / `[SUBAGENT]` = 서브에이전트 위임 가능
- 태스크마다 커밋한다. 단 T002 의 세 편집은 **한 커밋**이어야 한다.
- 테스트 실행은 언제나 저장소 루트에서.
- 단언을 약화시켜 통과시키지 않는다. 소스 결함이면 고치지 말고 이슈로 분리한다.
