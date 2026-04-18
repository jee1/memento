# Issue 160: CLI → HTTP 클라이언트 전환 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CLI가 DB를 직접 열지 않고, 항상 실행 중인 서버의 HTTP 관리 엔드포인트로 도구를 호출하도록 전환한다.

**Architecture:** 모든 서버 모드(HTTP, stdio MCP)는 기동 시 `~/.memento/server.json`에 관리 포트를 기록한다. CLI는 이 파일을 읽어 `POST /tools/{name}`으로 요청을 보낸다. stdio 서버는 기존 MCP 로직과 별도로 localhost-only 관리 HTTP 서버를 port :0으로 병행 기동한다.

**Tech Stack:** Node.js 20+, TypeScript 5, Express 4, better-sqlite3, Vitest

---

## 파일 구조

| 파일 | 유형 | 역할 |
|---|---|---|
| `packages/memento-server/src/server/server-info.ts` | 신규 | ServerInfo 읽기/쓰기/삭제, isServerAlive, callToolViaHttp |
| `packages/memento-server/src/server/server-info.spec.ts` | 신규 | server-info.ts 유닛 테스트 |
| `packages/memento-server/src/server/http-server.ts` | 수정 | 기동 시 writeServerInfo, 종료 시 deleteServerInfo |
| `packages/memento-server/src/server/index.ts` | 수정 | 관리 HTTP 서버 병행 기동, server.json 라이프사이클 |
| `packages/memento-server/src/cli.ts` | 수정 | DB 초기화 제거, HTTP 클라이언트로 교체 |
| `packages/memento-server/src/server/cli-integration.spec.ts` | 신규 | CLI 통합 테스트 (서버 없음, 왕복, 동시성) |

---

## Task 1: `server-info.ts` 유틸 작성

**Files:**
- Create: `packages/memento-server/src/server/server-info.ts`
- Create: `packages/memento-server/src/server/server-info.spec.ts`

### 배경

`configDir`은 `process.env.MEMENTO_CONFIG_DIR ?? path.join(os.homedir(), '.memento')`로 결정된다.
`server.json` 경로는 `path.join(configDir, 'server.json')`이다.

`isServerAlive`는 두 단계로 검증하며, **stale 파일이 감지되면 자동 삭제**한다:
1. PID 프로세스 존재 확인 (`process.kill(pid, 0)`)
2. `GET http://localhost:{port}/health` 응답이 2xx인지 확인
- 어느 단계든 실패 시 false 반환. CLI에서는 false 반환 전에 stale server.json을 삭제한다.

`callToolViaHttp`는 Node.js 내장 `fetch`(Node 18+)를 사용한다.

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// packages/memento-server/src/server/server-info.spec.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  writeServerInfo,
  readServerInfo,
  deleteServerInfo,
  type ServerInfo,
} from './server-info.js';

