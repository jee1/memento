# Issue 290 — recall `type` 경고·계약 정리 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `memory_types`가 있는 `recall` 호출에서 불필요한 missing-`type` WARN을 제거하고, MCP/문서·deprecate 링크로 `type` 명시 계약을 정리한다.

**Architecture:** `recall-tool.ts`에서 `type` 미지정이어도 `memory_types` 배열이 비어 있지 않으면 `validateTypeParam` 경고 경로를 건너뛰고 기본 `validatedType`만 설정한다(검색 분기 호환 유지). 별도 가이드 문서를 추가하고 `type-param-validator.ts`의 deprecate URL을 그 문서로 맞춘다.

**Tech Stack:** TypeScript, Vitest, Zod(MCP 스키마), 기존 `mementoConfig.typeParamMode`.

**설계 스펙:** [docs/superpowers/specs/2026-05-09-issue-290-recall-type-design.md](../specs/2026-05-09-issue-290-recall-type-design.md)

**워크트리:** 저장소 루트의 `.worktrees/issue-290-recall-type` · 브랜치 `feat/issue-290-recall-type`

---

## 파일 맵

| 파일 | 역할 |
|------|------|
| `packages/memento-core/src/domains/memory/tools/recall-tool.ts` | `type`/`memory_types` 분기, MCP `description`, 주석 |
| `packages/memento-core/src/shared/utils/type-param-validator.ts` | deprecate 메시지 내 마이그레이션 URL |
| `packages/memento-core/src/domains/memory/tools/__tests__/recall-tool.spec.ts` | 경고 유무·회귀 테스트 |
| `docs/guides/ko/type-param-rollout.md` (신규) | `MEMENTO_TYPE_PARAM_MODE`·`recall` `type` 권장 사항 |

**참고(변경 없음 예상):** `remember-tool.ts`, `telemetry-instrumentation.integration.spec.ts`(이미 `type` 명시).

**운영 참고:** `type` 없이 `memory_types`만 넣는 호출은 기존처럼 아래 **두 번째** 경고(`기본 타입을 우선 적용하고 memory_types는 무시합니다`)가 남을 수 있다. 이슈 290 지문은 **첫 번째** `validateTypeParam` 경고다. 추가로 소음이면 별도 이슈로 `logWarning`→`logInfo` 등 검토.

---

### Task 1: 가이드 문서 추가

**Files:**
- Create: `docs/guides/ko/type-param-rollout.md`

- [ ] **Step 1:** 아래 내용으로 파일을 생성한다.

```markdown
# MCP `type` 파라미터 롤아웃 가이드

## 요약

- `remember` / `recall` 등 메모리 도구에서는 가능하면 **`type`을 항상 명시**하는 것이 좋다.
- 복수 타입을 한 번에 필터링하려면 `recall`의 **`memory_types`** 를 사용할 수 있다. `memory_types`만으로도 타입 의도가 드러나므로, 일부 경고는 생략된다(세부 동작은 릴리스 노트·코드 주석 참고).

## 환경 변수 `MEMENTO_TYPE_PARAM_MODE`

- `warn`(기본): `type`이 없으면 기본값 `episodic`을 쓰고 경고를 남길 수 있다(조건은 구현 참고).
- `deprecate`: 경고 문구에 마이그레이션 안내가 포함된다.
- `error`: `type`이 없으면 호출이 거절된다(엄격 모드).

배포 환경에서 단계적으로 `warn` → `deprecate` → `error`로 올려 클라이언트를 정리할 수 있다.

## 권장 마이그레이션

1. 모든 `recall` 호출에 명시적으로 `type`을 넣는다 (예: 하이브리드 검색: `episodic` 외 타입이 필요하면 해당 타입).
2. 복수 타입이 필요하면 `memory_types` 배열을 사용하고, 가능하면 **`type`도 함께 지정**해 의도를 명확히 한다.
```

- [ ] **Step 2:** `git add docs/guides/ko/type-param-rollout.md && git commit -m "docs(ko): add type param rollout guide for MCP recall"`

---

### Task 2: `type-param-validator` deprecate URL 수정

**Files:**
- Modify: `packages/memento-core/src/shared/utils/type-param-validator.ts` (deprecate 분기 `message` 문자열)

