# Memento CLI for AI — SPECIFY (명세)

SDD(Specification-Driven Development)의 **Specify** 단계 산출물. 논의된 설계를 구현 가능한 요구사항·인터페이스·수용 기준으로 정리한다.

---

## 메타데이터

| 항목 | 값 |
|------|-----|
| **기능명** | Memento CLI for AI |
| **문서 유형** | SPECIFY (구현 명세) |
| **버전** | 1.0 |
| **날짜** | 2026-03-11 (ISO 8601) |
| **상태** | draft |
| **언어** | ko (한국어) |
| **관련 이슈** | [#110](https://github.com/jee1/memento/issues/110) |
| **설계 문서** | [design.md](./design.md) |
| **사전 코드 리뷰** | [2026-03-11-feat-110-cli-for-ai-ts-pre-review.md](../../../code_review/ko/2026-03-11-feat-110-cli-for-ai-ts-pre-review.md) |

---

## 1. 범위 및 목표

### 1.1 범위

- **In scope**
  - `packages/memento-server`에 CLI 진입점 추가. 기존 MCP 도구(recall, remember, forget 등)를 서브커맨드로 노출.
  - 한 번 실행 후 stdout에 JSON 출력하고 종료하는 **CLI 모드** (서버 대기 모드 아님).
  - 환경 설정: 글로벌 옵션, 환경변수, .env 탐색(마지막에 `~/.memento/.env`).
  - AI·개발자용 가이드 문서 및 `--help`/`memento schema`(선택).
- **Out of scope**
  - MCP 서버(stdio/HTTP) 동작 변경. 기존 bin(`memento-mcp-server`, `memento-dev`) 유지.
  - 별도 npm 패키지 분리(CLI 전용 패키지). 동일 패키지 내 추가 bin.

### 1.2 목표

- AI가 MCP 없이 터미널만으로 `memento recall ...`, `memento remember ...` 등으로 기억 조회·저장 가능. 설치 여부가 불명확한 환경에서는 `npm exec --package memento-mcp-server -- memento ...` 형태를 기준 예시로 사용한다.
- stdout=JSON, stderr=에러/로그, exit code로 성공/실패 구분하여 AI 파싱 용이.
- 설정은 `~/.memento/.env` 및 글로벌 옵션으로 cwd 무관하게 사용 가능.

---

## 2. 기능 요구사항

### 2.1 CLI 진입점 및 bin

| ID | 요구사항 | 수용 조건 |
|----|----------|-----------|
| REQ-CLI-1 | 패키지에 **bin 이름 `memento`**가 노출된다. | `npm run build` 후 `node dist/server/cli.js` 또는 등록된 bin으로 `memento` 실행 가능. |
| REQ-CLI-2 | CLI 진입 스크립트는 **packages/memento-server** 내에 있으며, 기존 `getToolRegistry()`, `executeTool()`, `ToolContext`를 재사용한다. | core 도구 레지스트리와 동일한 도구 집합을 CLI에서 호출 가능. |
| REQ-CLI-3 | 서브커맨드 이름은 MCP 도구 이름과 **1:1 매핑**된다. (예: `recall` → `recall`, `memory_injection` → `memory_injection`) | 설계 문서 3.1의 명령 목록과 일치하는 서브커맨드가 존재한다. |

### 2.2 입출력 규격

| ID | 요구사항 | 수용 조건 |
|----|----------|-----------|
| REQ-IO-1 | **성공 시** 결과만 **stdout**에 JSON으로 출력한다. 진행 메시지·로그는 stdout에 출력하지 않는다. | 성공한 CLI 호출의 stdout을 `JSON.parse()`하여 파싱 가능. |
| REQ-IO-2 | **실패 시** 에러 메시지는 **stderr**에 출력하고, 프로세스는 **non-zero exit code**로 종료한다. | 실패 시 `process.exitCode !== 0` 및 stderr에 사람이 읽을 수 있는 메시지. |
| REQ-IO-3 | 로그(디버그·정보)는 **stderr**로만 출력한다. | stdout이 항상 “JSON 또는 비출력”으로만 사용됨. |
| **REQ-IO-4** | **CLI 실행 시 사용자에게 노출되는 출력은 도구 응답(JSON)만 있어야 한다.** core·라이브러리에서 발생하는 로그(INFO, WARN, DEBUG 등)는 CLI 진입 시 **억제**하여, stdout·stderr 모두에 일상적 로그가 섞이지 않도록 한다. (AI·스크립트가 출력을 그대로 컨텍스트로 쓸 때 불필요한 토큰/화면 낭비를 막기 위함.) | 성공 시: stdout에 JSON 한 블록만 출력되고, stderr에는 아무것도 출력되지 않음. 실패 시: stderr에 에러 메시지만 출력. |

### 2.3 글로벌 옵션 (모든 서브커맨드 앞에 공통 적용)

| ID | 옵션 | 설명 | 필수/기본 |
|----|------|------|-----------|
| REQ-OPT-1 | `--db-path <path>` | DB 파일 경로. 환경변수 `DB_PATH`보다 우선. | 선택 |
| REQ-OPT-2 | `--env-file <path>` | 사용할 .env 파일 경로. 이 파일을 최우선으로 로드. | 선택 |
| REQ-OPT-3 | `--config-dir <dir>` | 설정 디렉터리. 해당 디렉터리의 `.env`를 로드 (`MEMENTO_CONFIG_DIR`과 동일 동작). | 선택 |

- **제약**: API 키·비밀은 CLI 인자로 **받지 않는다**. 환경변수 또는 .env로만 제공.

### 2.4 환경 설정 로드 순서

| ID | 요구사항 | 수용 조건 |
|----|----------|-----------|
| REQ-CFG-1 | **설정 우선순위**는 다음 순서이다: (1) CLI 글로벌 옵션 (`--db-path`, `--env-file`, `--config-dir`) → (2) 환경 변수 → (3) .env 파일(아래 탐색 순서) → (4) core `ENV_DEFAULTS`. | `--db-path` 지정 시 해당 경로의 DB가 사용됨. |
| REQ-CFG-2 | **.env 탐색 순서**(CLI 전용): (1) `--env-file`로 지정한 파일 → (2) `MEMENTO_CONFIG_DIR`이 설정된 경우 `$MEMENTO_CONFIG_DIR/.env` → (3) `process.cwd()`의 `.env` → (4) **`~/.memento/.env`**. 먼저 존재하는 파일 하나만 로드. | `~/.memento/.env`에 `DB_PATH`만 두고 cwd에 .env가 없을 때 해당 값 적용됨. |
| REQ-CFG-3 | `~/.memento/` 경로는 `os.homedir()` + `'.memento'`로 구성한다. 해당 디렉터리 또는 `.env`가 없으면 무시(에러 아님). | 디렉터리 없을 때도 CLI가 정상 기동. |
| REQ-CFG-4 | **resolveEnvPath()** 등 .env 경로 해석 API는, 어떤 .env 파일도 없을 때도 **기본 경로**(예: `~/.memento/.env`)를 반환할 수 있다. 호출자는 반환 경로만으로 "로드됐다"고 가정하지 말고, 실제 로드 여부는 **loadEnv() 호출 결과 또는 existsSync()**로 확인해야 한다. (코드 리뷰 반영) | 구현·문서(JSDoc)에 "파일 없을 때도 기본 경로 반환, 로드 여부는 loadEnv/existsSync로 확인" 명시. |

### 2.5 도구 실행

| ID | 요구사항 | 수용 조건 |
|----|----------|-----------|
| REQ-TOOL-1 | 서브커맨드에 전달된 옵션은 MCP 도구의 **인자 스키마와 동일**하게 `executeTool(name, params, context)`에 전달된다. | recall의 `query`, `limit` 등이 core 도구와 동일한 의미로 동작. |
| REQ-TOOL-2 | `createMementoCore({ dbPath })`에 넘기는 `dbPath`는 **우선순위 적용 후 한 번만 결정**한다: `opts.dbPath ?? process.env.DB_PATH ?? mementoConfig.dbPath`. | CLI에서 사용하는 DB가 설정 문서과 일치. |

### 2.6 도움말 및 스키마(선택)

| ID | 요구사항 | 수용 조건 |
|----|----------|-----------|
| REQ-HELP-1 | `memento --help`로 사용 가능한 서브커맨드 목록 및 한 줄 설명을 출력한다. | stdout 또는 stderr에 요약이 표시됨. |
| REQ-HELP-2 | `memento <command> --help`로 해당 서브커맨드의 옵션 요약을 출력한다. | (선택) 구현 시 옵션 목록 표시. |
| REQ-SCHEMA-1 | (선택) `memento schema [command]`로 지정한 명령 또는 전체 도구의 **인자 스키마를 JSON**으로 stdout에 출력한다. | AI가 동적으로 스키마를 참고 가능. |

---

## 3. 인터페이스 명세

### 3.1 CLI 문법

```
memento [글로벌 옵션] <서브커맨드> [서브커맨드 옵션]
```

- **글로벌 옵션**: `--db-path`, `--env-file`, `--config-dir` (서브커맨드 앞에만 유효).
- **서브커맨드**: 설계 문서 3.1의 명령 목록(recall, remember, forget, memory_injection, pin, unpin, get_memory_neighbors, set_anchor, get_anchor, search_local, clear_anchor, remember_procedure, procedural_diff, procedural_rollback)과 1:1.

### 3.2 출력 형식

- **성공**: stdout에 **단일 JSON 객체** 출력. MCP 도구 반환 형식과 동일한 구조를 그대로 사용한다(예: recall → `{ "items": [...], "total_count": N, ... }`). **REQ-IO-4**: 사용자에게 보이는 출력은 이 JSON만 있어야 하며, core/라이브러리 로그는 CLI 모드에서 억제하여 stdout·stderr 모두 로그가 섞이지 않는다.
- **실패**: stderr에 에러 메시지, exit code ≠ 0. stdout에는 아무것도 출력하지 않거나, 기계가 파싱할 수 있는 에러 객체(선택)를 JSON으로 출력할 수 있다.

### 3.3 지원 서브커맨드 목록(필수 구현 최소 집합)

Phase 1에서 **반드시** 구현할 서브커맨드:

- `recall`
- `remember`
- `forget`
- `memory_injection`

나머지(pin, unpin, get_memory_neighbors, set_anchor, get_anchor, search_local, clear_anchor, remember_procedure, procedural_diff, procedural_rollback)는 동일 패턴으로 확장 가능하도록 설계하고, Phase 2 또는 이슈에서 우선순위를 정할 수 있다.

**옵션 별칭·우선순위 (코드 리뷰 반영)**  
- `forget`: `--id`와 `--memory-id` 둘 다 주어지면 **`--memory-id` 우선**하여 도구에 전달한다. 명세·주석에 이 우선순위를 명시한다.

---

## 4. 제약 사항

| ID | 제약 | 검증 방법 |
|----|------|-----------|
| CON-1 | **API 키·비밀**은 CLI 인자로 받지 않는다. 환경변수 또는 .env만 사용. | 인자 파서에 API 키 관련 옵션이 없음. |
| CON-2 | 기존 bin **memento-mcp-server**, **memento-dev** 동작은 변경하지 않는다. | 기존 MCP/HTTP 실행 경로가 그대로 동작. |
| CON-3 | CLI 전용 설정 로드는 **진입 시점에 한 번만** 수행한다. dotenv는 `--env-file` 또는 탐색 순서에 따른 `.env` 하나만 로드. | 중복 로드 없음. |
| CON-4 | (코드 리뷰 반영) **타입 안전성**: CLI 진입점의 stderr 래퍼 등 Node.js 스트림 API를 다룰 때는 `WriteStream.write` 시그니처에 맞춰 타입을 지정한다. 서브커맨드 식별 시 `undefined` 대비(`subcommand ?? ''` 등)를 하여 non-null assertion에 의존하지 않는다. | 정적 분석·리뷰로 확인. |
| CON-5 | (코드 리뷰 반영) **전역 상태 지양**: 로그·경고 플래그 등은 모듈 스코프 변수로 두고, `(global as any)` 등 전역 오염을 피한다. (테스트 격리·다중 인스턴스 대비) | 구현·리뷰로 확인. |
| CON-6 | (코드 리뷰 반영) 향후 글로벌 옵션에 **경로** 인자를 추가할 때는 `path.resolve` 후 허용 prefix 검사 또는 `path.relative`로 탈출 경로를 제한하는 방안을 고려한다. | 신규 경로 옵션 추가 시 검토. |

---

## 5. 수용 기준 (Acceptance Criteria)

다음이 모두 만족되면 SPECIFY 대비 구현이 완료된 것으로 판단한다.

- [ ] **AC1** `npm run build` 후 `memento` bin으로 실행 가능하며, `memento --help`가 동작한다.
- [ ] **AC2** `memento recall --query "test" --limit 2` 실행 시 stdout에 JSON이 출력되고, exit code 0이다. (DB 초기화된 환경)
- [ ] **AC3** `memento remember --content "spec test" --type episodic --tags test` 실행 시 stdout에 memory_id 등이 포함된 JSON이 출력되고, exit code 0이다.
- [ ] **AC4** 잘못된 인자 또는 도구 실행 실패 시 stderr에 메시지가 출력되고 exit code가 non-zero이다.
- [ ] **AC5** `memento --db-path <path> recall ...` 실행 시 지정한 path의 DB가 사용된다.
- [ ] **AC6** `~/.memento/.env`에 `DB_PATH=...`를 두고 cwd에 .env가 없을 때, 해당 DB_PATH가 적용된다(탐색 순서 4번).
- [ ] **AC7** 성공한 CLI 호출에서 stdout만 파싱했을 때 유효한 JSON이다. (stderr에 로그가 섞이지 않음)
- [ ] **AC8** (REQ-IO-4) 성공한 CLI 호출 시 **stdout에 JSON만** 출력되고 **stderr에는 아무 출력이 없음**. 실패 시에만 stderr에 에러 메시지 출력. (core·라이브러리 로그는 CLI 모드에서 억제되어 컨텍스트 낭비가 없음.)
- [ ] **AC9** (코드 리뷰 반영) **AC6 전용 테스트**: cwd에 .env가 없고 `~/.memento/.env`에만 `DB_PATH`가 있을 때, 해당 DB가 사용됨을 검증하는 테스트가 있다.
- [ ] **AC10** (코드 리뷰 반영) **실패 시나리오 테스트**: (1) 필수 인자 누락(예: `recall` without `--query`) 시 exit 1 및 stderr에 "requires --query" 등 관련 메시지 포함, (2) 알 수 없는 서브커맨드 시 exit 1. (회귀 방지용)

---

## 6. 참조 및 연관 문서

- **설계(검토)**: [design.md](./design.md)
- **사전 코드 리뷰(TS)**: [2026-03-11-feat-110-cli-for-ai-ts-pre-review.md](../../../code_review/ko/2026-03-11-feat-110-cli-for-ai-ts-pre-review.md) — 타입 안전성, env-loader/option-map 문서화, 테스트(AC6·실패 시나리오) 권장 사항이 본 명세에 반영됨.
- **이슈**: [GitHub #110 — feat: AI 사용을 위한 Memento CLI 제공](https://github.com/jee1/memento/issues/110)
- **recall 컨텍스트 절약**: 아직 **미정**. [recall-context-saving-ideas.md](../../../design/recall-context-saving-ideas.md)는 검토용 아이디어 문서이며, 확정 시 CLI에서도 동일하게 반영할 수 있다.
- **MCP serverUseInstructions**: [mcp-server-instructions.md](../../../guides/ko/mcp-server-instructions.md)
- **core 설정**: `packages/memento-core/src/shared/config/index.ts`, `environment.ts` — 기본값 및 env 해석

---

## 7. 문서 산출물(구현 후)

구현 완료 시 다음 문서를 추가·갱신한다.

| 문서 | 내용 |
|------|------|
| docs/guides/ko/memento-cli-for-ai.md (및 en) | CLI 명령 목록, 스키마 요약, 워크플로, 예제, 설정 방법(~/.memento, DB_PATH, `npm exec --package memento-mcp-server -- memento ...` 권장). |
| README | npx 실행 시 모드별 사용법(MCP / HTTP / CLI), "CLI 반복 사용 시 글로벌 또는 로컬 설치 권장" 문구. |
| AGENTS.md 또는 .cursor 규칙 | "CLI 사용 시: 작업 전 recall/memory_injection, 작업 후 remember. 설정은 DB_PATH 또는 ~/.memento/.env." |

---

*이 명세는 SDD의 Plan → Tasks → Implement 단계에서 기준 문서로 사용한다.*

**다음 단계**: [구현 계획(PLAN)](./implementation-plan.md)
