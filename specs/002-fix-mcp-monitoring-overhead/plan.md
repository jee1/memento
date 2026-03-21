# Implementation Plan: Fix CPU Monitoring Bug and Reduce MCP Process Overhead

**Branch**: `002-fix-mcp-monitoring-overhead` | **Date**: 2026-03-19 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-fix-mcp-monitoring-overhead/spec.md`

## Summary

MCP 프로세스 내 `PerformanceMonitor`의 CPU 사용률 계산 버그(누적값 사용)를 delta 기반 측정으로 수정하고, `BatchScheduler`의 헬스체크(30s→5분)와 큐 폴링(100ms→1초) 기본 간격을 줄이며, `DB_PATH` 기본값을 절대 경로(`~/.memento/memory.db`)로 변경한다. 모든 새 기본값은 환경 변수로 재정의 가능하며, 유효하지 않은 환경 변수는 경고 로그 후 기본값으로 대체된다. DB 디렉터리 자동 생성 실패 시에는 서버 시작을 즉시 중단한다.

## Technical Context

**Language/Version**: TypeScript (Node.js ≥ 20), ES modules
**Primary Dependencies**: better-sqlite3, vitest
**Storage**: SQLite (better-sqlite3) — 스키마 변경 없음
**Testing**: Vitest (`.spec.ts` 단위 테스트 co-located)
**Target Platform**: Node.js 프로세스 (MCP stdio / HTTP 서버)
**Project Type**: 모노레포 라이브러리 + 서버 (`packages/memento-core` + `packages/memento-server`)
**Performance Goals**: 유휴 CPU 50%+ 감소 (SC-002), CPU 경고 오탐 0건 (SC-001)
**Constraints**: MCP 도구 스키마 변경 없음, 하위 호환 (기존 env var 우선 적용)
**Scale/Scope**: 단일 프로세스 MCP 서버; 변경 파일 4개, 신규 env var 4개

## Constitution Check

*GATE: 프로젝트 Constitution이 템플릿 상태이므로 AGENTS.md/CLAUDE.md 가이드라인을 기준으로 검사*

| 게이트 | 상태 | 비고 |
|--------|------|------|
| 단위 테스트 필수 (`.spec.ts`) | ✅ Pass | 변경 파일마다 `.spec.ts` 수정/추가 계획 |
| `npm run lint && npm run type-check && npm test` 통과 | ✅ Pass | 태스크에 품질 게이트 포함 |
| MCP 도구 스키마 변경 없음 | ✅ Pass | 내부 구현 변경만; 외부 인터페이스 유지 |
| Conventional commit 스타일 | ✅ Pass | `fix:` 접두사 사용 |
| `data/`, `dist/` 커밋 금지 | ✅ Pass | 해당 파일 변경 없음 |
| 신규 패키지 추가 없음 | ✅ Pass | `os` 모듈은 Node.js 내장 |

**위반 없음 — Phase 1 진행 가능**

## Project Structure

### Documentation (this feature)

```text
specs/002-fix-mcp-monitoring-overhead/
├── plan.md              ✅ (이 파일)
├── research.md          ✅ Phase 0 완료
├── data-model.md        ✅ Phase 1 완료
├── quickstart.md        ✅ Phase 1 완료
└── tasks.md             🔲 /speckit.tasks 명령으로 생성
```

### Source Code (변경 대상 파일)

```text
packages/memento-core/
└── src/
    ├── domains/
    │   └── monitoring/
    │       └── services/
    │           ├── performance-monitor.ts           ← 수정 (CPU delta, 임계값 env var)
    │           └── __tests__/
    │               └── performance-monitor.spec.ts  ← 수정 (delta 계산 테스트 추가)
    ├── infrastructure/
    │   └── scheduler/
    │       ├── batch-scheduler.ts                   ← 수정 (기본값 변경, env var 연동)
    │       └── __tests__/
    │           └── batch-scheduler.spec.ts          ← 수정 (기본값 테스트 갱신)
    ├── shared/
    │   └── config/
    │       └── environment.ts                       ← 수정 (신규 env var, DB_PATH 기본값)
    └── bootstrap.ts                                 ← 수정 (DB 디렉터리 자동 생성)
