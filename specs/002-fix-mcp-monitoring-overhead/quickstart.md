# Quickstart: Fix CPU Monitoring Bug and Reduce MCP Process Overhead

**Feature**: 002-fix-mcp-monitoring-overhead
**Date**: 2026-03-19

---

## 개요

이 기능은 다음 세 가지 개선을 포함합니다:

1. **CPU 경고 오탐 수정**: `process.cpuUsage()` 누적값 기반 계산을 delta 기반으로 수정
2. **배치 간격 최적화**: 헬스체크 30초→5분, 큐 폴링 100ms→1초
3. **DB 경로 일관성**: 기본값을 절대 경로(`~/.memento/memory.db`)로 변경

---

## 환경 변수 변경 사항

### 새로 추가된 변수 (모두 선택적)

```bash
# 성능 경고 임계값
PERF_MEMORY_WARN_PERCENT=85    # 메모리 경고 임계값 (기본: 85%)
PERF_CPU_WARN_PERCENT=75       # CPU 경고 임계값 (기본: 75%)

# 배치 스케줄러 간격
BATCH_HEALTH_CHECK_INTERVAL_MS=300000   # 헬스체크 주기 (기본: 5분)
BATCH_JOB_PROCESSOR_INTERVAL_MS=1000   # 큐 폴링 주기 (기본: 1초)
```

### 기본값이 변경된 변수

```bash
# DB_PATH: 상대 경로 → 절대 경로
# 이전: ./data/memory.db
# 이후: ~/.memento/memory.db
DB_PATH=~/.memento/memory.db   # 기존 값을 유지하려면 명시적으로 설정
```

> **주의**: `DB_PATH`를 기존 `./data/memory.db`로 유지하고 싶다면 `.env`에 명시적으로 설정하세요. 기본값만 변경되며 기존 설정은 그대로 동작합니다.

---

## 마이그레이션 가이드

### 기존 DB 경로 유지 (데이터 이전 없음)

`.env`에 아래를 추가하면 이전 동작을 유지합니다:
```bash
DB_PATH=./data/memory.db
```

### 새 기본 경로로 이전 (권장)

기존 `./data/memory.db`를 새 경로로 복사합니다:
```bash
mkdir -p ~/.memento
cp ./data/memory.db ~/.memento/memory.db
```

이후 `.env`에서 `DB_PATH` 설정을 제거하거나 그대로 두면 새 경로가 사용됩니다.

---

## 검증 방법

### CPU 경고 오탐 확인

MCP 서버를 시작하고 5분간 유휴 상태를 유지합니다. 로그에서 CPU 관련 경고가 없어야 합니다:

```bash
npm run dev 2>&1 | grep -i "cpu"
# 출력: 없어야 함 (유휴 상태에서)
```

### 헬스체크 간격 확인

로그에서 `healthcheck` 항목이 5분(300초) 이상 간격으로 출력되는지 확인합니다:

```bash
npm run dev 2>&1 | grep "healthcheck" | head -5
```

### DB 경로 자동 생성 확인

`DB_PATH`를 존재하지 않는 경로로 설정 후 서버 시작 시 디렉터리가 자동 생성됩니다:

```bash
DB_PATH=/tmp/test-memento/memory.db npm run dev
# /tmp/test-memento/ 디렉터리가 자동 생성됨
```

생성 불가능한 경로 시 오류 후 즉시 종료:

```bash
DB_PATH=/root/no-permission/memory.db npm run dev
# 오류 메시지 출력 후 프로세스 종료
```

---

## 단위 테스트 실행

변경된 파일의 테스트를 개별 실행합니다:

```bash
# PerformanceMonitor 테스트
npx vitest run packages/memento-core/src/domains/monitoring/services/__tests__/performance-monitor.spec.ts

# BatchScheduler 테스트
npx vitest run packages/memento-core/src/infrastructure/scheduler/__tests__/batch-scheduler.spec.ts

# 전체 테스트
npm test
```
