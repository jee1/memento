# 모노레포 전환 현황 조사 보고서

**목적**: 모노레포 + memento-core/server/client 분리 계획을 위한 현재 저장소 상태·패턴 정리.  
**컨텍스트**: [docs/brainstorms/2026-03-04-monorepo-memento-core-brainstorm.md](../brainstorms/2026-03-04-monorepo-memento-core-brainstorm.md) (Approach A: 3패키지 분리 선택).  
**범위**: 구현 계획 없음. 현재 상태와 관찰된 패턴만 기술.

---

## 1. 모노레포/워크스페이스 패턴

### 1.1 현재 상태

- **워크스페이스 미사용**: 루트 `package.json`에 `workspaces` 필드 없음. npm/pnpm/yarn workspaces 또는 Turborepo 설정 없음.
- **단일 패키지**: 루트가 유일한 npm 패키지(`memento-mcp-server`, `package.json`). `main`: `dist/server/index.js`, `bin`으로 MCP/HTTP/설정 스크립트 노출.
- **클라이언트 연동 방식**: 루트는 `packages/mcp-client`를 **의존성으로 갖지 않음**. 스크립트로만 참조:
  - `build:client`: `cd packages/mcp-client && npm run build`
  - `dev:client`: `cd packages/mcp-client && npm run dev`
  - `clean:client`, `publish:client` 동일 패턴
- **CI**: `.github/workflows/ci.yml`은 루트만 빌드·테스트(`npm ci` → `npm run build`). 클라이언트 빌드/테스트 단계 없음.

### 1.2 결론

- 모노레포·멀티패키지 빌드/테스트/배포 패턴이 **아직 도입되지 않은 상태**.
- 모노레포 전환 시 워크스페이스 정의, 루트 스크립트 통합, CI에 패키지별 단계 추가가 필요.

---

## 2. src/ 구조와 의존 관계

### 2.1 디렉터리 구성

| 경로 | 역할 |
|------|------|
| `src/domains/` | 도메인 로직: `memory/`, `embedding/`, `forgetting/`, `search/`, `anchor/`, `relation/`, `monitoring/` 등 |
| `src/infrastructure/` | DB, 스케줄러, 캐시, 마이그레이션, WAL 체크포인트, reflexion 워커, consolidation-score 등 |
| `src/shared/` | 공유 타입·인터페이스·설정·유틸(`config/`, `types/`, `utils/`, `interfaces/`, `constants/`) |
| `src/server/` | MCP 진입점(`index.ts`), HTTP 서버(`http-server.ts`, `http-server-v2.ts`), 부트스트랩·컨텍스트·라우트·미들웨어 |
| `src/tools/` | MCP 도구 레지스트리(`tool-registry`, `index.ts`) — 도메인 도구 클래스는 `domains/*/tools/`에 있음 |
| `src/scripts/` | 빌드 보조(`copy-assets.js` 등) |
| `src/test/` | E2E·시나리오 테스트 |
| `src/npm-client/` | **클라이언트 라이브러리 소스** (실제 빌드 출력은 `packages/mcp-client/dist`) |

### 2.2 의존 방향 (관찰된 패턴)

- **server →**  
  `infrastructure/database/.../init.js`, `shared/config`, `shared/utils`, `domains/*`(search, memory, anchor, monitoring, relation 등), `infrastructure/scheduler`, `tools/index.js`(getToolRegistry).
- **tools/index.ts →**  
  `domains/memory/tools/*`, `domains/anchor/tools/*` 등 도메인 도구 클래스 직접 import.
- **domains ↔ infrastructure**:  
  `domains` 일부가 `shared`만 쓰고, `infrastructure`는 `domains`(예: memory, monitoring) 및 `shared` 참조.  
  `init.ts`(infrastructure)는 `shared/config`, `domains/memory/services/core-memory-*`, `shared/utils` 사용.
- **shared**:  
  타입·설정·유틸; `infrastructure/scheduler/retry-manager` 등 일부 인프라 타입을 참조하는 경우 있음(`shared/config/retry-options-loader.ts`).

**요약**:  
- **server**와 **tools**가 **domains + infrastructure + shared**에 직접 의존.  
- core 분리 시, server/tools는 “core(domains+infrastructure+shared)를 소비하는 계층”으로 두고, core는 라이브러리 API만 노출하도록 진입점을 정리해야 함.

---

## 3. AGENTS.md, README, docs/ — 빌드·테스트·배포

### 3.1 AGENTS.md (`AGENTS.md`)

- **구조**: `src/server/`(MCP 진입), `src/domains/`, `src/shared/`, `src/infrastructure/`. DB는 `src/infrastructure/database/`, 스키마·마이그레이션 빌드 시 복사.
- **빌드**: `npm run build` = tsc + `copy:assets`. 산출물 `dist/`, 수동 편집 금지.
- **테스트**: Vitest. 단위(`*.spec.ts`), E2E(`src/test/test-*.ts`). `npm test`, `npm run test:client` 등 시나리오 스크립트.
- **DB**: `npm run db:init` → `src/infrastructure/database/database/init.ts`, 스키마 변경 시 `npm run db:migrate`. 설계 명세 `docs/architecture/ko/database-design.md`.
- **문서**: `docs/README.md` 목차·분류.

### 3.2 README / 배포

- **README.md**: npm 사용 명시, `quick-start`, Docker/HTTP 실행 방법, 환경 변수(DB_PATH, PORT 등).
- **배포 규칙**: `.cursor/rules/deployment.mdc`에 Dockerfile, docker-compose(dev/team/org), K8s, 환경 변수 예시 정리. DB_PATH 등은 환경 변수로 주입.

