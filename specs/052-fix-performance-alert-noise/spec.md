# Feature Specification: Performance alert WARN 노이즈 완화

**Feature Branch**: `fix/697-performance-alert-noise`  
**Created**: 2026-07-26  
**Issue**: [#697](https://github.com/jee1/memento/issues/697) — App warning: Performance alert generated  
**Status**: Active  
**Related**: #266 (heap false positive·error→warn), #551/#653 (log-monitor WARN 노이즈 완화 선례)

## Problem

운영 `log-issue-monitor`가 `Performance alert generated` WARN을 47회 집계해 이슈 #697을 승격했다. 최근 로그는 주로:

- `type=database` — DB 크기 120~154MB (하드코드 임계값 100MB 초과)
- `type=cpu` — 사용률 100% (임계값 75% 초과, severity critical)

알림 자체는 대시보드·`alertNotificationService`로 관측 가능해야 하지만, **예상 가능한 운영 조건**마다 동일 메시지로 `logger.warn`이 반복되면 warnThreshold 승격으로 GitHub 이슈 노이즈가 된다. #266에서 memory 축·error→warn은 이미 고쳤고, 이번 범위는 database/cpu 재발화와 로그 레벨이다.

## User Scenarios & Testing

### User Story 1 — warning 심각도는 log-monitor에 승격되지 않음 (P1)

warning severity 성능 알림은 INFO로 기록하고, critical만 WARN으로 남긴다.

**Why this priority**: log-issue-monitor는 `warn`/`error`만 감지한다. warning→info만으로 DB 크기 warning 반복 승격을 끊을 수 있다.

**Independent Test**: DB 크기 warning 알림 생성 시 `logger.info('Performance alert generated')`만 호출되고 `logger.warn`은 해당 메시지에 대해 호출되지 않는다.

**Acceptance Scenarios**:

1. **Given** DB 크기가 warning 임계만 초과, **When** `checkAlerts` 실행, **Then** `Performance alert generated`는 INFO, WARN 아님.
2. **Given** CPU가 critical 임계 초과, **When** `checkAlerts` 실행, **Then** `Performance alert generated`는 WARN.

---

### User Story 2 — DB 크기 임계값을 운영에서 조정 가능 (P1)

`PERF_DATABASE_WARN_MB`로 DB 알림 임계값을 설정하고, 기본값을 메모리 서버에 맞게 상향한다 (100 → 500).

**Why this priority**: 운영 DB가 이미 100MB를 상시 초과한다. 재시작마다 warning 알림이 재발화된다.

**Independent Test**: env 미설정 시 기본 500; `PERF_DATABASE_WARN_MB=200`이면 200 사용.

**Acceptance Scenarios**:

1. **Given** env 없음, **When** `PerformanceAlertManager` 생성, **Then** `databaseSizeMB === 500`.
2. **Given** `PERF_DATABASE_WARN_MB=200`, **When** 생성, **Then** `databaseSizeMB === 200`.
3. **Given** DB 150MB·기본 임계값, **When** `checkAlerts`, **Then** database 알림 없음.

---

### User Story 3 — resolve 후 동일 타입 즉시 재발화 억제 (P2)

알림이 resolve된 뒤 `PERF_ALERT_REARM_MS`(기본 30분) 동안 동일 타입의 새 알림을 만들지 않는다.

**Why this priority**: CPU는 조건 해소→재초과 플랩으로 WARN이 반복된다. 쿨다운으로 critical WARN 빈도도 낮춘다.

**Independent Test**: `alertRearmMs > 0`일 때 high→low→high 사이클에서 두 번째 high는 알림을 만들지 않는다. `alertRearmMs === 0`이면 기존처럼 재생성.

**Acceptance Scenarios**:

1. **Given** rearm 30분·CPU 알림 resolve 직후, **When** 다시 고부하, **Then** 새 CPU 알림 없음.
2. **Given** `alertRearmMs: 0`, **When** 동일 사이클, **Then** 새 CPU 알림 1개 (기존 회귀).

## Requirements

- **FR-001**: `Performance alert generated` — `severity === 'warning'` → `logger.info`, `critical` → `logger.warn`.
- **FR-002**: `PERF_DATABASE_WARN_MB` (기본 500, 범위 ≥1)로 `databaseSizeMB` 설정.
- **FR-003**: resolve 시 타입별 시각 기록; `PERF_ALERT_REARM_MS`(기본 1_800_000) 내 동일 타입 재생성 스킵.
- **FR-004**: `alertNotificationService`·대시보드 알림 객체 생성 경로는 유지(로그 레벨·재무장만 변경).
- **FR-005**: `env.example`·`ENV_DEFAULTS`·CHANGELOG 갱신.

## Out of Scope

- CPU 측정 알고리즘 변경 (`CpuUsageTracker`)
- log-issue-monitor fingerprint/ignore 규칙 변경
- 알림 상태 디스크 영속화
- memory/query 임계값 기본값 변경

## Success Criteria

- #697과 동일 fingerprint의 warning 반복 승격이 코드 경로상 중단됨
- 관련 Vitest·lint·type-check 통과
- CHANGELOG Unreleased Fixed 항목 추가
