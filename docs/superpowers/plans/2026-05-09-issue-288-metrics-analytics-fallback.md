# Issue #288: getMetricsAnalytics() fallback 제거 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `getMetricsAnalytics()`의 838번 줄에 있는 dead code fallback(`heapUsed/heapTotal` 계산)을 제거하고, `usagePercent ?? 0`으로 단순화한다.

**Architecture:** 단일 파일의 단일 표현식 수정. PR #286 이후 `usagePercent`는 항상 `rss/totalmem` 기준으로 채워지므로 `??` 이후의 fallback은 실행되지 않음. dead code 제거로 코드 명확성 향상.

**Tech Stack:** TypeScript, Vitest, Node.js ≥24

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `packages/memento-core/src/domains/monitoring/services/performance-monitor.ts:838` | dead code fallback 제거 |
| Modify | `packages/memento-core/src/domains/monitoring/services/__tests__/performance-monitor.spec.ts` | `usagePercent` undefined 레거시 케이스 테스트 추가 |

---

### Task 1: 워크트리 생성

**Files:**
- (없음 — 저장소 설정만)

- [ ] **Step 1: 워크트리 생성**

```bash
git worktree add .worktrees/fix/issue-288-metrics-fallback -b fix/issue-288-metrics-fallback
```

Expected: `.worktrees/fix/issue-288-metrics-fallback/` 디렉토리 생성됨

- [ ] **Step 2: 워크트리로 이동**

```bash
cd .worktrees/fix/issue-288-metrics-fallback
```

이후 모든 작업은 이 디렉토리에서 수행한다.

---

### Task 2: 레거시 usagePercent undefined 테스트 케이스 추가 (TDD)

**Files:**
- Modify: `packages/memento-core/src/domains/monitoring/services/__tests__/performance-monitor.spec.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`describe('PerformanceMonitor analytics', ...)` 블록 내에 다음 케이스를 추가한다 (기존 `'computes averages and shares from metrics history'` 테스트 바로 아래):

```typescript
it('usagePercent가 없는 레거시 메트릭은 0으로 fallback한다', () => {
  const monitor = new PerformanceMonitor();

  const legacyMetric = createMetrics({
    memory: { heapUsed: toBytes(512), usagePercent: undefined as unknown as number }
  });

  (monitor as any).metricsHistory = [legacyMetric];

  const analytics = monitor.getMetricsAnalytics();
  expect(analytics.memory.averageUsagePercent).toBe(0);
  expect(analytics.memory.history).toEqual([0]);
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

```bash
npx vitest run packages/memento-core/src/domains/monitoring/services/__tests__/performance-monitor.spec.ts --reporter=verbose 2>&1 | tail -30
```

Expected: 새로 추가한 테스트가 FAIL (현재 코드는 `heapUsed/heapTotal` 계산을 하므로 0이 아닌 50이 반환됨)

---

### Task 3: 소스 코드 수정

**Files:**
- Modify: `packages/memento-core/src/domains/monitoring/services/performance-monitor.ts:838`

- [ ] **Step 1: 838번 줄 수정**

`getMetricsAnalytics()` 함수 내 838번 줄을:

```typescript
// Before
const memoryPercentHistory = history.map(m => m.memory.usagePercent ?? (m.memory.heapTotal ? (m.memory.heapUsed / m.memory.heapTotal) * 100 : 0));
```

아래로 교체한다:

```typescript
// After
const memoryPercentHistory = history.map(m => m.memory.usagePercent ?? 0);
```

- [ ] **Step 2: 테스트 전체 통과 확인**

```bash
npx vitest run packages/memento-core/src/domains/monitoring/services/__tests__/performance-monitor.spec.ts --reporter=verbose 2>&1 | tail -30
```

Expected: 모든 테스트 PASS (새로 추가한 케이스 포함)

---

### Task 4: 린트 · 타입 체크 · 전체 테스트

**Files:**
- (없음 — 검증만)

- [ ] **Step 1: 타입 체크**

```bash
npm run type-check 2>&1 | tail -20
```

Expected: 에러 없음

- [ ] **Step 2: 린트**

```bash
npm run lint 2>&1 | tail -20
```

Expected: 에러 없음 (경고는 허용)

- [ ] **Step 3: 전체 단위 테스트**

```bash
npm test 2>&1 | tail -20
```

Expected: 모든 테스트 통과

---

### Task 5: 커밋 및 PR 생성

**Files:**
- (없음 — git 작업만)

- [ ] **Step 1: 변경 파일 확인**

```bash
git diff --stat
```

Expected: 두 파일 변경됨 (`performance-monitor.ts`, `performance-monitor.spec.ts`)

- [ ] **Step 2: 커밋**

```bash
git add packages/memento-core/src/domains/monitoring/services/performance-monitor.ts \
        packages/memento-core/src/domains/monitoring/services/__tests__/performance-monitor.spec.ts
git commit -m "fix(monitoring): remove heapUsed/heapTotal dead-code fallback in getMetricsAnalytics

usagePercent is always populated via rss/totalmem since PR #286.
The heapUsed/heapTotal fallback path was never executed and used
the wrong axis — replace with simple usagePercent ?? 0.

Closes #288"
```

- [ ] **Step 3: PR 생성**

```bash
gh pr create \
  --title "fix(monitoring): remove heapUsed/heapTotal dead-code fallback in getMetricsAnalytics" \
  --body "$(cat <<'EOF'
## Summary

- `getMetricsAnalytics()` 838번 줄의 dead code fallback 제거
- PR #286 이후 `usagePercent`는 항상 `rss/totalmem` 기준으로 채워지므로 `heapUsed/heapTotal` fallback은 실행되지 않음
- `usagePercent ?? 0`으로 단순화 (레거시 데이터 대응 포함)

## Test plan

- [ ] 기존 `getMetricsAnalytics()` 테스트 통과 확인
- [ ] `usagePercent` undefined 레거시 케이스 → 0 fallback 테스트 신규 추가
- [ ] `npm run type-check`, `npm run lint`, `npm test` 통과

## 지식 복리

해당 없음 (단순 dead code 제거)

Closes #288

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## 완료 기준

- [ ] `performance-monitor.ts` 838번 줄이 `usagePercent ?? 0`으로 단순화됨
- [ ] 레거시 `usagePercent undefined` 테스트 케이스 추가됨
- [ ] `npm run type-check`, `npm run lint`, `npm test` 모두 통과
- [ ] PR 생성 완료