### 3.3 docs/ 요약

- **docs/README.md**: 가이드·아키텍처·API·계획·테스트·운영·참조·리서치 등 분류.
- **DB·초기화**:  
  - `docs/architecture/ko/database-design.md`: 스키마 설계, DDL 진실 공급원은 `src/infrastructure/database/database/schema.sql` + 마이그레이션.  
  - `docs/guides/ko/migration-system-guide.md`: MigrationRunner, 마이그레이션 디렉터리(`migration/migrations/` vs 레거시 `migrations/`), 인터페이스.

---

## 4. packages/mcp-client — 빌드 및 루트 참조

### 4.1 패키지 정의

- **위치**: `packages/mcp-client/package.json`.
- **이름**: `@memento/client`, 버전 `0.1.0`.
- **진입점**: `main`: `dist/index.js`, `types`: `dist/index.d.ts`.
- **빌드**: `tsc --project tsconfig.build.json`.

### 4.2 소스 위치 (중요)

- **클라이언트 소스는 패키지 안에 없음.**  
  `packages/mcp-client/tsconfig.build.json`:
  - `rootDir`: `../../src/npm-client`
  - `include`: `../../src/npm-client/**/*`
- 즉, **실제 소스는 `src/npm-client/`**이고, 빌드 결과만 `packages/mcp-client/dist/`에 출력됨. 패키지 디렉터리에는 `package.json`, `tsconfig*.json`, (빌드 후) `dist/` 등만 있음.

### 4.3 루트 참조

- 루트 `package.json`에는 `@memento/client` 의존성 없음.
- 스크립트만: `build:client`, `dev:client`, `clean:client`, `publish:client`가 `cd packages/mcp-client && npm run ...` 실행.
- CI에서는 클라이언트 빌드/테스트를 수행하지 않음.

### 4.4 정리

- **memento-client** 패키지는 “소스는 루트 `src/npm-client/`, 패키지 메타와 빌드 설정은 `packages/mcp-client/`” 구조.  
- 모노레포에서 `packages/memento-client`로 통일할 때, 소스를 `packages/memento-client/src`로 옮기거나, 워크스페이스에서 루트 `src/npm-client`를 계속 참조하도록 할지 선택 필요.

---

## 5. DB 경로·설정·초기화 (core 노출 시 고려사항)

### 5.1 DB 경로

- **env**: `env.example` 및 `src/shared/config/environment.ts` 기본값 `DB_PATH=./data/memory.db`.
- **실제 사용**: `src/shared/config/index.ts`의 `mementoConfig.dbPath`가 `resolveString('DB_PATH')`로 로드.  
  `src/infrastructure/database/database/init.ts`는 `mementoConfig`를 통해 DB 경로를 사용.

### 5.2 설정 로드

- `shared/config/index.ts`: `dotenv` 로드 후 `mementoConfig` 객체 구성(DB, MCP, 임베딩, 검색, 망각 TTL, 로깅 등).  
  core를 라이브러리로 쓸 때는 **호출자가 DB 경로(및 필요 시 전체 설정)를 주입**할 수 있는 API가 필요할 수 있음.

### 5.3 초기화

- **스크립트**: `npm run db:init` → `src/infrastructure/database/database/init.ts`.
- **역할**: 스키마 적용, 마이그레이션 감지/실행(MigrationDetector, MigrationRunner), 레거시 호환 컬럼 추가, core_memory/knowledge_vault 등 초기화.  
  `init.ts`는 이미 `shared/config`, `domains/memory/services/core-memory-*`, `shared/utils` 등에 의존.
- **문서**:  
  - `docs/architecture/ko/database-design.md`: 스키마·마이그레이션 경로 명시.  
  - `docs/guides/ko/migration-system-guide.md`: 마이그레이션 디렉터리와 인터페이스.

### 5.4 core에서 노출할 것

- **경로**: DB 파일 경로(또는 인메모리)를 인자/옵션으로 받는 **초기화 함수**.
- **설정**: 환경 변수 단일 진입점 대신, **설정 객체 주입**을 지원하면 서버/CLI/앱에서 동일 core를 다른 설정으로 사용 가능.
- **에셋**: `copy-assets.js`가 복사하는 스키마(`schema.sql`), 마이그레이션 SQL, (선택) prompts/config — core 패키지에서 이 경로들을 안정적으로 노출하거나 번들링하는 방식 결정 필요.

---

## 6. 요약 표

| 항목 | 현재 상태 |
|------|-----------|
| 워크스페이스 | 없음 (단일 루트 패키지) |
| 패키지 수 | 1 (루트). `packages/mcp-client`는 별도 패키지지만 루트 의존성 아님 |
| 클라이언트 소스 | `src/npm-client/`, 빌드 출력 `packages/mcp-client/dist/` |
| server 의존 | infrastructure(init, scheduler 등), shared, domains, tools |
| tools 의존 | domains/*/tools, tool-registry |
| DB 경로 | `DB_PATH`(env), `mementoConfig.dbPath` |
| DB 초기화 | `src/infrastructure/database/database/init.ts`, 마이그레이션 `migration/migrations/` |
| 빌드 에셋 | `copy-assets.js`: schema → dist/database, migrations → dist/infrastructure/..., prompts, config → dist |
| CI | 루트만: lint, type-check, test:ci, build. 클라이언트 미포함 |

---

*이 문서는 모노레포 전환 및 memento-core 분리를 위한 **현재 상태 조사** 결과이며, 구현 단계나 태스크 목록은 포함하지 않습니다.*
