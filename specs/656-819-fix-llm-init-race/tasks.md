---
description: "Task breakdown for 656-819-fix-llm-init-race"
---

# Tasks: Relation extractor silently falls back to rule-based

> **For agentic workers:** 이 계획은 태스크 단위로 실행한다. 각 스텝은 체크박스(`- [ ]`)로 추적한다. 태스크 하나를 끝내기 전에 다음 태스크를 시작하지 않는다.

**Goal**: LLM 가용성 판정이 초기화 완료를 앞지르는 레이스를 없애, 설정된 LLM 이 실제로 관계 추출에 쓰이게 한다.

**Architecture**: `LLMBasedRelationExtractor` 에 초기화 완료를 보장하는 비동기 가용성 판정을 추가하고, `RelationExtractor` 의 두 판정 지점을 그쪽으로 옮긴다. 같은 파일에서 (a) `extractRelations` 의 await/throw 순서, (b) 로컬 프로바이더 판정 기준 불일치를 함께 바로잡는다.

**Tech Stack**: TypeScript 5.x, Node.js ≥24, ES modules, Vitest. 신규 dependency 없음.

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Research**: [research.md](./research.md) | **Contracts**: [contracts/availability-contract.md](./contracts/availability-contract.md)

**Input**: Design documents from `/specs/656-819-fix-llm-init-race/`
**Tests**: 필수. 헌법 I(Test-First)에 따라 모든 태스크가 RED → GREEN 순서를 따른다.

## Format: `[ID] [markers] [Story] Description`

| Marker | 의미 |
|--------|------|
| `[P]` | 다른 `[P]` 태스크와 병렬 가능 (파일이 겹치지 않음) |
| `[TDD]` | RED → GREEN 강제 |
| `[REVIEW]` | 사람 리뷰 후 진행 |
| `[SUBAGENT]` | 서브에이전트 위임 가능 |

## Global Constraints

이 절의 항목은 **모든 태스크의 요구사항에 암묵적으로 포함된다.**

- Node.js ≥24, TypeScript ES modules, npm workspaces.
- 새 설정값·환경 변수를 도입하지 않는다. 대기 상한 설정값도 포함(spec Non-Goals, FR-008).
- 추출기 인스턴스 재사용·싱글턴화를 하지 않는다(후속 이슈로 분리됨).
- MCP `extract_relations` 요청 파라미터·응답 필드·`method` 옵션 의미를 바꾸지 않는다(FR-006, 헌법 II).
- 새 가용성 상태 타입이나 진단 API 를 만들지 않는다(FR-005).
- 로그 사유 값에 API 키·토큰 등 자격 증명 값을 넣지 않는다(FR-005).
- 완료 전 `npm run lint`, `npm run type-check`, `npm test` 를 통과해야 한다(헌법 IV).
- production 코드를 건드리므로 완료 전 graphify 를 재빌드하고 `graphify-out/GRAPH_REPORT.md` 를 확인한다. `graphify-out/` 은 커밋하지 않는다(헌법 IV).
- 작업 브랜치는 `656-819-fix-llm-init-race`. **main 에 직접 커밋하지 않는다.** push·PR 생성은 사용자 승인 후에만 한다.
- 사유 필드 어휘는 세 값으로 고정한다: `provider_not_configured`, `init_failed`, `llm_call_failed`.

---

## Phase 1: Setup

**Purpose**: 변경 전 기준선을 확보한다. RED 가 진짜 RED 인지 판단하려면 기준선이 green 이어야 한다.

- [x] **T001** 기준선 확인

  Run:

  ```bash
  npm test -- packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts
  npm test -- packages/memento-core/src/domains/relation/services/__tests__/relation-extractor.spec.ts
  npm test -- packages/memento-core/src/domains/relation/tools/__tests__/extract-relations-tool.spec.ts
  npm test -- packages/memento-server/src/test/integration/mcp-relation-tools.spec.ts
  ```

  Expected: 4개 모두 PASS. 하나라도 실패하면 **여기서 멈추고 보고한다** — 기존 실패를 이번 변경 탓으로 오해하면 안 된다.

**Checkpoint**: 기준선 green. 구현 시작 가능.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 비동기 가용성 판정과 클래스 자체의 가드 정합성. **US1·US2·US3 전부 여기에 의존한다.**

**⚠️ CRITICAL**: T002 가 끝나기 전에는 어떤 User Story 도 시작할 수 없다.

### T002 [TDD] 초기화 완료를 보장하는 비동기 가용성 판정 추가

**Files:**
- Modify: `packages/memento-core/src/domains/relation/services/llm-based-relation-extractor.ts` (`isAvailable()` 바로 아래, 약 163행)
- Test: `packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts`

**Interfaces:**
- Consumes: 기존 `private readonly initializationPromise: Promise<void>` (:73), 기존 `isAvailable(): boolean` (:150)
- Produces: `isAvailableAsync(): Promise<boolean>` — `RelationExtractor` 의 두 판정 지점(T004, T006)이 이 시그니처를 쓴다. **반드시 `this.isAvailable()` 에 위임한다** — 기존 통합 테스트가 `LLMBasedRelationExtractor.prototype.isAvailable` 을 spy 해 LLM 호출을 차단하고 있어서, 위임하지 않으면 그 차단이 무력화된다.

