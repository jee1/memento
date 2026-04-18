# Issue 179 — `index.ts` slop-detector Critical 제거 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `packages/memento-server/src/server/index.ts`에서 `any`·익명 빈 함수 패턴을 제거하고, MCP stdio 제약을 **타입·주석·이름 있는 no-op**으로 명시하여 `ai-slop-detector --js` Critical를 없앤다.

**Architecture:** 동작은 유지한다(회귀 방지). `process.stderr.write` 래퍼는 첫 인자를 `unknown`으로 받아 런타임의 비정상 호출을 그대로 처리하고, 내부에서 기존과 같이 문자열로 정규화한 뒤 바인딩된 원본에 전달한다. `console.error`는 `unknown[]`. `log`/`warn`/`info`/`debug`는 단일 `silenceConsoleForMcpStdio` 함수로 묶는다.

**Tech Stack:** TypeScript 5.x, Node.js 20+, Vitest, `@types/node`

**Spec:** [docs/superpowers/specs/2026-04-18-issue-179-slop-index-design.md](../specs/2026-04-18-issue-179-slop-index-design.md)

---

## File Structure

| File | 역할 |
|------|------|
| `packages/memento-server/src/server/index.ts` | stderr 래핑, console 오버라이드, no-op 헬퍼 및 주석 |
| `packages/memento-server/src/server/index.spec.ts` | stdio 가드 동작 특성화 테스트(선택적이지만 권장) |

---

### Task 1: 특성화 테스트 추가 (회귀 방지)

**Files:**
- Modify: `packages/memento-server/src/server/index.spec.ts`

**Note:** `index.ts`는 import 시 부수효과로 래핑이 설치된다. 기존 스펙이 이미 `./index.js`를 로드하므로, 같은 `describe` 트리 안 또는 새 `describe('MCP stdio guards')`에 아래를 추가한다.

- [ ] **Step 1: 테스트 블록 추가**

`index.spec.ts` 적절한 위치(파일 하단 `describe` 근처 또는 새 섹션)에 추가:

```typescript
describe('MCP stdio guards (Issue #179)', () => {
  it('stderr.write는 undefined/null 청크를 삼키고 true를 반환해야 한다', () => {
    const write = process.stderr.write.bind(process.stderr);
    expect(write(undefined as unknown as string)).toBe(true);
    expect(write(null as unknown as string)).toBe(true);
  });

  it('stderr.write는 문자열 "undefined"만 있는 청크를 삼켜야 한다', () => {
    const write = process.stderr.write.bind(process.stderr);
    expect(write('undefined')).toBe(true);
    expect(write('  undefined  ')).toBe(true);
  });

  it('console.log은 no-op이어야 한다 (stdout 오염 방지)', () => {
    expect(console.log).toBeDefined();
    expect(() => console.log('must not throw')).not.toThrow();
  });
});
```

- [ ] **Step 2: 테스트 실행**

Run: `npx vitest run packages/memento-server/src/server/index.spec.ts`

Expected: **PASS** (현재 구현 기준)

- [ ] **Step 3: Commit**

```bash
git add packages/memento-server/src/server/index.spec.ts
git commit -m "test(server): add MCP stdio guard characterization tests (#179)"
```

---

### Task 2: `index.ts` — 타입·no-op·주석

**Files:**
- Modify: `packages/memento-server/src/server/index.ts` (대략 L53–61, L127–158)

- [ ] **Step 1: `stderr.write` 래퍼 교체**

기존 L55–61 블록을 아래로 교체한다 (`any` 제거, 동작 동일).

```typescript
const _stderrWrite = process.stderr.write.bind(process.stderr);

process.stderr.write = function (chunk: unknown, ...rest: unknown[]): boolean {
  if (chunk === undefined || chunk === null) return true;
  const s = typeof chunk === 'string' ? chunk : String(chunk);
  if (s === 'undefined' || s.trim() === 'undefined') return true;
  return (_stderrWrite as (first: string | Uint8Array, ...args: unknown[]) => boolean)(
    s,
    ...rest
  );
} as typeof process.stderr.write;
```

