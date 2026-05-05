# 이슈 #266 성능 알림 false positive 수정 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `performance-monitor.ts` 내 메모리 메트릭 축을 `rss/os.totalmem()`으로 교체하고, 로그 레벨 수정 및 알림 자동 해제 로직을 추가해 이슈 #266의 false positive를 제거한다.

**Architecture:** 단일 파일 `packages/memento-core/src/domains/monitoring/services/performance-monitor.ts` 내 **7곳**을 수정한다. 공개 인터페이스 변경 없음. TDD: 실패 테스트 작성 → 구현 → 통과 순으로 진행한다.

**Tech Stack:** TypeScript, Node.js `os` 모듈, Vitest (`vi.spyOn`)

---

## 파일 구조

| 역할 | 경로 |
|---|---|
| 구현 (수정) | `packages/memento-core/src/domains/monitoring/services/performance-monitor.ts` |
| 테스트 (추가) | `packages/memento-core/src/domains/monitoring/services/__tests__/performance-monitor.spec.ts` |

---

## Task 1: 실패 테스트 작성

**Files:**
- Modify: `packages/memento-core/src/domains/monitoring/services/__tests__/performance-monitor.spec.ts`

- [ ] **Step 1: 파일 상단 import 블록에 `os` 와 `logger` 추가**

파일 최상단 import 블록(`import { describe, it, ...` 줄 근처)에 다음 두 줄이 없으면 추가한다:

```typescript
import os from 'os';
import { logger } from '../../../../shared/utils/logger.js';
```

- [ ] **Step 2: 파일 하단에 새 describe 블록 추가**

파일 끝(현재 215번째 줄 이후)에 다음 블록을 추가한다. `os` 모듈을 spyOn으로 제어해 시스템 메모리를 고정한다.