- [ ] **Step 1:** `deprecate` 모드 메시지의 플레이스홀더 URL을 아래로 교체한다 (저장소 기본 원격이 `jee1/memento`가 아니면 PR에서 실제 기본 브랜치 URL로 맞춘다).

고정 문자열 예:

`https://github.com/jee1/memento/blob/main/docs/guides/ko/type-param-rollout.md`

- [ ] **Step 2:** `packages/memento-core/src/shared/utils/type-param-validator.spec.ts` 에서 `deprecate` 테스트가 URL을 단정하지 않으면 그대로 두고, 메시지에 `type-param-rollout` 또는 위 경로가 포함되는지 한 줄 assert를 추가해도 된다.

- [ ] **Step 3:** 해당 패키지 테스트만 실행해 통과를 확인한다.

```bash
cd /home/jee1lee/git/memento/.worktrees/issue-290-recall-type
npx vitest run packages/memento-core/src/shared/utils/type-param-validator.spec.ts
```

Expected: 모든 테스트 PASS.

- [ ] **Step 4:** 커밋

```bash
git add packages/memento-core/src/shared/utils/type-param-validator.ts packages/memento-core/src/shared/utils/type-param-validator.spec.ts
git commit -m "fix(core): point type-param deprecate message to real rollout doc"
```

---

### Task 3: `RecallTool` — missing-`type` 경고 조건

**Files:**
- Modify: `packages/memento-core/src/domains/memory/tools/recall-tool.ts` (약 674–705행 부근)

- [ ] **Step 1:** `RecallSchema.parse` 직후, 아래 의미로 분기를 바꾼다.

- `hasMemoryTypesFilter = Array.isArray(memory_types) && memory_types.length > 0`
- `if (!type)` 일 때:
  - **`hasMemoryTypesFilter`이면:** `validateTypeParam`을 호출하지 않는다. `validatedType = 'episodic'`(또는 기존과 동일하게 `MemoryTypeRequest` 기본으로 쓰는 리터럴)만 설정한다. **`logWarning` 없음**(이슈 290의 첫 경고 제거).
  - **아니면:** 기존과 같이 `validateTypeParam(undefined, typeParamMode, 'recall')` → error 시 throw → warn/deprecate 시 `logWarning` → `defaultType`으로 `validatedType` 설정.

- [ ] **Step 2:** 주석을 스펙과 맞게 수정한다. 삭제할 문구 예: "`memory_types`만 있어도 경고를 띄워야 함".

- [ ] **Step 3:** 커밋

```bash
git add packages/memento-core/src/domains/memory/tools/recall-tool.ts
git commit -m "fix(core): skip recall missing-type warn when memory_types is set"
```

---

### Task 4: MCP 스키마 설명 문구

**Files:**
- Modify: `packages/memento-core/src/domains/memory/tools/recall-tool.ts` — `getDefinition()`의 `inputSchema.properties` 에서 `type`·`memory_types` 필드 `description`

- [ ] **Step 1:** `type` 설명에 “가능하면 항상 지정”을 한국어로 짧게 반영한다.

- [ ] **Step 2:** `memory_types` 설명에 “복수 타입 필터; `type` 미지정 시에도 이 배열이 있으면 missing-`type` 경고가 생략될 수 있다” 수준의 한 줄을 추가한다(과장 없이, 실제 동작과 일치).

- [ ] **Step 3:** 커밋

```bash
git add packages/memento-core/src/domains/memory/tools/recall-tool.ts
git commit -m "docs(mcp): clarify recall type and memory_types descriptions"
```

(Task 3과 같은 파일이면 Task 3 커밋과 합쳐도 된다 — 한 커밋으로 묶어도 됨.)

---

### Task 5: 회귀 테스트 (`recall-tool.spec.ts`)

**Files:**
- Modify: `packages/memento-core/src/domains/memory/tools/__tests__/recall-tool.spec.ts`

- [ ] **Step 1:** 파일 상단 패턴과 같이 `mementoConfig`를 import 한 뒤, 새 `describe('type 파라미터 롤아웃')` 블록을 추가한다. `beforeEach`/`afterEach`에서 `typeParamMode`를 저장·복구한다.

