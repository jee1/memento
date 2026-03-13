# 모노레포 + Memento(core) 구현 계획

---

## title: 모노레포 전환 및 memento-core/server/client 3패키지 분리
type: refactor
status: active
date: 2026-03-04

**Goal:** 현재 단일 패키지 저장소를 모노레포로 전환하고, Memento를 3패키지(core / server / client)로 분리한 뒤 apps/에서 실험 서비스를 관리할 수 있게 한다.

**Architecture:** Approach A (3패키지 분리). packages/memento-core(라이브러리 API), packages/memento-server(core 소비, MCP/HTTP), packages/memento-client(기존 mcp-client), apps/(실험 서비스). 서비스는 @memento/core(in-process) 또는 @memento/client(원격) 중 선택.

**Tech Stack:** npm workspaces(또는 선호 시 pnpm/Turborepo), TypeScript, Vitest, 기존 src/ 구조.

**설계·브레인스토밍:** [design.md](./design.md)  
**현황 조사:** [monorepo-migration-current-state-report.md](../../../reference/ko/monorepo-migration-current-state-report.md)

---

## Overview

- **모노레포** 도입: 루트에 workspaces 정의, packages/ 및 apps/ 구성.
- **memento-core**: domains + infrastructure + shared만 포함, MCP/HTTP/도구 레지스트리 없음. 라이브러리 진입점(예: createMementoCore, recall, remember 등)만 export.
- **memento-server**: memento-core 의존, server/ + tools/, 기존 bin(MCP stdio/HTTP) 유지.
- **memento-client**: 기존 packages/mcp-client를 packages/memento-client로 정리. 소스 위치(src/npm-client vs packages/memento-client/src) 결정 후 CI에 빌드·테스트 포함.
- **apps/**: 실험 서비스 템플릿 또는 예시 1개. 각 서비스는 연결 방식(라이브러리 vs 서버)을 README에 명시.

## Problem Statement / Motivation

- Memento를 활용하는 여러 서비스를 실험하고 싶으나, 현재는 단일 패키지·단일 진입점(서버)만 있어 라이브러리로 재사용하거나 서비스별 격리가 어렵다.
- 모노레포 + core 분리로 (1) 실험 속도 향상(앱 추가/제거 용이, 코어 수정 반영 명확), (2) 배포 경계 명확화(나중에 @memento/core, memento-server 각각 npm 배포 가능)를 달성한다.

## Proposed Solution (요약)

- 루트 package.json에 workspaces 추가.
- src/ 내용을 패키지별로 분리: core용 진입점·에셋 경로를 core 패키지 기준으로 통일, server는 core 의존, client는 기존 기능 유지하되 패키지 경로·소스 위치 정리.
- core 라이브러리 사용을 위해 **DB 경로·설정 주입 API**(createMementoCore(options)) 명세 및 구현.
- 에셋(schema, migrations) 경로는 core 패키지 루트 기준 상대경로로 고정.
- CI: core → server → client 순서 빌드, 각 패키지 테스트, (선택) apps 예시 빌드.

## Technical Considerations

- **의존 관계**: server → core, tools → domains/*/tools(도메인 레이어). core 분리 시 server/tools는 core를 import하는 계층만 유지.
- **DB·설정**: 현재 env 단일 진입점(DB_PATH, mementoConfig). core 라이브러리화 시 호출자가 dbPath·config를 주입하는 API 필요. 서버는 기존처럼 env 사용.
- **에셋**: copy-assets.js가 projectRoot 기준으로 동작. core 패키지로 이동 시 projectRoot를 패키지 루트로 고정하고, 런타임 에셋 로딩도 동일 기준으로 통일.
- **클라이언트 소스**: 현재 src/npm-client → packages/mcp-client/dist. 모노레포에서 packages/memento-client/src로 이전할지, 루트 src/npm-client 참조를 유지할지 결정 필요(권장: 이전하여 패키지 자족성 확보).
- **빌드 순서**: core → server → client. 워크스페이스 스크립트 또는 Turborepo 등으로 순서 보장.

## Acceptance Criteria

