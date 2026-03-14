# Memento CLI for AI 구현 계획 (PLAN)

SDD **Plan** 단계 산출물. [명세(SPECIFY)](./spec.md)를 기준으로 구현 순서·태스크·검증을 정리한다.

---

## 메타데이터

| 항목 | 값 |
|------|-----|
| **기능명** | Memento CLI for AI |
| **문서 유형** | PLAN (구현 계획) |
| **기준 명세** | [spec.md](./spec.md) |
| **날짜** | 2026-03-11 |
| **관련 이슈** | [#110](https://github.com/jee1/memento/issues/110) |
| **Memory Bank** | [Structure.md](./Structure.md), [Tech.md](./Tech.md), [Product.md](./Product.md) |

---

## 0. Memory Bank (Plan 기초 문서)

명세가 확정된 뒤 기술적 언어로 번역하는 Plan 단계에서, AI가 임의로 판단하지 않도록 **Memory Bank**를 구축한다. 구현·태스크 수행 시 아래 3대 기초 문서를 우선 참조한다.

| 문서 | 내용 |
|------|------|
| **[Structure.md](./Structure.md)** | 시스템 아키텍처, 컴포넌트 간 관계, 디렉터리 구조 정의. |
| **[Tech.md](./Tech.md)** | 프레임워크·라이브러리 버전, DB 스키마 참조, 기술적 제약 사항. |
| **[Product.md](./Product.md)** | 비즈니스 맥락, 기존 기능(MCP/HTTP)과의 유기적 연관성. |

아키텍처·기술·제품 관점 변경 시 해당 Memory Bank 문서를 먼저 갱신한 뒤, 본 구현 계획(Tasks)을 수정한다.

---

## 1. 개요

- **목표**: 명세 REQ-CLI-1~3, REQ-IO-1~4, REQ-OPT-1~3, REQ-CFG-1~4, REQ-TOOL-1~2, REQ-HELP-1(필수), CON-1~6 및 AC1~AC10을 만족하는 CLI 구현.
- **위치**: `packages/memento-server` 내 CLI 전용 진입점. 기존 `index.ts`(stdio MCP), `http-server.ts`(HTTP)는 변경하지 않음(CON-2).
- **의존성**: 명세 §2.5에 따라 `@memento/core`의 `createMementoCore`, `getToolRegistry`, `executeTool`, `createToolContext` 재사용.
- **명세 갱신 반영**: 코드 리뷰 반영으로 REQ-CFG-4, CON-4~6, AC9~AC10, forget 옵션 우선순위가 명세에 추가됨. 본 계획의 Phase·TASK는 이를 반영한다.

---

## 2. 보안 정책·코딩 컨벤션·개발 철학

구현 시 아래 정책과 컨벤션을 준수한다. 리뷰 시에도 동일 기준으로 점검한다.

### 2.1 보안 정책

- **민감 정보**: API 키·비밀은 **CLI 인자로 받지 않는다**(명세 CON-1). 환경변수 또는 .env로만 제공. 인자 파서에 `OPENAI_API_KEY`, `GEMINI_API_KEY` 등 옵션을 추가하지 않는다.
- **경로 검증**: `--db-path`, `--env-file`, `--config-dir` 등 파일/디렉터리 경로는 core 또는 기존 서버에서 사용하는 **path validator**가 있으면 재사용한다. path traversal 등 비정상 경로는 거부한다. (참조: [reference/ko/security.md](../../../reference/ko/security.md), PRD 0019 보안 강화)
- **.env 로드**: 사용자 지정 경로(`--env-file`, `--config-dir`)는 **읽기 전용**으로만 사용. 해당 경로에 쓰기 연산을 하지 않는다.
- **에러 메시지**: stderr에 출력하는 에러 메시지에 **스택 트레이스·내부 경로·비밀**이 포함되지 않도록 한다. 프로덕션 환경에서도 안전한 수준만 노출.
- **참조**: [docs/reference/ko/security.md](../../../reference/ko/security.md), [docs/reviews/ko/code-review-comprehensive-report.md](../../../reviews/ko/code-review-comprehensive-report.md) 보안 검토 섹션.

### 2.2 코딩 컨벤션

저장소 루트 [AGENTS.md](../../../../AGENTS.md) 및 기존 서버 코드 스타일을 따른다.

- **언어·런타임**: Node.js ≥ 20, ES 모듈 기반 TypeScript.
- **들여쓰기·포맷**: 두 칸 들여쓰기, 후행 쉼표, **작은따옴표** 기본.
- **파일명**: **kebab-case** (예: `env-loader.ts`, `cli.ts`). CLI 전용 디렉터리는 `src/cli/` 또는 `src/server/cli/` 중 일관된 하나만 사용.
- **식별자**: 클래스·타입은 **PascalCase**, 함수·변수는 **camelCase**. 상수는 UPPER_SNAKE 또는 camelCase(프로젝트 기존 패턴 따름).
- **타입**: 비즈니스 로직은 공유 인터페이스로 타입 유지. `any` 최소화.
- **품질 게이트**: 커밋 전 `npm run lint -- --fix`, `npm run type-check`, `npm test` 통과. PR 시 CI에서 동일 검사.

### 2.3 개발 철학 (클린코드·유지보수성)

- **단일 책임**: env 로드, 옵션 파싱, 도구 실행, 출력 포맷을 **역할별로 분리**한다. 한 모듈이 한 가지 일만 하도록 설계.
- **읽기 쉬운 이름**: 서브커맨드·옵션 이름은 명세와 일치시키고, 변수·함수명은 **의도가 드러나도록** 짓는다. 약어보다는 풀어쓴 이름을 선호(이미 프로젝트에서 쓰는 약어는 예외).
- **테스트 가능한 구조**: env 로더, 옵션→파라미터 변환 등은 **순수 함수 또는 의존성 주입**으로 두어 단위 테스트가 가능하게 한다. core 초기화는 래핑하여 테스트에서 mock·:memory: DB로 대체 가능하게 한다.
- **테스트 스타일**: Vitest, **Given/When/Then** 구조 권장. 테스트 파일은 대상 모듈과 같은 디렉터리 또는 `__tests__/`에 `.spec.ts`로 둔다. (AGENTS.md 테스트 가이드라인)
- **중복 제거**: 옵션→도구 인자 변환, stdout/stderr 출력 규칙 등은 **한 곳에만** 정의하고 재사용한다.
- **점진적 복잡도**: Phase 1에서 최소 동작(env 로드, bin 진입)만 구현하고, Phase 2에서 도구 실행·I/O를 붙인다. 한 번에 많은 책임을 넣지 않는다.

### 2.4 명세 제약 (코드 리뷰 반영, CON-4~6)

구현·리뷰 시 아래를 준수한다.

- **CON-4 (타입 안전성)**: CLI 진입점의 stderr 래퍼는 Node.js `WriteStream.write` 시그니처에 맞춰 타입 지정. 서브커맨드 식별 시 `undefined` 대비(`subcommand ?? ''` 등), non-null assertion(`!`) 의존하지 않음.
- **CON-5 (전역 상태 지양)**: 로그·경고 플래그는 **모듈 스코프 변수**로 두고, `(global as any)` 등 전역 오염을 피함. (테스트 격리·다중 인스턴스 대비)
- **CON-6 (경로 인자)**: 향후 글로벌 옵션에 경로 인자를 추가할 때는 `path.resolve` 후 허용 prefix 검사 또는 `path.relative`로 탈출 경로 제한을 검토함.

---

## 3. Phase 개요

| Phase | 내용 | 산출물 | 명세 요구사항 |
|-------|------|--------|----------------|
| **Phase 1** | 환경 설정 로드 + CLI 진입점 + bin 등록 | 설정 로더, cli.ts 골격, package.json bin | REQ-CFG-1~4, REQ-OPT-1~3, REQ-CLI-1 |
| **Phase 2** | 서브커맨드 파싱 + recall/remember/forget/memory_injection + 입출력 | 4개 서브커맨드 동작, stdout/stderr/exit | REQ-CLI-2~3, REQ-IO-1~3, REQ-TOOL-1~2, AC2,3,4,7 |
| **Phase 3** | --help, db-path, ~/.memento 및 테스트 검증 | memento --help, AC5/AC6/AC9/AC10 검증 | REQ-HELP-1, REQ-OPT-1, AC1, AC5, AC6, AC9, AC10 |
| **Phase 4** | 문서 | 가이드·README·AGENTS.md | 명세 §7 |

---

## 4. Phase 1: 환경 설정 로드 + CLI 진입점 + bin 등록

**목표**: CLI 전용 설정 로드 순서 구현, `memento` 진입 스크립트 추가, bin 등록. (아직 서브커맨드 실행은 하지 않아도 됨.)

### Task 1.1: CLI 전용 .env 로드 유틸

**명세**: REQ-CFG-2, REQ-CFG-3, REQ-CFG-4, REQ-OPT-2, REQ-OPT-3.

**파일**:
- 신규: `packages/memento-server/src/cli/env-loader.ts` (또는 `src/server/cli-env.ts`)

**단계**:
1. **입력**: `{ envFile?: string, configDir?: string }` (글로벌 옵션에서 파싱한 값).
2. **탐색 순서**로 첫 번째 존재하는 .env 경로 결정 (REQ-CFG-4: 어떤 파일도 없을 때는 기본 경로 `~/.memento/.env`를 반환할 수 있음; 호출자는 반환 경로만으로 "로드됨"을 가정하지 말고 loadEnv() 또는 existsSync()로 확인):
   - `envFile`이 있으면 해당 파일만 사용(존재하지 않으면 에러).
   - 없으면 `process.env.MEMENTO_CONFIG_DIR`가 있으면 `path.join(MEMENTO_CONFIG_DIR, '.env')`.
   - 없으면 `path.join(process.cwd(), '.env')`.
   - 없으면 `path.join(os.homedir(), '.memento', '.env')`.
3. **로드**: 선택된 경로에 파일이 있으면 `dotenv.config({ path })` 호출. 없으면 무시(에러 아님).
4. `configDir`이 인자로 오면 2번에서 `configDir`을 MEMENTO_CONFIG_DIR 대신 사용하는 분기 추가.
5. **REQ-CFG-4**: `resolveEnvPath()` JSDoc에 "파일이 없을 때도 기본 경로(~/.memento/.env)를 반환할 수 있으며, 실제 로드 여부는 loadEnv() 또는 existsSync()로 확인해야 함" 명시.
6. 단위 테스트: (선택) mock fs로 각 순서에서 올바른 파일이 선택되는지 검증.

**검증**:
- `~/.memento/.env`만 있고 cwd에 .env 없을 때 해당 파일이 로드되는지 수동 또는 테스트로 확인.

---

### Task 1.2: CLI 진입점 파일 및 글로벌 옵션 파싱

**명세**: REQ-CLI-1, REQ-OPT-1~3, REQ-CFG-1.

**파일**:
- 신규: `packages/memento-server/src/cli.ts` (또는 `src/server/cli.ts`)

**단계**:
1. **진입 시점**에서 Task 1.1 호출: `--env-file`, `--config-dir`를 파싱한 뒤 env 로드. (이때 core의 `config/index.ts`가 로드되기 전에 호출되도록, CLI 진입점이 dotenv를 먼저 호출하는 구조로 설계. 또는 env-loader에서 dotenv를 호출하면 이후 `import '@memento/core'` 시 mementoConfig가 이미 env를 반영함.)
2. **글로벌 옵션** 파싱: `--db-path`, `--env-file`, `--config-dir`. (commander, yargs, 또는 최소한 argv 직접 파싱.)
3. **dbPath 결정**: `opts.dbPath ?? process.env.DB_PATH ?? mementoConfig.dbPath` (REQ-TOOL-2). core를 import한 뒤 사용.
4. **서브커맨드**가 없거나 `--help`만 있으면 도움말 출력(Phase 3에서 구체화). 그 외에는 Phase 2에서 처리할 서브커맨드 라우팅만 준비(예: `recall` | `remember` | `forget` | `memory_injection`일 때 도구 실행으로 넘김).
5. **bin 등록**: `packages/memento-server/package.json`의 `bin`에 `"memento": "./dist/server/cli.js"` 또는 `"./dist/cli.js"` 추가. 루트 `package.json`의 workspaces에서 server를 사용하므로 server 패키지의 bin이 노출되도록 확인.
6. **tsconfig**에 `cli.ts`(및 env-loader)가 빌드 대상에 포함되는지 확인.

**검증**:
- `npm run build -w memento-server` 후 `node packages/memento-server/dist/server/cli.js --help` 또는 `memento --help`(npm link 또는 루트에서 실행)로 진입 가능.
- `memento --db-path /tmp/test.db --help` 실행 시 오류 없이 동작(DB는 Phase 2에서 실제 사용).

**의존**: Task 1.1 완료 후 진행.

---

## 5. Phase 2: 서브커맨드 실행 + 입출력 규격

**목표**: recall, remember, forget, memory_injection 4개 서브커맨드 구현. 성공 시 stdout에 JSON, 실패 시 stderr + non-zero exit.

### Task 2.1: Core 초기화 및 도구 실행 공통 로직

**명세**: REQ-CLI-2, REQ-TOOL-1, REQ-TOOL-2, REQ-IO-1~3.

**파일**:
- 수정: `packages/memento-server/src/cli.ts` (또는 `src/server/cli.ts`)

**단계**:
1. **createMementoCore({ dbPath })** 호출. dbPath는 Phase 1에서 결정한 값.
2. **createToolContext(db, services)** 및 **getToolRegistry()** 사용. (기존 `index.ts`/`http-server.ts`와 동일한 방식.)
3. **서브커맨드 → MCP 도구 이름** 1:1 매핑: `recall`→`recall`, `remember`→`remember`, `forget`→`forget`, `memory_injection`→`memory_injection`.
4. **CLI 옵션 → 도구 인자** 변환: `--query "x"` → `{ query: "x" }`, `--limit 2` → `{ limit: 2 }` 등. MCP 도구 inputSchema와 동일한 키/타입. (구현 시 getToolRegistry().get(name).inputSchema 참고하여 옵션 이름 매핑.)
5. **executeTool(name, params, context)** 호출.
6. **성공**: 결과를 **stdout에만** JSON.stringify하여 출력. 로그는 stderr로만.
7. **실패**: 에러 메시지를 **stderr**에 출력, **process.exit(1)** (또는 exitCode 설정 후 종료).
8. **종료 전**: DB 연결 정리(closeDatabase 또는 core에서 제공하는 정리 함수 호출).

**검증**:
- DB 초기화된 상태에서 `memento recall --query "test" --limit 2` → stdout에 JSON, exit 0.
- `memento remember --content "plan test" --type episodic --tags plan` → stdout에 memory_id 포함 JSON, exit 0.
- 잘못된 인자(예: 필수 누락) → stderr 메시지, exit !== 0.
- 성공 시 stdout만 파싱하면 유효한 JSON(AC7).

**의존**: Phase 1 완료.

---

### Task 2.2: recall / remember / forget / memory_injection 옵션 매핑

**명세**: REQ-TOOL-1, §3.3.

**파일**:
- 동일: `cli.ts` 또는 옵션 매핑 전용 모듈 `cli/option-map.ts`

**단계**:
1. 각 서브커맨드별로 **인자 스키마**에 맞는 옵션 목록 정의. (MCP descriptor 또는 getToolRegistry().get(name).inputSchema 참고.)
2. **recall**: 최소 `query`, `limit`, `type`, `memory_types`, `tags` 등. 타입 변환(문자열→숫자, 쉼표 구분→배열) 처리.
3. **remember**: `content`, `type`, `tags`, `importance`, `privacy_scope` 등.
4. **forget**: `memory_id`(또는 별칭 `--id`). **명세 반영**: `--id`와 `--memory-id` 둘 다 주어지면 **`--memory-id` 우선**하여 도구에 전달. 주석·명세에 우선순위 명시.
5. **memory_injection**: `query`, `token_budget` 등.
6. API 키 등 민감 옵션은 **CLI 옵션으로 추가하지 않음**(CON-1).

**검증**:
- AC2, AC3 통과. forget, memory_injection도 동일 패턴으로 1회씩 실행 검증.

**의존**: Task 2.1.

---

## 6. Phase 3: --help, db-path, ~/.memento 및 AC9·AC10 검증

**목표**: REQ-HELP-1, AC1, AC5, AC6, AC9, AC10 충족.

### Task 3.1: memento --help

**명세**: REQ-HELP-1, AC1.

**단계**:
1. `memento` 또는 `memento --help` 실행 시 **서브커맨드 목록** 및 **한 줄 설명** 출력. (명세 §3.1 또는 설계 문서 3.1 표 참고.)
2. 출력 대상: stderr 권장(성공 시 stdout은 JSON만 쓰기 위해). 또는 도움말만 낼 때는 stdout 허용(명세 REQ-HELP-1: "stdout 또는 stderr에 요약이 표시됨").
3. `memento <command> --help`(선택, REQ-HELP-2): 해당 명령 옵션 요약. Phase 2 옵션 매핑과 일치하도록 유지.

**검증**:
- AC1: `npm run build` 후 `memento --help` 실행 가능, 목록·설명 표시.

---

### Task 3.2: AC5·AC6·AC9·AC10 검증 (원자 TASK로 분리)

**명세**: AC5, AC6, AC9, AC10, REQ-CFG-1, REQ-CFG-2.  
**계획 상세**: §8 TASK-14(AC5), TASK-15(AC6), TASK-16(AC9), TASK-17(AC10) 참조. 각각 한 가지 완료 조건만 갖는 원자 단위로 수행한다.

**단계 요약**:
1. **TASK-14**: AC5 — `--db-path` 지정 시 해당 DB 사용 검증.
2. **TASK-15**: AC6 — `~/.memento/.env`만 있을 때 DB_PATH 적용 검증.
3. **TASK-16**: AC9 — AC6 시나리오를 자동화한 전용 테스트 추가.
4. **TASK-17**: AC10 — 실패 시나리오(필수 인자 누락, 알 수 없는 서브커맨드) 테스트 추가.

**검증**: AC5, AC6, AC9, AC10 각각 통과.

**의존**: Phase 2 완료.

---

## 7. Phase 4: 문서

**명세**: §7.

### Task 4.1: CLI for AI 가이드

**파일**:
- 신규: `docs/guides/ko/memento-cli-for-ai.md` (및 en)

**내용**:
- 명령 목록·한 줄 설명.
- 워크플로(작업 전 recall/memory_injection, 작업 후 remember).
- 설정 방법: DB_PATH, ~/.memento/.env, MEMENTO_CONFIG_DIR, --db-path. npx 반복 사용 시 글로벌/로컬 설치 권장.
- 예제 호출 및 샘플 출력(성공 JSON, 실패 시 stderr 예시).

---

### Task 4.2: README 및 AGENTS.md

**파일**:
- 수정: 루트 `README.md`, `AGENTS.md`

**내용**:
- README: npx 실행 시 모드별 사용법(MCP / HTTP / CLI). "CLI 반복 사용 시 글로벌 또는 로컬 설치 권장" 문구.
- AGENTS.md(또는 .cursor 규칙): "CLI 사용 시: 작업 전 recall/memory_injection, 작업 후 remember. 설정은 DB_PATH 또는 ~/.memento/.env."

---

## 8. TASKS

아래 태스크는 **"한 번에 하나씩(One at a time)"** 원자 단위로 나눈다. 한 태스크당 **한 가지 완료 조건·한 관심사**만 두어, 구현·리뷰·롤백이 쉬우며 PR 크기를 제한한다.

**원자 단위 기준**: (1) 한 태스크는 **한 가지** 완료 조건만 갖는다. (2) 변경 범위는 **한 종류의 산출물·한 관심사**에 한정한다. (3) 선행 태스크 완료 후에만 진행 가능하다.

| ID | 제목 | Phase | 산출물 | 선행 | 완료 조건 |
|----|------|-------|--------|------|-----------|
| **TASK-01** | CLI 전용 .env 로드 유틸 | 1 | `src/cli/env-loader.ts` | — | resolveEnvPath·loadEnv 구현, 탐색 순서대로 한 경로만 로드, 파일 없으면 무시 |
| **TASK-02** | CLI 진입점 + 글로벌 옵션 파싱 | 1 | `src/cli.ts` | TASK-01 | env 로드 호출, --db-path/--env-file/--config-dir/--help 파싱, dbPath 결정, 서브커맨드 추출(실행 없음) |
| **TASK-03** | package.json에 memento bin 등록 | 1 | `package.json` | TASK-02 | `bin.memento`가 `dist/cli.js`(또는 동일 경로)를 가리킴 |
| **TASK-04** | tsconfig에 cli 소스 포함 | 1 | `tsconfig.json` | TASK-02 | `cli.ts`, `cli/*.ts`가 빌드 대상에 포함됨 |
| **TASK-05** | 도구 실행 시 createMementoCore 호출 | 2 | `cli.ts` | TASK-03, TASK-04 | 서브커맨드가 도구일 때만 createMementoCore({ dbPath }) 호출, db·services 확보 |
| **TASK-06** | 종료 시 closeDatabase 등록 | 2 | `cli.ts` | TASK-05 | 정상 exit·uncaughtException·SIGINT·SIGTERM 시 closeDatabase 호출 |
| **TASK-07** | recall 서브커맨드 + executeTool + 입출력 규격 | 2 | `cli.ts` | TASK-06 | recall 시 executeTool 호출, 성공 시 stdout에 JSON만, 실패 시 stderr+exit(1), 최소 --query/--limit |
| **TASK-08** | recall 옵션 전체 매핑 | 2 | `cli/option-map.ts` 또는 `cli.ts` | TASK-07 | type, tags, memory_types 등 inputSchema 기반 전체 옵션, AC2 |
| **TASK-09** | remember 옵션 매핑 및 실행 | 2 | 동일 | TASK-08 | remember 서브커맨드, content/type/tags 등 매핑, AC3 |
| **TASK-10** | forget 옵션 매핑 및 실행 | 2 | 동일 | TASK-09 | forget 서브커맨드, memory_id 등 매핑 |
| **TASK-11** | memory_injection 옵션 매핑 및 실행 | 2 | 동일 | TASK-10 | memory_injection 서브커맨드, AC4·AC7 |
| **TASK-12** | memento --help 출력 | 3 | `cli.ts` | TASK-07 | 서브커맨드 목록·한 줄 설명 출력, AC1 |
| **TASK-13** | CLI 모드 로그 억제 (REQ-IO-4, AC8) | 2/3 | `cli.ts` 및 필요 시 core 연동 | TASK-07 | 성공 시 stderr에 로그 없음, stdout에 JSON만. 실패 시 stderr에 에러 메시지만 |
| **TASK-14** | AC5 검증: --db-path 지정 시 해당 DB 사용 | 3 | 테스트 또는 체크리스트 | TASK-11 | AC5 통과 (--db-path로 지정한 DB에서 recall 결과 확인) |
| **TASK-15** | AC6 검증: ~/.memento/.env만 있을 때 DB_PATH 적용 | 3 | 테스트 또는 체크리스트 | TASK-11 | AC6 통과 (cwd에 .env 없이 ~/.memento/.env의 DB_PATH 사용 확인) |
| **TASK-16** | AC9: AC6 전용 테스트 추가 | 3 | `cli-ac5-ac6.spec.ts` 등 | TASK-15 | cwd에 .env 없고 ~/.memento/.env에만 DB_PATH 있을 때 해당 DB 사용 검증하는 자동 테스트 존재 |
| **TASK-17** | AC10: 실패 시나리오 테스트 추가 | 3 | 동일 | TASK-11 | (1) recall without --query → exit 1, stderr에 "requires --query" 등 (2) 알 수 없는 서브커맨드 → exit 1 |
| **TASK-18** | CLI for AI 가이드 문서 | 4 | `docs/guides/ko/memento-cli-for-ai.md` | TASK-14,TASK-15,TASK-16,TASK-17 | 명령 목록·워크플로·설정·예제 |
| **TASK-19** | README 갱신 | 4 | `README.md` | TASK-18 | 모드별 사용법(MCP/HTTP/CLI), CLI 반복 사용 시 설치 권장 |
| **TASK-20** | AGENTS.md 갱신 | 4 | `AGENTS.md` | TASK-18 | CLI 사용 시 recall/remember 워크플로, DB_PATH·~/.memento 안내 |

**의존 순서**: 01→02→03, 01→02→04. 03,04 완료 후 05→06→07→08→09→10→11. 07 완료 후 12(--help), 13(로그 억제). 11 완료 후 14(AC5), 15(AC6). 11 완료 후 16(AC9, 선행 15), 17(AC10). 14,15,16,17 완료 후 18→19, 18→20.

---

### TASK별 수행 내용

각 태스크에서 **무엇을 하는지** 요약한다. 한 태스크 = 한 가지 완료 조건·한 관심사. 구현·리뷰 시 이 목록을 기준으로 한다.

- **TASK-01 (CLI 전용 .env 로드 유틸)**  
  - **한다**: `resolveEnvPath(options)`, `loadEnv(options)` 구현. 탐색 순서: envFile → configDir/MEMENTO_CONFIG_DIR → cwd → ~/.memento/.env. 존재하는 첫 경로에만 `dotenv.config({ path })` 호출, 없으면 무시. **REQ-CFG-4**: resolveEnvPath JSDoc에 "파일 없을 때도 기본 경로 반환 가능, 로드 여부는 loadEnv()/existsSync()로 확인" 명시.  
  - **산출물**: `src/cli/env-loader.ts`.  
  - **검증**: ~/.memento/.env만 있을 때 해당 파일이 로드되는지 확인.

- **TASK-02 (CLI 진입점 + 글로벌 옵션 파싱)**  
  - **한다**: cli.ts에서 (1) parseGlobalOptions(argv)로 --db-path, --env-file, --config-dir, --help, 서브커맨드 추출. (2) loadEnv 호출(env-loader). (3) core 동적 import 후 dbPath = opts.dbPath ?? process.env.DB_PATH ?? mementoConfig.dbPath. (4) 서브커맨드 이름만 식별, 아직 도구 실행 없음.  
  - **산출물**: `src/cli.ts`.  
  - **검증**: `memento --db-path /tmp/x.db` 실행 시 오류 없이 진입(또는 미지 서브커맨드 시 에러 메시지 등 일관된 동작).

- **TASK-03 (package.json에 memento bin 등록)**  
  - **한다**: `packages/memento-server/package.json`의 `bin`에 `"memento": "./dist/cli.js"` 추가.  
  - **산출물**: `package.json` 수정만.  
  - **검증**: 빌드 후 `memento` 명령으로 진입 가능.

- **TASK-04 (tsconfig에 cli 소스 포함)**  
  - **한다**: `packages/memento-server/tsconfig.json`에 `cli.ts`, `cli/*.ts`가 컴파일 대상에 포함되는지 확인. 필요 시 include/rootDir 조정.  
  - **산출물**: `tsconfig.json` 수정(필요 시).  
  - **검증**: `npm run build -w memento-server` 시 dist/cli.js, dist/cli/*.js 생성.

- **TASK-05 (도구 실행 시 createMementoCore 호출)**  
  - **한다**: 서브커맨드가 recall|remember|forget|memory_injection일 때만 `createMementoCore({ dbPath })` 호출해 db·core.services 확보. 그 외 분기에서는 호출하지 않음.  
  - **산출물**: `cli.ts` 수정.  
  - **검증**: 도구 서브커맨드 실행 시 core가 초기화됨(다음 태스크에서 실행 연결).

- **TASK-06 (종료 시 closeDatabase 등록)**  
  - **한다**: process.on('exit'), process.on('uncaughtException'), process.on('SIGINT'), process.on('SIGTERM')에서 closeDatabase()(또는 core 정리 함수) 호출.  
  - **산출물**: `cli.ts` 수정.  
  - **검증**: CLI 종료 시 DB 연결이 정리됨.

- **TASK-07 (recall 서브커맨드 + executeTool + 입출력 규격)**  
  - **한다**: 서브커맨드가 recall일 때 createToolContext·getToolRegistry·executeTool('recall', params, context) 호출. 성공 시 결과만 stdout에 JSON.stringify. 실패 시 stderr에 메시지, process.exit(1). params는 최소 --query, --limit만.  
  - **산출물**: `cli.ts` 수정.  
  - **검증**: `memento recall --query "test" --limit 2` → stdout에 JSON, exit 0. 실패 시 stderr, exit !== 0.

- **TASK-08 (recall 옵션 전체 매핑)**  
  - **한다**: recall의 inputSchema에 맞춰 type, memory_types, tags, time_from, time_to 등 CLI 옵션→params 변환. 문자열→숫자, 쉼표→배열 처리. cli/option-map.ts에 recallParams(argv) 추가 또는 cli.ts 내 구현.  
  - **산출물**: `cli/option-map.ts` 또는 `cli.ts`.  
  - **검증**: AC2. recall에 다양한 옵션 적용 시 동일 JSON 구조.

- **TASK-09 (remember 옵션 매핑 및 실행)**  
  - **한다**: 서브커맨드 remember에 대해 옵션→params(content, type, tags, importance, privacy_scope 등) 매핑 후 executeTool('remember', params, context). 입출력 규격은 TASK-07과 동일.  
  - **산출물**: `cli.ts`, `cli/option-map.ts`.  
  - **검증**: AC3. `memento remember --content "..." --type episodic --tags x,y` → stdout에 memory_id 등.

- **TASK-10 (forget 옵션 매핑 및 실행)**  
  - **한다**: 서브커맨드 forget에 대해 memory_id(별칭 --id), 소프트/하드 등 옵션 매핑 후 executeTool('forget', params, context). **명세 반영**: `--id`와 `--memory-id` 둘 다 주어지면 **`--memory-id` 우선**. 주석·명세에 우선순위 명시.  
  - **산출물**: 동일.  
  - **검증**: forget 실행 시 stdout에 결과, 실패 시 stderr·non-zero exit.

- **TASK-11 (memory_injection 옵션 매핑 및 실행)**  
  - **한다**: 서브커맨드 memory_injection에 대해 query, token_budget 등 옵션 매핑 후 executeTool 호출.  
  - **산출물**: 동일.  
  - **검증**: AC4, AC7. 4개 서브커맨드 성공 시 stdout만 파싱하면 유효한 JSON.

- **TASK-12 (memento --help 출력)**  
  - **한다**: `memento` 또는 `memento --help` 실행 시 서브커맨드 목록(recall, remember, forget, memory_injection) 및 한 줄 설명, 글로벌 옵션 요약을 stderr(또는 stdout)에 출력.  
  - **산출물**: `cli.ts` 수정.  
  - **검증**: AC1. `memento --help` 실행 시 목록·설명 표시.

- **TASK-13 (CLI 모드 로그 억제, REQ-IO-4, AC8)**  
  - **한다**: CLI 진입 후 core·라이브러리 로거를 무음(silent) 또는 최소 레벨로 설정. 성공 시 stdout에 JSON만, stderr에는 아무 출력 없음. 실패 시에만 stderr에 에러 메시지.  
  - **산출물**: `cli.ts` 및 필요 시 core 로거 연동(환경 변수·옵션).  
  - **검증**: AC8. 성공한 CLI 호출 시 stderr 비어 있음, stdout에 JSON만.

- **TASK-14 (AC5 검증: --db-path 지정 시 해당 DB 사용)**  
  - **한다**: `memento --db-path <path> recall --query "x" --limit 1` 실행 시 지정한 path의 DB가 사용되는지 통합 테스트 또는 수동 체크리스트로 검증.  
  - **산출물**: 테스트 코드(`cli-ac5-ac6.spec.ts` 등) 또는 체크리스트.  
  - **검증**: AC5 통과.

- **TASK-15 (AC6 검증: ~/.memento/.env만 있을 때 DB_PATH 적용)**  
  - **한다**: cwd에 .env 없이 `~/.memento/.env`에만 `DB_PATH=<path>` 두고 `memento recall --query "x" --limit 1` 실행 시 해당 DB가 사용되는지 검증.  
  - **산출물**: 테스트 또는 체크리스트.  
  - **검증**: AC6 통과.

- **TASK-16 (AC9: AC6 전용 테스트 추가)**  
  - **한다**: cwd에 .env가 없고 ~/.memento/.env에만 DB_PATH가 있을 때 해당 DB가 사용됨을 검증하는 **자동화된 전용 테스트** 추가. (임시 디렉터리에서 실행, exit 0 및 JSON 결과로 간접 검증 등.)  
  - **산출물**: `cli-ac5-ac6.spec.ts` 등 테스트 파일.  
  - **검증**: AC9 통과. AC6 시나리오가 자동 테스트로 보장됨.

- **TASK-17 (AC10: 실패 시나리오 테스트 추가)**  
  - **한다**: (1) `recall` without `--query` → exit 1, stderr에 "requires --query" 등 관련 메시지 포함. (2) 알 수 없는 서브커맨드 → exit 1. Given/When/Then 형태 권장.  
  - **산출물**: 동일 테스트 파일.  
  - **검증**: AC10 통과. 회귀 방지용 실패 시나리오가 자동 검증됨.

- **TASK-18 (CLI for AI 가이드 문서)**  
  - **한다**: `docs/guides/ko/memento-cli-for-ai.md` 작성. 명령 목록·한 줄 설명, 워크플로(작업 전 recall/memory_injection·작업 후 remember), 설정(DB_PATH, ~/.memento/.env, --db-path), 예제 호출·샘플 출력.  
  - **산출물**: `docs/guides/ko/memento-cli-for-ai.md`.  
  - **검증**: 위 항목이 문서에 포함됨.

- **TASK-19 (README 갱신)**  
  - **한다**: README에 npx 실행 시 모드별 사용법(MCP / HTTP / CLI), "CLI 반복 사용 시 글로벌 또는 로컬 설치 권장" 문구 추가.  
  - **산출물**: `README.md` 수정.  
  - **검증**: README에 해당 문구 존재.

- **TASK-20 (AGENTS.md 갱신)**  
  - **한다**: AGENTS.md에 CLI 사용 시 작업 전 recall/memory_injection·작업 후 remember, 설정은 DB_PATH 또는 ~/.memento/.env 안내 반영.  
  - **산출물**: `AGENTS.md` 수정.  
  - **검증**: AGENTS.md에 해당 규칙 존재.

---

## 9. 작업 순서 및 체크리스트

| 순서 | TASK ID | 명세 요구사항 | 완료 시 검증 |
|------|---------|----------------|--------------|
| 1 | TASK-01 | REQ-CFG-2, REQ-CFG-3 | env-loader 탐색·로드 동작 |
| 2 | TASK-02 | REQ-CLI-1, REQ-OPT, REQ-CFG-1 | cli 진입·글로벌 옵션·dbPath |
| 3 | TASK-03 | REQ-CLI-1 | memento bin 등록 |
| 4 | TASK-04 | 빌드 포함 | tsconfig cli 소스 포함 |
| 5 | TASK-05 | REQ-TOOL-2 | createMementoCore 호출 |
| 6 | TASK-06 | 종료 정리 | closeDatabase 훅 등록 |
| 7 | TASK-07 | REQ-CLI-2, REQ-IO-1~3 | recall + stdout/stderr/exit |
| 8 | TASK-08 | REQ-TOOL-1 | recall 전체 옵션, AC2 |
| 9 | TASK-09 | REQ-TOOL-1 | remember, AC3 |
| 10 | TASK-10 | REQ-TOOL-1 | forget |
| 11 | TASK-11 | REQ-TOOL-1 | memory_injection, AC4·AC7 |
| 12 | TASK-12 | REQ-HELP-1 | AC1 |
| 13 | TASK-13 | REQ-IO-4, AC8 | CLI 로그 억제 |
| 14 | TASK-14 | REQ-OPT-1 | AC5 |
| 15 | TASK-15 | REQ-CFG-2 | AC6 |
| 16 | TASK-16 | AC9 | AC6 전용 자동 테스트 |
| 17 | TASK-17 | AC10 | 실패 시나리오 자동 테스트 |
| 18 | TASK-18 | 명세 §7 | docs/guides/ko/memento-cli-for-ai.md |
| 19 | TASK-19 | 명세 §7 | README 반영 |
| 20 | TASK-20 | 명세 §7 | AGENTS.md 반영 |

---

## 10. 선택 사항(이번 계획 제외 가능)

- **REQ-HELP-2**: `memento <command> --help` — Phase 3에서 여유 있으면 추가.
- **REQ-SCHEMA-1**: `memento schema [command]` — 별도 Task로 후순위.
- **나머지 서브커맨드**: pin, unpin, get_memory_neighbors, set_anchor, get_anchor, search_local, clear_anchor, remember_procedure, procedural_diff, procedural_rollback. Phase 2와 동일 패턴으로 확장 가능하므로 필요 시 이슈/후속 계획에서 진행.

---

## 11. 참조

- **명세**: [spec.md](./spec.md) (코드 리뷰 반영: REQ-CFG-4, CON-4~6, AC9~AC10, forget 옵션 우선순위)
- **사전 코드 리뷰**: [2026-03-11-feat-110-cli-for-ai-ts-pre-review.md](../../../code_review/ko/2026-03-11-feat-110-cli-for-ai-ts-pre-review.md)
- **설계**: [design.md](./design.md)
- **이슈**: [#110](https://github.com/jee1/memento/issues/110)
- **기존 서버 초기화**: `packages/memento-server/src/server/index.ts` (createMementoCore, getToolRegistry, createToolContext), `http-server.ts` 동일.

---

*이 계획은 SDD의 Tasks → Implement 단계에서 태스크 단위로 실행할 때 기준으로 사용한다.*
