# Memento CLI for AI — Tech (Memory Bank)

SDD **Plan** 단계의 **Memory Bank** 문서 2/3. 프레임워크·라이브러리 버전, 데이터베이스 스키마, 기술적 제약 사항을 정의한다.  
**기준 명세**: [spec.md](./spec.md)

---

## 1. 런타임·언어

| 항목 | 값 | 비고 |
|------|-----|------|
| Node.js | ≥ 20.0.0 | package.json engines, AGENTS.md |
| 모듈 | ES Module | `"type": "module"` |
| 언어 | TypeScript | 빌드 산출물: dist/*.js |
| 패키지 매니저 | npm ≥ 10 | workspaces 사용 |

---

## 2. CLI 관련 의존성

| 패키지 | 용도 | 버전(참고) |
|--------|------|------------|
| **@memento/core** | createMementoCore, closeDatabase, createToolContext, getToolRegistry | workspace `*` |
| **dotenv** | .env 파일 로드 | ^16.3.1 (server/루트) |
| Node 내장 | path, os, fs, process | — |

- CLI 전용으로 **새 의존성 추가하지 않음**. 기존 server 패키지 의존성만 사용(commander/yargs 등 미사용, argv 직접 파싱).

---

## 3. 데이터베이스

- **스키마**: CLI는 **기존 SQLite 스키마를 그대로 사용**한다. 스키마 변경·마이그레이션은 core 책임.
- **진실 공급원**: `packages/memento-core/src/infrastructure/database/database/schema.sql` 및 마이그레이션 디렉터리. 참조: [architecture/ko/database-design.md](../../../architecture/ko/database-design.md).
- **DB 경로 결정**: `opts.dbPath ?? process.env.DB_PATH ?? mementoConfig.dbPath`. CLI는 이 한 번 결정된 경로로만 `createMementoCore({ dbPath })` 호출.
- **초기화/마이그레이션**: DB가 없거나 스키마가 낮은 경우 core 내부에서 처리. CLI는 `db:init`/`db:migrate` 스크립트를 실행하지 않으며, 사용자가 별도로 실행하는 것을 가이드 문서에서 안내.

---

## 4. 환경 설정

- **.env 탐색 순서**(CLI 진입 시):  
  `--env-file` 지정 파일 → `MEMENTO_CONFIG_DIR/.env`(또는 `--config-dir`/.env) → `process.cwd()/.env` → `~/.memento/.env`.  
  먼저 존재하는 파일 **하나만** 로드(명세 REQ-CFG-2).
- **dotenv 호출 시점**: **core를 import하기 전**. env-loader가 CLI 진입 직후 호출되므로 `mementoConfig`가 이미 process.env를 반영한 상태로 로드됨.
- **API 키·비밀**: CLI 인자로 **받지 않음**(명세 CON-1). 환경변수 또는 .env로만 제공.

---

## 5. 기술적 제약 사항

| ID | 제약 | 검증 |
|----|------|------|
| CON-1 | API 키·비밀은 CLI 인자로 받지 않는다. | 인자 파서에 API 키 옵션 없음. |
| CON-2 | 기존 bin(memento-mcp-server, memento-dev) 동작은 변경하지 않는다. | server/index.ts, http-server.ts 무수정. |
| CON-3 | CLI 전용 설정 로드는 진입 시 **한 번만** 수행. dotenv는 하나의 .env만 로드. | 중복 로드 없음. |
| REQ-IO-4 | CLI 실행 시 **출력은 도구 응답(JSON)만**. core·라이브러리 로그(INFO/WARN/DEBUG)는 CLI 모드에서 **억제**. stdout·stderr 모두 일상 로그 없음. | 성공 시 stdout=JSON만, stderr=없음. 실패 시 stderr=에러 메시지만. |

- **로그 억제**: 명세 AC8. 구현 시 core/라이브러리 로거를 CLI 진입 후 무음(silent) 또는 레벨 오프로 설정하여, AI·스크립트가 stdout만 파싱해도 토큰/화면 낭비가 없도록 한다.

---

## 6. 빌드·테스트

- **빌드**: `npm run build -w memento-server` 또는 루트 `npm run build`. `tsconfig.json`에 `cli.ts`, `cli/*.ts` 포함.
- **산출물**: `packages/memento-server/dist/cli.js`, `dist/cli/env-loader.js`, `dist/cli/option-map.js`.
- **테스트**: Vitest. CLI 통합 테스트는 `cli/cli-ac5-ac6.spec.ts` 등에서 `child_process.spawn`으로 bin 실행·stdout/stderr/exit 검증.
- **품질 게이트**: `npm run lint`, `npm run type-check`, `npm test` (AGENTS.md).

---

## 7. 참조 문서

- Core 설정: `packages/memento-core/src/shared/config/index.ts`, environment 관련.
- DB 설계: [docs/architecture/ko/database-design.md](../../../architecture/ko/database-design.md).
- 보안: [docs/reference/ko/security.md](../../../reference/ko/security.md) — 경로 검증·에러 메시지 노출 정책.

---

*이 문서는 Plan 단계의 기술 헌칙으로, 도입 기술·제약 변경 시 이 문서를 먼저 갱신한다.*