- [x] **Step 1: 실패 테스트 작성**

  `llm-based-relation-extractor.spec.ts` 의 `describe('isAvailable', ...)` 블록 근처에 추가:

  ```ts
  describe('isAvailableAsync', () => {
    it('초기화가 아직 끝나지 않았어도 완료 후의 결과를 반환한다', async () => {
      const extractor = new LLMBasedRelationExtractor();

      // 초기화가 진행 중이고 아직 프로바이더가 정해지지 않은 상태를 만든다
      (extractor as any).preferredProvider = null;
      (extractor as any).openaiClient = null;
      (extractor as any).initializationCompleted = false;
      (extractor as any).initializationPromise = Promise.resolve().then(() => {
        (extractor as any).preferredProvider = 'openai';
        (extractor as any).openaiClient = {};
        (extractor as any).initializationCompleted = true;
      });

      // 동기 판정은 초기화 전 상태를 그대로 본다
      expect(extractor.isAvailable()).toBe(false);

      // 비동기 판정은 초기화 완료 후의 결과를 본다
      await expect(extractor.isAvailableAsync()).resolves.toBe(true);
    });

    it('초기화가 실패로 끝나도 예외를 던지지 않고 false 를 반환한다', async () => {
      const extractor = new LLMBasedRelationExtractor();

      (extractor as any).preferredProvider = null;
      (extractor as any).openaiClient = null;
      (extractor as any).geminiClient = null;
      (extractor as any).initializationCompleted = false;
      (extractor as any).initializationPromise = Promise.resolve();

      await expect(extractor.isAvailableAsync()).resolves.toBe(false);
    });
  });
  ```

- [x] **Step 2: 실패 확인**

  Run:

  ```bash
  npm test -- packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts -t "isAvailableAsync"
  ```

  Expected: FAIL — `extractor.isAvailableAsync is not a function`

- [x] **Step 3: 최소 구현**

  `llm-based-relation-extractor.ts` 의 `isAvailable()` 정의 바로 다음에 추가:

  ```ts
  /**
   * LLM 서비스 사용 가능 여부 확인 (초기화 완료 보장)
   *
   * 생성자에서 시작된 초기화가 끝난 뒤에 판정한다. 초기화 실패는 생성자에서
   * 이미 흡수되므로 여기서 예외가 새어 나가지 않는다.
   *
   * 외부 호출자는 이 판정을 사용한다. 동기 `isAvailable()` 은 초기화 완료
   * 이후에만 유효하다.
   */
  async isAvailableAsync(): Promise<boolean> {
    await this.initializationPromise;
    return this.isAvailable();
  }
  ```

- [x] **Step 4: 통과 확인**

  Run:

  ```bash
  npm test -- packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts
  ```

  Expected: 신규 2건 PASS, 기존 케이스 전부 PASS 유지.

- [x] **Step 5: 커밋**

  ```bash
  git add packages/memento-core/src/domains/relation/services/llm-based-relation-extractor.ts \
          packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts
  git commit -m "feat(relation): add initialization-aware LLM availability check

Refs #819"
  ```

---

### T003 [TDD] `extractRelations` 의 await/throw 순서 교정

**Files:**
- Modify: `packages/memento-core/src/domains/relation/services/llm-based-relation-extractor.ts:356-368`
- Modify (기존 단언 갱신): `packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts:2021`
- Test: 같은 spec 파일

**Interfaces:**
- Consumes: `initializationPromise`
- Produces: 없음 (클래스 내부 계약 정정). 초기화 미완을 이유로 던지지 않으며, 진짜 미가용은 그 뒤의 `hasAvailableClient` 검사(:374-383)가 처리한다.

**왜 필요한가**: 현재 코드는 `initializationWasPending && preferredProvider === null` 이면 **await 앞에서** throw 한다. 신규 인스턴스는 항상 이 조건에 걸려 뒤의 `await this.initializationPromise` 에 도달하지 못한다. T002 를 통해 들어오는 경로는 이미 초기화가 끝나 있지만, 이 클래스를 직접 쓰는 호출자에게는 여전히 잘못된 가드다(FR-003).

- [x] **Step 1: 실패 테스트 작성**

  ```ts
  it('초기화가 진행 중이어도 완료 후 프로바이더가 있으면 던지지 않는다', async () => {
    const extractor = new LLMBasedRelationExtractor();

    (extractor as any).preferredProvider = null;
    (extractor as any).openaiClient = null;
    (extractor as any).initializationCompleted = false;
    (extractor as any).initializationPromise = Promise.resolve().then(() => {
      (extractor as any).preferredProvider = 'openai';
      (extractor as any).openaiClient = {};
      (extractor as any).initializationCompleted = true;
    });

    const newMemory = createTestMemory('mem1', '새로운 기능', 'episodic');

    // 기존 기억이 없으면 빈 배열. 초기화 대기 이후에 이 분기에 도달해야 한다.
    await expect(extractor.extractRelations(newMemory, [])).resolves.toEqual([]);
  });
  ```

- [x] **Step 2: 실패 확인**

  Run:

  ```bash
  npm test -- packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts -t "초기화가 진행 중이어도"
  ```

  Expected: FAIL — `LLM 서비스가 사용 불가능합니다` 로 reject

- [x] **Step 3: 최소 구현**

  `llm-based-relation-extractor.ts` 의 `extractRelations` 시작 부분을 다음으로 교체한다.

  Before (:356-368):

  ```ts
    const initializationWasPending = !this.initializationCompleted;
    if (initializationWasPending && this.preferredProvider === null) {
      throw new Error('LLM 서비스가 사용 불가능합니다');
    }

    if (this.initializationPromise && initializationWasPending) {
      await this.initializationPromise;
    }

    if (existingMemories.length === 0) {
      return [];
    }
  ```

  After:

  ```ts
    // 초기화 완료를 먼저 기다린 뒤에 가용성을 판정한다.
    // (기존 코드는 await 앞에서 던져 신규 인스턴스가 await 에 도달하지 못했다)
    await this.initializationPromise;

    if (existingMemories.length === 0) {
      return [];
    }
  ```

  진짜 미가용은 바로 뒤의 `hasAvailableClient` 검사가 그대로 처리한다. 이 블록은 건드리지 않는다.

