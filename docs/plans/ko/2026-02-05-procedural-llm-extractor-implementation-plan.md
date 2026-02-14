# Procedural Memory LLM 추출기 구현 계획

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reflexion 결과에서 procedural memory 필드를 추출할 때 LLM 추출기를 1순위로 시도하고, 실패/타임아웃 시 기존 규칙 기반 추출로 자동 fallback 하도록 플러그 가능 구조를 도입한다.

**Architecture:** 공통 인터페이스 `IProceduralMemoryExtractor`(extract → Promise<ExtractedProceduralMemory | null>)를 두고, RuleBasedProceduralExtractor(기존 동기 함수 래핑)와 LlmProceduralExtractor(신규)가 구현한다. reflexion-worker는 설정(PROCEDURAL_EXTRACTION_STRATEGY)에 따라 llm_first일 때만 LLM 추출기를 먼저 호출하고, null이면 규칙 기반을 호출한다. 기본값은 rule_only로 기존 동작을 유지한다.

**Tech Stack:** TypeScript, Vitest, 기존 `procedural-memory-extractor`, `ReflectionNotes`/`FailureEvent`/`ExtractedProceduralMemory` 타입, LLM 호출은 `LLMClientInitializer` 및 기존 completion 패턴(llm-based-relation-extractor 참고) 재사용.

**참고 설계:** `docs/plans/2026-02-05-procedural-llm-extractor-design.md`

---

## Task 1: 추출기 인터페이스 및 타입 정의

**Files:**
- Create: `src/shared/utils/procedural-memory-extractor.types.ts`
- Test: `src/shared/utils/__tests__/procedural-memory-extractor.types.spec.ts` (인터페이스 존재/호환 검증만 필요 시 선택)

**Step 1: 타입 파일 생성**

- **순환 참조 방지:** `IProceduralMemoryExtractor`를 `procedural-memory-extractor.types.ts`에 두고, 같은 파일에서 `ReflectionNotes`·`ExtractedProceduralMemory`를 정의하거나 re-export하면, `procedural-memory-extractor.ts`가 이 타입 파일만 import 하여 순환이 생기지 않는다. 현재 `ReflectionNotes`와 `ExtractedProceduralMemory`는 `procedural-memory-extractor.ts`에 정의되어 있으므로, 둘 중 하나를 선택한다.
  - **선택 A:** `ReflectionNotes`와 `ExtractedProceduralMemory`를 `procedural-memory-extractor.types.ts`로 옮기고, `procedural-memory-extractor.ts`는 여기서 import 후 기존 함수만 유지. (권장)
  - **선택 B:** 타입 파일에서는 `import type { ... } from './procedural-memory-extractor.js'`로만 가져오고, `procedural-memory-extractor.ts`는 `RuleBasedProceduralExtractor`를 별도 파일(예: `procedural-rule-extractor.ts`)에 두어 해당 파일만 `types`를 import 하게 하면 순환 제거.

권장: **선택 A**. `procedural-memory-extractor.types.ts`에 인터페이스와 필요한 타입을 두고, 구현 파일은 여기서 타입만 import.

```typescript
// src/shared/utils/procedural-memory-extractor.types.ts
import type { FailureEvent } from '../../domains/monitoring/services/failure-detector.js';

// 기존 extractor.ts에 있으면 여기로 이동 후 export (선택 A)
export interface ReflectionNotes { ... }
export interface ExtractedProceduralMemory { ... }

/**
 * Procedural Memory 추출기 플러그인 인터페이스.
 * LLM 추출 실패 시 null을 반환하여 fallback(규칙 기반)으로 넘긴다.
 */
export interface IProceduralMemoryExtractor {
  extract(
    notes: ReflectionNotes | Record<string, unknown>,
    event?: FailureEvent
  ): Promise<ExtractedProceduralMemory | null>;
}
```

- `FailureEvent`는 `src/domains/monitoring/services/failure-detector.ts`에서 import.

**Step 2: 기존 procedural-memory-extractor export 확인**

- `src/shared/utils/procedural-memory-extractor.ts`에서 `ReflectionNotes`, `ExtractedProceduralMemory`가 export 되어 있는지 확인.
- `FailureEvent`는 `src/domains/monitoring/services/failure-detector.ts`에서 import.