```typescript
describe('PerformanceMonitor 메모리 메트릭 (rss/totalmem 축)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeMonitor(thresholds?: { memoryUsagePercent?: number; cpuUsagePercent?: number }) {
    return new PerformanceMonitor(thresholds);
  }

  it('V8 힙 충전율이 높아도 rss가 낮으면 알림을 생성하지 않는다', async () => {
    // heapUsed/heapTotal = 93.75% (기존 로직에선 알림 발생)
    // rss/totalmem = ~0.37% (새 로직에선 알림 없음)
    const totalMem = 8 * 1024 * 1024 * 1024; // 8GB
    vi.spyOn(os, 'totalmem').mockReturnValue(totalMem);
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 30 * 1024 * 1024,
      heapTotal: 32 * 1024 * 1024,
      heapUsed: 30 * 1024 * 1024,
      external: 0,
      arrayBuffers: 0
    });

    const monitor = makeMonitor({ memoryUsagePercent: 85 });
    await monitor.collectMetrics();

    const alerts = monitor.getActiveAlerts().filter(a => a.type === 'memory');
    expect(alerts).toHaveLength(0);
  });

  it('heapUsed/heapTotal < 85%이지만 rss/totalmem > 85%이면 알림을 생성한다', async () => {
    // heapUsed/heapTotal = 75% (기존 로직에선 미발화)
    // rss/totalmem = 90% (새 로직에선 발화)
    const totalMem = 1024 * 1024 * 1024; // 1GB
    vi.spyOn(os, 'totalmem').mockReturnValue(totalMem);
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: Math.round(totalMem * 0.9),
      heapTotal: Math.round(totalMem * 0.4),
      heapUsed: Math.round(totalMem * 0.3),  // heapUsed/heapTotal = 75%
      external: 0,
      arrayBuffers: 0
    });

    const monitor = makeMonitor({ memoryUsagePercent: 85 });
    await monitor.collectMetrics();

    const alerts = monitor.getActiveAlerts().filter(a => a.type === 'memory');
    expect(alerts.length).toBeGreaterThanOrEqual(1);
  });

  it('os.totalmem()이 0이면 알림을 생성하지 않고 오류도 없다', async () => {
    vi.spyOn(os, 'totalmem').mockReturnValue(0);
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 500 * 1024 * 1024,
      heapTotal: 600 * 1024 * 1024,
      heapUsed: 500 * 1024 * 1024,
      external: 0,
      arrayBuffers: 0
    });

    const monitor = makeMonitor({ memoryUsagePercent: 85 });
    await expect(monitor.collectMetrics()).resolves.not.toThrow();
    const alerts = monitor.getActiveAlerts().filter(a => a.type === 'memory');
    expect(alerts).toHaveLength(0);
  });

  it('memory: 알림 발생 후 조건 해소 시 auto-resolve, 재발생 시 새 알림 생성', async () => {
    const totalMem = 1024 * 1024 * 1024;
    const memMock = vi.spyOn(process, 'memoryUsage');
    vi.spyOn(os, 'totalmem').mockReturnValue(totalMem);
    const monitor = makeMonitor({ memoryUsagePercent: 85 });

    // 1단계: 초과 → 알림 생성
    memMock.mockReturnValue({
      rss: Math.round(totalMem * 0.9),
      heapTotal: totalMem,
      heapUsed: Math.round(totalMem * 0.9),
      external: 0,
      arrayBuffers: 0
    });
    await monitor.collectMetrics();
    expect(monitor.getActiveAlerts().filter(a => a.type === 'memory')).toHaveLength(1);

    // 2단계: 해소 → auto-resolve
    memMock.mockReturnValue({
      rss: Math.round(totalMem * 0.5),
      heapTotal: totalMem,
      heapUsed: Math.round(totalMem * 0.5),
      external: 0,
      arrayBuffers: 0
    });
    await monitor.collectMetrics();
    expect(monitor.getActiveAlerts().filter(a => a.type === 'memory')).toHaveLength(0);

    // 3단계: 재초과 → 새 알림 생성 (dedup 리셋 확인)
    memMock.mockReturnValue({
      rss: Math.round(totalMem * 0.9),
      heapTotal: totalMem,
      heapUsed: Math.round(totalMem * 0.9),
      external: 0,
      arrayBuffers: 0
    });
    await monitor.collectMetrics();
    expect(monitor.getActiveAlerts().filter(a => a.type === 'memory')).toHaveLength(1);
  });

  it('cpu: 알림 발생 후 조건 해소 시 auto-resolve, 재발생 시 새 알림 생성', async () => {
    vi.spyOn(os, 'totalmem').mockReturnValue(8 * 1024 * 1024 * 1024);
    // rss를 낮게 고정해 memory alert가 끼어들지 않게 함
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: 100 * 1024 * 1024,
      heapTotal: 200 * 1024 * 1024,
      heapUsed: 100 * 1024 * 1024,
      external: 0,
      arrayBuffers: 0
    });

    const monitor = makeMonitor({ cpuUsagePercent: 10 });
    // collectMetrics 내부의 checkAlerts 부산물을 제거한 뒤 명시적으로 시나리오를 주입한다
    await monitor.collectMetrics();
    monitor.clearAlerts();

    // 기준 메트릭을 수집해 cpu.percent만 교체하는 베이스로 사용
    const baseMetrics = await monitor.collectMetrics();
    monitor.clearAlerts(); // 위 collectMetrics 부산물도 제거

    const highCpuMetrics = { ...baseMetrics, cpu: { ...baseMetrics.cpu, percent: 80 } };
    const lowCpuMetrics  = { ...baseMetrics, cpu: { ...baseMetrics.cpu, percent: 5  } };

    // 1단계: 초과 → 알림 생성
    await (monitor as any).checkAlerts(highCpuMetrics);
    expect(monitor.getActiveAlerts().filter(a => a.type === 'cpu')).toHaveLength(1);

    // 2단계: 해소 → auto-resolve
    await (monitor as any).checkAlerts(lowCpuMetrics);
    expect(monitor.getActiveAlerts().filter(a => a.type === 'cpu')).toHaveLength(0);

    // 3단계: 재발화 → 새 알림 생성 (dedup 리셋 확인)
    await (monitor as any).checkAlerts(highCpuMetrics);
    expect(monitor.getActiveAlerts().filter(a => a.type === 'cpu')).toHaveLength(1);
  });

  it('critical alert는 logger.warn을 사용하고 logger.error를 사용하지 않는다', async () => {
    const warnSpy = vi.spyOn(logger, 'warn');
    const errorSpy = vi.spyOn(logger, 'error');

    const totalMem = 1024 * 1024 * 1024;
    vi.spyOn(os, 'totalmem').mockReturnValue(totalMem);
    vi.spyOn(process, 'memoryUsage').mockReturnValue({
      rss: Math.round(totalMem * 0.95), // 95% > 90% → critical severity
      heapTotal: totalMem,
      heapUsed: Math.round(totalMem * 0.95),
      external: 0,
      arrayBuffers: 0
    });

    const monitor = makeMonitor({ memoryUsagePercent: 85 });
    await monitor.collectMetrics();

    const criticalWarnCalls = warnSpy.mock.calls.filter(
      args => args[0] === 'Critical performance alert handling'
    );
    const criticalErrorCalls = errorSpy.mock.calls.filter(
      args => args[0] === 'Critical performance alert handling'
    );

    expect(criticalWarnCalls.length).toBeGreaterThanOrEqual(1);
    expect(criticalErrorCalls).toHaveLength(0);
  });
});
```