```typescript
import { mementoConfig } from '../../../../shared/config/index.js';

describe('type 파라미터 롤아웃 (issue 290)', () => {
  let savedTypeParamMode: (typeof mementoConfig)['typeParamMode'];

  beforeEach(() => {
    savedTypeParamMode = mementoConfig.typeParamMode;
    mementoConfig.typeParamMode = 'warn';
    vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
      items: [],
      total_count: 0,
      query_time: 1
    });
  });

  afterEach(() => {
    mementoConfig.typeParamMode = savedTypeParamMode;
  });

  it('type 없고 memory_types만 있으면 missing-type 경고(validateTypeParam 문구)를 내지 않는다', async () => {
    const logWarningSpy = vi.spyOn(tool as any, 'logWarning');
    await tool.handle(
      { query: 'q', memory_types: ['semantic'] as const, limit: 5 },
      context
    );
    const missingTypeCalls = logWarningSpy.mock.calls.filter(
      (c) => typeof c[0] === 'string' && c[0].includes("type' 파라미터가 지정되지 않았습니다")
    );
    expect(missingTypeCalls).toHaveLength(0);
  });

  it('type·memory_types 모두 없으면 warn 모드에서 missing-type 경고를 낸다', async () => {
    const logWarningSpy = vi.spyOn(tool as any, 'logWarning');
    await tool.handle({ query: 'q', limit: 5 }, context);
    expect(logWarningSpy).toHaveBeenCalledWith(
      expect.stringContaining("type' 파라미터가 지정되지 않았습니다")
    );
  });
});
```

- [ ] **Step 2:** 위 블록을 기존 `describe('RecallTool')`의 `beforeEach`가 준비한 `tool`/`context`/`hybridSearchEngine`을 쓰도록 **중첩 위치**를 맞춘다(동일 `describe` 트리 안의 형제 `describe`로 두면 된다).

- [ ] **Step 3:** 테스트 실행

```bash
npx vitest run packages/memento-core/src/domains/memory/tools/__tests__/recall-tool.spec.ts -t "type 파라미터 롤아웃"
```

Expected: 신규 두 테스트 PASS.

- [ ] **Step 4:** 커밋

```bash
git add packages/memento-core/src/domains/memory/tools/__tests__/recall-tool.spec.ts
git commit -m "test(core): recall missing-type warn only without memory_types"
```

---

### Task 6: 전체 검증

- [ ] **Step 1:** 워크트리 루트에서 프로젝트 표준 명령 실행.

```bash
cd /home/jee1lee/git/memento/.worktrees/issue-290-recall-type
npm test
npm run lint
npm run type-check
```

Expected: 모두 성공(기존 CI와 동일 기준).

- [ ] **Step 2:** 변경 사항이 스펙 [docs/superpowers/specs/2026-05-09-issue-290-recall-type-design.md](../specs/2026-05-09-issue-290-recall-type-design.md) 와 모순 없음을 스스로 확인한다.

- [ ] **Step 3:** PR 본문에 이슈 290 링크, 스펙·플랜 경로, 운영 로그에서 **잔여 경고**(두 번째 `memory_types` 무시 경고) 가능성을 한 줄 언급.

---

## 스펙 대응 표

| 스펙 절 | 태스크 |
|---------|--------|
| 4.1 경고 조건 | Task 3, 5 |
| 4.3 계약·문서 | Task 1, 2, 4 |
| 5 테스트 | Task 5, 6 |
| 6 참고 파일 | 파일 맵 |

## 플랜 자체 점검

- 플레이스홀더 없음.
- `error` 모드에서 `memory_types`만 있는 호출은 스펙대로 거절하지 않는다(validate 생략).
- 기본 브랜치 URL은 포크 시 PR에서 조정 가능하도록 주석함.

---

**실행 선택**

플랜 저장 위치: `docs/superpowers/plans/2026-05-09-issue-290-recall-type.md`

1. **Subagent-Driven (권장)** — 태스크마다 새 서브에이전트, 태스크 사이 리뷰  
2. **Inline Execution** — 이 세션에서 `executing-plans`로 체크포인트 실행

원하는 방식을 지정해 주세요.
