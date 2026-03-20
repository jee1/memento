# Data Model: Fix CPU Monitoring Bug and Reduce MCP Process Overhead

**Phase**: 1 — Design
**Date**: 2026-03-19

이 기능은 신규 데이터베이스 스키마를 추가하지 않습니다. 변경 사항은 기존 클래스의 내부 상태(private 필드)와 환경 변수 설정에 국한됩니다.

---

## 변경되는 상태 모델

### PerformanceMonitor (수정)

**위치**: `packages/memento-core/src/domains/monitoring/services/performance-monitor.ts`

#### 추가되는 private 필드

```
previousCpuUsage: NodeJS.CpuUsage | null
  - 설명: 직전 collectMetrics() 호출 시점의 process.cpuUsage() 스냅샷
  - 초기값: null (첫 번째 호출 식별용)
  - 갱신 시점: collectMetrics() 호출마다 갱신

previousMeasurementTime: number | null
  - 설명: 직전 collectMetrics() 호출 시점의 Date.now() 값 (ms)
  - 초기값: null
  - 갱신 시점: previousCpuUsage와 동시에 갱신
```

#### 수정되는 필드 (기존)

```
thresholds.memoryUsagePercent: number
  - 현재: 하드코딩 80
  - 변경 후: 환경 변수 PERF_MEMORY_WARN_PERCENT로 주입, 기본값 85

thresholds.cpuUsagePercent: number
  - 현재: 하드코딩 70
  - 변경 후: 환경 변수 PERF_CPU_WARN_PERCENT로 주입, 기본값 75
```

#### CPU 사용률 계산 상태 전이

```
[초기 상태]
  previousCpuUsage = null
  previousMeasurementTime = null
       │
       ▼ collectMetrics() 첫 번째 호출
[기준점 설정]
  previousCpuUsage = process.cpuUsage()
  previousMeasurementTime = Date.now()
  반환값: 0% (경고 미발생)
       │
       ▼ collectMetrics() 이후 호출마다
[Delta 계산]
  ∆cpu = current - previous (µs)
  ∆time = (now - prevTime) × 1000 (µs)
  percent = (∆cpu / ∆time) × 100
  → clamp [0, 100]
  → 임계값 초과 시 경고 생성
  previousCpuUsage = current
  previousMeasurementTime = now
```

---

### BatchScheduler (수정)

**위치**: `packages/memento-core/src/infrastructure/scheduler/batch-scheduler.ts`

#### 기본값 변경

```
BatchJobConfig.healthCheckInterval
  - 현재: 30,000ms (30초)
  - 변경 후: 300,000ms (5분)
  - 환경 변수: BATCH_HEALTH_CHECK_INTERVAL_MS

jobProcessorInterval (setInterval 내부 상수)
  - 현재: 100ms
  - 변경 후: 1,000ms (1초)
  - 환경 변수: BATCH_JOB_PROCESSOR_INTERVAL_MS
```

---

### 환경 변수 (신규 추가)

**위치**: `packages/memento-core/src/shared/config/environment.ts`의 `ENV_DEFAULTS`

```
PERF_MEMORY_WARN_PERCENT
  - 타입: 정수 (0-100)
  - 기본값: "85"
  - 의미: 메모리(heapUsed/heapTotal) 경고 발생 임계값 (%)
  - 유효성: 1~100 정수; 범위 이탈 시 경고 로그 + 기본값 적용

PERF_CPU_WARN_PERCENT
  - 타입: 정수 (0-100)
  - 기본값: "75"
  - 의미: CPU 사용률 경고 발생 임계값 (%)
  - 유효성: 1~100 정수; 범위 이탈 시 경고 로그 + 기본값 적용

BATCH_HEALTH_CHECK_INTERVAL_MS
  - 타입: 정수 (≥ 10,000)
  - 기본값: "300000"
  - 의미: 헬스체크 실행 주기 (ms)
  - 유효성: 10,000 미만이면 경고 로그 + 기본값 적용

BATCH_JOB_PROCESSOR_INTERVAL_MS
  - 타입: 정수 (≥ 100)
  - 기본값: "1000"
  - 의미: 작업 큐 폴링 주기 (ms)
  - 유효성: 100 미만이면 경고 로그 + 기본값 적용

DB_PATH (기존, 기본값 변경)
  - 타입: 문자열 (파일 경로)
  - 기존 기본값: "./data/memory.db"
  - 새 기본값: "${os.homedir()}/.memento/memory.db" (런타임 해석)
  - 동작: 디렉터리 미존재 시 자동 생성; 생성 실패 시 서버 시작 중단
```

---

## 변경 없는 영역

- SQLite 스키마: 변경 없음 (마이그레이션 불필요)
- MCP 도구 스키마: 변경 없음 (`remember`, `recall` 등 11개 도구 인터페이스 유지)
- HTTP Admin API 엔드포인트: 변경 없음
- 외부 의존성: 신규 패키지 추가 없음 (`os` 모듈은 Node.js 내장)