- [x] **Step 4: 기존 단언 갱신**

  `llm-based-relation-extractor.spec.ts:2021` 은 제거된 조기 throw 의 문구를 단언한다. 초기화 완료 후 가드가 내는 문구로 바꾼다.

  Before:

  ```ts
        ).rejects.toThrow('LLM 서비스가 사용 불가능합니다');
  ```

  After:

  ```ts
        ).rejects.toThrow('LLM 서비스를 사용할 수 없습니다');
  ```

- [x] **Step 5: 통과 확인**

  Run:

  ```bash
  npm test -- packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts
  ```

  Expected: 전부 PASS.

- [x] **Step 6: 커밋**

  ```bash
  git add packages/memento-core/src/domains/relation/services/llm-based-relation-extractor.ts \
          packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts
  git commit -m "fix(relation): await LLM initialization before availability guard

Refs #819"
  ```

**Checkpoint**: 비동기 판정이 존재하고 클래스 내부 가드가 정합적이다. User Story 진행 가능.

---

## Phase 3: User Story 1 — 새 프로세스에서도 LLM 관계 추출이 실제로 동작한다 (P1) 🎯 MVP

**Goal**: 기억 저장 시 하이브리드 폴백이 LLM 을 실제로 시도한다.

**Independent Test**: LLM 자격 증명이 설정된 새 프로세스에서 규칙 기반 신뢰도가 낮은 기억을 저장하고, LLM 추출 시도와 영속화된 `method: 'llm'` 관계를 확인한다.

### T004 [TDD] [US1] 하이브리드 폴백의 가용성 판정을 비동기로 전환

**Files:**
- Modify: `packages/memento-core/src/domains/relation/services/relation-extractor.ts:135-140`
- Modify: `packages/memento-core/src/domains/relation/services/__tests__/relation-extractor.spec.ts` (beforeEach + 신규 케이스)

**Interfaces:**
- Consumes: `LLMBasedRelationExtractor.isAvailableAsync(): Promise<boolean>` (T002)
- Produces: 없음

- [x] **Step 1: 기존 spec 의 beforeEach 에 비동기 판정 시드 추가**

  `relation-extractor.spec.ts` 의 `beforeEach` 에서 `isAvailable` prototype spy 바로 아래에 추가한다. 기존 케이스들이 `mockLLMExtractor.isAvailable` 로 가용성을 제어하는 의미를 유지하면서, 실제 초기화를 기다리지 않게 한다.

  ```ts
    vi.spyOn(LLMBasedRelationExtractor.prototype, 'isAvailableAsync').mockImplementation(
      async () => mockLLMExtractor.isAvailable()
    );
  ```

- [x] **Step 2: 실패 테스트 작성**

  `describe('RelationExtractor', ...)` 안에 추가:

  ```ts
  describe('초기화 레이스 (이슈 #819)', () => {
    it('하이브리드 폴백은 초기화 완료를 보장하는 비동기 판정을 사용한다', async () => {
      const newMemory = createTestMemory('mem1', '새로운 기능을 구현했습니다.', 'episodic');
      const existingMemory = createTestMemory('mem2', '기존 기능', 'episodic');

      const ruleCandidates = [{
        source_id: 'mem1',
        target_id: 'mem2',
        relation_type: 'REFERENCES' as RelationType,
        confidence: 0.3,
        method: 'rule' as const,
        evidence: '관련'
      }];
      const llmCandidates = [{
        source_id: 'mem1',
        target_id: 'mem2',
        relation_type: 'DERIVED_FROM' as RelationType,
        confidence: 0.9,
        method: 'llm' as const,
        evidence: 'LLM 판단'
      }];

      // 초기화 전 동기 판정은 false — 이것이 #819 의 재현 조건
      mockLLMExtractor.isAvailable.mockReturnValue(false);
      const asyncSpy = vi
        .spyOn(LLMBasedRelationExtractor.prototype, 'isAvailableAsync')
        .mockResolvedValue(true);

      mockRuleExtractor.extractRelations.mockResolvedValue(ruleCandidates);
      mockLLMExtractor.extractRelations.mockResolvedValue(llmCandidates);

      const candidates = await extractor.extractRelations(newMemory, [existingMemory], {
        method: 'hybrid',
        minConfidence: 0.5
      });

      expect(asyncSpy).toHaveBeenCalled();
      expect(mockLLMExtractor.extractRelations).toHaveBeenCalled();
      expect(candidates.some(c => c.method === 'llm')).toBe(true);
    });
  });
  ```

- [x] **Step 3: 실패 확인**

  Run:

  ```bash
  npm test -- packages/memento-core/src/domains/relation/services/__tests__/relation-extractor.spec.ts -t "초기화 완료를 보장하는 비동기 판정"
  ```

  Expected: FAIL — `mockLLMExtractor.extractRelations` 가 호출되지 않음(동기 판정이 false 를 반환해 규칙 기반 결과만 반환)

- [x] **Step 4: 최소 구현**

  `relation-extractor.ts:135-140`:

  Before:

  ```ts
    if (!hasAnyResults || !hasHighConfidenceResults) {
      // LLM이 사용 가능한지 확인
      if (!this.llmExtractor.isAvailable()) {
        logger.info('LLM 서비스가 사용 불가능하여 규칙 기반 결과 반환', { memoryId: newMemory.id });
        return ruleCandidates;
      }
  ```

  After:

  ```ts
    if (!hasAnyResults || !hasHighConfidenceResults) {
      // LLM이 사용 가능한지 확인 (진행 중인 초기화 완료까지 대기)
      if (!(await this.llmExtractor.isAvailableAsync())) {
        logger.info('LLM 서비스가 사용 불가능하여 규칙 기반 결과 반환', { memoryId: newMemory.id });
        return ruleCandidates;
      }
  ```

- [x] **Step 5: 통과 확인**

  Run:

  ```bash
  npm test -- packages/memento-core/src/domains/relation/services/__tests__/relation-extractor.spec.ts
  ```

  Expected: 신규 케이스 PASS. 기존 케이스(특히 `mockLLMExtractor.isAvailable.mockReturnValue(false)` 로 LLM 미호출을 단언하는 케이스) 전부 PASS 유지 — Step 1 의 시드가 그 의미를 보존한다.

