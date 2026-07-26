# Implementation Plan: Issue #697

**Branch**: `fix/697-performance-alert-noise`  
**Spec**: `specs/052-fix-performance-alert-noise/spec.md`

## Architecture

변경은 `PerformanceAlertManager`에 집중한다. `PerformanceMonitor`는 기존처럼 manager에 위임만 한다.

```
collectMetrics → checkAlerts(metrics)
  → PerformanceAlertManager.checkAlerts
       thresholds.databaseSizeMB ← PERF_DATABASE_WARN_MB (default 500)
       resolve → lastResolvedAtByType[type] = now
       create  → skip if now - lastResolved < alertRearmMs
       log     → warning→info / critical→warn
       emit    → alertNotificationService (unchanged)
```

## File Changes

| File | Change |
|------|--------|
| `performance-monitor-types.ts` | `AlertThresholds`에 `alertRearmMs` 추가; `databaseSizeMB` 기본 주석 500 |
| `performance-alert-manager.ts` | env 임계값·rearm·로그 레벨 분기 |
| `environment.ts` | `PERF_DATABASE_WARN_MB`, `PERF_ALERT_REARM_MS` defaults |
| `env.example` | 주석 추가 |
| `performance-monitor.spec.ts` | US1–US3 테스트; 기존 재발화 케이스에 `alertRearmMs: 0` |
| `CHANGELOG.md` | Unreleased Fixed |
| `specs/052-fix-performance-alert-noise/*` | Spec Kit 산출물 |

## Test Strategy

- Red: warning→info, default 500, rearm skip, rearm=0 회귀
- Green: manager 구현
- Domain: `npm test -- packages/memento-core/src/domains/monitoring/services/__tests__/performance-monitor.spec.ts`
- Gates: `lint`, `type-check`

## Risks

- 기본 `databaseSizeMB` 100→500은 동작 변경이지만 운영 노이즈 제거가 목적. 엄격한 모니터링은 env로 100 유지 가능.
- `alertRearmMs` 기본 30분은 critical CPU 재알림을 늦춘다. `PERF_ALERT_REARM_MS=0`으로 비활성 가능.
