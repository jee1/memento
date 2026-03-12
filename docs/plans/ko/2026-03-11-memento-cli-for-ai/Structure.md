# Memento CLI for AI — Structure (Memory Bank)

SDD **Plan** 단계의 **Memory Bank** 문서 1/3. 시스템 아키텍처, 컴포넌트 간 관계, 디렉터리 구조를 정의한다.  
**기준 명세**: [specs/ko/2026-03-11-memento-cli-for-ai-spec.md](../../specs/ko/2026-03-11-memento-cli-for-ai-spec.md)

---

## 1. 시스템 아키텍처

### 1.1 모노레포 구조

- **루트**: npm workspaces. `packages/memento-core`, `packages/memento-server`, `packages/memento-client`, `apps/*` 포함.
- **CLI 소속**: CLI는 **packages/memento-server** 패키지 내부에만 존재한다. 별도 패키지로 분리하지 않음(명세 Out of scope).
- **실행 모드 구분**:
  - `memento` bin → **CLI 모드** (한 번 실행 후 stdout에 JSON 출력하고 종료).
  - `memento-mcp-server` / `memento-mcp` bin → **stdio MCP** (기존 index.js).
  - `memento-dev` bin → **HTTP 서버** (기존 http-server.js).
- **제약**: 기존 bin 동작은 변경하지 않는다(명세 CON-2).

### 1.2 CLI와 Core 관계

```
[사용자/AI] → memento [글로벌 옵션] <서브커맨드> [옵션]
       ↓
[cli.ts] → env 로드(env-loader) → 글로벌 옵션 파싱 → dbPath 결정
       ↓
       → 동적 import('@memento/core')
       → createMementoCore({ dbPath }) → db, services
       → createToolContext(db, services), getToolRegistry()
       → 옵션→params 매핑(option-map) → executeTool(name, params, context)
       → 성공: stdout에 JSON / 실패: stderr + exit(1)
       → 종료 전 closeDatabase()
```

- **Core 재사용**: `createMementoCore`, `closeDatabase`, `createToolContext`, `getToolRegistry`, `toolRegistry.execute`는 **@memento/core**에서 제공. MCP/HTTP 서버와 동일한 도구 집합·동일 DB 스키마 사용.

---

## 2. 컴포넌트 간 관계

| 컴포넌트 | 역할 | 의존 |
|----------|------|------|
| **cli.ts** | 진입점. 글로벌 옵션 파싱, env 로드 호출, dbPath 결정, 서브커맨드 라우팅, Core 초기화·도구 실행·stdout/stderr/exit 처리. | env-loader, option-map, @memento/core |
| **cli/env-loader.ts** | .env 탐색 순서 구현, dotenv 로드. CLI 진입 시 **core import 전** 호출. | dotenv, Node path/os/fs |
| **cli/option-map.ts** | 서브커맨드별 argv → MCP 도구 params 변환(recallParams, rememberParams, forgetParams, memoryInjectionParams). | 없음(순수 함수) |
| **@memento/core** | DB·서비스·도구 레지스트리. CLI는 **소비자**이며 core 내부 구조를 변경하지 않음. | SQLite, 기존 도메인/인프라 |

- **데이터 흐름**: argv → parseGlobalOptions → loadEnv → dbPath/subcommand → (도구 실행 시) createMementoCore → option-map(argv) → params → executeTool → result → stdout/stderr.

---

## 3. 디렉터리 구조

### 3.1 packages/memento-server (CLI 관련만)

```
packages/memento-server/
├── package.json          # bin "memento": "./dist/cli.js"
├── src/
│   ├── cli.ts            # CLI 진입점 (단일 실행, 서버 대기 없음)
│   └── cli/
│   ├── env-loader.ts     # .env 탐색·로드
│   ├── option-map.ts      # 서브커맨드별 argv → params
│   └── cli-ac5-ac6.spec.ts  # AC5/AC6 통합 테스트
├── dist/
│   ├── cli.js            # 빌드 산출물 (진입점)
│   └── cli/              # env-loader.js, option-map.js
└── ...
```

- **server/** 디렉터리: 기존 MCP/HTTP 코드. **CLI에서 수정하지 않음**. context.ts는 `createToolContext`를 core에서 re-export; CLI는 core를 직접 import하여 사용 가능.

### 3.2 기존 진입점과의 병존

| 진입점 | 경로 | 용도 |
|--------|------|------|
| MCP stdio | src/server/index.ts → dist/server/index.js | MCP 클라이언트 연결 |
| HTTP | src/server/http-server.ts → dist/server/http-server.js | HTTP/SSE 서버 |
| **CLI** | **src/cli.ts → dist/cli.js** | **한 번 실행 후 JSON 반환** |

---

## 4. 인터페이스 경계

- **CLI ↔ Core**: `createMementoCore({ dbPath })`, `createToolContext(db, services)`, `getToolRegistry()`, `registry.execute(name, params, context)`. Core가 제공하는 공개 API만 사용.
- **CLI ↔ 환경**: `process.argv`, `process.env`, `process.stdout`/`process.stderr`, `process.exit`. .env는 env-loader를 통해서만 로드.
- **CLI ↔ 사용자**: stdin 사용하지 않음. 모든 입력은 argv와 환경변수·.env로만.

---

*이 문서는 Plan 단계의 헌칙으로, Tasks/Implement 시 아키텍처·구조 변경 시 이 문서를 먼저 갱신한다.*
