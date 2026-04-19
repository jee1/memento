# Issue 159 Diagnostics Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Docker Desktop 다운 현상을 재현 가능하게 분석할 수 있도록 앱 내부 진단 로깅, 상주 서브시스템 차단 플래그, Docker 외부 관측 경로를 추가한다.

**Architecture:** 진단 기능은 기본적으로 꺼진 상태로 유지하고, 활성화 시에만 `/app/logs/diagnostics` 아래 JSONL 파일을 남긴다. 부팅 시점에 `BatchScheduler`, `WalCheckpointScheduler`, `DatabaseLockMonitor`를 환경변수로 독립 제어하고, 호스트에서 별도 스크립트로 Docker 상태를 수집해 앱 내부 로그와 교차 분석한다.

**Tech Stack:** TypeScript 5.x, Node.js 20+, Vitest, npm workspaces, Docker Compose

---

## File Structure

- `packages/memento-core/src/shared/config/environment.ts`
  - 진단/기능 차단 환경변수 기본값과 파서 추가
- `packages/memento-core/src/shared/config/index.ts`
  - `mementoConfig`에 진단/기능 차단 필드 노출
- `packages/memento-core/src/domains/monitoring/services/runtime-diagnostics-logger.ts`
  - JSONL 파일 기반 진단 로거 신규 구현
- `packages/memento-core/src/domains/monitoring/services/__tests__/runtime-diagnostics-logger.spec.ts`
  - 진단 로거 단위 테스트
- `packages/memento-core/src/bootstrap.ts`
  - 진단 로거 초기화, 스케줄러/모니터 start 조건 분기
- `packages/memento-core/src/infrastructure/scheduler/batch-scheduler.ts`
  - 진단 이벤트 훅(시작/종료/실패) 기록 지점 추가
- `packages/memento-core/src/infrastructure/database/wal-checkpoint-scheduler.ts`
  - start/stop/checkpoint 이벤트 진단 로그 연계
- `packages/memento-core/src/infrastructure/database/database-lock-monitor.ts`
  - start/stop/error 이벤트 진단 로그 연계
- `packages/memento-core/src/bootstrap.spec.ts`
  - 기능 차단 플래그와 진단 로거 초기화 테스트 추가
- `packages/memento-core/src/infrastructure/database/wal-checkpoint-scheduler.spec.ts`
  - 진단 이벤트 연계 테스트 추가
- `packages/memento-server/src/server/index.ts`
  - 프로세스 이벤트(`uncaughtException`, 종료 신호) 진단 이벤트 기록
- `packages/memento-server/src/server/http-server.ts`
  - HTTP 서버 종료 경로에서 진단 로거 정리
- `packages/memento-server/src/server/index.spec.ts`
  - 서버 진입점 진단 이벤트 테스트 추가
- `scripts/collect-docker-diagnostics.sh`
  - 호스트 측 Docker 상태 샘플링 스크립트 신규 추가
- `DOCKER_SETUP_GUIDE.md`
  - 진단 모드 사용법과 재현 실험 순서 문서화
- `docker-compose.base.yml`
  - 진단 로그 디렉토리와 환경변수 예시 주석 정리(기본값 변경 없음)

---

### Task 1: 진단 설정 계약과 JSONL 로거 추가

**Files:**
- Create: `packages/memento-core/src/domains/monitoring/services/runtime-diagnostics-logger.ts`
- Test: `packages/memento-core/src/domains/monitoring/services/__tests__/runtime-diagnostics-logger.spec.ts`
- Modify: `packages/memento-core/src/shared/config/environment.ts`
- Modify: `packages/memento-core/src/shared/config/index.ts`

- [ ] **Step 1: 진단 설정 파서 테스트를 먼저 추가**

```ts
it('DIAGNOSTICS_ENABLED가 true일 때 진단 모드를 활성화해야 한다', async () => {
  process.env.DIAGNOSTICS_ENABLED = 'true';
  process.env.DIAGNOSTICS_INTERVAL_MS = '15000';
  process.env.DIAGNOSTICS_LOG_DIR = '/tmp/memento-diagnostics';

  const { mementoConfig } = await import('../../../shared/config/index.js');

  expect(mementoConfig.diagnosticsEnabled).toBe(true);
  expect(mementoConfig.diagnosticsIntervalMs).toBe(15000);
  expect(mementoConfig.diagnosticsLogDir).toBe('/tmp/memento-diagnostics');
});
```