```

**Structure Decision**: 단일 패키지(`memento-core`) 내 4개 파일 수정. 신규 파일 없음. 기존 구조를 그대로 유지.

## Complexity Tracking

해당 없음 — Constitution 위반 없음.

---

## Phase 0: Research 결과 요약

→ 상세 내용: [research.md](./research.md)

**핵심 결정사항**:

1. **CPU delta 측정**: `previousCpuUsage: NodeJS.CpuUsage | null`, `previousMeasurementTime: number | null` 두 필드를 `PerformanceMonitor`에 추가. `collectMetrics()` 호출마다 delta 계산 후 갱신.
2. **공식**: `percent = (∆user_µs + ∆system_µs) / (wallClock_ms × 1000) × 100`, clamp [0, 100]
3. **첫 번째 호출**: 0 반환 (경고 없음)
4. **기본값**: 헬스체크 5분, 큐 폴링 1초, 메모리 임계값 85%, CPU 임계값 75%
5. **DB_PATH**: `os.homedir() + '/.memento/memory.db'`

---

## Phase 1: 설계 산출물

→ 엔티티/상태: [data-model.md](./data-model.md)
→ 사용 가이드: [quickstart.md](./quickstart.md)
→ contracts/: 해당 없음 (MCP 도구·HTTP API 인터페이스 변경 없음)

---

## Phase 2: 구현 태스크 개요

*상세 태스크 목록은 `/speckit.tasks`로 생성*

### T-1: 환경 변수 추가 (environment.ts)

**목표**: 신규 env var 4개 및 DB_PATH 기본값 변경

변경 내용:
- `ENV_DEFAULTS`에 추가:
  ```ts
  PERF_MEMORY_WARN_PERCENT: '85',
  PERF_CPU_WARN_PERCENT: '75',
  BATCH_HEALTH_CHECK_INTERVAL_MS: '300000',
  BATCH_JOB_PROCESSOR_INTERVAL_MS: '1000',
  DB_PATH: `${os.homedir()}/.memento/memory.db`,
  ```
- `os` 모듈 import 추가 (상단)

**테스트**: 기존 env var 기본값 테스트 유지 + 신규 env var 기본값 확인

---

### T-2: CPU delta 측정 수정 (performance-monitor.ts)

**목표**: `calculateCpuUsage()` 누적값 계산 → delta 기반으로 수정

변경 내용:
```ts
// 추가 필드
private previousCpuUsage: NodeJS.CpuUsage | null = null;
private previousMeasurementTime: number | null = null;

// 수정 메서드 시그니처: 인자 없음 (자체적으로 process.cpuUsage() 호출)
private calculateCpuUsage(): number {
  const now = Date.now();
  const current = process.cpuUsage();

  if (this.previousCpuUsage === null || this.previousMeasurementTime === null) {
    this.previousCpuUsage = current;
    this.previousMeasurementTime = now;
    return 0;
  }

  const cpuDelta = (current.user - this.previousCpuUsage.user)
                 + (current.system - this.previousCpuUsage.system);
  const wallClockDelta = (now - this.previousMeasurementTime) * 1000; // µs

  this.previousCpuUsage = current;
  this.previousMeasurementTime = now;

  if (wallClockDelta === 0) return 0;
  return Math.max(0, Math.min(100, (cpuDelta / wallClockDelta) * 100));
}
```

임계값 env var 연동:
```ts
// constructor에서 resolveNumber() 사용
this.thresholds = {
  memoryUsagePercent: resolveNumber('PERF_MEMORY_WARN_PERCENT', { defaultValue: 85 }),
  cpuUsagePercent: resolveNumber('PERF_CPU_WARN_PERCENT', { defaultValue: 75 }),
  ...
};
```

`collectMetrics()`에서 호출 방식 변경:
```ts
// 변경 전: this.calculateCpuUsage(cpuUsage) 에 cumulative 값 전달
// 변경 후: this.calculateCpuUsage() 인자 없음
const cpuUsagePercent = this.calculateCpuUsage();
```

**테스트**:
- 첫 번째 호출 → 0 반환
- 두 번째 호출 (CPU 부하 후) → 0 초과, 100 이하
- elapsed = 0인 경우 → 0 반환
- 임계값 85% 미만에서 경고 미발생, 초과 시 경고 발생

---

### T-3: BatchScheduler 기본값 변경 (batch-scheduler.ts)

**목표**: healthCheckInterval 기본값 5분, jobProcessorInterval 1초 + env var 연동

변경 내용:
```ts
// constructor 기본값
this.config = {
  healthCheckInterval: resolveNumber('BATCH_HEALTH_CHECK_INTERVAL_MS', { defaultValue: 300_000 }),
  // ... 기존 필드들
  ...config
};