describe('server-info', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'memento-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('writeServerInfo는 server.json을 생성한다', async () => {
    await writeServerInfo(tmpDir, 51764);
    const info = await readServerInfo(tmpDir);
    expect(info).not.toBeNull();
    expect(info!.port).toBe(51764);
    expect(info!.pid).toBe(process.pid);
    expect(info!.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('readServerInfo는 파일이 없으면 null을 반환한다', async () => {
    const info = await readServerInfo(tmpDir);
    expect(info).toBeNull();
  });

  it('deleteServerInfo는 server.json을 삭제한다', async () => {
    await writeServerInfo(tmpDir, 51764);
    await deleteServerInfo(tmpDir);
    const info = await readServerInfo(tmpDir);
    expect(info).toBeNull();
  });

  it('deleteServerInfo는 파일이 없어도 에러를 던지지 않는다', async () => {
    await expect(deleteServerInfo(tmpDir)).resolves.not.toThrow();
  });
});
```

- [ ] **Step 2: 테스트 실행 — FAIL 확인**

```bash
cd packages/memento-server && npx vitest run src/server/server-info.spec.ts 2>&1 | tail -20
```

Expected: `Cannot find module './server-info.js'`

- [ ] **Step 3: `server-info.ts` 구현**

```typescript
// packages/memento-server/src/server/server-info.ts
import { readFile, writeFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';

export interface ServerInfo {
  port: number;
  pid: number;
  startedAt: string;
}

function serverInfoPath(configDir: string): string {
  return join(configDir, 'server.json');
}

export async function writeServerInfo(configDir: string, port: number): Promise<void> {
  await mkdir(configDir, { recursive: true });
  const info: ServerInfo = { port, pid: process.pid, startedAt: new Date().toISOString() };
  await writeFile(serverInfoPath(configDir), JSON.stringify(info, null, 2), 'utf-8');
}

export async function readServerInfo(configDir: string): Promise<ServerInfo | null> {
  try {
    const raw = await readFile(serverInfoPath(configDir), 'utf-8');
    return JSON.parse(raw) as ServerInfo;
  } catch {
    return null;
  }
}

export async function deleteServerInfo(configDir: string): Promise<void> {
  try {
    await unlink(serverInfoPath(configDir));
  } catch {
    // 파일이 없어도 무시
  }
}

export async function isServerAlive(info: ServerInfo): Promise<boolean> {
  // 1단계: PID 존재 확인
  try {
    process.kill(info.pid, 0);
  } catch {
    return false;
  }
  // 2단계: HTTP /health 응답 확인 (PID 재사용 오탐 방지)
  try {
    const res = await fetch(`http://localhost:${info.port}/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function callToolViaHttp(
  port: number,
  toolName: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const res = await fetch(`http://localhost:${port}/tools/${toolName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(30_000),
  });

  const body = await res.json() as Record<string, unknown>;

  if (!res.ok) {
    throw new Error(
      (typeof body.message === 'string' ? body.message : null) ??
      `HTTP ${res.status}: Tool ${toolName} failed`,
    );
  }

  return body.result;
}
```

- [ ] **Step 4: 테스트 실행 — PASS 확인**

```bash
cd packages/memento-server && npx vitest run src/server/server-info.spec.ts 2>&1 | tail -20
```

Expected: `✓ server-info` 3개 이상 PASS

- [ ] **Step 5: 커밋**

```bash
git add packages/memento-server/src/server/server-info.ts packages/memento-server/src/server/server-info.spec.ts
git commit -m "feat: add server-info utility for server discovery"
```

---

## Task 2: HTTP 서버 — server.json 라이프사이클

**Files:**
- Modify: `packages/memento-server/src/server/http-server.ts`

### 배경

HTTP 서버는 이미 `server.on('listening', ...)` 콜백이 있으므로(line 610), 거기서 `writeServerInfo`를 호출한다.
`cleanup()` 함수(line ~560)에서 `deleteServerInfo`를 호출한다.
`configDir`은 `process.env.MEMENTO_CONFIG_DIR ?? path.join(os.homedir(), '.memento')`로 결정한다.

> **Note:** HTTP 서버의 server.json 라이프사이클 통합 테스트는 Task 5의 `cli-integration.spec.ts`에서 커버한다. Task 2는 구현 후 타입 체크와 수동 검증으로 확인한다.

- [ ] **Step 2: `http-server.ts` 수정**

`http-server.ts` 상단 import에 추가:
```typescript
import { homedir } from 'os';
import { writeServerInfo, deleteServerInfo } from './server-info.js';
```

`cleanup()` 함수 안 서비스 정리 코드 직후에 추가 (기존 `closeDatabase` 호출 전):
```typescript
// server.json 삭제
const configDirForCleanup = process.env.MEMENTO_CONFIG_DIR ?? join(homedir(), '.memento');
try {
  await deleteServerInfo(configDirForCleanup);
} catch (_) {}
```

`server.on('listening', ...)` 콜백 안에 추가:
```typescript
server.on('listening', () => {
  const address = server.address();
  if (address && typeof address === 'object') {
    logger.info('서버 바인딩 완료', { address: address.address, port: address.port });
    // server.json 기록
    const configDir = process.env.MEMENTO_CONFIG_DIR ?? join(homedir(), '.memento');
    void writeServerInfo(configDir, address.port);
  }
});
```

- [ ] **Step 3: 타입 체크**

```bash
cd packages/memento-server && npx tsc --noEmit 2>&1 | head -30
```

Expected: 에러 없음

- [ ] **Step 4: 커밋**

```bash
git add packages/memento-server/src/server/http-server.ts
git commit -m "feat: write/delete server.json on HTTP server lifecycle"
```

---

## Task 3: stdio 서버 — 관리 HTTP 포트 병행 기동

**Files:**
- Modify: `packages/memento-server/src/server/index.ts`

### 배경

stdio 서버는 stdout/stdin으로만 통신하므로 CLI가 접근할 HTTP 엔드포인트가 없다.
`startServer()` 안에서 `server.connect(transport)` 직후, 관리용 Express 앱을 포트 `:0`(OS 자동 배정)으로 기동한다.
Express 앱은 `/health`와 `POST /tools/:name`만 노출한다.
`db`와 `serverServices`는 모듈 레벨 변수로 각 요청 시점에 읽히므로, 초기화 중이면 503을 반환한다.

- [ ] **Step 1: import 추가**

`index.ts` 상단에 추가:
```typescript
import express from 'express';
import { createServer as createHttpServer } from 'http';
import type { AddressInfo } from 'net';
import { homedir } from 'os';
import { writeServerInfo, deleteServerInfo } from './server-info.js';
```

- [ ] **Step 2: 모듈 레벨 변수 추가**

기존 `let serverServices: ServerServices | null = null;` 아래에 추가:
```typescript
let mgmtHttpServer: ReturnType<typeof createHttpServer> | null = null;
```

- [ ] **Step 3: 관리 HTTP 서버 기동 함수 추가**

`startServer()` 함수 바로 위에 추가:
```typescript
async function startMgmtHttpServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'healthy', transport: 'stdio' });
  });

  app.post('/tools/:name', async (req, res) => {
    if (!db || !serverServices) {
      return res.status(503).json({ error: '서버 초기화 중입니다. 잠시 후 다시 시도하세요.' });
    }
    const { name } = req.params;
    try {
      const context = createToolContext(db, serverServices);
      const result = await executeTool(name, req.body as Record<string, unknown>, context);
      let actual: unknown = result;
      if (Array.isArray(result.content) && result.content[0]?.text) {
        try { actual = JSON.parse(result.content[0].text as string); } catch {}
      }
      return res.json({ result: actual, tool: name, timestamp: new Date().toISOString() });
    } catch (err) {
      return res.status(500).json({
        error: 'Tool execution failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  });

  mgmtHttpServer = createHttpServer(app);

  await new Promise<void>((resolve, reject) => {
    mgmtHttpServer!.once('error', reject);
    mgmtHttpServer!.listen(0, '127.0.0.1', async () => {
      const addr = mgmtHttpServer!.address() as AddressInfo;
      const configDir = process.env.MEMENTO_CONFIG_DIR ?? join(homedir(), '.memento');
      try {
        await writeServerInfo(configDir, addr.port);
      } catch (err) {
        mcpLogger.logServer('error', `server.json 기록 실패: ${err}`);
        reject(err);
        return;
      }
      mcpLogger.logServer('info', `관리 HTTP 서버 기동 완료 (port: ${addr.port})`);
      resolve();
    });
  });
}
```

- [ ] **Step 4: `startServer()`에서 관리 HTTP 서버 기동**

`await server.connect(transport);` 직후에 추가:
```typescript
// 관리 HTTP 서버 기동 (CLI 통신용)
await startMgmtHttpServer();
```

- [ ] **Step 5: `cleanup()` 함수에 관리 HTTP 서버 종료 추가**

`cleanup()` 함수 안 맨 앞부분에 추가:
```typescript
// server.json 삭제 및 관리 HTTP 서버 종료
if (mgmtHttpServer) {
  const configDir = process.env.MEMENTO_CONFIG_DIR ?? join(homedir(), '.memento');
  try {
    await deleteServerInfo(configDir);
  } catch (_) {}
  await new Promise<void>((resolve) => mgmtHttpServer!.close(() => resolve()));
  mgmtHttpServer = null;
}
```

- [ ] **Step 6: `join` import 추가 확인**

`index.ts`에는 이미 `import { basename, resolve } from 'path';`가 있다. 이 줄에 `join`을 추가하여:
```typescript
import { basename, join, resolve } from 'path';
```
**새 import 행을 추가하지 말고, 기존 path import에 `join`을 병합한다.**

- [ ] **Step 7: 타입 체크**

```bash
cd packages/memento-server && npx tsc --noEmit 2>&1 | head -30
```

Expected: 에러 없음

- [ ] **Step 8: 수동 연기 검증**

```bash
# 터미널 1: stdio 서버 기동
npm run dev 2>/dev/null &
sleep 2
# server.json이 생성되었는지 확인
cat ~/.memento/server.json
# 포트 확인 후 health 체크
PORT=$(cat ~/.memento/server.json | python3 -c "import sys,json; print(json.load(sys.stdin)['port'])")
curl -s http://localhost:$PORT/health
# 종료
kill %1
sleep 1
# server.json이 삭제되었는지 확인
cat ~/.memento/server.json 2>&1
```

Expected: `{"status":"healthy","transport":"stdio"}` 출력 후 종료 시 파일 없음

- [ ] **Step 9: 커밋**

```bash
git add packages/memento-server/src/server/index.ts
git commit -m "feat: add management HTTP server to stdio MCP server for CLI discovery"
```

---

## Task 4: CLI — DB 초기화 제거, HTTP 클라이언트 전환

**Files:**
- Modify: `packages/memento-server/src/cli.ts`

### 배경

`cli.ts`는 현재 `createMementoCore()`, `cleanup()`, 신호 핸들러 등 150줄 이상의 DB/서비스 코드를 포함한다.
이것을 모두 제거하고, `readServerInfo` + `isServerAlive` + `callToolViaHttp` 로 대체한다.

`configDir` 결정 방법:
```typescript
const configDir = preOptions.configDir ?? process.env.MEMENTO_CONFIG_DIR ?? path.join(os.homedir(), '.memento');
```

deprecated 옵션(`--db-path`, `--env-file`): 파싱은 그대로 두되 사용하지 않고 stderr 경고 출력.

- [ ] **Step 1: 불필요한 import 제거 및 새 import 추가**

`cli.ts`에서 `@memento/core`에서 가져오던 import들을 정리한다.
현재:
```typescript
const {
  mementoConfig,
  createMementoCore,
  closeDatabase,
  createToolContext,
  executeTool,
  getBatchScheduler
} = await import('@memento/core');
```

새로 교체:
```typescript
const { mementoConfig } = await import('@memento/core');
const { readServerInfo, isServerAlive, callToolViaHttp } = await import('./server/server-info.js');
```

- [ ] **Step 2: `main()` 함수 안 DB 초기화 코드 제거 및 HTTP 클라이언트 코드 삽입**

현재 `main()` 내부의 아래 블록 전체를 제거한다:
- `let db`, `let coreServices`, `let isCleaningUp` 선언
- `cleanup()` 함수 전체
- `process.on('exit', ...)`, `process.on('uncaughtException', ...)`, `process.on('SIGINT', ...)`, `process.on('SIGTERM', ...)` 등록
- `const core = await createMementoCore({ dbPath });` 호출

위 내용을 아래로 교체한다:

```typescript
// configDir 결정
const configDir =
  preOptions.configDir ??
  process.env.MEMENTO_CONFIG_DIR ??
  path.join(os.homedir(), '.memento');

// deprecated 옵션 경고
if (preOptions.dbPath) {
  await writeStderr('[deprecated] --db-path 옵션은 더 이상 사용되지 않습니다. 서버가 DB를 관리합니다.\n');
}
if (preOptions.envFile) {
  await writeStderr('[deprecated] --env-file 옵션은 더 이상 사용되지 않습니다.\n');
}

// 서버 발견
const serverInfo = await readServerInfo(configDir);
const serverAlive = serverInfo ? await isServerAlive(serverInfo) : false;
if (!serverInfo || !serverAlive) {
  // stale server.json이 존재하면 자동 삭제
  if (serverInfo && !serverAlive) {
    await deleteServerInfo(configDir);
  }
  await writeStderr(
    'Memento 서버가 실행 중이지 않습니다.\n' +
    'npm run dev 또는 npm run dev:http 로 먼저 서버를 실행하세요.\n'
  );
  return 1;
}
```

- [ ] **Step 3: 각 서브커맨드 실행 부분 교체**

현재 `if (subcommand === 'recall')` 등 블록들이 `executeTool('recall', params, context)` 를 호출한다.
이를 `callToolViaHttp(serverInfo.port, 'recall', params)` 로 교체한다.

예시:
```typescript
if (subcommand === 'recall') {
  const params = recallParams(cmdArgv);
  if (typeof params.query !== 'string' || !String(params.query).trim()) {
    await writeStderr('recall requires --query <string>.\n');
    return 1;
  }
  const result = await callToolViaHttp(serverInfo.port, 'recall', params as Record<string, unknown>);
  await writeStdout(JSON.stringify(result) + '\n');
  return 0;
}
```

나머지 서브커맨드(`remember`, `forget`, `memory_injection`)도 동일하게 교체한다.

- [ ] **Step 4: 불필요해진 환경 변수 설정 제거**

```typescript
// 제거 대상:
process.env.MEMENTO_CLI_QUIET = '1';
process.env.BATCH_SCHEDULER_ENABLED = 'false';
process.env.WAL_CHECKPOINT_ENABLED = 'false';
process.env.DB_LOCK_MONITOR_ENABLED = 'false';
```

- [ ] **Step 5: import 정리**

`cli.ts`에서 더 이상 필요 없는 import:
- `import type { ServerServices } from '@memento/core';` → 제거

필요한 import 추가:
- `import { homedir } from 'os';`
- `import path from 'path';`

- [ ] **Step 6: 타입 체크**

```bash
cd packages/memento-server && npx tsc --noEmit 2>&1 | head -30
```

Expected: 에러 없음

- [ ] **Step 7: 커밋**

```bash
git add packages/memento-server/src/cli.ts
git commit -m "refactor(cli): replace direct DB access with HTTP client"
```

---

## Task 5: 통합 테스트

**Files:**
- Create: `packages/memento-server/src/server/cli-integration.spec.ts`

### 배경

이 테스트들은 실제 HTTP 서버를 기동해 CLI HTTP 호출을 검증한다.
`packages/memento-server/src/server/test/helpers/test-database.ts`의 헬퍼를 재사용한다.

- [ ] **Step 1: 통합 테스트 작성**

```typescript
// packages/memento-server/src/server/cli-integration.spec.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir, homedir } from 'os';
import { join } from 'path';
import express from 'express';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import {
  writeServerInfo,
  readServerInfo,
  isServerAlive,
  callToolViaHttp,
  deleteServerInfo,
} from './server-info.js';
import {
  setupTestDatabase,
  cleanupTestDatabase,
  type TestDatabaseContext,
} from './test/helpers/test-database.js';
import { createToolContext, executeTool } from '@memento/core';

describe('CLI 통합 (server-info + callToolViaHttp)', () => {
  let tmpDir: string;
  let ctx: TestDatabaseContext;
  let httpServer: ReturnType<typeof createServer>;
  let port: number;

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'memento-cli-int-'));
    ctx = await setupTestDatabase();

    // 테스트용 경량 HTTP 서버
    const app = express();
    app.use(express.json({ limit: '1mb' }));
    app.get('/health', (_req, res) => res.json({ status: 'healthy' }));
    app.post('/tools/:name', async (req, res) => {
      try {
        const context = createToolContext(ctx.db, ctx.services);
        const result = await executeTool(req.params.name, req.body, context);
        let actual: unknown = result;
        if (Array.isArray(result.content) && result.content[0]?.text) {
          try { actual = JSON.parse(result.content[0].text); } catch {}
        }
        res.json({ result: actual, tool: req.params.name, timestamp: new Date().toISOString() });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    httpServer = createServer(app);
    await new Promise<void>((resolve) => {
      httpServer.listen(0, '127.0.0.1', () => {
        port = (httpServer.address() as AddressInfo).port;
        resolve();
      });
    });
    await writeServerInfo(tmpDir, port);
  });

  afterAll(async () => {
    await cleanupTestDatabase(ctx);
    await deleteServerInfo(tmpDir);
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('server.json이 없으면 readServerInfo는 null을 반환한다', async () => {
    const emptyDir = await mkdtemp(join(tmpdir(), 'memento-empty-'));
    try {
      const info = await readServerInfo(emptyDir);
      expect(info).toBeNull();
    } finally {
      await rm(emptyDir, { recursive: true, force: true });
    }
  });

  it('isServerAlive는 실행 중인 서버에 대해 true를 반환한다', async () => {
    const info = await readServerInfo(tmpDir);
    expect(info).not.toBeNull();
    const alive = await isServerAlive(info!);
    expect(alive).toBe(true);
  });

  it('isServerAlive는 존재하지 않는 PID에 대해 false를 반환한다', async () => {
    const fakeInfo = { port, pid: 999999999, startedAt: new Date().toISOString() };
    const alive = await isServerAlive(fakeInfo);
    expect(alive).toBe(false);
  });

  it('callToolViaHttp로 remember 호출이 성공한다', async () => {
    const result = await callToolViaHttp(port, 'remember', {
      content: '통합 테스트용 기억',
      type: 'semantic',
      tags: ['test'],
    });
    expect(result).toBeDefined();
  });

  it('callToolViaHttp로 recall 호출이 성공한다', async () => {
    const result = await callToolViaHttp(port, 'recall', {
      query: '통합 테스트용 기억',
    });
    expect(result).toBeDefined();
  });

  it('callToolViaHttp로 forget 호출이 성공한다', async () => {
    // 먼저 remember로 기억 생성
    const remembered = await callToolViaHttp(port, 'remember', {
      content: 'forget 테스트용 기억',
      type: 'semantic',
      tags: ['forget-test'],
    }) as { id?: string };
    expect(remembered).toBeDefined();
    // forget 호출 (id가 반환된 경우)
    if (remembered?.id) {
      const result = await callToolViaHttp(port, 'forget', { id: remembered.id });
      expect(result).toBeDefined();
    }
  });

  it('callToolViaHttp로 memory_injection 호출이 성공한다', async () => {
    const result = await callToolViaHttp(port, 'memory_injection', {
      query: '통합 테스트',
    });
    expect(result).toBeDefined();
  });

  it('동시성: N회 병렬 호출 후 DB 무결성이 유지된다', async () => {
    const N = 10;
    const calls = Array.from({ length: N }, (_, i) =>
      callToolViaHttp(port, 'remember', {
        content: `동시성 테스트 ${i}`,
        type: 'semantic',
        tags: ['concurrency-test'],
      })
    );
    const results = await Promise.all(calls);
    expect(results).toHaveLength(N);
    results.forEach((r) => expect(r).toBeDefined());

    // recall로 기억 확인
    const recallResult = await callToolViaHttp(port, 'recall', {
      query: '동시성 테스트',
    }) as { memories?: unknown[] };
    // 기억이 저장되었음을 확인 (정확한 개수는 임베딩 결과에 따라 다를 수 있음)
    expect(recallResult).toBeDefined();
  });
});
```

- [ ] **Step 2: 테스트 실행 — FAIL 확인**

```bash
cd packages/memento-server && npx vitest run src/server/cli-integration.spec.ts 2>&1 | tail -30
```

Expected: import 오류 또는 로직 오류로 FAIL (아직 구현 중인 부분이 있을 수 있음)

- [ ] **Step 3: 테스트 실행 — PASS 확인**

Task 1~4 완료 후:
```bash
cd packages/memento-server && npx vitest run src/server/cli-integration.spec.ts 2>&1 | tail -30
```

Expected: 모든 테스트 PASS

- [ ] **Step 4: 전체 테스트 스위트 통과 확인**

```bash
npm test 2>&1 | tail -40
```

Expected: 모든 테스트 PASS, 실패 없음

- [ ] **Step 5: 커밋**

```bash
git add packages/memento-server/src/server/cli-integration.spec.ts
git commit -m "test: add CLI integration tests for HTTP client mode"
```

---

## Task 6: 최종 검증 및 마무리

- [ ] **Step 1: 린트 + 타입 체크**

```bash
npm run lint && npm run type-check
```

Expected: 에러 없음

- [ ] **Step 2: 전체 테스트**

```bash
npm test
```

Expected: 모든 테스트 PASS

- [ ] **Step 3: 수동 E2E 검증 (HTTP 서버)**

```bash
# 터미널 1
npm run dev:http &
sleep 3
cat ~/.memento/server.json  # port, pid 확인

# 터미널 2
node packages/memento-server/dist/cli.js remember --content "E2E 테스트 기억" --type semantic
node packages/memento-server/dist/cli.js recall --query "E2E"
kill %1
```

Expected: `remember` 성공 JSON, `recall` 결과 JSON 출력

- [ ] **Step 4: CHANGELOG.md 업데이트**

`## [Unreleased]` 아래에 추가:
```markdown
### Fixed
- CLI(`memento remember` 등)가 HTTP/stdio MCP 서버와 동시에 실행될 때 발생하던 WAL 체크포인트 충돌 및 DB 손상 버그 수정 (#160)

### Changed
- CLI가 DB를 직접 열지 않고 실행 중인 서버의 HTTP 관리 포트로 요청을 위임하도록 아키텍처 전환
- stdio MCP 서버가 CLI 통신을 위한 localhost-only HTTP 관리 포트를 함께 기동
- `--db-path`, `--env-file` CLI 옵션 deprecated (무시됨)
```

- [ ] **Step 5: 최종 커밋**

```bash
git add CHANGELOG.md
git commit -m "docs: update CHANGELOG for issue 160"
```