- [x] **Step 6: 커밋**

  ```bash
  git add packages/memento-core/src/domains/relation/services/relation-extractor.ts \
          packages/memento-core/src/domains/relation/services/__tests__/relation-extractor.spec.ts
  git commit -m "fix(relation): use initialization-aware availability check in hybrid fallback

Fixes the silent rule-based fallback reported in #819."
  ```

---

### T005 [TDD] [US1] 자동 선택된 로컬 프로바이더를 가용으로 판정 (FR-010)

**Files:**
- Modify: `packages/memento-core/src/domains/relation/services/llm-based-relation-extractor.ts:165-167`
- Test: `packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts`

**Interfaces:**
- Consumes: `private preferredProvider`
- Produces: 없음. 다만 `providerAvailability()`(:169) → `determineProvider()`(:178) → `hasAvailableClient`(:374) 세 지점이 모두 이 함수를 거치므로, 한 번 고치면 가드와 실제 프로바이더 선택이 함께 정합해진다.

**왜 필요한가**: `isAvailable()` 은 `preferredProvider === 'ollama'` 면 true 지만, `isOllamaAvailable()` 은 `mementoConfig.llmProvider === 'ollama'` 를 추가로 요구한다. 프로바이더를 자동 선택으로 두고 클라우드 자격 증명 없이 로컬 프로바이더만 띄운 환경에서는 `mementoConfig.llmProvider` 가 `'auto'` 라 두 판정이 갈린다. T004 이후 이 불일치가 드러나 저장마다 "자격 증명을 설정하라"는 잘못된 실패 로그가 남는다. `preferredProvider` 는 초기화가 연결 점검에 성공했을 때만 `'ollama'` 가 되므로 두 번째 조건은 중복이다. 형제 서비스 `TripleExtractionService.determineProvider`(:169-181)도 설정값을 보지 않는다.

- [x] **Step 1: 실패 테스트 작성**

  ```ts
  it('자동 선택 모드에서 로컬 프로바이더가 채택되면 사용 가능으로 본다 (FR-010)', async () => {
    const configModule = await import('../../../shared/config/index.js');
    const extractor = new LLMBasedRelationExtractor();

    // 초기화가 연결 점검에 성공해 ollama 를 채택한 상태
    (extractor as any).preferredProvider = 'ollama';
    (extractor as any).openaiClient = null;
    (extractor as any).geminiClient = null;

    // 설정값은 자동 선택 그대로
    (configModule.mementoConfig as any).llmProvider = 'auto';

    expect(extractor.isAvailable()).toBe(true);
    expect((extractor as any).isOllamaAvailable()).toBe(true);
  });
  ```

  `configModule` 은 이 spec 이 이미 쓰는 방식(`await import('../../../shared/config/index.js')`, 예: 315행)과 동일하다.

- [x] **Step 2: 실패 확인**

  Run:

  ```bash
  npm test -- packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts -t "자동 선택 모드에서 로컬 프로바이더"
  ```

  Expected: FAIL — `isOllamaAvailable()` 이 `false`

- [x] **Step 3: 최소 구현**

  Before (:165-167):

  ```ts
    private isOllamaAvailable(): boolean {
      return this.preferredProvider === 'ollama' && mementoConfig.llmProvider === 'ollama';
    }
  ```

  After:

  ```ts
    /**
     * 로컬(ollama) 프로바이더 사용 가능 여부.
     *
     * `preferredProvider` 는 초기화가 연결 점검에 성공했을 때만 'ollama' 가 되므로
     * 설정값을 다시 확인하지 않는다. 설정값까지 요구하면 자동 선택으로 ollama 가
     * 채택된 환경에서 가용성 판정과 실행 경로가 어긋난다 (FR-010).
     */
    private isOllamaAvailable(): boolean {
      return this.preferredProvider === 'ollama';
    }
  ```

  `mementoConfig` import 가 이 파일의 다른 곳에서도 쓰이는지 확인한다. 더 이상 쓰이지 않으면 import 를 정리한다(lint 가 잡는다).

- [x] **Step 4: 통과 확인**

  Run:

  ```bash
  npm test -- packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts
  ```

  Expected: 신규 케이스 PASS. `determineProvider` 관련 기존 케이스 전부 PASS 유지 — 실패한다면 그 케이스가 설정값 게이트에 의존하고 있었다는 뜻이므로, 단언을 FR-010 기준으로 갱신하고 갱신 이유를 커밋 메시지에 적는다.

- [x] **Step 5: 커밋**

  ```bash
  git add packages/memento-core/src/domains/relation/services/llm-based-relation-extractor.ts \
          packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts
  git commit -m "fix(relation): treat auto-selected local provider as available

Aligns the availability predicate with the execution path (FR-010). Refs #819"
  ```

**Checkpoint**: US1 완료. 하이브리드 폴백이 LLM 을 시도하고, 자동 선택된 로컬 프로바이더 환경도 동작한다.

---

## Phase 4: User Story 2 — LLM 전용 요청이 초기화 타이밍 때문에 실패하지 않는다 (P2)

**Goal**: `method: 'llm'` 요청이 프로세스 기동 직후에도 성공한다.

**Independent Test**: 새 프로세스에서 LLM 전용 방식으로 관계 추출을 요청해 오류 없이 결과가 오는지 확인한다.

### T006 [TDD] [US2] LLM 전용 경로의 가용성 판정을 비동기로 전환

**Files:**
- Modify: `packages/memento-core/src/domains/relation/services/relation-extractor.ts:98-104`
- Test: `packages/memento-core/src/domains/relation/services/__tests__/relation-extractor.spec.ts`

**Interfaces:**
- Consumes: `LLMBasedRelationExtractor.isAvailableAsync(): Promise<boolean>` (T002)
- Produces: 없음