- 루트에 workspaces가 정의되어 있고, packages/memento-core, memento-server, memento-client 및 apps/ 예시 1개가 포함된다.
- packages/memento-core는 domains + infrastructure + shared만 포함하며, MCP/HTTP/도구 레지스트리 코드는 없다. 라이브러리 진입점(createMementoCore 등)만 export한다.
- packages/memento-server는 @memento/core에만 의존하며, 기존 MCP stdio/HTTP bin과 도구 노출이 동작한다.
- packages/memento-client는 서버에 연결하는 클라이언트로, 기존 @memento/client 기능을 유지한다. 소스 위치가 결정되어 있고 CI에서 빌드·테스트된다.
- core를 라이브러리로 사용할 때 DB 경로·필요 설정을 옵션으로 주입하는 API(예: createMementoCore({ dbPath, config? }))가 존재하고 문서화되어 있다.
- schema/migrations 등 에셋 경로는 core 패키지 루트 기준 상대경로로 고정되어 있으며, copy-assets 및 런타임 로딩이 이에 맞춰 동작한다.
- 루트 npm run build 시 core → server → client 순서가 보장되고, 각 패키지가 의존하는 패키지는 이미 빌드된 상태이다.
- apps/* 패키지는 @memento/core 또는 @memento/client만 의존한다(server 패키지 직접 의존 없음). 예시 앱 1개의 README에 연결 방식(라이브러리 vs 서버)이 명시되어 있다.
- (선택) dbPath 검증 또는 절대경로 정규화 규칙이 한 곳에 명시되어 있다.

## Success Metrics

- 기존 단일 패키지에서 실행하던 MCP/HTTP 서버가 packages/memento-server에서 동일하게 동작한다.
- packages/memento-core를 import하여 recall/remember 등을 호출하는 최소 1개 예시(CLI 또는 앱)가 동작한다.
- npm run build, npm test가 루트에서 실행 시 모든 패키지가 빌드·테스트를 통과한다.

## Dependencies & Risks

- **의존성**: 패키지 매니저 선택(npm workspaces vs pnpm vs Turborepo)이 Open Question. 기본은 npm workspaces로 진행 가능.
- **리스크**: core 분리 시 server/domains 간 순환 참조, init/부트스트랩 경로 변경으로 인한 회귀. 단계별 검증(빌드·테스트)으로 완화.
- **클라이언트 소스 이전**: src/npm-client → packages/memento-client/src 이동 시 기존 빌드 스크립트·tsconfig 참조 수정 필요.

## References & Research

- 브레인스토밍: [design.md](./design.md)
- 현황 조사: [monorepo-migration-current-state-report.md](../../../reference/ko/monorepo-migration-current-state-report.md)
- 스펙 플로우 분석: DB 경로 주입 API, 에셋 경로, 클라이언트 소스 위치, 워크스페이스 빌드 순서 등 수용 기준 반영됨.

---

## Phase 1: 워크스페이스 및 루트 설정

### Task 1.1: 루트 package.json에 workspaces 정의

**목표:** packages/* 및 apps/*를 워크스페이스로 등록한다.

**Steps:**

1. 루트 `package.json`에 `"workspaces": ["packages/*", "apps/*"]` 추가. (npm 7+)
2. 기존 `name`은 유지하거나 루트 전용 이름(예: `memento-monorepo`)으로 변경. 기존 `main`/`bin`은 Phase 2 이후 server 패키지로 이전될 때 제거할 예정이므로, 이 단계에서는 주석 또는 TODO로 표시만 해도 됨.
3. 검증: `npm install` 실행 후 `node_modules` 하위에 패키지 링크가 생기는지 확인. (아직 packages/* 구조가 없으면 1.2 선행)

**검증:** `npm install` 성공.

---

### Task 1.2: packages/ 및 apps/ 디렉터리 골격 생성

**목표:** packages/memento-core, packages/memento-server, packages/memento-client, apps/experimental-example 디렉터리와 각 package.json 골격을 만든다. 이 단계에서는 **기존 src/는 아직 옮기지 않는다**.

**Steps:**

1. `packages/memento-core/package.json` 생성: name `@memento/core`, private true, main/types/exports 골격만.
2. `packages/memento-server/package.json` 생성: name `memento-server`(또는 `@memento/server`), dependencies에 `@memento/core` workspace 참조(`"@memento/core": "*"` 또는 `"workspace:*"`).
3. `packages/memento-client/package.json`: 기존 `packages/mcp-client/package.json`을 `packages/memento-client/`로 복사 후 name을 `@memento/client` 유지, 나머지 경로만 필요 시 조정.
4. `apps/experimental-example/package.json` 생성: name `experimental-example`, dependencies에 `@memento/core` 또는 `@memento/client` 중 하나만.
5. 루트 workspaces가 `packages/`*, `apps/*`를 포함하도록 이미 되어 있다면 `npm install`로 링크 확인.

**검증:** `npm install` 후 각 패키지가 node_modules에서 링크됨.

---

## Phase 2: memento-core 패키지 구성

### Task 2.1: core에 이동할 소스 식별 및 복사

**목표:** domains, infrastructure, shared를 packages/memento-core/src/ 아래로 복사한다. server/, tools/는 제외.

**Steps:**

1. `packages/memento-core/src/domains/`, `infrastructure/`, `shared/` 생성 후 현재 `src/domains`, `src/infrastructure`, `src/shared` 내용을 복사.
2. 패키지 내부 import 경로는 상대 경로 또는 `@memento/core` 내부 alias로 정리(Phase 2.2 tsconfig와 함께).
3. server, tools에서만 쓰이는 코드(예: ToolContext, getToolRegistry)는 core에 두지 않는다.

**검증:** core 패키지에서 `tsc --noEmit` 가능 (진입점이 아직 없으면 일부 에러 허용).

---

### Task 2.2: core 라이브러리 진입점 및 export 정의

**목표:** createMementoCore(options?), recall, remember 등 라이브러리 API를 하나의 진입점(예: index.ts)에서 export한다.

**Steps:**

1. `packages/memento-core/src/index.ts` 생성. export할 함수/클래스: 초기화(createMementoCore), recall, remember, forget, anchor 관련, search_local 등. (기존 도구 구현이 도메인에 있으므로, 그 구현을 감싸는 얇은 API 레이어.)
2. createMementoCore(options: { dbPath: string; config?: Partial<...> }) 명세: DB 경로와 선택 설정을 받아, 기존 init/설정 로드 대신 주입된 값을 사용하도록 한다. env 폴백은 server 전용으로 문서에만 명시.
3. package.json의 `main`, `types`, `exports`를 해당 진입점으로 설정.
4. tsconfig.json: rootDir `src`, outDir `dist`, 필요한 path/alias 설정.

**검증:** 다른 패키지에서 `import { createMementoCore } from '@memento/core'` 후 타입 체크 통과.

---

### Task 2.3: core 에셋 경로 통일 (schema, migrations)

**목표:** schema.sql, migrations를 core 패키지 루트 기준 상대경로로 두고, copy-assets 및 런타임 로딩이 이 경로만 사용하도록 한다.

**Steps:**

1. `src/infrastructure/database/database/schema.sql`, `migration/migrations/`*를 `packages/memento-core/` 하위(예: `database/schema.sql`, `database/migrations/`)로 복사.
2. copy-assets 스크립트를 core 패키지용으로 수정: projectRoot = packages/memento-core 루트, 출력은 packages/memento-core/dist 내 고정.
3. 런타임에서 schema/migrations를 읽는 코드가 패키지 루트(또는 dist) 기준 상대경로 한 가지 방식만 사용하도록 수정.
4. core의 package.json build 스크립트: `tsc && node scripts/copy-assets.js` (또는 동등).

**검증:** `cd packages/memento-core && npm run build` 후 dist/ 아래에 schema, migrations가 존재하고, createMementoCore({ dbPath: ':memory:' }) 호출 시 초기화가 동작(간단 테스트 가능).

---

## Phase 3: memento-server 패키지 구성

### Task 3.1: server 소스 이전 및 core 의존

**목표:** server/, tools/를 packages/memento-server/src/로 이동하고, domains/infrastructure/shared 대신 @memento/core를 사용하도록 변경한다.

**Steps:**

1. `packages/memento-server/src/server/`, `src/tools/` 생성 후 현재 `src/server`, `src/tools` 내용 복사.
2. server 부트스트랩에서 기존 init/domains 직접 import를 제거하고, createMementoCore(process.env.DB_PATH 등)로 초기화한 인스턴스를 사용하도록 변경.
3. tools 레지스트리는 core가 노출하는 API(recall, remember 등)를 호출하도록 수정. (도구 구현이 core에 남았다면 그쪽 함수를 호출.)
4. package.json: dependencies에 `"@memento/core": "workspace:*"`, bin은 기존과 동일하게 dist/server/index.js, dist/server/http-server.js 등.
5. tsconfig: rootDir src, outDir dist. paths로 @memento/core 매핑.

**검증:** `cd packages/memento-server && npm run build` 성공. `node dist/server/index.js` 또는 http-server로 MCP/HTTP 동작 확인(DB_PATH 설정 후).

**서버 thin화 (Phase 3.1 보완):** 서버에서 domains/shared/infrastructure/workers 복사본을 제거하고 core만 사용하려면 [2026-03-04-monorepo-phase3-thin-server-plan.md](./2026-03-04-monorepo-phase3-thin-server-plan.md)의 단계별 계획( core export 목록, 제거 대상, 실행 순서)을 따른다.

---

### Task 3.2: server bin 및 스크립트 정리

**목표:** 루트 package.json의 main/bin을 제거하거나 server 패키지로 위임하고, 루트에서는 workspace 스크립트만 유지한다.

**Steps:**

1. 루트 `package.json`의 `main`, `bin`을 제거하거나 `npm run dev` 등이 `npm exec -w memento-server ...` 형태로 server 패키지를 실행하도록 변경.
2. db:init, db:migrate 등은 server 패키지 또는 core 패키지 스크립트로 이전. (DB 초기화는 core가 제공하는 createMementoCore 내부 또는 별도 init 스크립트에서 수행하도록 결정.)
3. 루트에서 `npm run build` 시 워크스페이스 순서(core → server)로 빌드되도록 스크립트 추가.

**검증:** 루트에서 `npm run build` 후 `npm run dev`(또는 동등)로 서버 기동 가능.

---

## Phase 4: memento-client 패키지 정리

### Task 4.1: 클라이언트 소스 위치 결정 및 이전

**목표:** 클라이언트 소스를 packages/memento-client/src로 옮겨 패키지 자족성을 갖추거나, 기존처럼 루트 src/npm-client를 참조하도록 유지. 권장: packages/memento-client/src로 이전.

**Steps:**

1. `packages/memento-client/src/` 생성 후 `src/npm-client/`* 내용 복사.
2. packages/memento-client/tsconfig.build.json 수정: rootDir `./src`, include `src/**/*`, outDir `dist`. 더 이상 `../../src/npm-client` 참조 제거.
3. package.json name은 `@memento/client` 유지.

**검증:** `cd packages/memento-client && npm run build` 성공.

---

### Task 4.2: CI에 client 빌드·테스트 포함

**목표:** 루트 또는 워크스페이스 CI에서 memento-client 빌드 및 테스트가 실행되도록 한다.

**Steps:**

1. 루트 package.json scripts에 `build:all` 또는 `build`가 workspaces를 순서대로 빌드하도록 정의(core → server → client).
2. .github/workflows/ci.yml(또는 동일 CI)에 client 빌드·테스트 단계 추가.

**검증:** CI에서 client 패키지 빌드·테스트 통과.

---

## Phase 5: apps/ 예시 및 문서

### Task 5.1: 실험 서비스 예시 1개 추가

**목표:** apps/experimental-example에 @memento/core를 사용하는 최소 예시(CLI 또는 단순 서버)를 넣고, README에 연결 방식(라이브러리 in-process)을 명시한다.

**Steps:**

1. apps/experimental-example에 createMementoCore를 호출해 recall/remember를 한 번씩 호출하는 스크립트 또는 CLI 추가.
2. README에 "연결 방식: 라이브러리(in-process). 의존: @memento/core. 환경: DB_PATH 또는 인자로 dbPath 전달." 명시.
3. (선택) @memento/client를 쓰는 두 번째 예시 앱을 apps/에 추가하고, "연결 방식: 독립 서버(원격). memento-server 실행 후 client로 접속." 문서화.

**검증:** apps/experimental-example에서 npm run build 및 실행 시 core 호출 성공.

---

### Task 5.2: 브레인스토밍·계획 문서 링크 및 AGENTS.md 갱신

**목표:** 모노레포 구조와 패키지 역할을 AGENTS.md 및 docs에 반영한다.

**Steps:**

1. AGENTS.md에 packages/memento-core, memento-server, memento-client, apps/ 설명과 빌드/테스트 명령 요약 추가.
2. docs/README.md 또는 docs/plans에 본 구현 계획 및 브레인스토밍 문서 링크 유지.
3. 실험 서비스별 Memento 연결 방식 표(브레인스토밍 문서 내용)를 docs에 요약 링크하거나 복사.

**검증:** 새로 온보딩하는 개발자가 AGENTS.md만 보고 모노레포 빌드·실행 가능.

---

## Phase 6 (선택): DB 경로 검증 및 보안

- dbPath에 대한 허용 디렉터리/패턴 검증 또는 절대경로 정규화 규칙을 core 패키지 한 곳에 명시하고, createMementoCore에서 적용한다. (SpecFlow 분석 권장 사항.)

---

## Next Steps

- Phase 1부터 순서대로 진행. 각 Phase 끝에 `npm run build`, `npm test`로 검증.
- 패키지 매니저 선호(pnpm/Turborepo)가 정해지면 Task 1.1·1.2와 CI 스크립트에 반영.