- [ ] **Step 2: `silenceConsoleForMcpStdio` 헬퍼 추가 및 console 무력화 블록 정리**

`setupConsoleErrorOverride` **위**(또는 `console` 오버라이드 직전)에 헬퍼와 블록 주석을 둔다. 아래는 **한 덩어리**로 맞춘 예시(기존 주석 L104–108과 통합·정리 가능).

```typescript
/**
 * MCP stdio 전송 시 stdout에는 JSON-RPC 메시지만 있어야 한다.
 * 모듈 로드 시점부터 `console.log` 등 기본 경로의 stdout 출력을 막는다.
 * `console.error`는 `setupConsoleErrorOverride`에서 stderr/mcpLogger로 우회한다.
 * @see https://github.com/jee1/memento/issues/179
 */
function silenceConsoleForMcpStdio(..._args: unknown[]): void {
  // intentionally empty
}
```

`console.error` 오버라이드 내부:

```typescript
  console.error = (...args: unknown[]) => {
```

`if (!serverState.isConsoleOverridden()) { ... }` 블록을 다음과 같이 바꾼다:

```typescript
if (!serverState.isConsoleOverridden()) {
  console.log = silenceConsoleForMcpStdio;
  setupConsoleErrorOverride();
  console.warn = silenceConsoleForMcpStdio;
  console.info = silenceConsoleForMcpStdio;
  console.debug = silenceConsoleForMcpStdio;
  serverState.setConsoleOverridden(true);
}
```

- [ ] **Step 3: 타입 검사 및 테스트**

Run:

```bash
npm run type-check
npx vitest run packages/memento-server/src/server/index.spec.ts
```

Expected: **PASS**, 타입 에러 없음

- [ ] **Step 4: Lint**

Run: `npm run lint`

Expected: **PASS** (필요 시 `npm run lint -- --fix`)

- [ ] **Step 5: Commit**

```bash
git add packages/memento-server/src/server/index.ts
git commit -m "fix(server): tighten types for stdio guards in MCP index (#179)"
```

---

### Task 3: 품질 게이트 및 slop-detector

- [ ] **Step 1: 워크스페이스 테스트 (서버 패키지 또는 전체)**

Run: `npm test`

Expected: **PASS** (또는 기존 CI와 동일한 스킵 규칙)

- [ ] **Step 2: slop-detector (로컬에 도구가 있을 때)**

```bash
slop-detector --project packages/memento-server/src --js
```

Expected: **`[JS/TS Analysis]`** 구간에서 **Critical 0** (Suspicious는 허용)

도구 미설치 시: `pip install ai-slop-detector` 후 재실행.

- [ ] **Step 3: (선택) 최종 커밋 없음 — Task 2에서 이미 커밋했다면 생략**

---

## Spec coverage (self-review)

| Spec 요구 | Task |
|-----------|------|
| `any` 제거/축소 | Task 2 (`unknown`, `as typeof process.stderr.write`) |
| 의도적 no-op 명시 | Task 2 (`silenceConsoleForMcpStdio`, 블록 주석, Issue 링크) |
| 비목표: 라우트·CI·`.slopconfig` | 본 플랜에 작업 없음 ✓ |
| 검증: lint, type-check, 테스트, slop | Task 2–3 |

## Placeholder scan

- TBD/TODO 없음.
- 모든 코드 블록은 구현 가능한 완전한 형태.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-18-issue-179-slop-index.md`. Two execution options:

**1. Subagent-Driven (recommended)** — 태스크마다 새 서브에이전트, 태스크 사이 리뷰

**2. Inline Execution** — 이 세션에서 `executing-plans` 스킬로 순차 실행

원하는 방식을 알려 주세요.
