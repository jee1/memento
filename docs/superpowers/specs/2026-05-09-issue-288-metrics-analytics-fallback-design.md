# Issue #288: getMetricsAnalytics() fallback 제거

**날짜:** 2026-05-09  
**이슈:** [#288](https://github.com/jee1lee/memento/issues/288)  
**라벨:** bug

## 문제

`performance-monitor.ts`의 `getMetricsAnalytics()` (838번 줄)에 dead code fallback이 존재한다:

```typescript
const memoryPercentHistory = history.map(m =>
  m.memory.usagePercent ?? (m.memory.heapTotal ? (m.memory.heapUsed / m.memory.heapTotal) * 100 : 0)
);
```

PR #286 이후 `m.memory.usagePercent`는 항상 `rss/totalmem` 기준으로 채워지므로, `??` 이후의 `heapUsed/heapTotal` fallback은 실행되지 않는다. 잘못된 축(heap 기준)의 dead code가 혼선을 유발한다.

## 설계

### 변경 파일

`packages/memento-core/src/domains/monitoring/services/performance-monitor.ts`

### 변경 내용

838번 줄을 단순화한다:

```typescript
// Before
const memoryPercentHistory = history.map(m =>
  m.memory.usagePercent ?? (m.memory.heapTotal ? (m.memory.heapUsed / m.memory.heapTotal) * 100 : 0)
);

// After
const memoryPercentHistory = history.map(m => m.memory.usagePercent ?? 0);
```

`usagePercent`가 undefined인 경우(레거시 데이터) 0으로 fallback한다. 실제 운영에서는 발생하지 않지만 타입 안전성을 위해 유지한다.

### 스코프 외 항목

- 762번 줄의 `heapUsed` trend 계산은 별도 이슈로 처리

## 테스트 전략

기존 `getMetricsAnalytics()` 테스트에서:
1. `usagePercent`가 채워진 경우 — 기존 동작과 동일한 결과 반환
2. `usagePercent`가 undefined인 레거시 데이터 — 0으로 fallback

## 구현 계획

1. 워크트리 생성: `fix/issue-288-metrics-fallback`
2. 838번 줄 단순화
3. 기존 테스트 통과 확인 + 신규 테스트 케이스 추가(필요 시)
4. PR 생성