- [x] **Step 1: 실패 테스트 작성**

  T004 가 만든 `describe('초기화 레이스 (이슈 #819)', ...)` 블록에 추가:

  ```ts
  it('LLM 전용 요청은 초기화 미완을 이유로 실패하지 않는다', async () => {
    const newMemory = createTestMemory('mem1', '새로운 기능을 구현했습니다.', 'episodic');
    const existingMemory = createTestMemory('mem2', '기존 기능', 'episodic');

    const llmCandidates = [{
      source_id: 'mem1',
      target_id: 'mem2',
      relation_type: 'DERIVED_FROM' as RelationType,
      confidence: 0.9,
      method: 'llm' as const,
      evidence: 'LLM 판단'
    }];

    mockLLMExtractor.isAvailable.mockReturnValue(false);   // 초기화 전 동기 판정
    vi.spyOn(LLMBasedRelationExtractor.prototype, 'isAvailableAsync').mockResolvedValue(true);
    mockLLMExtractor.extractRelations.mockResolvedValue(llmCandidates);

    await expect(
      extractor.extractRelations(newMemory, [existingMemory], { method: 'llm' })
    ).resolves.toEqual(llmCandidates);
  });

  it('초기화 완료 후에도 프로바이더가 없으면 LLM 전용 요청은 명확한 오류를 낸다', async () => {
    const newMemory = createTestMemory('mem1', '새로운 기능을 구현했습니다.', 'episodic');
    const existingMemory = createTestMemory('mem2', '기존 기능', 'episodic');

    vi.spyOn(LLMBasedRelationExtractor.prototype, 'isAvailableAsync').mockResolvedValue(false);

    await expect(
      extractor.extractRelations(newMemory, [existingMemory], { method: 'llm' })
    ).rejects.toThrow('LLM 서비스가 사용 불가능합니다');
  });
  ```

- [x] **Step 2: 실패 확인**

  Run:

  ```bash
  npm test -- packages/memento-core/src/domains/relation/services/__tests__/relation-extractor.spec.ts -t "LLM 전용 요청은 초기화 미완"
  ```

  Expected: FAIL — `LLM 서비스가 사용 불가능합니다. 규칙 기반 추출을 사용하거나 API 키를 설정해주세요.` 로 reject

- [x] **Step 3: 최소 구현**

  `relation-extractor.ts:98-104`:

  Before:

  ```ts
    if (method === 'llm') {
      // LLM만 사용하는 경우, LLM이 사용 가능한지 확인
      if (!this.llmExtractor.isAvailable()) {
        throw new Error('LLM 서비스가 사용 불가능합니다. 규칙 기반 추출을 사용하거나 API 키를 설정해주세요.');
      }
  ```

  After:

  ```ts
    if (method === 'llm') {
      // LLM만 사용하는 경우, LLM이 사용 가능한지 확인 (초기화 완료까지 대기)
      if (!(await this.llmExtractor.isAvailableAsync())) {
        throw new Error('LLM 서비스가 사용 불가능합니다. 규칙 기반 추출을 사용하거나 API 키를 설정해주세요.');
      }
  ```

  오류 문구는 그대로 둔다 — 기존 계약이며 US2 시나리오 2 가 요구하는 "설정이 없음을 알리는 명확한 오류"다.

- [x] **Step 4: 통과 확인**

  Run:

  ```bash
  npm test -- packages/memento-core/src/domains/relation/services/__tests__/relation-extractor.spec.ts
  ```

  Expected: 전부 PASS.

- [x] **Step 5: 커밋**

  ```bash
  git add packages/memento-core/src/domains/relation/services/relation-extractor.ts \
          packages/memento-core/src/domains/relation/services/__tests__/relation-extractor.spec.ts
  git commit -m "fix(relation): wait for initialization on llm-only extraction path

Refs #819"
  ```

**Checkpoint**: US1 + US2 각각 독립적으로 동작.

---

## Phase 5: User Story 3 — LLM 이 정말 없을 때 이유를 알 수 있게 폴백한다 (P3)

**Goal**: 폴백 로그만 보고 세 가지 사유를 구분할 수 있다.

**Independent Test**: 자격 증명 없는 환경과 호출이 실패하는 환경에서 각각 저장해, 로그의 `reason` 값이 다른지 확인한다.

### T007 [TDD] [US3] 폴백 사유 필드 추가

**Files:**
- Modify: `packages/memento-core/src/domains/relation/services/relation-extractor.ts:138`, `:171-174`
- Modify: `packages/memento-core/src/domains/relation/services/llm-based-relation-extractor.ts:109-115` (생성자 catch 로그)
- Test: `packages/memento-core/src/domains/relation/services/__tests__/relation-extractor.spec.ts`

**Interfaces:**
- Consumes: 기존 `logger`
- Produces: 로그 필드 `reason`. 값은 `'provider_not_configured'` | `'init_failed'` | `'llm_call_failed'` 세 개로 고정한다. 새 타입·API 를 만들지 않는다(FR-005).

