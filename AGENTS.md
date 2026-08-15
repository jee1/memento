# Memento Agent Guidelines (Master Guide)

이 파일은 Memento 저장소에서 일하는 **사람과 AI 에이전트**가 공통으로 참조하는 진입점입니다. 패키지 구조·npm 명령·MCP 워크플로 같은 상세는 [docs/agents/](./docs/agents/README.md)로 나뉘어 있고, **코딩 행동 지침(§4)** 은 여기에만 둡니다. `CLAUDE.md`·`GEMINI.md`도 이 문서를 가리킵니다.

| 문서 | 내용 |
|------|------|
| [architecture.md](./docs/agents/architecture.md) | 패키지·도메인 |
| [commands.md](./docs/agents/commands.md) | 명령·환경·Docker (배포 전 `db:pre-docker-deploy`) |
| [agent-workflow.md](./docs/agents/agent-workflow.md) | MCP·graphify·UI·복리 |
| [search-ranking.md](./docs/agents/search-ranking.md) | 랭킹 공식 |
| [DEVELOPMENT_RULES.md](./DEVELOPMENT_RULES.md) | 코딩 표준 |

## 1. 프로젝트 개요

Memento는 AI 에이전트가 **대화가 끝난 뒤에도 맥락을 잃지 않도록** 돕는 MCP 메모리 서버입니다. 기억은 working(48h), episodic(90d), semantic·procedural(무기한) 네 층으로 나뉘고, FTS5와 벡터를 함께 쓰는 하이브리드 검색·망각 정책·다중 임베딩으로 운영됩니다. 스택은 Node.js ≥24, TypeScript, SQLite, Vitest입니다.

## 2. 빠른 시작

저장소에 처음 들어왔다면, 의존성 설치와 빌드·테스트를 한 번에 돌려 본 뒤 개발 모드를 켜면 됩니다.

```bash
npm install && npm run build && npm test
npm run dev          # MCP
npm run dev:http     # HTTP 관리
npm run lint && npm run type-check  # 커밋 전 필수
```

명령 전체와 Docker·DB 운영은 [commands.md](./docs/agents/commands.md)에, 패키지·도메인 구조는 [architecture.md](./docs/agents/architecture.md)에 정리되어 있습니다.

## 3. 에이전트 필수 습관

