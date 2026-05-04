# 설계: 이슈 #266 — 성능 알림 false positive 수정

**날짜**: 2026-05-04  
**브랜치**: fix/issue-266-perf-alert-false-positive  
**변경 파일**: `packages/memento-core/src/domains/monitoring/services/performance-monitor.ts`

---

## 문제 요약

운영 로그 모니터가 `logger.error('Critical performance alert handling')` 호출을 감지해 이슈 #266을 자동 생성했다. 총 7회 발생(2026-05-03 ~ 05-04), 각 발생은 서버 재시작 직후 첫 번째 성능 점검 사이클에서 triggered.

로그에 기록된 메모리 사용률 93~95%는 **실제 시스템 메모리 압박이 아닌 V8 힙 충전율**이다. 실제 RSS는 30~72MB 수준으로 시스템 전체 메모리 대비 무시할 수 있는 수준이다.

---

## 근본 원인

### 원인 1 (핵심): 잘못된 메모리 메트릭 축

`checkAlerts()` 내부에서 사용하는 메트릭:

```typescript
// performance-monitor.ts line 185
const memoryUsagePercent = (metrics.memory.heapUsed / metrics.memory.heapTotal) * 100;
```

`heapTotal`은 V8이 현재 할당한 힙 크기이지 시스템 전체 메모리가 아니다. V8 GC는 컴팩션 후 `heapTotal`을 줄이므로, 실제 메모리는 충분해도 `heapUsed/heapTotal` 비율이 93%+ 로 급등한다.

실증:
- 신선한 Node.js 프로세스: `heapUsed/heapTotal = 67.3%`, `heapUsed/totalmem = 0.01%`
- 이슈 로그: 30MB/32MB = 93.8% — 시스템 관점에서는 정상

### 원인 2: 모니터링 이벤트에 `logger.error` 사용

`handleCriticalAlert()`이 성능 경보를 `logger.error`로 기록한다. 운영 로그 모니터는 `error` 레벨을 애플리케이션 장애로 분류해 이슈를 자동 생성한다.

```typescript
// performance-monitor.ts line 956
logger.error('Critical performance alert handling', { alert, metrics });
```

### 원인 3: 알림 자동 해제 없음 + 재시작 시 dedup 초기화

알림 Map이 인메모리라서 서버 재시작 시 초기화된다. 조건이 해소되어도 알림이 `resolved: false`로 영구 잔존하므로, 재시작마다 dedup이 리셋되어 새 경보가 발화된다.

---

## 설계

### 변경 범위

**단 1개 파일**: `packages/memento-core/src/domains/monitoring/services/performance-monitor.ts`

새 파일 없음. 공개 인터페이스(`PerformanceMetrics`, `AlertThresholds`, `PerformanceAlert`) 변경 없음.

---

### 변경 1: 메모리 메트릭 → `rss / os.totalmem()`

`checkAlerts()` 내 메모리 계산을 실제 시스템 메모리 기준으로 교체한다.

```typescript
// 변경 전 (line ~185)
const memoryUsagePercent = (metrics.memory.heapUsed / metrics.memory.heapTotal) * 100;

// 변경 후
const totalSystemMemory = os.totalmem();  // os는 이미 import됨
const memoryUsagePercent = totalSystemMemory > 0
  ? (metrics.memory.rss / totalSystemMemory) * 100
  : 0;
```

`metrics.memory.rss`는 `collectMetrics()`에서 이미 수집되므로 추가 syscall 없음.

---

### 변경 2: `logger.error` → `logger.warn`

`handleCriticalAlert()` 내 로그 레벨을 내려 로그 모니터가 이슈를 생성하지 않도록 한다.

```typescript
// 변경 전 (line ~956)
logger.error('Critical performance alert handling', { alert, metrics: { ... } });

// 변경 후
logger.warn('Critical performance alert handling', { alert, metrics: { ... } });
```

경보 자체의 처리 로직(GC 트리거, DB VACUUM)은 그대로 유지한다.

---

### 변경 3: 조건 해소 시 알림 자동 해제

`checkAlerts()` 에서 각 타입별로, 임계값 이하일 때 기존 활성 알림을 resolve한다. dedup이 재시작 없이도 자연히 리셋된다.

```typescript
// 메모리 체크 앞에 추가
if (memoryUsagePercent <= this.thresholds.memoryUsagePercent) {
  const existing = Array.from(this.alerts.values())
    .find(a => a.type === 'memory' && !a.resolved);
  if (existing) this.resolveAlert(existing.id);
}

// CPU 체크 앞에 추가 (동일 패턴)
if (cpuUsagePercent <= this.thresholds.cpuUsagePercent) {
  const existing = Array.from(this.alerts.values())
    .find(a => a.type === 'cpu' && !a.resolved);
  if (existing) this.resolveAlert(existing.id);
}
```

---

## 데이터 플로우 (변경 후)

```
BatchScheduler (60초 주기)
  → collectMetrics({ tick: true })
      memory.rss 수집 (기존)
    → checkAlerts(metrics)
        memoryUsagePercent = rss / os.totalmem()   ← 새 축
        조건 해소 → resolveAlert(existing)          ← 새 로직
        조건 초과 → createAlert (dedup 통과 시)
          severity=critical → handleCriticalAlert()
            → logger.warn(...)                      ← error → warn
            → if memory: global.gc() 시도 (유지)
```

---

## 테스트 전략

기존 테스트 파일: `packages/memento-core/src/domains/monitoring/services/__tests__/performance-alert-service.spec.ts`

추가할 케이스:

| 케이스 | 입력 | 기대 결과 |
|---|---|---|
| V8 힙 충전율 높음, rss 낮음 | heapUsed/heapTotal=93%, rss=30MB, totalmem=8GB | 알림 없음 |
| 실제 RSS 압박 | rss/totalmem > 85% | 알림 생성 |
| 조건 해소 | 기존 메모리 알림 존재 → 다음 점검에서 rss 정상 | 알림 auto-resolve |
| critical 처리 로그 레벨 | critical alert 발생 | `logger.warn` 호출, `logger.error` 미호출 |

---

## 기대 효과

- 이슈 #266 형태의 false positive 에러 로그 제거
- 실제 RSS 기반 메모리 경보로 더 의미 있는 알림
- 서버 재시작 없이 조건 해소 시 dedup 자동 리셋
- 공개 인터페이스 및 기존 기능 100% 유지