- [x] **Step 1: 실패 테스트 작성**

  spec 상단 import 에 logger 를 추가한다:

  ```ts
  import { logger } from '../../../shared/utils/logger.js';
  ```

  그리고 `describe('초기화 레이스 (이슈 #819)', ...)` 블록에 추가:

  ```ts
  it('LLM 미가용 폴백 로그에 사유가 남는다', async () => {
    const infoSpy = vi.spyOn(logger, 'info');
    const newMemory = createTestMemory('mem1', '새로운 기능을 구현했습니다.', 'episodic');
    const existingMemory = createTestMemory('mem2', '기존 기능', 'episodic');

    mockRuleExtractor.extractRelations.mockResolvedValue([{
      source_id: 'mem1',
      target_id: 'mem2',
      relation_type: 'REFERENCES' as RelationType,
      confidence: 0.3,
      method: 'rule' as const,
      evidence: '관련'
    }]);
    vi.spyOn(LLMBasedRelationExtractor.prototype, 'isAvailableAsync').mockResolvedValue(false);

    await extractor.extractRelations(newMemory, [existingMemory], {
      method: 'hybrid',
      minConfidence: 0.5
    });

    expect(infoSpy).toHaveBeenCalledWith(
      'LLM 서비스가 사용 불가능하여 규칙 기반 결과 반환',
      expect.objectContaining({ reason: 'provider_not_configured' })
    );
  });

  it('LLM 호출 실패 폴백 로그에 사유가 남는다', async () => {
    const errorSpy = vi.spyOn(logger, 'error');
    const newMemory = createTestMemory('mem1', '새로운 기능을 구현했습니다.', 'episodic');
    const existingMemory = createTestMemory('mem2', '기존 기능', 'episodic');

    mockRuleExtractor.extractRelations.mockResolvedValue([{
      source_id: 'mem1',
      target_id: 'mem2',
      relation_type: 'REFERENCES' as RelationType,
      confidence: 0.3,
      method: 'rule' as const,
      evidence: '관련'
    }]);
    vi.spyOn(LLMBasedRelationExtractor.prototype, 'isAvailableAsync').mockResolvedValue(true);
    mockLLMExtractor.extractRelations.mockRejectedValue(new Error('boom'));

    await extractor.extractRelations(newMemory, [existingMemory], {
      method: 'hybrid',
      minConfidence: 0.5
    });

    expect(errorSpy).toHaveBeenCalledWith(
      'LLM fallback 실패, 규칙 기반 결과 반환',
      expect.objectContaining({ reason: 'llm_call_failed' })
    );
  });
  ```

- [x] **Step 2: 실패 확인**

  Run:

  ```bash
  npm test -- packages/memento-core/src/domains/relation/services/__tests__/relation-extractor.spec.ts -t "폴백 로그에 사유가 남는다"
  ```

  Expected: FAIL — 로그 객체에 `reason` 키 없음

- [x] **Step 3: 최소 구현 (relation-extractor.ts)**

  `:138`:

  ```ts
        logger.info('LLM 서비스가 사용 불가능하여 규칙 기반 결과 반환', {
          memoryId: newMemory.id,
          reason: 'provider_not_configured'
        });
  ```

  `:171-174`:

  ```ts
        logger.error('LLM fallback 실패, 규칙 기반 결과 반환', {
          error: error instanceof Error ? error.message : String(error),
          memoryId: newMemory.id,
          reason: 'llm_call_failed'
        });
  ```

- [x] **Step 4: 최소 구현 (llm-based-relation-extractor.ts 생성자 catch)**

  `:109-115` 의 초기화 실패 로그에 같은 어휘를 추가한다. 세 사유가 하나의 필드명으로 grep 되게 하는 것이 목적이다.

  ```ts
    }).catch((error) => {
      logger.error('LLM 클라이언트 초기화 실패', {
        error: error instanceof Error ? error.message : String(error),
        reason: 'init_failed'
      });
  ```

  **주의**: `error.message` 외에 어떤 값도 추가하지 않는다. 자격 증명 값이 로그에 들어가면 안 된다(FR-005).

- [x] **Step 5: 통과 확인**

  Run:

  ```bash
  npm test -- packages/memento-core/src/domains/relation/services/__tests__/relation-extractor.spec.ts
  npm test -- packages/memento-core/src/domains/relation/services/__tests__/llm-based-relation-extractor.spec.ts
  ```

  Expected: 전부 PASS.

- [x] **Step 6: 커밋**

  ```bash
  git add packages/memento-core/src/domains/relation/services/relation-extractor.ts \
          packages/memento-core/src/domains/relation/services/llm-based-relation-extractor.ts \
          packages/memento-core/src/domains/relation/services/__tests__/relation-extractor.spec.ts
  git commit -m "feat(relation): distinguish rule-based fallback reasons in logs

Refs #819"
  ```

**Checkpoint**: US1 · US2 · US3 모두 독립적으로 동작.

---

## Phase 6: Polish & Cross-Cutting Concerns

### T008 [P] [SUBAGENT] 동기 판정의 유효 범위 문서화 (FR-009)

**Files:**
- Modify: `packages/memento-core/src/domains/relation/services/llm-based-relation-extractor.ts:147-149`

- [x] **Step 1: JSDoc 갱신**

  Before:

  ```ts
    /**
     * LLM 서비스 사용 가능 여부 확인
     */
    isAvailable(): boolean {
  ```

  After:

  ```ts
    /**
     * LLM 서비스 사용 가능 여부 확인 (동기)
     *
     * **초기화 완료 이후에만 유효하다.** 생성 직후에는 `preferredProvider` 가
     * 아직 정해지지 않아 항상 false 를 반환한다 (이슈 #819).
     * 외부 호출자는 `isAvailableAsync()` 를 사용한다.
     */
    isAvailable(): boolean {
  ```

- [x] **Step 2: 커밋**

  ```bash
  git add packages/memento-core/src/domains/relation/services/llm-based-relation-extractor.ts
  git commit -m "docs(relation): document sync availability check validity window

Refs #819"
  ```

---

### T009 [P] [SUBAGENT] FR-009 정적 검증

FR-009 는 런타임 시나리오가 아니라 정적으로 확인한다 — 초기화 완료를 보장하지 않는 판정에 **외부(production) 호출자가 0** 인지 본다.

- [x] **Step 1: 확인**

  Run:

  ```bash
  grep -rn "llmExtractor.isAvailable()" packages --include="*.ts"
  grep -rn "isAvailable()" packages/memento-core/src/domains/relation/services/relation-extractor.ts
  ```

  Expected: 두 명령 모두 **결과 0줄**. 결과가 있으면 해당 호출자를 `isAvailableAsync()` 로 옮긴다.

  참고: `LLMBasedRelationExtractor.prototype.isAvailable` 에 대한 **테스트 spy** 는 남아 있어야 정상이다(LLM 호출 차단 시드).