- [ ] **Step 2: 테스트를 실행해 실패를 확인**

Run: `npm test -- packages/memento-core/src/domains/monitoring/services/__tests__/runtime-diagnostics-logger.spec.ts`

Expected: FAIL with config fields or logger module missing

- [ ] **Step 3: 환경변수 기본값과 설정 필드를 추가**

```ts
const ENV_DEFAULTS: Record<string, string> = {
  // ...
  DIAGNOSTICS_ENABLED: 'false',
  DIAGNOSTICS_INTERVAL_MS: '15000',
  DIAGNOSTICS_LOG_DIR: '/app/logs/diagnostics',
  BATCH_SCHEDULER_ENABLED: 'true',
  WAL_CHECKPOINT_ENABLED: 'true',
  DB_LOCK_MONITOR_ENABLED: 'true'
};
```

```ts
export interface MementoConfig {
  // ...
  diagnosticsEnabled: boolean;
  diagnosticsIntervalMs: number;
  diagnosticsLogDir: string;
  batchSchedulerEnabled: boolean;
  walCheckpointEnabled: boolean;
  dbLockMonitorEnabled: boolean;
}
```

- [ ] **Step 4: 최소 진단 로거를 구현**

```ts
export class RuntimeDiagnosticsLogger {
  constructor(
    private readonly enabled: boolean,
    private readonly logDir: string
  ) {}

  async writeSample(sample: Record<string, unknown>): Promise<void> {
    if (!this.enabled) return;
    await this.appendJsonl('app-runtime.jsonl', sample);
  }

  async writeEvent(event: Record<string, unknown>): Promise<void> {
    if (!this.enabled) return;
    await this.appendJsonl('app-events.jsonl', event);
  }
}
```

- [ ] **Step 5: 로그 실패 격리 테스트를 추가**

```ts
it('로그 파일 쓰기 실패가 예외를 전파하지 않아야 한다', async () => {
  const logger = new RuntimeDiagnosticsLogger(true, '/root/forbidden');
  await expect(logger.writeEvent({ type: 'server_start' })).resolves.toBeUndefined();
});
```

- [ ] **Step 6: 테스트를 다시 실행해 통과를 확인**

Run: `npm test -- packages/memento-core/src/domains/monitoring/services/__tests__/runtime-diagnostics-logger.spec.ts`

Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add packages/memento-core/src/shared/config/environment.ts packages/memento-core/src/shared/config/index.ts packages/memento-core/src/domains/monitoring/services/runtime-diagnostics-logger.ts packages/memento-core/src/domains/monitoring/services/__tests__/runtime-diagnostics-logger.spec.ts
git commit -m "feat: add runtime diagnostics config and logger"
```

---

### Task 2: 부트스트랩에서 기능 차단 플래그와 주기 샘플 연결

**Files:**
- Modify: `packages/memento-core/src/bootstrap.ts`
- Test: `packages/memento-core/src/bootstrap.spec.ts`

- [ ] **Step 1: 플래그 분기 테스트를 먼저 추가**

```ts
it('BATCH_SCHEDULER_ENABLED=false일 때 배치 스케줄러를 시작하지 않아야 한다', async () => {
  process.env.BATCH_SCHEDULER_ENABLED = 'false';
  const core = await createMementoCore();
  expect(core.services.batchScheduler?.getStatus().isRunning ?? false).toBe(false);
});
```

```ts
it('WAL_CHECKPOINT_ENABLED=false일 때 WAL 체크포인트 스케줄러를 시작하지 않아야 한다', async () => {
  process.env.WAL_CHECKPOINT_ENABLED = 'false';
  const core = await createMementoCore();
  expect(core.services.walCheckpointScheduler.isRunning()).toBe(false);
});
```

- [ ] **Step 2: 테스트를 실행해 실패를 확인**

Run: `npm test -- packages/memento-core/src/bootstrap.spec.ts`

Expected: FAIL because services always start

- [ ] **Step 3: `bootstrap.ts`에 진단 로거를 초기화하고 서비스 컨텍스트에 연결**

```ts
const diagnosticsLogger = new RuntimeDiagnosticsLogger(
  mementoConfig.diagnosticsEnabled,
  mementoConfig.diagnosticsLogDir
);

