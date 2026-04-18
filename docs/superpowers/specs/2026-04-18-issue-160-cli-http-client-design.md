# Issue 160: CLI → HTTP 클라이언트 전환 설계

**날짜**: 2026-04-18  
**이슈**: [#160](https://github.com/jee1/memento/issues/160) — HTTP 서버 실행 중 CLI remember 시 DB 손상  
**상태**: 설계 확정

---

## 문제 요약

CLI(`memento remember` 등)가 `createMementoCore()`를 직접 호출해 DB를 열고, 서버 전용 장기 실행 서비스(WalCheckpointScheduler, BatchScheduler 등)까지 초기화한다. HTTP 또는 stdio MCP 서버가 동시에 실행 중일 때 WAL 체크포인트 경합 및 stale read mark가 발생해 DB가 손상된다.

---

## 핵심 원칙

**CLI는 DB를 직접 건드리지 않는다.**  
모든 서버 모드(HTTP, stdio MCP)는 로컬 HTTP 관리 포트를 노출하며, CLI는 해당 포트로만 통신한다.

---

## 아키텍처

```
[CLI]
  └─ server.json 읽기 → port 확인
  └─ POST http://localhost:{port}/tools/{subcommand}
          │
[서버 (HTTP 또는 stdio MCP)]
  └─ /tools/:name 라우터 처리
  └─ DB 접근 및 결과 반환
```

---

## 구성 요소

### 1. 서버 정보 파일 (`server.json`)

**위치**: `{configDir}/server.json` (기본: `~/.memento/server.json`)

**형식**:
```json
{
  "port": 51764,
  "pid": 12345,
  "startedAt": "2026-04-18T10:00:00.000Z"
}
```

- 모든 서버 모드가 기동 시 기록, 종료 시 삭제
- CLI가 서버를 발견하는 유일한 방법
- PID 검증: 파일이 존재하더라도 해당 PID 프로세스가 살아있는지 확인 후 사용

### 2. `src/server/server-info.ts` (신규)

서버 정보 파일 읽기/쓰기/삭제 유틸리티:

```typescript
export interface ServerInfo {
  port: number;
  pid: number;
  startedAt: string;
}

export async function writeServerInfo(configDir: string, port: number): Promise<void>
export async function readServerInfo(configDir: string): Promise<ServerInfo | null>
export async function deleteServerInfo(configDir: string): Promise<void>
export async function isServerAlive(info: ServerInfo): Promise<boolean>  // PID 검증
```

### 3. stdio 서버 (`src/server/index.ts`) 변경

기존 stdio MCP 로직 유지, HTTP 관리 서버 병행 기동 추가:

- 기동 시 Express 앱으로 `/tools/:name` 라우터만 마운트한 HTTP 서버를 포트 `:0`(OS 자동 배정)으로 올림
- 실제 바인딩된 포트를 `server.json`에 기록
- `SIGINT`/`SIGTERM`/`exit` 시 HTTP 서버 닫고 `server.json` 삭제

### 4. HTTP 서버 (`src/server/http-server.ts`) 변경

- 기존 Express 서버가 listen 완료 후 포트를 `server.json`에 기록
- `SIGINT`/`SIGTERM`/`exit` 시 `server.json` 삭제

### 5. CLI (`src/cli.ts`) 변경

`createMementoCore()` 호출 및 모든 DB/서비스 초기화 코드 제거:

```typescript
// 기존 흐름 (제거)
const core = await createMementoCore({ dbPath });
// ...서비스 초기화, cleanup 등

// 새 흐름
const info = await readServerInfo(configDir);
if (!info || !(await isServerAlive(info))) {
  await writeStderr('Memento 서버가 실행 중이지 않습니다. npm run dev 또는 npm run dev:http로 먼저 실행하세요.\n');
  process.exit(1);
}
const result = await callToolViaHttp(info.port, subcommand, params);
await writeStdout(JSON.stringify(result) + '\n');
```

`cleanup()` 함수 전체 제거 — DB 연결이 없으므로 정리할 것 없음.

---

## 오류 처리

| 상황 | 동작 |
|---|---|
| `server.json` 없음 | "서버가 실행 중이지 않습니다" 에러 후 exit 1 |
| PID 검증 실패 (stale file) | 위와 동일 |
| HTTP 요청 실패 (연결 거부) | "서버에 연결할 수 없습니다 (port: {port})" 에러 후 exit 1 |
| HTTP 응답 오류 (4xx/5xx) | 서버 응답 메시지를 stderr에 출력 후 exit 1 |
| 타임아웃 | 30초 후 타임아웃, 에러 후 exit 1 |

---

## 변경 파일 요약

| 파일 | 변경 유형 | 내용 |
|---|---|---|
| `packages/memento-server/src/server/server-info.ts` | 신규 | ServerInfo 읽기/쓰기/삭제 유틸 |
| `packages/memento-server/src/server/index.ts` | 수정 | HTTP 관리 포트 병행 기동, server.json 기록/삭제 |
| `packages/memento-server/src/server/http-server.ts` | 수정 | server.json 기록/삭제 |
| `packages/memento-server/src/cli.ts` | 수정 | DB 초기화 제거, HTTP 클라이언트로 교체 |

---

## 테스트 전략

- `server-info.ts` 유닛 테스트: 읽기/쓰기/삭제/PID 검증
- CLI 통합 테스트: 서버 없을 때 에러 메시지 검증
- CLI 통합 테스트: 실제 HTTP 서버 기동 후 `remember`/`recall` 왕복 테스트

---

## 마이그레이션 영향

- 기존 CLI 사용자: 서버 없이 CLI만 사용하는 워크플로우는 더 이상 지원되지 않음 → 문서 및 에러 메시지로 명확히 안내
- 환경 변수 `BATCH_SCHEDULER_ENABLED`, `WAL_CHECKPOINT_ENABLED`, `DB_LOCK_MONITOR_ENABLED`는 CLI에서 불필요 (제거 가능)