- [ ] **Step 3: 테스트 실행 — 실패 확인**

```bash
npx vitest run packages/memento-core/src/domains/monitoring/services/__tests__/performance-monitor.spec.ts --reporter=verbose 2>&1 | tail -50
```

기대 결과:
- `'V8 힙 충전율이 높아도...'` → **FAIL** (현재 heapUsed/heapTotal 기준이므로 알림이 생성됨)
- `'heapUsed/heapTotal < 85%이지만 rss/totalmem > 85%이면...'` → **FAIL** (현재는 heapUsed/heapTotal=75%로 미발화)
- `'logger.warn을 사용하고...'` → **FAIL** (현재 logger.error 사용)
- 나머지(totalmem=0, auto-resolve) → 결과 무관, 구현 후 검증

- [ ] **Step 4: 커밋 (실패 테스트 커밋)**

```bash
git add packages/memento-core/src/domains/monitoring/services/__tests__/performance-monitor.spec.ts
git commit -m "test: add failing tests for rss-based memory metric and auto-resolve (#266)"
```

---

## Task 2: 메모리 메트릭 교체 구현

**Files:**
- Modify: `packages/memento-core/src/domains/monitoring/services/performance-monitor.ts`

참조 라인: `collectMetrics()` ~line 135, `checkAlerts()` ~line 185, 알림 메시지 ~line 199, `handleCriticalAlert()` ~line 956-959

- [ ] **Step 1: `collectMetrics()` 내 `usagePercent` 계산 교체 (line ~135)**

현재 코드:
```typescript
const memoryUsagePercent = memUsage.heapTotal > 0 ? (memUsage.heapUsed / memUsage.heapTotal) * 100 : 0;
```

교체:
```typescript
const totalSystemMemory = os.totalmem();
const memoryUsagePercent = totalSystemMemory > 0 ? (memUsage.rss / totalSystemMemory) * 100 : 0;
```

- [ ] **Step 2: `checkAlerts()` 내 메모리 계산 교체 (line ~185)**

현재 코드:
```typescript
const memoryUsagePercent = (metrics.memory.heapUsed / metrics.memory.heapTotal) * 100;
```

교체:
```typescript
const totalSystemMemory = os.totalmem();
const memoryUsagePercent = totalSystemMemory > 0
  ? (metrics.memory.rss / totalSystemMemory) * 100
  : 0;
```

- [ ] **Step 3: 알림 메시지 본문 교체 (line ~199)**

현재 코드:
```typescript
message: `High memory usage: ${memoryUsagePercent.toFixed(1)}% (${this.formatBytes(metrics.memory.heapUsed)}/${this.formatBytes(metrics.memory.heapTotal)})`,
```

교체 (`totalSystemMemory`는 Step 2에서 이미 선언된 변수):
```typescript
message: `High memory usage: ${memoryUsagePercent.toFixed(1)}% RSS (${this.formatBytes(metrics.memory.rss)} / ${this.formatBytes(totalSystemMemory)})`,
```

- [ ] **Step 4: `handleCriticalAlert()` 로그 레벨 + payload 교체 (line ~956-959)**

현재 코드:
```typescript
logger.error('Critical performance alert handling', {
  alert,
  metrics: {
    memoryUsage: (metrics.memory.heapUsed / metrics.memory.heapTotal) * 100,
    dbSize: metrics.database.size / (1024 * 1024),
    queryTime: metrics.database.queryTime
  }
});
```

교체:
```typescript
const _totalMem = os.totalmem();
logger.warn('Critical performance alert handling', {
  alert,
  metrics: {
    memoryUsage: alert.type === 'memory'
      ? alert.value
      : (_totalMem > 0 ? (metrics.memory.rss / _totalMem) * 100 : 0),
    dbSize: metrics.database.size / (1024 * 1024),
    queryTime: metrics.database.queryTime
  }
});
```

`alert.value`를 우선 사용해 알림 발화 기준값과 로그가 완전히 일치하도록 한다. 비메모리 타입에서 `totalmem === 0`이면 `0`을 사용해 `Infinity` 노출을 방지한다.

- [ ] **Step 5: 테스트 실행 — 진전 확인**

```bash
npx vitest run packages/memento-core/src/domains/monitoring/services/__tests__/performance-monitor.spec.ts --reporter=verbose 2>&1 | tail -50
```