// startJobProcessor()의 setInterval
this.jobProcessorInterval = setInterval(
  processQueue,
  resolveNumber('BATCH_JOB_PROCESSOR_INTERVAL_MS', { defaultValue: 1_000 })
);
```

유효성 검사: `validateConfig()`에서 `BATCH_HEALTH_CHECK_INTERVAL_MS` < 10,000이면 warn + 기본값 적용

**테스트**:
- 기본값으로 생성 시 healthCheckInterval = 300,000 확인
- 환경 변수 오버라이드 시 해당 값 사용 확인
- 유효하지 않은 값(음수) → 기본값 적용 + warn 로그

---

### T-4: DB 디렉터리 자동 생성 및 실패 처리 (bootstrap.ts)

**목표**: DB 연결 전 디렉터리 존재 확인 및 자동 생성; 실패 시 즉시 종료

변경 내용 (bootstrap.ts 또는 DB 초기화 진입점):
```ts
import { mkdirSync } from 'fs';
import { dirname } from 'path';

function ensureDbDirectory(dbPath: string): void {
  const dir = dirname(dbPath);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[memento] DB 디렉터리 생성 실패: ${dir}\n원인: ${msg}`);
    process.exit(1);
  }
}
```

**테스트**:
- 디렉터리 미존재 시 자동 생성
- 이미 존재하면 에러 없이 통과
- 권한 오류 시뮬레이션 → process.exit(1) 호출 확인 (mock)

---

### T-5: 유효하지 않은 env var 경고 처리

**목표**: T-1~T-3의 env var 파싱 시 유효하지 않은 값 → 경고 로그 + 기본값

변경 내용:
`environment.ts`에 `resolveValidatedNumber()` 유틸 추가 (또는 인라인):

```ts
function resolveValidatedNumber(
  key: string,
  defaultValue: number,
  validate: (n: number) => boolean,
  hint: string
): number {
  const raw = process.env[key];
  if (raw === undefined) return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || !validate(parsed)) {
    console.warn(`[memento] 환경 변수 ${key}="${raw}" 유효하지 않음 (${hint}). 기본값 ${defaultValue} 사용.`);
    return defaultValue;
  }
  return parsed;
}
```

**테스트**:
- 숫자 아닌 값 → 경고 + 기본값
- 음수 → 경고 + 기본값
- 유효한 값 → 해당 값 그대로 사용

---

### T-6: 품질 게이트 통과

**목표**: 전체 lint + type-check + test 통과

```bash
npm run lint -- --fix
npm run type-check
npm test
```

---

## 구현 순서

```
T-1 (environment.ts)
  → T-2 (performance-monitor.ts)  [T-1 의존]
  → T-3 (batch-scheduler.ts)      [T-1 의존]
  → T-4 (bootstrap.ts)            [T-1 의존]
  → T-5 (유효성 검사 유틸)       [T-1 의존]
  → T-6 (품질 게이트)             [T-2~T-5 의존]
```

T-2, T-3, T-4, T-5는 T-1 이후 병렬 진행 가능.

---

## 리스크

| 리스크 | 가능성 | 영향 | 대응 |
|--------|--------|------|------|
| 기존 테스트에서 `calculateCpuUsage(cpu)` 시그니처를 직접 사용 | 중 | 컴파일 오류 | T-2 작업 시 spec 파일 동시 업데이트 |
| DB_PATH 기본값 변경으로 기존 `./data/memory.db` 사용자 영향 | 중 | 데이터 접근 불가 | quickstart.md 마이그레이션 가이드 제공 |
| `setInterval(processQueue, 1000)` 변경 시 jobProcessorInterval 관련 테스트 실패 | 낮 | 테스트 오류 | 테스트에서 고정값 대신 config 값 참조 |
