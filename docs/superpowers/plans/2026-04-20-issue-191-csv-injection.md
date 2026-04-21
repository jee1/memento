# Issue 191: CSV Formula Injection Mitigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `packages/memento-client/src/utils.ts`의 `memoriesToCSV()`가 `content`, `tags`, `source`에 대해 CSV formula injection을 방지하도록 수정하고, 해당 보안 동작을 테스트로 고정한다.

**Architecture:** 구현 범위는 `packages/memento-client` 내부로 제한한다. 먼저 `utils.spec.ts`에 failing test를 추가해 원하는 CSV 출력 문자열을 고정한 뒤, `utils.ts`에 작은 공통 helper를 추가해 자유형 문자열 3개 필드만 안전하게 직렬화한다.

**Tech Stack:** TypeScript, Vitest, npm workspaces

**Spec:** `docs/superpowers/specs/2026-04-20-issue-191-csv-injection-design.md`

---

## File Map

| 작업 | 파일 | 변경 유형 |
|------|------|-----------|
| Task 1 | `packages/memento-client/src/utils.spec.ts` | 수정 |
| Task 2 | `packages/memento-client/src/utils.ts` | 수정 |
| 검증 | `docs/superpowers/specs/2026-04-20-issue-191-csv-injection-design.md` | 읽기 전용 |

---

## Task 1: failing test로 CSV 보안 동작 고정

**Files:**
- Modify: `packages/memento-client/src/utils.spec.ts`
- Test: `packages/memento-client/src/utils.spec.ts`

### 배경

현재 `utils.spec.ts`는 `isValidMemoryType()`만 검증하고 있고, `memoriesToCSV()`의 출력 형식과 CSV injection 방어 규칙은 테스트로 고정되어 있지 않다. 이 작업에서는 `content`, `tags`, `source`에 대한 quoted CSV 출력과 single-quote neutralization 규칙을 먼저 테스트로 명세한다.

---

- [ ] **Step 1: import 구문을 확장한다**

`packages/memento-client/src/utils.spec.ts`의 상단 import를 아래처럼 바꾼다.

```typescript
import { describe, it, expect } from 'vitest';
import { isValidMemoryType, memoriesToCSV } from './utils.js';
import type { MemoryItem, MemoryType } from './types.js';
```

Expected: `memoriesToCSV`와 `MemoryItem`을 테스트에서 바로 사용할 수 있다.

---

- [ ] **Step 2: 테스트 fixture와 CSV 보안 테스트를 추가한다**

`packages/memento-client/src/utils.spec.ts` 파일 하단에 아래 코드를 추가한다.

```typescript
const buildMemory = (overrides: Partial<MemoryItem> = {}): MemoryItem => ({
  id: 'mem_123',
  content: 'plain content',
  type: 'episodic',
  importance: 0.8,
  created_at: '2026-04-20T00:00:00.000Z',
  pinned: false,
  privacy_scope: 'private',
  ...overrides,
});

describe('memoriesToCSV', () => {
  it('returns an empty string for empty input', () => {
    expect(memoriesToCSV([])).toBe('');
  });

  it('quotes free-form fields and escapes embedded double quotes', () => {
    const csv = memoriesToCSV([
      buildMemory({
        content: 'He said "hello"',
        tags: ['alpha"beta', 'gamma'],
        source: 'web"form',
      }),
    ]);

    expect(csv).toBe([
      'id,content,type,importance,created_at,last_accessed,pinned,tags,privacy_scope,source',
      'mem_123,"He said ""hello""",episodic,0.8,2026-04-20T00:00:00.000Z,,false,"alpha""beta;gamma",private,"web""form"',
    ].join('\n'));
  });

  it('neutralizes formula-like content prefixes', () => {
    const cases = [
      ['=SUM(A1:A2)', '"\'=SUM(A1:A2)"'],
      ['+cmd', '"\'+cmd"'],
      ['-2+3', '"\'-2+3"'],
      ['@lookup', '"\'@lookup"'],
    ] as const;

    cases.forEach(([content, expectedCell]) => {
      const csv = memoriesToCSV([buildMemory({ content })]);
      const [, row] = csv.split('\n');

      expect(row).toBe(
        `mem_123,${expectedCell},episodic,0.8,2026-04-20T00:00:00.000Z,,false,,private,`
      );
    });
  });

  it('neutralizes formula-like tags and source values', () => {
    const csv = memoriesToCSV([
      buildMemory({
        tags: ['+danger', 'safe'],
        source: '@cmd',
      }),
    ]);

    expect(csv).toBe([
      'id,content,type,importance,created_at,last_accessed,pinned,tags,privacy_scope,source',
      'mem_123,"plain content",episodic,0.8,2026-04-20T00:00:00.000Z,,false,"\'+danger;safe",private,"\'@cmd"',
    ].join('\n'));
  });

  it('neutralizes tags only after joining them', () => {
    const csv = memoriesToCSV([
      buildMemory({
        tags: ['safe', '=later'],
      }),
    ]);

    expect(csv).toBe([
      'id,content,type,importance,created_at,last_accessed,pinned,tags,privacy_scope,source',
      'mem_123,"plain content",episodic,0.8,2026-04-20T00:00:00.000Z,,false,"safe;=later",private,',
    ].join('\n'));
  });
});
```