await diagnosticsLogger.writeEvent({
  type: 'bootstrap_start',
  timestamp: new Date().toISOString(),
  diagnosticsEnabled: mementoConfig.diagnosticsEnabled
});
```

- [ ] **Step 4: 상주성 서브시스템 start를 플래그로 감싼다**

```ts
if (mementoConfig.walCheckpointEnabled) {
  walCheckpointScheduler.start();
}

if (mementoConfig.dbLockMonitorEnabled) {
  databaseLockMonitor.start();
}

if (mementoConfig.batchSchedulerEnabled) {
  await batchScheduler.start(db, reflexionWorker);
}
```

- [ ] **Step 5: 주기 샘플러 등록을 추가한다**

```ts
if (mementoConfig.diagnosticsEnabled) {
  setInterval(async () => {
    await diagnosticsLogger.writeSample({
      type: 'runtime_sample',
      timestamp: new Date().toISOString(),
      memory: process.memoryUsage(),
      uptime: process.uptime(),
      batchScheduler: batchScheduler.getStatus(),
      walCheckpointEnabled: mementoConfig.walCheckpointEnabled,
      dbLockMonitorEnabled: mementoConfig.dbLockMonitorEnabled
    });
  }, mementoConfig.diagnosticsIntervalMs);
}
```

- [ ] **Step 6: 테스트를 다시 실행해 통과를 확인**

Run: `npm test -- packages/memento-core/src/bootstrap.spec.ts`

Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add packages/memento-core/src/bootstrap.ts packages/memento-core/src/bootstrap.spec.ts
git commit -m "feat: gate background services with diagnostics flags"
```

---

### Task 3: 배치/WAL/락 모니터 이벤트를 진단 로그에 남기기

**Files:**
- Modify: `packages/memento-core/src/infrastructure/scheduler/batch-scheduler.ts`
- Modify: `packages/memento-core/src/infrastructure/database/wal-checkpoint-scheduler.ts`
- Modify: `packages/memento-core/src/infrastructure/database/database-lock-monitor.ts`
- Test: `packages/memento-core/src/infrastructure/scheduler/batch-scheduler.spec.ts`
- Test: `packages/memento-core/src/infrastructure/database/wal-checkpoint-scheduler.spec.ts`
- Test: `packages/memento-core/src/infrastructure/database/database-lock-monitor.spec.ts`

- [ ] **Step 1: 배치 이벤트 로그 테스트를 추가**

```ts
it('작업 시작과 종료 시 진단 이벤트를 기록해야 한다', async () => {
  const writeEvent = vi.fn();
  const scheduler = new BatchScheduler({}, { diagnosticsLogger: { writeEvent } as any });

  await scheduler.start(db);
  await scheduler.runJob('healthcheck');

  expect(writeEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'batch_job_start' }));
  expect(writeEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'batch_job_finish' }));
});
```

- [ ] **Step 2: 테스트를 실행해 실패를 확인**

Run: `npm test -- packages/memento-core/src/infrastructure/scheduler/batch-scheduler.spec.ts packages/memento-core/src/infrastructure/database/wal-checkpoint-scheduler.spec.ts`

Expected: FAIL because diagnostics hook is absent

- [ ] **Step 3: `BatchScheduler`에 선택적 진단 로거 의존성을 추가**

```ts
constructor(
  config?: Partial<BatchJobConfig>,
  dependencies?: {
    // ...
    diagnosticsLogger?: RuntimeDiagnosticsLogger;
  }
) {
  this.diagnosticsLogger = dependencies?.diagnosticsLogger;
}
```

```ts
await this.diagnosticsLogger?.writeEvent({
  type: 'batch_job_start',
  jobName,
  timestamp: new Date().toISOString(),
  queueSize: this.jobQueue.size,
  runningCount: this.jobQueue.runningCount
});
```

- [ ] **Step 4: WAL/락 모니터에 start/stop/error 이벤트를 추가**

```ts
await this.diagnosticsLogger?.writeEvent({
  type: 'wal_checkpoint_start',
  timestamp: new Date().toISOString(),
  intervalMs: this.config.intervalMs
});
```

