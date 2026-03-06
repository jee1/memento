---
title: MCP 로그 두 번 출력 (두 프로세스 / Cursor UI)
problem_type: integration-issues
component: mcp-server
date: 2026-03-05
tags:
  - mcp
  - logging
  - single-instance
  - cursor
symptom: MCP 서버 stderr 로그가 동일 메시지가 연속 두 줄씩 출력됨.
---

# MCP 로그 두 번 출력 (두 프로세스 / Cursor UI)

## 문제

- MCP 서버(user-project-memento) stderr 로그가 동일한 메시지가 연속 두 줄씩 출력됨.
- [BATCH], [SERVER], pipe 형식(타임스탬프 | 레벨 | 메시지) 모두 동일.

## 근본 원인

Cursor가 동일한 Memento MCP 서버를 **두 개의 Node 프로세스**로 기동함(user 스코프 + project 스코프). 각 프로세스가 같은 DB/설정으로 동시에 기동되며, 각각 stderr에 로그를 기록하므로 Cursor가 두 프로세스의 stderr를 한 창에 모아 보여줄 때 모든 로그가 두 번씩 찍혀 보인다. 서버는 프로세스당 한 번만 출력하고 있으며, 중복은 **두 프로세스 기동 + (또는) Cursor UI의 이중 표시**에서 발생한다.

## 해결 방법

### 1. 단일 인스턴스 lock (`src/server/instance-lock.ts`)

- Lock 파일 `memento-mcp.lock`를 DB 경로와 같은 디렉터리에 둠. 파일 내용은 실행 중인 프로세스 PID.
- `tryAcquireLock(dbPath)`: lock이 없거나 기존 PID가 죽었으면 lock 생성/덮어쓰고 `{ acquired: true }` 반환; 다른 프로세스가 lock을 보유 중이면(`isProcessAlive(existingPid)`) `{ acquired: false, existingPid }` 반환.
- `releaseLock()`: 종료 시 lock 파일 제거(cleanup에서 호출).

### 2. 시작 시 동작 (`src/server/index.ts`)

- DB 경로 확정 후(`mementoConfig.dbPath`) `MEMENTO_SINGLETON≠'0'`이면 `tryAcquireLock` 호출. lock을 얻지 못하면 stderr에 "이미 다른 인스턴스가 실행 중(PID …)" 메시지를 남기고 `process.exit(0)`.
- stderr에 진단용 한 줄 출력: `[Memento MCP] instance pid=... id=...` (id는 짧은 랜덤 문자열).
- cleanup(SIGINT/SIGTERM 및 정상 종료) 시 `releaseLock()` 호출.

### 3. 로거 (`src/server/mcp-logger.ts`)

- 모듈 스코프 dedup: 동일 level+message가 `LOG_DEDUP_MS`(2000ms) 안에 있으면 한 프로세스당 한 번만 출력.

## 검증

- **터미널**: `npm run build` 후 `node dist/server/index.js` 실행. 각 로그가 한 번씩만 출력되고, 첫 줄은 `[Memento MCP] instance pid=... id=...`.
- **Cursor**: MCP 로그 창에서는 동일 메시지가 여전히 두 번 나올 수 있음. 이는 서버가 두 번 찍는 것이 아니라 Cursor(두 프로세스 또는 UI 집계) 쪽 원인임을 의미함.

## 참고

- Cursor UI에서의 중복은 서버만으로는 제거할 수 없음. 서버는 프로세스당 한 번만 로그하며, lock으로 DB당 한 프로세스만 실행되도록 했음.
- user/project 양쪽에서 Memento를 쓰고 싶다면 환경 변수 `MEMENTO_SINGLETON=0`으로 lock 비활성화.

## 관련 문서

- [docs/plans/2026-03-05-mcp-log-duplicate-root-cause-and-fix.md](../../plans/2026-03-05-mcp-log-duplicate-root-cause-and-fix.md) — 근본 원인 및 수정 설계(단일 인스턴스 lock, 검증 방법).
- [AGENTS.md](../../../AGENTS.md) — MCP 진입점, 빌드·테스트 가이드.
- [docs/reference/ko/logging-schema.md](../../reference/ko/logging-schema.md) — 로거 인터페이스, MCP 모드, 로그 스키마.
- [docs/guides/ko/cursor-mcp-setup.md](../../guides/ko/cursor-mcp-setup.md) — Cursor에서 Memento MCP 설정.
- [docs/architecture/ko/architecture.md](../../architecture/ko/architecture.md) — 시스템 개요, MCP·메모리 서버.

## 재발 방지 및 권장 사항

- **단일 인스턴스 패턴**: 같은 DB를 쓰는 MCP 서버는 lock으로 한 프로세스만 기동하도록 유지.
- **진단 로그**: 시작 시 `[Memento MCP] instance pid=... id=...` 한 줄로 실제 기동 횟수·PID 확인 가능. 로그에서 서로 다른 PID가 두 번 보이면 두 프로세스가 기동된 것.
- **환경 변수**: 의도적으로 user/project 양쪽에서 Memento를 쓸 때만 `MEMENTO_SINGLETON=0` 사용.
- **테스트 아이디어**: (선택) lock 보유 중인 상태에서 두 번째 프로세스 기동 시 exit(0) 및 stderr 메시지 검증.
