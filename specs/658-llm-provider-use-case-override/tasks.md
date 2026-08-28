---
description: "Task breakdown for 658-llm-provider-use-case-override"
---

# Tasks: LLM Provider Use-Case Override

> **For agentic workers:** 이 계획은 태스크 단위로 실행한다. 각 스텝은 체크박스(`- [x]`)로 추적한다. `[TDD]` 태스크는 RED → GREEN → REFACTOR 순서를 지킨다. 페이즈 체크포인트에서 사람 승인 없이 다음 페이즈로 넘기지 않는다 (`/speckit.superspec.execute`).



> **Execute note (2026-08-27):** Implementation complete in-session. Per-task git commits deferred (user commit policy); ask to commit when ready.

**Goal**: triple / relation / procedural 에 per-job `LLM_PROVIDER_*` 를 추가하고, FR-004 cross-provider model leak 을 막으며, job override 가 ollama 일 때 readiness 를 돌리고, 문서를 갱신한다 (#820).

**Architecture**: `llmModelOverrides` 패턴을 미러해 `llmProviderOverrides` + `resolveLlmProvider(useCase)` 를 추가한다. `resolveLlmModel` 은 `runtimeProvider === boundProvider` 일 때만 use-case model override 를 적용한다. 세 call site 는 `resolveLlmProvider` 를 기존 `determineProvider` / 선택 경로에 넣고, initializer 는 세 override 중 하나라도 `ollama` 이면 `testOllamaConnection` 을 호출한다.

**Tech Stack**: TypeScript 5.x, Node.js ≥24, ES modules, Vitest. 신규 dependency 없음.

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Research**: [research.md](./research.md) | **Data model**: [data-model.md](./data-model.md) | **Contracts**: [contracts/env-llm-provider-overrides.md](./contracts/env-llm-provider-overrides.md) | **Quickstart**: [quickstart.md](./quickstart.md)

**Input**: Design documents from `/specs/658-llm-provider-use-case-override/`
**Tests**: 필수. 헌법 I(Test-First) — FR-004 / `resolveLlmProvider` / Ollama readiness 는 자동 테스트 없이 완료로 치지 않는다.

## Format: `[ID] [markers] [Story] Description`

| Marker | 의미 |
|--------|------|
| `[P]` | 다른 `[P]` 태스크와 병렬 가능 (파일이 겹치지 않음) |
| `[TDD]` | RED → GREEN 강제 |
| `[REVIEW]` | 사람 리뷰 후 진행 |
| `[SUBAGENT]` | 서브에이전트 위임 가능 |

## Global Constraints

이 절의 항목은 **모든 태스크의 요구사항에 암묵적으로 포함된다.**

- Node.js ≥24, TypeScript ES modules, npm workspaces (`packages/memento-core`).
- In-scope env keys only: `LLM_PROVIDER_TRIPLE_EXTRACTION`, `LLM_PROVIDER_RELATION_EXTRACTION`, `LLM_PROVIDER_PROCEDURAL`. **No** `LLM_PROVIDER_CONSOLIDATION` (FR-007).
- Prefer-then-fallback only (FR-017) — no hard-pin / never-fallback mode.
- No new model-name ↔ provider compatibility validator (FR-019).
- No MCP / HTTP API contract change (FR-009); no embedding provider change (FR-008); no personal-agent namespace change (FR-007).
- Invalid provider → unset + `[CONFIG WARN]` once at load via `process.stderr.write` (not `console.warn`) (FR-010/014; AGENTS.md Security Check).
- Empty/whitespace provider or model override → unset (FR-012/015).
- Tokens: trim + lowercase before validity (`openai` \| `gemini` \| `ollama` \| `auto`) (FR-013).
- No new hot-reload (Q7 / R7).
- Complete before finish: `npm run lint`, `npm run type-check`, targeted + relevant vitest, graphify rebuild. Do **not** commit `graphify-out/`.
- Branch: `jee1/feat-config-llm-provider-use-case-override-cross`. Do not push/PR without user approval.
- Issue refs in commits: `Refs #820`.

---

## Phase 1: Setup

**Purpose**: 변경 전 기준선. 기존 실패를 이번 변경 탓으로 오해하지 않는다.

- [x] **T001** 기준선 확인

  Run:

  ```bash
  npm test -- packages/memento-core/src/shared/config/__tests__/llm-model-resolver.spec.ts
  npm test -- packages/memento-core/src/shared/services/__tests__/llm-client-initializer/ollama-connection.spec.ts
  npm test -- packages/memento-core/src/shared/services/__tests__/llm-client-initializer/initialize.spec.ts
  ```

  Expected: 모두 PASS. 하나라도 실패하면 **여기서 멈추고 보고**.

**Checkpoint**: 기준선 green → Phase 2.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 타입·config 로드·`resolveLlmProvider`. **US1–US4 전부 여기 의존.**

**⚠️ CRITICAL**: T003 완료 전 User Story 구현 시작 금지.

### T002 [TDD] `llmProviderOverrides` 타입 + config 로드 (normalize / empty / invalid warn)

**Files:**
- Modify: `packages/memento-core/src/shared/types/memory.types.ts` (`MementoConfig` — `llmModelOverrides` 근처)
- Modify: `packages/memento-core/src/shared/config/index.ts` (env → overrides)
- Create (권장): `packages/memento-core/src/shared/config/llm-provider-override.ts` — parse/normalize 순수 함수 (테스트 주입 용이)
- Test: `packages/memento-core/src/shared/config/__tests__/llm-provider-override.spec.ts` (신규) 및/또는 config 로드 단위 테스트
- Modify: `packages/memento-core/src/shared/services/__tests__/llm-client-initializer/llm-client-initializer.test-setup.ts` — mock에 `llmProviderOverrides: {}` 추가

**Interfaces:**
- Consumes: `resolveOptionalString` / `getRawEnvValue`, `LLMProvider`
- Produces:
  - `MementoConfig.llmProviderOverrides: { triple_extraction?: LLMProvider; relation_extraction?: LLMProvider; procedural?: LLMProvider }` (partial; absent keys = unset)
  - `parseLlmProviderOverride(raw: string | undefined): { value?: LLMProvider; invalidRaw?: string }` — empty/whitespace → no value; trim+lowercase; allowed set `openai|gemini|ollama|auto`; else `invalidRaw` for once-at-load warn
  - Config load: for each of the three env keys, if `invalidRaw` → `process.stderr.write('[CONFIG WARN] ...\\n')` **once**, omit key from map

- [x] **Step 1: 실패 테스트**

  ```ts
  import { parseLlmProviderOverride } from '../llm-provider-override.js';

  describe('parseLlmProviderOverride', () => {
    it('treats empty and whitespace as unset', () => {
      expect(parseLlmProviderOverride(undefined).value).toBeUndefined();
      expect(parseLlmProviderOverride('').value).toBeUndefined();
      expect(parseLlmProviderOverride('  ').value).toBeUndefined();
    });

    it('normalizes trim+lowercase', () => {
      expect(parseLlmProviderOverride('  OpenAI ').value).toBe('openai');
      expect(parseLlmProviderOverride('GEMINI').value).toBe('gemini');
    });

    it('marks unknown tokens invalid without value', () => {
      const r = parseLlmProviderOverride('anthropic');
      expect(r.value).toBeUndefined();
      expect(r.invalidRaw).toBeTruthy();
    });

    it('accepts auto and equals-global-compatible tokens', () => {
      expect(parseLlmProviderOverride('auto').value).toBe('auto');
      expect(parseLlmProviderOverride('ollama').value).toBe('ollama');
    });
  });
  ```

- [x] **Step 2: RED 확인** — `npm test -- packages/memento-core/src/shared/config/__tests__/llm-provider-override.spec.ts` → FAIL (module missing)

- [x] **Step 3: 최소 구현** — parser + `memory.types` 필드 + `index.ts` 세 env 키 로드 + invalid warn once + test-setup mock 필드

- [x] **Step 4: GREEN** — parser spec PASS; existing initializer specs still PASS

- [x] **Step 5: Commit** — `feat(config): add llmProviderOverrides from LLM_PROVIDER_* env\n\nRefs #820`

---

### T003 [TDD] `resolveLlmProvider(useCase)`

**Files:**
- Modify: `packages/memento-core/src/shared/config/llm-model-resolver.ts` (또는 동일 디렉터리에 provider resolver 추가 후 re-export — YAGNI면 같은 파일)
- Test: `packages/memento-core/src/shared/config/__tests__/llm-model-resolver.spec.ts` (또는 `llm-provider-resolver.spec.ts`)

**Interfaces:**
- Consumes: `mementoConfig.llmProviderOverrides`, `mementoConfig.llmProvider`
- Produces:

  ```ts
  export type InScopeLlmProviderUseCase =
    | 'triple_extraction'
    | 'relation_extraction'
    | 'procedural';

  export function resolveLlmProvider(
    useCase: InScopeLlmProviderUseCase,
    config?: Pick<MementoConfig, 'llmProvider' | 'llmProviderOverrides'>
  ): LLMProvider;
  ```

  Semantics: valid override for `useCase` → that provider; else `config.llmProvider` (default `'auto'`). Do **not** warn here (warn already at load).

- [x] **Step 1: 실패 테스트**

  ```ts
  it('returns override when set', () => {
    const config = {
      llmProvider: 'openai' as const,
      llmProviderOverrides: { triple_extraction: 'ollama' as const },
    };
    expect(resolveLlmProvider('triple_extraction', config)).toBe('ollama');
  });

  it('falls back to global when override unset', () => {
    const config = { llmProvider: 'gemini' as const, llmProviderOverrides: {} };
    expect(resolveLlmProvider('relation_extraction', config)).toBe('gemini');
  });

  it('override equal to global is valid no-op', () => {
    const config = {
      llmProvider: 'openai' as const,
      llmProviderOverrides: { procedural: 'openai' as const },
    };
    expect(resolveLlmProvider('procedural', config)).toBe('openai');
  });
  ```

- [x] **Step 2: RED** → Step 3 implement → Step 4 GREEN → Step 5 commit  
  `feat(config): add resolveLlmProvider for per-job preferences\n\nRefs #820`

**Checkpoint**: Foundation ready — US1/US2/US3/US4 시작 가능.

---

## Phase 3: User Story 2 - Stop wrong-provider model names (Priority: P1) 🎯 correctness

**Goal**: FR-004 — use-case model override only when `runtimeProvider === boundProvider`; discard observable ≤1×/invocation (FR-016); empty model unset (FR-015).

**Independent Test**: `resolveLlmModel` unit tests — mismatch discards override + log spy; match applies; empty model → provider default.

**Note**: US2 를 US1 call-site 배선 **앞**에 두면 call site 가 새 시그니처로 바로 연결 가능. US1 과 병렬 가능하나 **같은 파일** `llm-model-resolver.ts` 를 건드리면 직렬.

### T004 [TDD] [US2] `resolveLlmModel` bound-provider guard + discard log

**Files:**
- Modify: `packages/memento-core/src/shared/config/llm-model-resolver.ts`
- Test: `packages/memento-core/src/shared/config/__tests__/llm-model-resolver.spec.ts`
- Call-site follow-up (최소): 기존 `resolveLlmModel(provider, useCase)` 호출이 깨지지 않게 — **옵션 인자**로 `boundProvider` / logger 주입. `boundProvider` 생략 시: legacy 동작 대신 **안전하게** override 미적용(또는 `boundProvider === runtimeProvider` 로만 적용) — research R4: call sites **must** supply bound. Prefer: required when `useCase` set.

**Interfaces:**
- Consumes: `llmModelOverrides`, provider defaults, `resolveLlmProvider` (bound 계산은 call site 또는 thin helper)
- Produces (권장 시그니처 — 구현 시 기존 호출부 전수 갱신):

  ```ts
  export type ResolveLlmModelOptions = {
    boundProvider?: LlmModelProvider | null;
    /** test inject; default structured logger */
    onModelOverrideDiscarded?: (info: {
      useCase: LlmUseCase;
      boundProvider: LlmModelProvider | null | undefined;
      runtimeProvider: LlmModelProvider;
      discardedModel: string;
    }) => void;
  };

  export function resolveLlmModel(
    runtimeProvider: LlmModelProvider,
    useCase?: LlmUseCase,
    config: LlmModelConfigSlice = mementoConfig,
    options?: ResolveLlmModelOptions
  ): string;
  ```

  Rules:
  1. Empty/whitespace model override → treat unset (FR-015); return provider default.
  2. If override non-empty and (`options.boundProvider` is null/undefined **or** `runtimeProvider !== boundProvider`) → **do not** apply override; call `onModelOverrideDiscarded` once; return provider default (FR-004/016).
  3. If `runtimeProvider === boundProvider` → apply override (FR-019: no name↔provider validator).
  4. Helper (optional, same module): `resolveBoundLlmProvider(useCase, initPreferred: LlmModelProvider | null, config?)` — concrete requested → that; `auto` → `initPreferred` if non-null else null (skip override).

- [x] **Step 1: 실패 테스트** (기존 override-always-applies 케이스 갱신 + 신규)

  ```ts
  it('applies use-case override only when runtime equals bound', () => {
    const config = {
      ...baseConfig,
      llmModelOverrides: { triple_extraction: 'cheap-mini-model' },
    };
    expect(
      resolveLlmModel('gemini', 'triple_extraction', config, { boundProvider: 'gemini' })
    ).toBe('cheap-mini-model');
  });

  it('discards override when runtime differs from bound and logs once', () => {
    const discarded: unknown[] = [];
    const config = {
      ...baseConfig,
      llmModelOverrides: { triple_extraction: 'gpt-cloud-only' },
    };
    expect(
      resolveLlmModel('ollama', 'triple_extraction', config, {
        boundProvider: 'openai',
        onModelOverrideDiscarded: (i) => discarded.push(i),
      })
    ).toBe(baseConfig.ollamaModel || 'llama3'); // provider default path
    expect(discarded).toHaveLength(1);
  });

  it('treats whitespace model override as unset', () => {
    const config = {
      ...baseConfig,
      llmModelOverrides: { procedural: '   ' },
    };
    expect(
      resolveLlmModel('openai', 'procedural', config, { boundProvider: 'openai' })
    ).toBe(baseConfig.openaiLlmModel || 'gpt-4o-mini');
  });

  it('skips override when boundProvider is null (auto + no preferred)', () => {
    const config = {
      ...baseConfig,
      llmModelOverrides: { relation_extraction: 'should-not-leak' },
    };
    expect(
      resolveLlmModel('gemini', 'relation_extraction', config, { boundProvider: null })
    ).not.toBe('should-not-leak');
  });
  ```

- [x] **Step 2: RED** — 기존 “override always wins” 테스트도 새 시그니처/의미에 맞게 수정한 뒤 RED 확인

- [x] **Step 3: 구현** + 모든 기존 `resolveLlmModel(...)` 호출부에 `boundProvider` 전달 (임시로 `boundProvider: runtimeProvider` 는 **leak 미수정** — US1 태스크에서 `resolveBoundLlmProvider` 로 교체).  
  **이 태스크에서**: shared-helpers / triple / relation / procedural 등 컴파일 깨짐 방지용으로, useCase 있는 호출은 최소한 `boundProvider: <same as first arg>` 로 맞춰 **타입만** 통과시킨 뒤, T005–T007 에서 bound 를 올바르게 연결한다.  
  *Better*: T004 끝에서 helper `resolveBoundLlmProvider` 를 export 하고, 세 도메인 파일의 model resolve 호출을 helper+runtime 으로 바로 올바르게 연결하면 US1 과 중복을 줄임 — **권장: T004에서 helper까지 넣고, model 호출부만 올바르게 수정; provider 선택 배선은 T005–T007.**

- [x] **Step 4: GREEN** — `llm-model-resolver.spec.ts` PASS; type-check clean for touched files

- [x] **Step 5: Commit** — `fix(config): bind LLM model overrides to provider (FR-004)\n\nRefs #820`

**Checkpoint**: SC-003/SC-007 unit coverage green. US1 provider wiring next.

---

## Phase 4: User Story 1 - Per-job provider preference (Priority: P1) 🎯 MVP

**Goal**: 세 job 이 `resolveLlmProvider(useCase)` 를 preferred 로 쓰고, unset 시 기존 global 동작 (FR-001/002/003/017).

**Independent Test**: override 한 job 만 해당 provider 선호; 나머지 unset → global. Unit/spy on `determineProvider` / selection path.

### T005 [TDD] [US1] Wire triple extraction to `resolveLlmProvider`

**Files:**
- Modify: `packages/memento-core/src/domains/relation/services/triple-extraction/triple-extraction-service.ts` (requested provider ≈ `options.provider || resolveLlmProvider('triple_extraction')` 계열 — 기존 `options.provider || this.preferredProvider || 'auto'` 를 override-aware 로)
- Modify as needed: `triple-extraction-llm-providers.ts`, `triple-extractor.ts` — `resolveLlmModel(..., { boundProvider })` already correct from T004
- Test: 기존 triple extraction provider 관련 spec (없으면 service 단위에 spy 추가)

**Interfaces:**
- Consumes: `resolveLlmProvider('triple_extraction')`, existing `determineProvider`
- Produces: per-invocation requested preference from resolve; fallback unchanged

- [x] RED: 테스트 — config `llmProviderOverrides.triple_extraction = 'ollama'` (및 mock availability) 일 때 requested/actual 이 ollama 선호를 반영; unset 시 `mementoConfig.llmProvider` 경로와 동일
- [x] GREEN + commit: `feat(triple): prefer per-job LLM provider override\n\nRefs #820`

### T006 [P] [TDD] [SUBAGENT] [US1] Wire relation extractor to `resolveLlmProvider`

**Files:**
- Modify: `packages/memento-core/src/domains/relation/services/llm-based-relation-extractor.ts` (~442: `requestedProvider` — `resolveLlmProvider('relation_extraction')` 우선, 그다음 기존 preferred/global — research: replace global-only with resolve)
- Test: `packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts` (최소 1 케이스)

**Interfaces:**
- Consumes: `resolveLlmProvider('relation_extraction')`, `determineProvider`
- Produces: job-scoped preferred provider; FR-011 fallback intact

- [x] RED → GREEN → commit: `feat(relation): prefer per-job LLM provider override\n\nRefs #820`

### T007 [P] [TDD] [SUBAGENT] [US1] Wire procedural extractor (incl. ollama path)

**Files:**
- Modify: `packages/memento-core/src/domains/memory/procedural/procedural-llm-extractor.ts` — today hard-codes openai→gemini on `result.preferredProvider` only; must use `resolveLlmProvider('procedural')` + existing determine/fallback style; support `ollama` when override/global says so (R5)
- Test: procedural extractor spec (create/extend under `domains/memory/procedural/**/__tests__/`)

**Interfaces:**
- Consumes: `resolveLlmProvider('procedural')`, init result clients, `resolveLlmModel` + bound helper
- Produces: prefer-then-fallback per job; null→rule fallback on total failure (existing)

- [x] RED → GREEN → commit: `feat(procedural): prefer per-job LLM provider override\n\nRefs #820`

**Checkpoint**: US1 independent test 가능. **MVP** = Phase 2 + 3 + 4.

---

## Phase 5: User Story 3 - Ollama readiness for job override (Priority: P2)

**Goal**: FR-005/018 — any of three overrides is `ollama` → run `testOllamaConnection` even if global is cloud; failure → existing unavailable path, no primary-path abort.

**Independent Test**: mock config `llmProvider=openai`, `llmProviderOverrides.triple_extraction='ollama'` → fetch to ollama tags called.

### T008 [TDD] [US3] Extend `LLMClientInitializer` Ollama gate

**Files:**
- Modify: `packages/memento-core/src/shared/services/llm-client-initializer.ts` (~78–82)
- Modify: `packages/memento-core/src/shared/services/__tests__/llm-client-initializer/llm-client-initializer.test-setup.ts` if needed
- Test: `packages/memento-core/src/shared/services/__tests__/llm-client-initializer/ollama-connection.spec.ts` (new cases)

**Interfaces:**
- Consumes: `mementoConfig.llmProviderOverrides` (or injected mock)
- Produces: readiness when `selectedProvider === 'ollama'` OR auto-without-cloud (existing) OR **any in-scope override === 'ollama'`**

- [x] **Step 1: 실패 테스트**

  ```ts
  it('tests Ollama when only a job override selects ollama', async () => {
    process.env.LLM_PROVIDER = 'openai';
    mockMementoConfig.llmProvider = 'openai';
    mockMementoConfig.llmProviderOverrides = { triple_extraction: 'ollama' };
    mockMementoConfig.openaiApiKey = 'sk-test';
    // mock fetch 200 like existing test...
    const initializer = new LLMClientInitializer();
    await initializer.initialize();
    expect(mockFetch).toHaveBeenCalled(); // tags URL
  });

  it('does not require new Ollama test when overrides unset and provider is openai', async () => {
    process.env.LLM_PROVIDER = 'openai';
    mockMementoConfig.llmProvider = 'openai';
    mockMementoConfig.llmProviderOverrides = {};
    mockMementoConfig.openaiApiKey = 'sk-test';
    const mockFetch = vi.fn();
    global.fetch = mockFetch as typeof fetch;
    await new LLMClientInitializer().initialize();
    expect(mockFetch).not.toHaveBeenCalled();
  });
  ```

- [x] RED → implement gate → GREEN → commit: `feat(llm-init): ollama readiness when job override selects ollama\n\nRefs #820`

**Checkpoint**: SC-004 path covered at unit level.

---

## Phase 6: User Story 4 - Documentation (Priority: P3)

**Goal**: FR-006 / SC-005 — env.example + ko/en guides.

### T009 [P] [SUBAGENT] [US4] Document three provider overrides + binding rules

**Files:**
- Modify: `env.example` (near `LLM_MODEL_*` / `LLM_PROVIDER`)
- Modify: `docs/guides/ko/llm-provider-configuration.md`
- Modify: `docs/guides/en/llm-provider-configuration.md`
- Reference: `specs/658-llm-provider-use-case-override/contracts/env-llm-provider-overrides.md`

**Must document:**
1. Three env keys + unset/empty → global
2. Invalid → global + warn at load/init
3. Canonical trim+lowercase tokens
4. Prefer-then-fallback (not hard-pin)
5. Model bound to job provider if set else global; discard when runtime ≠ bound; discard observable, alone does not fail job

- [x] Edit three files → self-check against FR-006 checklist → commit: `docs(llm): document per-job LLM_PROVIDER_* overrides\n\nRefs #820`

**Checkpoint**: Operator can find settings without reading source.

---

## Phase 7: Polish & Cross-Cutting

**Purpose**: 회귀·품질 게이트·리뷰.

### T010 [TDD] Regression — unset overrides preserve prior selection semantics

**Files:**
- Test: extend `llm-model-resolver.spec.ts` and/or call-site specs — explicit “overrides empty → same as pre-feature requested provider path” cases (SC-002)
- Smoke note: consolidation / personal-agent untouched (SC-006) — grep confirm no edits under consolidation summarization provider path / `MEMENTO_AGENT_LLM_*`

- [x] Add/adjust regression tests → PASS
- [x] Commit if new tests: `test(config): regression for unset llmProviderOverrides\n\nRefs #820`

### T011 Quality gates + graphify

- [x] Run:

  ```bash
  npm run lint
  npm run type-check
  npm test -- packages/memento-core/src/shared/config/__tests__/llm-model-resolver.spec.ts
  npm test -- packages/memento-core/src/shared/config/__tests__/llm-provider-override.spec.ts
  npm test -- packages/memento-core/src/shared/services/__tests__/llm-client-initializer/ollama-connection.spec.ts
  # plus any new/updated call-site specs from T005–T007
  python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"
  ```

- [x] Confirm `graphify-out/` **not** staged

### T012 [REVIEW] Spec compliance gate

- [x] Pause for human / `/speckit.superspec.review`
- [x] Checklist: FR-001…019 mapped to tasks above; SC-001…007 evidence; Out of Scope untouched

**Checkpoint**: Ready for `/speckit.superspec.execute` completion → PR when user asks.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: none
- **Phase 2 Foundational**: after T001 — **BLOCKS** all stories
- **Phase 3 US2 (T004)**: after T003 (needs override types on config slice; bound helper uses `resolveLlmProvider`)
- **Phase 4 US1 (T005–T007)**: after T003; **strongly after T004** so model calls pass correct `boundProvider`
- **Phase 5 US3 (T008)**: after T002 (needs `llmProviderOverrides` on config/mock)
- **Phase 6 US4 (T009)**: after T002 (env key names stable); can parallel with US1–US3
- **Phase 7**: after desired stories complete

### User Story Dependencies

| Story | Depends on | Notes |
|-------|------------|-------|
| US2 | T003 | Same resolver file as T003 — serialize T003→T004 |
| US1 | T003, T004 | T006/T007 `[P]` with each other after T005 or all three `[P]` if different files |
| US3 | T002 | Parallel with US1/US2 if staffing allows |
| US4 | T002 | `[P]` docs-only |

### Parallel Opportunities

```text
After T003:
  T004 (US2)          ──┐
  T008 (US3) [P]      ──┼── then T005/T006/T007 (US1)
  T009 (US4) [P]      ──┘

After T004:
  T005 [US1]
  T006 [P][SUBAGENT][US1]
  T007 [P][SUBAGENT][US1]
```

---

## Parallel Example: After Foundation

```bash
# Parallel after T003 (different owners / subagents):
Task: "T008 Ollama readiness when job override is ollama"
Task: "T009 Document LLM_PROVIDER_* in env.example + ko/en guides"

# After T004, parallel call sites:
Task: "T006 Wire relation extractor resolveLlmProvider"
Task: "T007 Wire procedural extractor resolveLlmProvider"
```

---

## Implementation Strategy

### MVP First (US2 + US1)

1. T001 → T002 → T003 → T004 → T005–T007
2. **STOP**: validate FR-004 tests + one job override path
3. Then T008 → T009 → T010–T012

### Incremental Delivery

1. Foundation (config + resolveLlmProvider)
2. FR-004 guard (correctness)
3. Three call sites (operator value)
4. Ollama readiness
5. Docs + gates

---

## Spec Coverage Matrix (self-review)

| Requirement | Task(s) |
|-------------|---------|
| FR-001/002/003/017 | T002, T003, T005–T007 |
| FR-004/015/016/019 | T004 |
| FR-005/018 | T008 |
| FR-006 | T009 |
| FR-007/008/009 | Global Constraints + T010 grep |
| FR-010–014 | T002 |
| SC-002 | T010 |
| SC-003/007 | T004 |
| SC-004 | T008 |
| SC-005 | T009 |
| SC-006 | T010 |

**Placeholder scan**: none intentional. Exact line numbers in call sites may drift — use symbol search (`determineProvider`, `resolveLlmModel`, `testOllamaConnection`).

---

## Notes

- Commit after each task (or logical TDD cycle); message includes `Refs #820`.
- Do not invent consolidation provider env.
- Procedural ollama support is in-scope when override/global selects it (R5) — not optional polish.
- Next command after all `[ ]` → `[x]`: `/speckit.superspec.execute` or `/speckit.superspec.review`.