```ts
await this.diagnosticsLogger?.writeEvent({
  type: 'db_lock_monitor_error',
  timestamp: new Date().toISOString(),
  error: error instanceof Error ? error.message : String(error)
});
```

- [ ] **Step 5: 테스트를 다시 실행해 통과를 확인**

Run: `npm test -- packages/memento-core/src/infrastructure/scheduler/batch-scheduler.spec.ts packages/memento-core/src/infrastructure/database/wal-checkpoint-scheduler.spec.ts packages/memento-core/src/infrastructure/database/database-lock-monitor.spec.ts`

Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add packages/memento-core/src/infrastructure/scheduler/batch-scheduler.ts packages/memento-core/src/infrastructure/database/wal-checkpoint-scheduler.ts packages/memento-core/src/infrastructure/database/database-lock-monitor.ts packages/memento-core/src/infrastructure/scheduler/batch-scheduler.spec.ts packages/memento-core/src/infrastructure/database/wal-checkpoint-scheduler.spec.ts packages/memento-core/src/infrastructure/database/database-lock-monitor.spec.ts
git commit -m "feat: emit diagnostics events for background services"
```

---

### Task 4: 서버 프로세스 이벤트와 종료 정리 연결

**Files:**
- Modify: `packages/memento-server/src/server/index.ts`
- Modify: `packages/memento-server/src/server/http-server.ts`
- Test: `packages/memento-server/src/server/index.spec.ts`
- Test: `packages/memento-server/src/server/http-server.spec.ts`

- [ ] **Step 1: 서버 프로세스 이벤트 테스트를 추가**

```ts
it('uncaughtException 발생 시 진단 이벤트를 기록해야 한다', async () => {
  const writeEvent = vi.fn();
  setDiagnosticsLoggerForTest({ writeEvent } as any);

  process.emit('uncaughtException', new Error('boom'));

  expect(writeEvent).toHaveBeenCalledWith(expect.objectContaining({
    type: 'uncaught_exception',
    error: 'boom'
  }));
});
```

- [ ] **Step 2: 테스트를 실행해 실패를 확인**

Run: `npm test -- packages/memento-server/src/server/index.spec.ts packages/memento-server/src/server/http-server.spec.ts`

Expected: FAIL because diagnostics logger is not wired into process handlers

- [ ] **Step 3: 서버 시작/종료/예외 경로에 진단 이벤트를 추가**

```ts
await diagnosticsLogger?.writeEvent({
  type: 'server_start',
  timestamp: new Date().toISOString(),
  transport: 'stdio'
});
```

```ts
process.on('uncaughtException', (error) => {
  void diagnosticsLogger?.writeEvent({
    type: 'uncaught_exception',
    timestamp: new Date().toISOString(),
    error: error instanceof Error ? error.message : String(error)
  });
  cleanup();
  process.exit(1);
});
```

- [ ] **Step 4: HTTP cleanup에서 진단 로거 flush/destroy를 호출**

```ts
if (serverServices?.runtimeDiagnosticsLogger) {
  await serverServices.runtimeDiagnosticsLogger.flush?.();
}
```

- [ ] **Step 5: 테스트를 다시 실행해 통과를 확인**

Run: `npm test -- packages/memento-server/src/server/index.spec.ts packages/memento-server/src/server/http-server.spec.ts`

Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add packages/memento-server/src/server/index.ts packages/memento-server/src/server/http-server.ts packages/memento-server/src/server/index.spec.ts packages/memento-server/src/server/http-server.spec.ts
git commit -m "feat: log server lifecycle diagnostics events"
```

---

### Task 5: Docker 외부 관측 스크립트와 운영 문서 추가

**Files:**
- Create: `scripts/collect-docker-diagnostics.sh`
- Modify: `DOCKER_SETUP_GUIDE.md`
- Modify: `docker-compose.base.yml`

- [ ] **Step 1: 스크립트 존재 테스트 또는 사용 예를 먼저 문서에 추가**

```md
## 진단 모드

```bash
DIAGNOSTICS_ENABLED=true \
DIAGNOSTICS_INTERVAL_MS=10000 \
BATCH_SCHEDULER_ENABLED=false \
docker-compose up -d