기대 결과:
- `'V8 힙 충전율이 높아도...'` → **PASS**
- `'heapUsed/heapTotal < 85%이지만 rss/totalmem > 85%...'` → **PASS**
- `'logger.warn을 사용하고...'` → **PASS**
- auto-resolve 테스트 2개 → 아직 FAIL (Task 3에서 구현)
- 기존 테스트 → **PASS** (변경 없음)

- [ ] **Step 6: 커밋**

```bash
git add packages/memento-core/src/domains/monitoring/services/performance-monitor.ts
git commit -m "fix(monitoring): replace heapUsed/heapTotal with rss/os.totalmem() and warn on critical alert (#266)"
```

---

## Task 3: 알림 자동 해제 (auto-resolve) 구현

**Files:**
- Modify: `packages/memento-core/src/domains/monitoring/services/performance-monitor.ts`

`checkAlerts()` 메서드 내에 추가.

- [ ] **Step 1: memory 알림 생성 블록 앞에 auto-resolve 추가**

`checkAlerts()` 내에서 `if (memoryUsagePercent > this.thresholds.memoryUsagePercent)` 블록 **바로 앞**에 삽입:

```typescript
if (memoryUsagePercent <= this.thresholds.memoryUsagePercent) {
  const existing = Array.from(this.alerts.values())
    .find(a => a.type === 'memory' && !a.resolved);
  if (existing) this.resolveAlert(existing.id);
}
```

- [ ] **Step 2: CPU 알림 생성 블록 앞에 auto-resolve 추가**

`checkAlerts()` 내에서 `if (cpuUsagePercent > this.thresholds.cpuUsagePercent)` 블록 **바로 앞**에 삽입:

```typescript
if (cpuUsagePercent <= this.thresholds.cpuUsagePercent) {
  const existing = Array.from(this.alerts.values())
    .find(a => a.type === 'cpu' && !a.resolved);
  if (existing) this.resolveAlert(existing.id);
}
```

- [ ] **Step 3: 전체 테스트 실행 — 모든 케이스 통과 확인**

```bash
npx vitest run packages/memento-core/src/domains/monitoring/services/__tests__/performance-monitor.spec.ts --reporter=verbose 2>&1 | tail -50
```

기대 결과: 신규 6개 + 기존 테스트 전체 **PASS**

- [ ] **Step 4: 커밋**

```bash
git add packages/memento-core/src/domains/monitoring/services/performance-monitor.ts
git commit -m "fix(monitoring): auto-resolve memory/cpu alerts when condition clears (#266)"
```

---

## Task 4: 전체 검증

- [ ] **Step 1: 모니터링 도메인 전체 테스트**

```bash
npx vitest run packages/memento-core/src/domains/monitoring/ --reporter=verbose 2>&1 | tail -30
```

기대 결과: 전체 PASS

- [ ] **Step 2: core 패키지 전체 CI 테스트**

```bash
npm run test:ci:core 2>&1 | tail -20
```

기대 결과: 에러 없음

- [ ] **Step 3: 타입 체크**

```bash
cd packages/memento-core && npx tsc --noEmit 2>&1 | head -20
cd ../..
```

기대 결과: 에러 없음

---

## 완료 기준

- [ ] `npx vitest run packages/memento-core/src/domains/monitoring/` 전체 PASS
- [ ] `logger.error` → `logger.warn` 전환 확인:
  ```bash
  grep -n "logger\.error.*Critical performance" packages/memento-core/src/domains/monitoring/services/performance-monitor.ts
  ```
  기대 결과: 출력 없음
- [ ] 수정 대상 3곳에서 `heapUsed/heapTotal` 잔존 없음:
  ```bash
  sed -n '130,145p' packages/memento-core/src/domains/monitoring/services/performance-monitor.ts | grep "heapUsed.*heapTotal"
  sed -n '180,210p' packages/memento-core/src/domains/monitoring/services/performance-monitor.ts | grep "heapUsed.*heapTotal"
  sed -n '950,970p' packages/memento-core/src/domains/monitoring/services/performance-monitor.ts | grep "heapUsed.*heapTotal"
  ```
  기대 결과: 모두 출력 없음 (line 823의 analytics 코드는 이번 PR 범위 밖이므로 무관)
- [ ] 타입 에러 없음

---

## 범위 밖 (이번 PR에 포함하지 않음)

- `getMemoryMetrics()` (line ~544)의 `const totalMemory = 1024 * 1024 * 1024` 하드코딩 → 별도 이슈
- `getMetricsAnalytics()` (line ~823)의 `heapUsed/heapTotal` 사용 → 별도 이슈
- database/query 타입 알림 auto-resolve → 별도 이슈
