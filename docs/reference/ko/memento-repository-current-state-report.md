# Memento 저장소 현재 상태 조사 보고서

**목적**: 모노레포 구조 제안 전, 현재 프로젝트 구조·코드 구성·문서·외부 사용 방식만 정리.
**일자**: 2026-03-04
**범위**: 진입점, 패키지, 서버 vs 라이브러리 표면, 도메인 구조, 배포·MCP·HTTP 관련 문서/관례, 외부 소비자 사용 경로. **모노레포 구조 제안은 포함하지 않음.**

> **적용 상태 (2026-03)**: 이 문서는 모노레포 전환 **이전** 상태를 기록한 조사 보고서입니다. 현재 저장소는 **npm workspaces 모노레포**로 전환되어 있으며, 실제 구조·진입점은 [AGENTS.md](../../../AGENTS.md) 및 [README.md](../../../README.md)를 참조하세요. (packages/memento-core, packages/memento-server, packages/memento-client, apps/*)
> **최신 가이드**: 일상 개발·경로 기준은 [개발자 가이드](../../guides/ko/developer-guide.md), [아키텍처 개요](../../architecture/ko/)를 함께 보세요.

---

## 1. 현재 프로젝트 구조 (진입점, 패키지, 서버 vs 라이브러리) — 과거 단일 패키지 시점

### 1.1 패키지 구성 (과거)

- **단일 npm 패키지**: `memento-mcp-server` (버전 1.17.0).
- **main**: `dist/server/index.js` — Node에서 `require`/`import` 시 노출되는 진입점은 **서버 진입점** 하나뿐이며, “라이브러리만 import”하는 공식 진입점은 없음.
- **bin**:
  - `memento-mcp-server`, `memento-mcp` → `dist/server/index.js` (stdio MCP 서버)
  - `memento-dev` → `dist/server/http-server.js` (HTTP/WebSocket MCP 서버)
  - `memento-setup` → `scripts/auto-setup.js`
- **별도 패키지**: `packages/mcp-client` — 현재는 `packages/memento-client`로 이전됨. `@memento/client`로 npm 배포 가능한 MCP 클라이언트 라이브러리.

### 1.2 서버 vs 라이브러리 표면

- **서버 표면**: `main`과 모든 `bin`이 서버 실행용. CLI/서버만 공식 진입점.
- **라이브러리 표면**: 공개 API로 “도메인만 import해서 쓰는” 진입점은 없음. `packages/mcp-client`는 Memento **서버에 연결하는 클라이언트**이지, 서버 코드를 라이브러리처럼 쓰는 패키지가 아님.

---

## 2. 코드베이스 구성 (src/ 도메인, 서버, 도구, 코어 vs 애플리케이션)

### 2.1 src/ 디렉터리 구조

- **domains/**
  - `memory`: 기억 CRUD, 임베딩 연동, 코어/볼트, 절차 기억·버전·롤백, 이웃 검색, memory_injection 등.
  - `search`: 검색 엔진(텍스트·벡터·하이브리드), 통합 점수, 프로시저 매칭.
  - `anchor`: 앵커 설정/조회/삭제, search_local.
  - `forgetting`: 망각 정책, 간격 반복, 리뷰 스케줄링.
  - `relation`: 트리플 추출, 관계 추출/검증, LLM 기반 추출.
  - `embedding`: OpenAI/Gemini/경량 등 임베딩 제공자.
  - `monitoring`: 성능 모니터, 알림, 에러 로깅, 품질 보증 등.

- **infrastructure/**
  - `database`: SQLite 초기화·마이그레이션·스키마·WAL·락 모니터, 레포지토리 구현.
  - `cache`, `scheduler`, `logging`: 캐시, 배치 스케줄러, 로깅.

- **shared/**
  - `types`, `config`, `utils`, `interfaces`, `constants`: 공유 타입, 설정, 유틸, 인터페이스.

- **server/**
  - `index.ts`: stdio MCP 진입점 (SDK Server + StdioServerTransport).
  - `http-server.ts`, `http-server-v2.ts`: HTTP/WebSocket MCP 서버 (Express + 라우터).
  - `bootstrap.ts`, `context.ts`: 서비스 초기화, ToolContext 생성.
  - `routes/`: tools, admin, api, mcp, quality 등 HTTP 라우트.
  - `middleware/`: 서비스 주입, 도구 컨텍스트, 관리자 인증, 에러 핸들러.
  - `servers/`: SSE 등 전송 레이어.

- **tools/**
  - `tool-registry.ts`, `index.ts`: 도구 레지스트리 및 MCP에 노출되는 도구 목록.
  - 실제 도구 구현은 `domains/*/tools/`에 있음.
  - `index.ts`에서 Remember, Recall, Forget, Pin, Unpin, MemoryInjection, GetMemoryNeighbors, SetAnchor, GetAnchor, SearchLocal, ClearAnchor, ProceduralDiff, ProceduralRollback, RememberProcedure 등 **핵심 도구만** 등록. 관리/운영(앵커 복원, 임베딩 마이그레이션, episodic→semantic 변환, 메타 메모리 통계) 및 관계 엔진(추출·조회·시각화)은 HTTP API 전용.

- **기타**: `scripts/`, `test/`, `client/`, `npm-client/`, `workers/`, `services/` 등.

### 2.2 “코어” vs “애플리케이션”에 해당할 만한 구분

- **코어에 가까운 것**
  - `domains/*`: 메모리·검색·앵커·망각·관계·임베딩·모니터링 등 비즈니스 로직.
  - `shared/*`: 타입, 설정, 유틸, 인터페이스.
  - `infrastructure/*`: DB, 캐시, 스케줄러, 로깅 등 인프라.
  → 프로토콜/전송에 무관한 “메모리·검색·망각·관계” 등 핵심 기능.

- **애플리케이션에 가까운 것**
  - `server/*`: MCP/HTTP 진입점, 라우터, 미들웨어, 부트스트랩, ToolContext.
  - `tools/*`: MCP 도구 등록·노출 정책(무엇을 MCP에 넣고 무엇을 HTTP만 둘지).
  → “어떤 프로토콜로, 어떤 도구 세트로” 서비스하는지 결정하는 층.

문서상 “core” vs “application”이라는 용어로 공식 분리된 레이어는 없으나, 위와 같이 도메인+인프라+공유 vs 서버+도구 레지스트리로 나누면 자연스럽게 대응됨.

---

## 3. 배포·MCP 서버·HTTP 서버 관련 문서·관례

### 3.1 배포

- **.cursor/rules/deployment.mdc**
  - Dockerfile (M1 SQLite / M3+ PostgreSQL), Docker Compose (dev, team, org), Kubernetes(네임스페이스·ConfigMap·Secret·Deployment·Service·Ingress), 환경 변수, 빌드/배포 스크립트, 모니터링·로깅·보안 체크리스트.
  - M1(개인) ~ M4(엔터프라이즈) 단계별 가이드.

- **README / INSTALL**
  - 원클릭 설치 스크립트, npx, Docker, 소스 빌드(`npm run quick-start` 등) 방식 안내.
  - “팀/조직은 Docker 권장” 등 사용처별 권장 방식.

### 3.2 MCP 서버

- **AGENTS.md**
  - MCP 진입점: `src/server/index.ts` (CLI용), `src/server/http-server.ts` (HTTP용).
  - `npm run dev` → stdio MCP, `npm run dev:http` / `dev:http-v2` → HTTP 퍼사드.
  - 빌드 시 `copy:assets`로 스키마·마이그레이션·prompts·config를 `dist` 등으로 복사.

- **서버 사용 지침 (serverUseInstructions)**
  - `index.ts` 내 `MEMENTO_SERVER_INSTRUCTIONS`: 작업 전 `recall`/`memory_injection`/`search_local`, 작업 후 `remember`, 타입·태그·중복 검사 등.

- **docs/guides**
  - Cursor MCP 설정, MCP serverUseInstructions, 다중 에이전트 사용 시 **단일 MCP 서버 프로세스**로 DB 접근 권장(HTTP MCP로 여러 클라이언트가 한 서버에 접속).

### 3.3 HTTP 서버

- **두 가지 HTTP 진입점**
  - `http-server.ts` → `dev:http`, `start:http`, bin `memento-dev`가 `dist/server/http-server.js` 참조.
  - `http-server-v2.ts` → `dev:http-v2`, `start:http-v2`.
  - 라우터: tools, admin, api, mcp, quality 등 (Phase 1.2 구조).

- **문서**
  - README: “성능 모니터링 (HTTP 관리 API)”, “HTTP 전용” 기능 나열.
  - `docs/api/ko/api-reference.md`: MCP Tools + HTTP 관리 API(성능 메트릭, 캐시, admin, 관계, 배치 등).
  - `docs/reference/ko/security.md`: HTTP API는 인증 없음, 내부망/MCP 전용 사용 권장.

---

## 4. 외부 소비자가 Memento를 사용하는 방식 (CLI, MCP, HTTP API)

### 4.1 CLI / 실행 방식

- **npx**
  - `npx memento-mcp-server@latest dev` — stdio MCP (watch).
  - `npx memento-mcp-server@latest` / `start` — stdio MCP 실행.
  - `npx memento-mcp-server@latest dev-http` — HTTP MCP 서버.
  - `npx memento-mcp-server@latest setup` — 자동 설정.
- **원클릭**
  - `curl -sSL .../install.sh | bash`.
- **Docker**
  - `docker-compose -f docker-compose.dev.yml` / `docker-compose.prod.yml` 등.
- **소스**
  - `npm install` → `npm run quick-start` 또는 `npm run dev` / `npm run dev:http`(v2는 `dev:http-v2`).

### 4.2 MCP 클라이언트 (에이전트/호스트)

- **stdio MCP**
  - 한 프로세스당 하나의 MCP 서버. Cursor, Claude Desktop 등에서 `memento-mcp-server`(또는 `memento-mcp`)를 stdio 전송으로 실행해 연결.
- **HTTP MCP**
  - 다중 에이전트 시 권장: MCP 서버를 HTTP/WebSocket으로 한 번만 띄우고, 모든 클라이언트가 같은 포트(예: 9001)로 접속. `mcp.json` 등에 HTTP MCP 서버 URL/포트 설정.
- **노출 도구**
  - MCP에는 핵심 22개(remember, recall, feedback, forget, pin, unpin, memory_injection, get_memory_neighbors, set/get/search_local/clear_anchor, procedural_*, extract_triples, add/get/remove_relation, get_introspection_summary, get_telemetry_summary, export_memories).
  - 관리/운영(앵커 복원, 임베딩 마이그레이션, episodic→semantic 변환, 메타 메모리 통계)은 MCP에 없고 HTTP로만 제공.

### 4.3 HTTP API

- **역할**
  - 관리·운영: 앵커 복원, 임베딩 마이그레이션, episodic→semantic 변환, 메타 메모리 통계, 배치, 성능 메트릭·알림, 관계 추출·조회·시각화 등.
  - 인증 없음, 내부망/MCP 전용 사용 권장(docs/reference/ko/security.md).

### 4.4 클라이언트 라이브러리

- **packages/mcp-client** (`@memento/client`)
  - Memento MCP **서버에 연결**하는 클라이언트 라이브러리.
  - 서버 코드를 npm 패키지로 직접 import하는 “core 라이브러리”는 없음.

---

## 5. 요약

| 항목 | 현재 상태 |
|------|-----------|
| 패키지 | 단일 패키지 `memento-mcp-server` + 저장소 내 `packages/mcp-client` |
| 진입점 | main = 서버 진입점만. 라이브러리 전용 진입점 없음 |
| bin | stdio MCP, HTTP MCP(memento-dev), setup |
| 코드 구성 | domains(7) + infrastructure + shared + server + tools; “코어”≈도메인+인프라+공유, “앱”≈server+tools |
| 배포 문서 | .cursor/rules/deployment.mdc, README, INSTALL, Docker/Compose/K8s |
| MCP/HTTP 문서 | AGENTS.md, docs/guides, docs/api, serverUseInstructions |
| 외부 사용 | CLI(npx/원클릭/Docker/소스), stdio MCP 또는 HTTP MCP, HTTP 관리 API; 클라이언트는 @memento/client |

이 문서는 **현재 상태와 패턴만 기술**하며, 모노레포 또는 패키지 분리 제안은 포함하지 않습니다.