**Step 3: import 경로 수정**

- 타입 파일에서 순환 참조가 나지 않도록 한다. `procedural-memory-extractor.types.ts`는 타입만 정의하고, `ExtractedProceduralMemory`/`ReflectionNotes`는 `procedural-memory-extractor.ts`에서 import. `FailureEvent`는 `failure-detector`에서 import.

**Step 4: lint 및 type-check**

Run: `npm run type-check`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/shared/utils/procedural-memory-extractor.types.ts
git commit -m "feat(procedural): add IProceduralMemoryExtractor interface"
```

---

## Task 2: RuleBasedProceduralExtractor (규칙 기반 래퍼)

**Files:**
- Modify: `src/shared/utils/procedural-memory-extractor.ts` (파일 끝에 클래스 또는 함수 추가)
- Test: `src/shared/utils/__tests__/procedural-memory-extractor.spec.ts`

**Step 1: 실패하는 테스트 추가**

기존 `procedural-memory-extractor.spec.ts`에 describe 블록 추가:

```typescript
describe('RuleBasedProceduralExtractor', () => {
  it('Given: reflection_notes와 event가 주어졌을 때, When: extract()를 호출하면, Then: ExtractedProceduralMemory를 Promise로 반환한다', async () => {
    const notes = { original_task: '테스트 작업', suggested_improvements: '단계1. 검증' };
    const extractor = new RuleBasedProceduralExtractor();
    const result = await extractor.extract(notes);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('workflow_name');
    expect(result).toHaveProperty('skill_name');
    expect(result).toHaveProperty('steps');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/shared/utils/__tests__/procedural-memory-extractor.spec.ts -t "RuleBasedProceduralExtractor"`  
Expected: FAIL (RuleBasedProceduralExtractor not defined 또는 extract not a function)

**Step 3: RuleBasedProceduralExtractor 구현**

`src/shared/utils/procedural-memory-extractor.ts` 상단에 인터페이스 import 추가 후, 파일 끝에:

```typescript
import type { IProceduralMemoryExtractor } from './procedural-memory-extractor.types.js';

export class RuleBasedProceduralExtractor implements IProceduralMemoryExtractor {
  async extract(
    notes: ReflectionNotes | Record<string, unknown>,
    event?: FailureEvent
  ): Promise<ExtractedProceduralMemory | null> {
    try {
      const result = extractProceduralMemory(notes, event);
      return result;
    } catch {
      return null;
    }
  }
}
```

(실제로 기존 `extractProceduralMemory`는 예외를 던지지 않고 항상 객체를 반환하므로, catch는 안전용. null 반환 조건이 필요하면 “workflow_name과 skill_name이 모두 없을 때 null” 등 설계에 맞게 추가.)

**Step 4: Run test to verify it passes**

Run: `npm test -- src/shared/utils/__tests__/procedural-memory-extractor.spec.ts -t "RuleBasedProceduralExtractor"`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/shared/utils/procedural-memory-extractor.ts src/shared/utils/__tests__/procedural-memory-extractor.spec.ts
git commit -m "feat(procedural): add RuleBasedProceduralExtractor implementing IProceduralMemoryExtractor"
```

---

## Task 3: 설정 추가 (PROCEDURAL_EXTRACTION_STRATEGY, 타임아웃)

**Files:**
- Modify: `src/shared/config/index.ts`
- Modify: `src/shared/config/environment.ts` (resolveOptionalString 등 사용처 확인)
- Modify: `src/shared/types/index.ts` (MementoConfig에 필드 추가)
- Modify: `env.example`

**Step 1: MementoConfig 타입 확장**

`src/shared/types/index.ts`의 `MementoConfig` 인터페이스에 추가:

```typescript
  // Procedural Memory 추출 전략 (Issue #57 Phase 2)
  proceduralExtractionStrategy: 'llm_first' | 'rule_only';
  proceduralLlmExtractorTimeoutMs: number;
```

**Step 2: environment에서 resolve 함수 확인**

`src/shared/config/environment.ts`에 `resolveOptionalNumber` 등이 있으면 그대로 사용. 없으면 `resolveNumber`에 defaultValue 사용.

**Step 3: mementoConfig에 값 할당**

`src/shared/config/index.ts`에서:

```typescript
  proceduralExtractionStrategy: (getRawEnvValue('PROCEDURAL_EXTRACTION_STRATEGY') === 'llm_first'
    ? 'llm_first'
    : 'rule_only') as 'llm_first' | 'rule_only',
  proceduralLlmExtractorTimeoutMs: resolveNumber('PROCEDURAL_LLM_EXTRACTOR_TIMEOUT_MS', { defaultValue: 10000 }),
```

(환경변수 키는 대문자 스네이크. `resolveNumber`가 defaultValue를 지원하는지 확인하고, 없으면 `resolveOptionalNumber` 후 `?? 10000`.)

**Step 4: env.example 주석 추가**

```bash
# Procedural Memory 추출 전략 (Issue #57)
# PROCEDURAL_EXTRACTION_STRATEGY=rule_only  # rule_only | llm_first (기본: rule_only)
# PROCEDURAL_LLM_EXTRACTOR_TIMEOUT_MS=10000
```

**Step 5: type-check**

Run: `npm run type-check`  
Expected: PASS

**Step 6: Commit**

```bash
git add src/shared/types/index.ts src/shared/config/index.ts env.example
git commit -m "chore(config): add proceduralExtractionStrategy and proceduralLlmExtractorTimeoutMs"
```

---

## Task 4: LlmProceduralExtractor 구현 (핵심)

**Files:**
- Create: `src/domains/memory/services/procedural-llm-extractor.ts`
- Test: `src/domains/memory/services/__tests__/procedural-llm-extractor.spec.ts`

**Step 1: 실패하는 테스트 작성**

`src/domains/memory/services/__tests__/procedural-llm-extractor.spec.ts` 생성:

- Given: stub된 LLM 응답(유효한 JSON 문자열)을 반환하는 모킹
- When: `LlmProceduralExtractor.extract(notes)` 호출
- Then: `ExtractedProceduralMemory` 형태의 객체 반환 (null 아님)
- Given: LLM이 잘못된 JSON 또는 예외를 던짐
- When: extract 호출
- Then: `null` 반환

테스트에서 LLM 호출부를 주입하거나, `procedural-llm-extractor`가 주입받는 completion 함수를 모킹하여 실제 API 호출 없이 검증.

**Step 2: Run test to verify it fails**

Run: `npm test -- src/domains/memory/services/__tests__/procedural-llm-extractor.spec.ts`  
Expected: FAIL (파일/클래스 없음)

**Step 3: LlmProceduralExtractor 최소 구현**

- `src/domains/memory/services/procedural-llm-extractor.ts` 생성.
- `IProceduralMemoryExtractor` 구현.
- 프롬프트: 시스템 메시지 + 유저 메시지( reflection_notes JSON 또는 문자열화 ).
- 응답에서 JSON 블록 추출(정규식 또는 ```json ... ``` 제거 후 parse).
- `ExtractedProceduralMemory` 필드 검증 후 반환, 실패 시 null.
- LLM 호출: 기존 `LLMClientInitializer` 또는 `llm-based-relation-extractor`와 동일한 패턴(OpenAI/Gemini/Ollama)으로 한 번의 completion 호출. 타임아웃은 `mementoConfig.proceduralLlmExtractorTimeoutMs` 사용(AbortSignal + setTimeout 또는 클라이언트 옵션).
- 생성자에서 optional로 completion 함수를 받으면 테스트 시 주입 가능하도록 한다.

**Step 4: Run test to verify it passes**

Run: `npm test -- src/domains/memory/services/__tests__/procedural-llm-extractor.spec.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/domains/memory/services/procedural-llm-extractor.ts src/domains/memory/services/__tests__/procedural-llm-extractor.spec.ts
git commit -m "feat(procedural): add LlmProceduralExtractor with prompt and JSON parsing"
```

---

## Task 5: reflexion-worker 연동 (전략 분기)

**Files:**
- Modify: `src/infrastructure/reflexion-worker.ts` (convertToProceduralMemory 내 추출 호출부)
- Test: `src/infrastructure/reflexion-worker.spec.ts`

**Step 1: 실패하는 테스트 추가**

reflexion-worker.spec.ts에:
- `PROCEDURAL_EXTRACTION_STRATEGY=rule_only`(또는 설정 모킹)일 때 기존과 동일하게 규칙 기반만 사용되는지 검증.
- `llm_first`이고 LLM 추출기가 null을 반환할 때 규칙 기반 결과가 사용되는지 검증.

(ReflexionWorker를 생성할 때 DB, FailureDetector 등 의존성을 모킹하고, procedural 추출 결과만 검증할 수 있는 최소 시나리오.)

**Step 2: Run test to verify it fails**

Run: `npm test -- src/infrastructure/reflexion-worker.spec.ts -t "procedural"` (또는 해당 describe)  
Expected: FAIL 또는 새 테스트가 추가된 상태에서 기대 실패

**Step 3: convertToProceduralMemory 수정**

- `convertToProceduralMemory` 내부 1번 단계에서:
  - `mementoConfig.proceduralExtractionStrategy === 'llm_first'`이면:
    - LlmProceduralExtractor 인스턴스 생성(필요 시 싱글톤/팩토리), `extract(reflectionNote, event)` 호출.
    - 결과가 non-null이고 workflow_name 또는 skill_name이 있으면 그대로 `extracted`로 사용.
    - 그 외(null 또는 필드 부족)면 기존 `extractProceduralMemory(reflectionNote, event)` 호출하여 `extracted` 설정.
  - `rule_only`이면 기존처럼 `extractProceduralMemory(reflectionNote, event)` 만 사용.
- LLM 실패 시 로그만 남기고 fallback 하므로 try/catch로 감싸서 예외 시에도 규칙 기반으로 진행.

**Step 4: Run test to verify it passes**

Run: `npm test -- src/infrastructure/reflexion-worker.spec.ts`  
Expected: PASS

**Step 5: Commit**

```bash
git add src/infrastructure/reflexion-worker.ts src/infrastructure/reflexion-worker.spec.ts
git commit -m "feat(reflexion): wire procedural extraction strategy (llm_first fallback to rule)"
```

---

## Task 6: 통합 검증 및 문서

**Files:**
- Modify: `docs/plans/2026-02-05-procedural-llm-extractor-design.md` (구현 완료 메모 추가는 선택)
- Run: `npm run lint`, `npm test` (전체)

**Step 1: 전체 테스트 실행**

Run: `npm test`  
Expected: PASS

**Step 2: lint**

Run: `npm run lint`  
Expected: PASS (필요 시 `--fix`)

**Step 3: 설계 문서에 구현 완료 노트 (선택)**

설계 문서 하단에 “구현 완료: 2026-02-05, 계획 문서: 2026-02-05-procedural-llm-extractor-implementation-plan.md” 정도 추가.

**Step 4: Commit**

```bash
git add docs/plans/2026-02-05-procedural-llm-extractor-design.md
git commit -m "docs: mark procedural LLM extractor implementation complete"
```

---

## 체크리스트 (실행 시 확인)

- [ ] Task 1: `IProceduralMemoryExtractor` 타입만 정의, 순환 참조 없음
- [ ] Task 2: `RuleBasedProceduralExtractor`가 기존 `extractProceduralMemory` 래핑, 테스트 통과
- [ ] Task 3: `proceduralExtractionStrategy`, `proceduralLlmExtractorTimeoutMs` 기본값으로 기존 동작 유지
- [ ] Task 4: `LlmProceduralExtractor` 단위 테스트에서 모킹으로 파싱/실패 시 null 검증
- [ ] Task 5: reflexion-worker에서 `llm_first` + LLM 실패 시 규칙 fallback 동작
- [ ] Task 6: 전체 lint 및 test 통과

---

## 실행 옵션

**계획 저장 위치:** `docs/plans/2026-02-05-procedural-llm-extractor-implementation-plan.md`

**실행 방법 두 가지:**

1. **서브에이전트 주도(이 세션)** — 태스크마다 서브에이전트를 호출하고 태스크 간 코드 리뷰하며 진행.
2. **별도 세션(병렬)** — worktree에서 새 세션을 열고 executing-plans 스킬로 체크포인트 단위 배치 실행.

원하시는 방식을 알려주시면 그에 맞춰 진행하겠습니다.
