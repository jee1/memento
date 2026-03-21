# Research: Fix CPU Monitoring Bug and Reduce MCP Process Overhead

**Phase**: 0 — Outline & Research
**Date**: 2026-03-19
**Feature**: 002-fix-mcp-monitoring-overhead

---

## Decision 1: CPU 사용률 측정 방식

**Decision**: 클래스 필드에 이전 측정 기준점을 저장하는 delta 기반 측정 방식 채택

**Rationale**:
`process.cpuUsage()`는 프로세스 시작부터 누적된 CPU 시간(마이크로초)을 반환한다.
올바른 백분율 계산은 두 측정 시점의 CPU delta를 경과한 wall-clock 시간으로 나눠야 한다:

```
CPU% = (∆user_µs + ∆system_µs) / (wallClock_ms × 1000) × 100
```

첫 번째 호출은 기준점만 저장하고 0을 반환한다 (경고 없음).
elapsed time = 0이면 0을 반환한다 (divide-by-zero 방지).
결과는 `Math.max(0, Math.min(100, result))`로 클램프한다.

`PerformanceMonitor` 클래스에 두 개의 private 필드를 추가한다:
- `previousCpuUsage: NodeJS.CpuUsage | null`
- `previousMeasurementTime: number | null`

**Alternatives considered**:
- `process.cpuUsage(previousUsage)`: Node.js가 delta를 직접 반환하는 패턴 — 동일한 결과이나 외부에서 이전값을 전달해야 해 클래스 캡슐화에 불리함.
- Closure 패턴: 기능적으로 동일하나 클래스 구조에 이질적.
- CPU 코어 수(os.cpus().length)로 정규화: 선택적으로 적용. 단일 프로세스가 단일 코어 기준으로 얼마나 쓰는지 보는 것이 모니터링 목적에 더 직관적이므로 정규화 없이 단일 코어 기준 % 사용.

---

## Decision 2: 헬스체크 및 작업 큐 폴링 기본값

**Decision**: 헬스체크 5분(300,000ms), 큐 폴링 1초(1,000ms)

**Rationale**:
- 헬스체크 5분: 기존 `monitoringInterval`(5분)과 동일하게 맞춰 로그 패턴이 예측 가능해짐. 장애 감지 지연 최대 5분은 운영상 허용 가능 (Assumptions 참조).
- 큐 폴링 1초: 대부분의 배치 작업 단위가 1시간~24시간. 1초 폴링으로 충분히 반응적이며, 기존 100ms 대비 CPU 폴링 횟수를 10배 절감.

**Alternatives considered**:
- 헬스체크 2분 / 폴링 500ms: 최소 변경이지만 모니터링 간격과 불일치.
- 헬스체크 10분 / 폴링 2초: 최대 절감이나 장애 감지 지연 과도.

---

## Decision 3: DB_PATH 기본값

**Decision**: `~/.memento/memory.db` (Node.js에서 `os.homedir() + '/.memento/memory.db'`)

**Rationale**:
- 사용자 홈 디렉터리 하위의 고정 절대 경로로, 어느 디렉터리에서 MCP 서버를 실행해도 동일한 DB에 접근한다.
- `~/.memento/` 디렉터리가 없으면 서버 시작 시 `fs.mkdirSync(dir, { recursive: true })`로 자동 생성한다.
- 생성 실패 시(권한 없음, 디스크 꽉 참) 오류 메시지와 함께 `process.exit(1)` 또는 예외를 throw해 서버 시작을 중단한다.

**Alternatives considered**:
- XDG Base Directory (`~/.local/share/memento/`): 표준이지만 사용자 친화성이 낮고 인지하기 어렵다.
- `./data/memory.db` 유지: 기존 문제(실행 위치 의존) 해소 불가.

---

## Decision 4: 환경 변수 유효성 검사

**Decision**: 유효하지 않은 값 → 경고 로그 출력 + 기본값으로 대체하여 서버 정상 기동

**Rationale**:
- DB_PATH 실패(FR-006)와 달리 임계값/간격은 기본값으로도 정상 동작 가능.
- 서버 시작을 막으면 환경 변수 오타 하나가 MCP 서버 전체를 중단시킬 수 있어 운영 안정성이 낮아짐.
- 경고 로그에 변수명과 입력값을 포함시켜 운영자가 즉시 인지·수정 가능.

**유효하지 않은 값 기준**:
- 숫자가 아닌 문자열 (NaN)
- 0 이하 값 (간격은 최솟값 이상이어야 함)
- 퍼센트값이 0~100 범위를 벗어남

---

## Decision 5: 영향 범위 — MCP 노출 도구 변경 없음

**Decision**: 이 기능은 MCP 도구 스키마를 변경하지 않는다. 내부 스케줄러·모니터 설정만 수정한다.

**Rationale**:
- `BatchScheduler`, `PerformanceMonitor`, `environment.ts`는 모두 `memento-core` 내부 구현체.
- 새 환경 변수는 기존 env var 패턴과 일관되게 추가 (`environment.ts` `ENV_DEFAULTS` 및 `resolveNumber`/`resolveBoolean` 사용).
- 하위 호환성: 기존 `DB_PATH` 환경 변수를 명시적으로 설정한 사용자는 영향 없음.

---

## 영향 파일 목록

| 파일 | 변경 유형 | 내용 |
|------|-----------|------|
| `packages/memento-core/src/domains/monitoring/services/performance-monitor.ts` | 수정 | CPU delta 계산 방식 수정, 임계값 env var 적용 |
| `packages/memento-core/src/infrastructure/scheduler/batch-scheduler.ts` | 수정 | healthCheckInterval 기본값 5분, jobProcessorInterval 1초 |
| `packages/memento-core/src/shared/config/environment.ts` | 수정 | DB_PATH 기본값 변경, 신규 env var 5개 추가 |
| `packages/memento-core/src/bootstrap.ts` | 수정 | DB 디렉터리 자동 생성 + 실패 시 서버 중단 |

테스트 파일 (신규 or 수정):
| 파일 | 유형 |
|------|------|
| `packages/memento-core/src/domains/monitoring/services/__tests__/performance-monitor.spec.ts` | 수정 |
| `packages/memento-core/src/infrastructure/scheduler/__tests__/batch-scheduler.spec.ts` | 수정 |