./scripts/collect-docker-diagnostics.sh memento-mcp-server
```
```

- [ ] **Step 2: 스크립트를 작성**

```bash
#!/usr/bin/env bash
set -euo pipefail

CONTAINER_NAME="${1:-memento-mcp-server}"
OUT_DIR="${2:-$HOME/.memento/logs/docker-diagnostics}"
mkdir -p "$OUT_DIR"

while true; do
  ts="$(date -Iseconds)"
  docker stats --no-stream --format '{{json .}}' "$CONTAINER_NAME" >> "$OUT_DIR/docker-stats.jsonl" || true
  docker inspect "$CONTAINER_NAME" >> "$OUT_DIR/docker-inspect.jsonl" || true
  docker system df >> "$OUT_DIR/docker-disk.log" || true
  sleep 10
done
```

- [ ] **Step 3: `docker-compose.base.yml`에 진단 환경변수 예시 주석을 추가**

```yml
environment:
  <<: *default-environment
  # 진단 모드 예시:
  # DIAGNOSTICS_ENABLED: "true"
  # DIAGNOSTICS_INTERVAL_MS: "10000"
```

- [ ] **Step 4: 문서에 4개 실험 프로파일을 명시**

```md
1. 기준선: 모든 기능 on
2. 배치 차단: `BATCH_SCHEDULER_ENABLED=false`
3. DB 모니터 차단: `WAL_CHECKPOINT_ENABLED=false`, `DB_LOCK_MONITOR_ENABLED=false`
4. 전부 차단: 위 세 플래그 모두 `false`
```

- [ ] **Step 5: 문서 링크/스크립트 동작을 검토**

Run: `bash -n scripts/collect-docker-diagnostics.sh`

Expected: no output, exit code 0

- [ ] **Step 6: 커밋**

```bash
git add scripts/collect-docker-diagnostics.sh DOCKER_SETUP_GUIDE.md docker-compose.base.yml
git commit -m "docs: add docker diagnostics runbook"
```

---

### Task 6: 최종 검증과 정리

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: 핵심 테스트만 먼저 실행**

Run: `npm test -- packages/memento-core/src/bootstrap.spec.ts packages/memento-core/src/domains/monitoring/services/__tests__/runtime-diagnostics-logger.spec.ts packages/memento-server/src/server/index.spec.ts packages/memento-server/src/server/http-server.spec.ts`

Expected: PASS

- [ ] **Step 2: 관련 배경 서비스 테스트를 실행**

Run: `npm test -- packages/memento-core/src/infrastructure/scheduler/batch-scheduler.spec.ts packages/memento-core/src/infrastructure/database/wal-checkpoint-scheduler.spec.ts packages/memento-core/src/infrastructure/database/database-lock-monitor.spec.ts`

Expected: PASS

- [ ] **Step 3: 타입 체크를 실행**

Run: `npm run type-check`

Expected: PASS

- [ ] **Step 4: changelog에 진단 기능 추가를 기록**

```md
### Added
- Docker instability 진단용 runtime diagnostics 모드와 background service feature flags 추가
```

- [ ] **Step 5: 최종 커밋**

```bash
git add CHANGELOG.md
git commit -m "chore: record diagnostics mode in changelog"
```

---

## Self-Review

### Spec coverage

- 진단 모드 환경변수: Task 1
- 앱 내부 JSONL 로그: Task 1, Task 2, Task 3, Task 4
- 기능 차단 플래그: Task 1, Task 2
- Docker 외부 관측 스크립트/가이드: Task 5
- 실험 프로파일 문서화: Task 5
- 테스트 전략: Task 1~6

누락 없음.

### Placeholder scan

- `TBD`, `TODO`, “적절한 처리” 같은 문구 없음
- 각 테스트/명령/커밋 단위에 실제 경로와 예시 코드 포함

### Type consistency

- 진단 설정 필드명은 `diagnosticsEnabled`, `diagnosticsIntervalMs`, `diagnosticsLogDir`로 일관성 유지
- 차단 플래그는 `batchSchedulerEnabled`, `walCheckpointEnabled`, `dbLockMonitorEnabled`로 일관성 유지
- 이벤트 파일명은 `app-runtime.jsonl`, `app-events.jsonl`로 일관성 유지