Expected: 새 테스트들이 현재 구현과의 차이를 정확히 드러낸다.

---

- [ ] **Step 3: 테스트를 실행해 실제로 실패하는지 확인한다**

Run: `npx vitest run packages/memento-client/src/utils.spec.ts`

Expected: FAIL. 대표적으로 다음과 같은 차이가 보여야 한다.
- `content`가 `=`, `+`, `-`, `@`로 시작해도 현재 구현은 single quote를 붙이지 않음
- `tags`, `source`는 현재 quoted CSV cell조차 아님
- joined tags에 대한 기대 출력과 현재 출력이 다름

---

## Task 2: 최소 helper로 free-form CSV 셀을 안전하게 직렬화

**Files:**
- Modify: `packages/memento-client/src/utils.ts`
- Test: `packages/memento-client/src/utils.spec.ts`

### 배경

현재 `memoriesToCSV()`는 `content`만 inline escaping 하고 있고, `tags`와 `source`는 bare string으로 내보낸다. 보안 규칙을 한 곳에 모으기 위해 helper를 추가하고 자유형 문자열 3개 필드만 그 helper를 통과시킨다.

---

- [ ] **Step 1: `utils.ts`에 safe CSV helper를 추가한다**

`packages/memento-client/src/utils.ts`에서 `memoriesToCSV()` 바로 위에 아래 helper를 추가한다.

```typescript
function toSafeCSVCell(value: string | null | undefined): string {
  if (value == null) return '';

  const neutralized = /^[=+\-@]/.test(value) ? `'${value}` : value;
  const escaped = neutralized.replace(/"/g, '""');

  return `"${escaped}"`;
}
```

Expected: 자유형 문자열을 CSV quoted cell로 만들고, 수식 시작 문자를 single quote로 neutralize할 수 있다.

---

- [ ] **Step 2: `memoriesToCSV()`의 free-form 필드를 helper로 교체한다**

`packages/memento-client/src/utils.ts`의 `rows` 매핑을 아래처럼 바꾼다.

```typescript
  const rows = memories.map(memory => [
    memory.id,
    toSafeCSVCell(memory.content),
    memory.type,
    memory.importance,
    memory.created_at,
    memory.last_accessed || '',
    memory.pinned,
    memory.tags && memory.tags.length > 0 ? toSafeCSVCell(memory.tags.join(';')) : '',
    memory.privacy_scope,
    memory.source ? toSafeCSVCell(memory.source) : ''
  ]);
```

Expected:
- `content`는 기존처럼 quoted CSV cell이지만 이제 formula neutralization도 수행한다.
- `tags`와 `source`도 quoted CSV cell로 직렬화된다.
- empty tags/source는 기존처럼 빈 셀(``)로 유지된다.

---

- [ ] **Step 3: focused test를 다시 실행해 green으로 만든다**

Run: `npx vitest run packages/memento-client/src/utils.spec.ts`

Expected: PASS. 총 11개 테스트가 통과해야 한다. (`isValidMemoryType` 6개 + `memoriesToCSV` 5개)

---

- [ ] **Step 4: 타입/회귀 확인을 한 번 더 실행한다**

Run: `npm run type-check`

Expected: PASS. `packages/memento-client/src/utils.ts` 변경으로 인한 타입 오류가 없어야 한다.

---

- [ ] **Step 5: 변경 범위를 확인한다**

Run: `git status --short`

Expected: `packages/memento-client/src/utils.ts`와 `packages/memento-client/src/utils.spec.ts` 중심의 변경만 보여야 한다. 의도하지 않은 파일이 보이면 staging 전에 원인을 확인한다.

---

- [ ] **Step 6: 커밋한다**

```bash
git add packages/memento-client/src/utils.ts packages/memento-client/src/utils.spec.ts
git commit -m "fix(client): neutralize CSV formula injection in memory exports

- add safe CSV helper for free-form string fields
- protect content, tags, and source with single-quote neutralization
- add focused tests for formula-like payloads and quote escaping

Fixes #191"
```

Expected: issue `#191`에 대응하는 단일 보안 수정 커밋이 생성된다.

---

## Self-Review Checklist

- Spec coverage: `content`, `tags`, `source` 3개 필드 보호와 작은따옴표 neutralization, quote escaping, joined tags semantics가 모두 task에 반영되어 있는지 확인한다.
- Placeholder scan: `TODO`, `TBD`, "적절한 처리" 같은 문구 없이 실제 코드와 명령으로만 구성되어 있는지 확인한다.
- Type consistency: 테스트의 `MemoryItem` fixture, helper 이름 `toSafeCSVCell()`, 구현에서 사용하는 필드명 `content`, `tags`, `source`가 모두 일치하는지 확인한다.