---

### T010 [P] [SUBAGENT] CHANGELOG 갱신

- [x] **Step 1: `CHANGELOG.md` 의 Unreleased 섹션에 추가**

  ```markdown
  ### Fixed

  - 관계 추출기가 LLM 초기화 완료 전에 가용성을 판정해 항상 규칙 기반으로 조용히 폴백하던 문제 (#819)
  - 프로바이더 자동 선택으로 로컬 프로바이더가 채택된 환경에서 가용성 판정과 실행 경로가 어긋나던 문제 (#819)

  ### Changed

  - 규칙 기반 폴백 로그가 사유(`provider_not_configured` / `init_failed` / `llm_call_failed`)를 구분함 (#819)
  ```

- [x] **Step 2: 커밋**

  ```bash
  git add CHANGELOG.md
  git commit -m "docs: changelog for #819"
  ```

---

### T011 [REVIEW] 회귀 + 헌법 IV 게이트

**⚠️ 이 태스크는 병렬 불가.** T004~T010 이 모두 끝난 뒤 수행한다.

- [x] **Step 1: 인접 스펙 회귀**

  Run:

  ```bash
  npm test -- packages/memento-core/src/domains/relation/tools/__tests__/extract-relations-tool.spec.ts
  npm test -- packages/memento-server/src/test/integration/mcp-relation-tools.spec.ts
  npm test -- packages/memento-core/src/domains/memory/remember/__tests__/remember-tool-relation-persist.spec.ts
  ```

  Expected: 전부 PASS. 이 스펙들은 `isAvailable` prototype spy 로 LLM 호출을 차단하므로, `isAvailableAsync` 가 `isAvailable` 에 위임하는 한 그대로 통과해야 한다. 실패한다면 위임이 깨진 것이므로 T002 Step 3 을 다시 본다.

- [x] **Step 2: 전체 게이트**

  Run:

  ```bash
  npm run lint && npm run type-check && npm test
  ```

  Expected: 전부 PASS.

- [x] **Step 3: graphify 재빌드**

  production 코드를 건드렸으므로 필수다(헌법 IV). graphify 를 재빌드하고 `graphify-out/GRAPH_REPORT.md` 를 확인한다. `graphify-out/` 은 커밋하지 않는다.

- [x] **Step 4: quickstart 검증**

  [quickstart.md](./quickstart.md) 의 시나리오 2~4 를 수행해 기대 동작을 확인한다.

- [ ] **Step 5: 사람 리뷰** ← 미완료. 나머지 게이트는 전부 통과했다.

  변경 diff 를 리뷰받는다. 승인 전에는 push·PR 을 만들지 않는다.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: 의존 없음. 즉시 시작.
- **Phase 2 (Foundational)**: Phase 1 이후. **모든 User Story 를 블록한다.**
- **Phase 3~5 (User Stories)**: Phase 2 완료 후. 우선순위 순(P1 → P2 → P3) 또는 병렬.
- **Phase 6 (Polish)**: T008~T010 은 User Story 와 병렬 가능. **T011 은 전부 완료 후.**

### Task Dependencies

```text
T001 ──► T002 ──┬──► T004 ──► T005 ──┐        (US1)
                │                     │
                ├──► T006 ────────────┤        (US2)
                │                     │
                ├──► T007 ────────────┤        (US3)
                │                     │
       T003 ────┘                     │
                                      ▼
              T008 [P] ─────────────► T011 [REVIEW]
              T009 [P] ─────────────►
              T010 [P] ─────────────►
```

- **T003** 은 T002 와 같은 파일·같은 영역이므로 T002 직후에 이어서 한다(병렬 금지).
- **T004 → T005**: 같은 US1 이지만 파일이 다르다. 다만 T005 의 필요성이 T004 이후에 드러나므로 순서를 지킨다.
- **T004 / T006 / T007**: 셋 다 `relation-extractor.ts` 를 수정한다 → **병렬 금지.**
- **T007** 은 `llm-based-relation-extractor.ts` 도 건드리므로 T005 완료 후에 한다.

### Parallel Opportunities

- **T008 / T009 / T010** 은 서로 다른 파일(또는 읽기 전용)이라 동시에 진행 가능하며 `[SUBAGENT]` 위임 대상이다.
- User Story 간 병렬은 **불가** — 셋 다 `relation-extractor.ts` 한 파일에 모인다.

---

## Implementation Strategy

### MVP First (User Story 1만)

1. Phase 1 (T001) → Phase 2 (T002, T003) → Phase 3 (T004, T005)
2. **STOP & VALIDATE**: quickstart.md 시나리오 2·3 으로 US1 단독 검증
3. 여기까지가 이슈 #819 의 핵심 증상 해소다.

### Incremental Delivery

1. Setup + Foundational → 비동기 판정 확보
2. US1 추가 → 하이브리드 폴백 복원 (**MVP**)
3. US2 추가 → LLM 전용 경로 복원
4. US3 추가 → 진단성 개선
5. Polish → 문서·정적 검증·게이트

각 단계는 이전 단계를 깨지 않으며, 어느 지점에서 멈춰도 동작하는 상태다.

---

## Spec Coverage