Memento를 **쓰는** 에이전트는 작업 전에 `recall`이나 `memory_injection`으로 관련 기억을 불러오고, 그 결과를 실제로 썼다면 `feedback`(helpful/not_helpful)을 남기고, 작업이 끝나면 `remember`로 결과를 남기는 습관이 품질 차이를 만듭니다. 저신뢰·고실패 기억이 쌓이면(`introspection_hint`/`get_introspection_summary`) 운영자가 `POST /admin/introspection/heal`(dry-run 우선)로 정리합니다 — recall→feedback→heal 체크리스트는 [agent-workflow.md §MCP·메모리](./docs/agents/agent-workflow.md#mcp메모리--작업-전후-기억-루프)를 보세요. **코드를 고치는** 에이전트는 구조를 추측하기 전에 `graphify-out/GRAPH_REPORT.md`를 보고, 수정 후 graphify를 재빌드합니다. PR을 내보내기 전에는 `lint`, `type-check`, `test`를 통과시킵니다.

상세 워크플로: [agent-workflow.md](./docs/agents/agent-workflow.md)

## 3.1 Gotchas

- **Docker 배포 전**: `npm run db:pre-docker-deploy` (DB 무결성 점검)
- **Node 24 정합**: 루트 `.nvmrc`=`24`; `nvm use` 후 `node -v`·`which node` 확인(Cursor agent PATH가 nvm을 가릴 수 있음). major 전환 후 `npm run rebuild-native`. Docker는 #702 (`node:24-*`)
- **`DB_PATH`**: 프로덕션은 절대 경로; `~`는 확장되지 않음
- **memory_embedding migrate rebuild (#755)**: create/copy/drop/rename + `memory_embedding_vec_*` DROP은 단일 `db.transaction()`; 실패 시 live 테이블·트리거 함께 롤백. `recreateVecTriggers`는 성공 후 트랜잭션 밖
- **memory_embedding metadata repair (#753)**: `ensureMemoryEmbeddingMetadataDefaults`는 `migrate.ts`·`initializeDatabase` 1회만 — `MemoryEmbeddingService` create/search/stats hot path에 테이블 전역 UPDATE 금지
- **npm 발행 대상 (#765)**: `memento-mcp-server`(루트)·`@jee1/memento-client`·`@jee1/memento-assistant`만 발행. `@memento/core`·`@memento/agent-integration`은 `private: true`(루트 tarball에 번들). `@memento` scope는 타인 소유라 사용 불가. SDK는 **워크스페이스 version을 올려야** 릴리스에서 발행됨(동일 버전이면 skip)
- **MCP 레지스트리 (#763)**: 루트 `server.json`의 `name`은 `package.json.mcpName`과, `version`·`packages[0].version`은 `package.json.version`과 일치해야 함 (`tests/mcp-registry-metadata.spec.ts`). 릴리스 시 `release.yml`이 태그 버전으로 재작성 후 `mcp-publisher`로 등재(정식 릴리스만)

- **Claude Code 플러그인 (#764)**: 마켓플레이스는 루트 `.claude-plugin/marketplace.json`, 플러그인 본체는 `plugins/memento/`(`.mcp.json`·`skills/`). 수정 후 `claude plugin validate . --strict` 통과 필수이고, 사용자에게 업데이트가 나가려면 `plugins/memento/.claude-plugin/plugin.json`의 `version`을 올려야 함
- **graphify**: 코드 수정 후 재빌드 필수 (명령은 [agent-workflow.md](./docs/agents/agent-workflow.md))
- **graphify 커밋**: 루트 `graphify-out/`만; `packages/memento-core/graphify-out/cache/`는 무시
- **debt markers**: BUG/TODO 판단은 `npm run check-debt-markers -- --production-only` 우선 (`tech-debt-analyzer`는 `debug` 등 false positive)
- **@deprecated**: merge 전 `docs/architecture/core-deprecated-inventory.md` 갱신
- **기술 부채 추적**: GitHub #593 (완료 #580)
- **git worktree**: 브랜치 삭제·`gh pr merge --delete-branch` 전에 `git worktree remove <path>` 필수 (attach 상태면 로컬 브랜치 삭제 실패)
- **gh pr merge**: 머지는 성공해도 worktree 미제거 시 로컬 브랜치 삭제만 실패 — `worktree remove` 후 `git branch -D`(squash merge는 `-d` 불가)·`git fetch --prune`
- **병렬 HTTP 보안 PR**: #662→#663→#664 순 merge·rebase 권장(토큰→audit `keyId`→owner scope); 독립 CI(#665)는 선행 가능 — **CHANGELOG·http-server·graphify-out 충돌** 예상
- **graphify merge 충돌**: `git checkout origin/main -- graphify-out/` 후 graphify 재빌드가 수동 conflict보다 빠름
- **http-server 미들웨어 순서**: `/tools` — rateLimit → programmaticAuth → toolContext → ownerScope → httpAudit → router; `middleware/index.ts` export 누락 시 `tsc` 실패
- **Security Check no-console (core)**: config 파서 경고는 `console.warn` 금지 — `process.stderr.write('[CONFIG WARN] ...\\n')` (예: `owner-scope-mode.ts`)
- **Express `programmaticAuth`**: `declare global`은 `programmatic-auth.middleware.ts` 한 곳만 — audit 등 다른 미들웨어에서 중복 선언 시 TS2717
- **CI npm ci flake**: `onnxruntime-node` NuGet `ETIMEDOUT`은 코드 버그 아님 — `gh run rerun --failed`
- **신규 worktree**: 생성 직후 해당 경로에서 `npm install` 후 테스트 (`tsc: not found` 방지)
- **병렬 이슈 worktree**: `~/git/memento-worktrees/issue-<num>-<slug>`; Spec Kit는 `specs/0NN-<slug>/` (번호는 기존 최대+1)
- **`MEMENTO_TYPE_PARAM_MODE`**: 기본값 `error` (#636, v1.18+); `type` 생략 시 `remember`/`recall` 거절 — 레거시는 env `warn`/`deprecate`; spec·통합테스트는 `type` 명시 또는 `mementoConfig.typeParamMode='warn'` mock
- **core-deprecated-inventory**: 활성 표 먼저 확인 (#617 후 shim 제거 완료; #636은 type-param 롤아웃); merge 전 inventory·CHANGELOG 갱신
- **deps minor/patch**: `npm outdated` → wanted만; `better-sqlite3` 후 `npm run rebuild-native`; major(eslint 10·vitest 4)는 별도 이슈
- **`@types/node`**: major는 `engines.node`(≥24)와 맞춤 — root·워크스페이스 package.json 동시 갱신
- **Node major 전환**: `npm ci` → `npm run rebuild-native` → smoke(`better-sqlite3`/`sqlite-vec`/`sharp`/`onnxruntime-node`) → type-check; Cursor agent PATH가 nvm을 가릴 수 있음
- **도메인 회귀 테스트**: `npm test -- packages/memento-core/src/domains/<domain>/.../__tests__/<module>` (전체 `npm test` 전 선행)
- **recall search_quality 텔레메트리**: `ranking_version`은 hybrid면 `HybridSearchEngine.getRankingVersion()`(생성 시 캐시, `ranking-sha256:`+가중치 SHA12) 아니면 `getRankingVersion()`; funnel은 SQL `json_extract`로 `text_candidate_count`/`vector_candidate_count`/`union_candidate_count`(없으면 `candidate_count`) — extra_data 전량 JS 파싱 금지, 키 변경 시 admin `/telemetry/search-quality`·`get_telemetry_summary`·telemetry-cli 동시 갱신
- **feedback_quality 텔레메트리 (#729)**: `recall_without_feedback_rate` 등 키 변경 시 `get_telemetry_summary`·admin `/telemetry/feedback`·`npm run telemetry -- --type feedback-quality` 동시 갱신; 관측 지표는 [agent-workflow.md](./docs/agents/agent-workflow.md)
- **nightly category-report (#731)**: weekly `nightly-tests.yml`이 `npm run quality:benchmark:category-report` 실행 — `REQUIRED_MACRO_CATEGORIES` 누락·평가 불가 GT 또는 카테고리 MRR < 0.5면 exit 1; PR gate 아님(승격·범위는 2026-09-01까지 재검토)
- **infrastructure repo 분해**: `packages/memento-core/src/infrastructure/database/repositories/` — composition(`*-store.ts`); public export는 오케스트레이터 파일만 (#610)
- **composition 분해 후 CI**: `test-core`는 memento-core 전체 vitest — 도메인 `__tests__`만 green이면 부족; 다른 경로 spec이 `(orchestrator as any).privateMethod` 호출 시 orchestrator에 위임 래퍼 필수 (예: `006-fts5-reflection-notes.spec.ts` → `buildReflectionNotesSearchCondition`)
- **scheduler jobs 타입**: `BatchJobResult` 등은 `batch-scheduler-types.js`에서 import (`batch-scheduler.js`는 jobs↔scheduler 순환 참조)
- **batch-scheduler singleton (#749)**: `getBatchScheduler`/`create`/`reset` 구현은 `batch-scheduler.ts`에 두고 `batch-scheduler-singleton.ts`는 re-export만 — singleton→class←re-export runtime cycle 방지 (`dependency-boundaries.spec.ts`)
- **dependency-boundaries (#749)**: domain→infra·shared→infra|server는 allowlist+rationale로 freeze; 신규 위반·allowlist 추가는 `FROZEN_*_SIZE` bump 필요 — `packages/memento-core/src/test/architecture/dependency-boundaries.spec.ts`
- **fts5↔database cycle (#749)**: `fts5-migration-status.ts`는 `DatabaseUtils`/`database.ts` 대신 `shared/utils/database/query-helpers.js`의 `getQuery`/`runQuery` 사용 (schema-init 순환 차단)
- **infrastructure async·reflexion** (#615): `async-optimizer/`(types·parsers·queue·worker·batch-processor), `reflexion-procedural-memory-service/`(extraction·create·update-*); orchestrator는 re-export·early-return; Worker↔Queue는 `import type`으로 순환 방지; 선행 spec — `reflexion-worker.spec.ts` + `failure-detector.spec.ts`
- **composition import 깊이**: `infrastructure/foo.ts` → `../shared/`; `infrastructure/foo/bar.ts` → `../../shared/` (`tsc` 모듈 not found 시 우선 확인)
- **커밋 훅 (revise-claude-md)**: `git commit` 직전 `.cursor/hooks/pre-commit-revise-claude-md.sh`가 `AGENTS.md` §3.1 등을 갱신·스테이징; 스킵 `REVISE_CLAUDE_MD_SKIP=1`

## 4. 코딩 에이전트 행동 지침 (Karpathy Guidelines)

> 출처: [andrej-karpathy-skills/CLAUDE.md](https://github.com/multica-ai/andrej-karpathy-skills/blob/main/CLAUDE.md)

**트레이드오프:** 속도보다 신중함 우선. 사소한 작업은 유연 적용.

### 4.1 구현 전에 생각하기 (Think Before Coding)

**가정하지 말 것. 혼란을 숨기지 말 것. 트레이드오프를 드러낼 것.**

- 가정을 명시한다. 불확실하면 질문한다.
- 해석이 여러 가지면 제시한다.
- 더 단순한 접근이 있으면 말한다.
- 불명확하면 멈추고 질문한다.

### 4.2 단순함 우선 (Simplicity First)

**최소 코드만. 추측성 코드 금지.**

- 요청 범위 초과·단일용 추상화·미요청 설정성·불가능 시나리오 에러 처리 금지
- 200줄이 50줄이 될 수 있으면 다시 쓴다

### 4.3 수술적 변경 (Surgical Changes)

**꼭 필요한 것만 수정. 자신이 만든 unused만 정리.**

- 인접 코드·포맷 "개선", 무관 리팩터, 기존 dead code 삭제 금지
- 변경 줄은 사용자 요청에 직접 연결되어야 한다

### 4.4 목표 기반 실행 (Goal-Driven Execution)

**성공 기준을 정의하고 검증될 때까지 반복.**

- "검증 추가" → 잘못된 입력 테스트 작성 후 통과
- "버그 수정" → 재현 테스트 후 통과
- 다단계 작업은 `단계 → 검증 방법` 계획을 먼저 제시

**잘 작동하면:** diff 노이즈·과도한 재작성이 줄고, 구현 전에 질문이 나온다.