| 요구사항 | 태스크 |
|----------|--------|
| FR-001 (판정 전 초기화 대기, 인스턴스 내 일관성) | T002 |
| FR-002 (하이브리드가 LLM 을 시도) | T004 |
| FR-003 (LLM 전용이 초기화 미완으로 실패하지 않음) | T003, T006 |
| FR-004 (초기화 실패해도 저장·추출 성공) | T002 (Step 1 두 번째 케이스) |
| FR-005 (폴백 사유 구분, 자격 증명 미노출) | T007 |
| FR-006 (공개 계약 불변) | T006 Step 3(문구 유지), T011 Step 1 |
| FR-007 (고신뢰 빠른 경로 대기 없음) | 코드상 판정 자체를 하지 않음 — T004 Step 4 가 폴백 분기 안에만 대기를 넣는다. T011 Step 1 회귀로 확인 |
| FR-008 (대기 상한 = 기존 재시도 정책, 새 설정값 없음) | Global Constraints. T009 |
| FR-009 (비동기 판정이 유일 공개 경로) | T002, T008, T009 |
| FR-010 (판정과 실행 경로 일치) | T005 |
| SC-001 / SC-002 | T004, T005, quickstart 시나리오 2·3 |
| SC-003 | T011 Step 1, quickstart 시나리오 4 |
| SC-004 | FR-007 과 동일 경로 |
| SC-005 | T007 |

---

## Execution Notes (2026-08-26)

T001~T010 완료. T011 게이트 결과는 아래 표. 계획 스니펫과 달라진 지점만 적는다 — 리뷰어가 diff 를 계획과 대조할 때 필요한 정보다.

| 태스크 | 계획과 달라진 점 | 이유 |
|--------|------------------|------|
| T002 | private 필드를 직접 조작하는 대신 `LLMClientInitializer.prototype.initialize` 를 게이트 promise 로 spy 해 초기화 타이밍을 제어. 두 번째 케이스는 `mockRejectedValue` 사용. | 필드 조작 방식은 생성자가 시작한 **진짜** 초기화(로컬 ollama 실 fetch)를 배경에서 계속 돌게 두어 타이밍 의존적이었다. 또 거부되는 초기화라야 생성자 `catch` 흡수 경로(FR-004)를 실제로 지나간다. |
| T003 | `initializationCompleted` 필드까지 제거. | 조기 throw 를 걷어내면 이 필드는 쓰기 전용 dead state 로 남는다. |
| T003 Step 4 | 단언 문구 교체만으로는 부족해 `엣지 케이스 > should throw error when LLM service is not available` 를 재작성. | 이 테스트는 신규 인스턴스에 `preferredProvider = null` 을 강제하는데, 초기화를 await 하면 생성자의 `.then()` 이 그 값을 덮어쓴다(해당 describe 의 `beforeEach` spy 가 `'openai'` 를 반환). 이제 테스트가 `initialize` 를 직접 통제하고 실제 가드 문구를 단언한다. 분기 방어 코드도 함께 제거. |
| T005 | 테스트가 mock config 대신 **실제** `mementoConfig.llmProvider` 를 잠시 `'auto'` 로 바꾸고 복원. `determineProvider('auto')` 단언 추가. | 이 spec 의 `vi.mock('../../../shared/config/index.js')` 는 `__tests__/` 기준 경로가 한 단계 얕아 `src/domains/shared/config` 를 가리킨다(존재하지 않음). 소스는 실제 config 를 읽고 `.env` 에 `LLM_PROVIDER=ollama` 가 있어, mock 만 바꾼 테스트는 fix 없이도 통과하는 위양성이었다. **이 spec 의 config 모킹 결함 자체는 이번 범위 밖 — 별도 이슈감.** |
| T008 | `extract-relations-tool.spec.ts` · `mcp-relation-tools.spec.ts` 에 `isAvailableAsync` seed spy 추가. | 두 spec 은 `isAvailable` 만 spy 한다. 비동기 판정이 실제로 돌면 매 추출기 생성마다 실제 프로바이더 연결 점검을 기다린다(ollama 없는 환경에서는 재시도 지연까지). |
| T009 | 결과 0줄 확인. | 남은 `.isAvailable()` 호출은 `isAvailableAsync()` 내부 위임 1건뿐. |

### T011 게이트

| 항목 | 결과 |
|------|------|
| 인접 spec 회귀 (4개) | PASS — 32 tests |
| `npm run lint` | PASS — 0 errors (242 warnings, 전부 기존 것) |
| `npm run type-check` | PASS — exit 0 |
| `npm test` (전체) | PASS — 471 files, 5047 passed / 1 skipped, exit 0 |
| graphify 재빌드 | 완료 — 6357 nodes · 7207 edges · 1400 communities. `graphify-out/` 은 gitignore 되어 커밋되지 않음 |
| quickstart 시나리오 3 | PASS — `LLM_PROVIDER=auto` + 클라우드 키 없음에서 `preferredProvider='ollama'`, `isAvailableAsync()=true`, `isOllamaAvailable()=true`, `determineProvider('auto')='ollama'` |
| quickstart 시나리오 2 (SC-001·SC-002) | PASS — 실제 로컬 프로바이더(`OLLAMA_MODEL=gemma2:2b`)로 hybrid 추출 실행: `규칙 기반 결과 부족, LLM fallback 시도` → `LLM fallback 완료` → `[{"method":"llm","relation_type":"FOLLOWS","confidence":0.8}]`. `LLM 서비스가 사용 불가능하여...` 로그는 나오지 않았다. |
| quickstart 시나리오 4 | 전체 스위트 PASS 로 확인 — 미설정 경로의 저장·규칙 기반 결과가 그대로다 |
| 사람 리뷰 · push · PR | **대기 중** — 승인 전 진행 안 함 |

### 남은 관측 사항 (범위 밖)

- 로컬 프로바이더가 떠 있지만 모델이 설치되지 않은 환경에서는 이제 저장마다 실제 LLM 호출이 시도되고 실패한다. 수정 전에는 호출 자체가 없었다. 이것은 의도한 동작(LLM 을 실제로 쓰기 시작함)이며 실패는 `reason: 'llm_call_failed'` 로 구분되어 남는다. 관계 추출은 fire-and-forget 이라 저장 응답은 지연되지 않는다.
- `llm-based-relation-extractor.spec.ts` 의 config 모킹 경로 결함(위 표 T005 행)은 별도 이슈감이다.
