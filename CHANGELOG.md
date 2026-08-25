# Changelog

이 파일은 Memento MCP Server 프로젝트의 모든 중요한 변경사항을 기록합니다.

형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.0.0/)를 따르며,
이 프로젝트는 [Semantic Versioning](https://semver.org/lang/ko/)을 준수합니다.

## [Unreleased]

### Breaking

- **[BREAKING] MCP `tools/list` 기본 노출을 4개로 축소** (#769): 등록 도구는 22개 그대로지만 `tools/list`는 기본적으로 `recall`·`remember`·`memory_injection`·`feedback`만 반환합니다. 도구 정의는 세션 내내 클라이언트 컨텍스트를 점유하고, Memento는 늘 켜두는 서버라 상시 점유 비용이 큽니다 — 측정 결과 직렬화된 목록이 23,440 → 11,817 바이트(추정 5,860 → 2,954 토큰, **49.6% 감소**)입니다.

  **마이그레이션**: 나머지 18개는 **등록된 채로 남아 `tools/call`로 그대로 호출됩니다** — 목록에서만 빠지므로 도구 이름을 이미 아는 클라이언트·스킬·스크립트는 영향이 없습니다. 영향을 받는 것은 `tools/list` 결과만 보고 도구를 고르는 에이전트입니다. 이전처럼 22개를 전부 나열하려면 MCP 호스트 설정에 `MEMENTO_TOOLSET=full`을 추가하세요(stdio·HTTP·WebSocket 모두 동일). 잘못된 값은 경고 후 `core`로 폴백합니다. 측정 재현: `npm run mcp:tool-surface`.

- **CLI bin alias `memento-mcp` removed** (#766): use `memento-mcp-server` only (same stdio entrypoint). The short alias collided with the unrelated npm/GitHub project `gannonh/memento-mcp`. Update MCP host configs and scripts that invoked `memento-mcp`. npm package name remains `memento-mcp-server`.

### Changed

- **규칙 기반 폴백 로그 사유 구분** (#819): 폴백 로그에 `reason` 필드가 붙어 미설정(`provider_not_configured`)·초기화 실패(`init_failed`)·LLM 호출 실패(`llm_call_failed`)를 구분합니다. 값은 세 개로 고정이며 기존 로그 문구는 그대로입니다.
- **Recall latency** (#735): `include_metadata` 경로의 고정 150ms 대기를 제거하고, pending `recordRecall` 통계를 `getStats`/`getStatsById`에서 즉시 읽는다. hybrid search는 FTS와 vector 분기를 `Promise.all`로 동시에 시작한다. ranking weight·score breakdown은 그대로다.

### Fixed

- **관계 추출기의 조용한 규칙 기반 폴백** (#819): `RelationExtractor`가 `LLMBasedRelationExtractor.isAvailable()`을 동기로 호출했는데, `preferredProvider`는 생성자의 비동기 초기화가 끝난 뒤에야 정해집니다. remember·`extract_relations` 모두 요청마다 추출기를 새로 만들기 때문에 이 판정은 항상 초기화 이전 상태를 봤고, LLM이 설정돼 있어도 관계 추출이 한 번도 시도되지 않았습니다. 초기화 완료를 기다린 뒤 판정하는 `isAvailableAsync()`를 추가하고 두 판정 지점을 그쪽으로 옮겼습니다. 규칙 기반 고신뢰 결과가 나오는 빠른 경로는 판정 자체를 하지 않으므로 대기가 붙지 않습니다.
- **로컬 프로바이더 자동 선택 시 판정 불일치** (#819): `isOllamaAvailable()`이 `preferredProvider === 'ollama'` 외에 `LLM_PROVIDER` 설정값까지 `ollama`이길 요구했습니다. 설정을 `auto`로 두고 클라우드 자격 증명 없이 로컬 프로바이더만 띄운 환경에서는 초기화가 ollama를 채택해도 설정값은 `auto`라 가용성 판정과 실행 경로가 어긋났습니다. `preferredProvider`는 연결 점검에 성공했을 때만 `ollama`가 되므로 설정값 조건을 제거했습니다.
- **Hybrid vector under-fill** (#789): hybrid vector fetch uses `threshold: 0` and keeps `HYBRID_VECTOR_THRESHOLD` 0.38 as the funnel diagnostic. When thresholded hits are fewer than `query.limit`, remaining raw prefetch (similarity desc, unique ids) fills the ranking pool before min-max. Prefetch multiplier stays 2. Ranking hash includes threshold, prefetch multiplier, and fill flag. Ranking weights.toml is unchanged.
- **memory_injection parity arm** (#790): production scorecard keeps `production_path: hybridSearchEngine.search`. A separate adapter arm calls `buildKnowledgeContextBundle` (same path as `memory_injection`), reconstructs selected IDs from serialized prompt content, and evaluates the proposed gate (Recall@10 ≥ 0.80, zero-hit < 20%, p95 < 1s).
- **Hybrid fusion relevance** (#788): `HybridResultRanker` keeps combiner `textScore * textWeight + vectorScore * vectorWeight` as the relevance feature instead of overwriting with `vectorScore || textScore`. Consolidation path and quality-report helpers use the same contract. Ranking weights.toml is unchanged.
- **FTS5 BM25 rank contract** (#787): text search SQL orders by `fts_rank ASC` (SQLite bm25 is lower-is-better, including negatives). `applyRanking` maps signed rank with `1/(1+exp(rank))` and treats `0` as the empty-query sentinel instead of requiring `ftsRank > 0`. Production scorecard reports `sql_candidate_recall` (`raw_text`) separately from `engine_topn_recall` (`text_topN`). Ranking weights and FTS AND/OR combinator are unchanged pending LoCoMo ablation.
- **Nightly MigrationRunner truthfulness** (#751): `vitest.config.ts` gates `**/migration-runner.integration.spec.ts` CI exclude on `VITEST_INCLUDE_MIGRATION_RUNNER=1` (default PR CI still excludes). Nightly sets the flag and fails the step when collected MigrationRunner tests == 0.
- **Recall nested `filters` wire + channel isolation** (#754): HTTP/client가 보내는 nested `filters`(tags/type 등)를 공유 `executeTool`에서 1회 top-level로 flatten한다(MCP top-level 필드 우선). 텍스트 검색 SQL·recall post-filter가 tags ⊇(AND)를 적용해 `crossChannelRecall=off` 채널 격리를 복원하고, assistant `channel-isolation` e2e unskip 및 `test:ci`에 `test/` 포함.
- **Ops scripts monorepo import paths** (#750): root-registered ops CLIs no longer import removed root `src/`; they use `@memento/core` public/workspace exports (plus minimal package exports for embedding/path/stopwords helpers and a thin `shared/ops/search-quality-cli-helpers` re-export). Unused legacy/archive scripts that still pointed at root `src/` were deleted. CI `test:ci:scripts` now includes parameterized CLI spawn smoke (not SQL-clone integration).
- **Production dependency audit + CI gate** (#756): wanted-only lockfile bumps (`@hono/node-server` 1.19.17, `hono` 4.13.2, `fast-uri` 3.1.5, `ip-address` 10.5.0, `protobufjs` 7.6.5) clear fixable production High/Moderate. `security-check.yml` runs `npm audit --omit=dev` via `scripts/check-production-audit-fixable.mjs` (fails on remaining fixable High/Moderate). Upstream-blocked ML transitives (`adm-zip`/`onnxruntime-node`/`sharp` via `@huggingface/transformers`) documented in `docs/reference/{ko,en}/security.md` — no force-override.
- **Architecture dependency boundaries + runtime cycles** (#749): `dependency-boundaries.spec.ts`가 domain→infra·shared→infra|server 신규 위반을 allowlist(+rationale)·frozen size로 CI 차단한다. `fts5-migration-status`는 `query-helpers`를 직접 사용해 database↔schema-init↔fts5 사이클을 끊고, batch-scheduler singleton 구현을 orchestrator로 옮겨 singleton↔orchestrator 재export 사이클을 제거한다.
- **npm pack server runtime closure** (#752): 루트 `dependencies`에 `express-rate-limit`·`helmet`·`umap-js`를 맞추고, registry에 없는 `@memento/agent-integration`을 `prepack`/`bundledDependencies`로 tarball에 번들한다. `verify-npm-pack-bundle`이 core뿐 아니라 agent-integration 경로·루트 deps 선언·empty-temp install resolve smoke까지 검증한다.
- **memory_embedding rebuild atomicity** (#755): `migrate.ts`의 create/copy/drop/rename(및 직전 vec trigger drop)을 better-sqlite3 `db.transaction` 한 단위로 묶어, copy 후 rename 전 실패 시 live 테이블·행이 롤백으로 보존된다. 성공·멱등 경로 회귀 유지.
- **Embedding metadata repair off hot path** (#753): `ensureMetadataDefaults` 테이블 전역 UPDATE를 create/search/stats에서 제거하고, 동일 SQL을 `migrate.ts`·`initializeDatabase` bootstrap에서 1회 실행한다. 신규 행 기본값과 `created_by='legacy'` 레거시 보정 의미를 유지한다.
- **Triple → semantic memory 임베딩 누락** (#710): `SemanticMemoryCrud.createSemanticMemory`가 관계 추출(triple)로 생성한 semantic memory에 대해 임베딩 생성을 fire-and-forget으로 트리거합니다(느린 provider가 memory 생성 응답을 지연시키지 않음, 실패해도 memory 생성은 차단하지 않음). `EmbeddingReindexService.backfillSemanticRelationEndpoints`는 `memory_relation`의 endpoint이면서 #713 vec 계약(`embedding_provider` + 예상 `dimensions` + `projection_type='native'`)을 만족하는 임베딩이 없는 기존 semantic memory를 제한된 개수(기본 200, 최대 1000)만큼 채워 넣습니다(non-native projection·차원 불일치 행만 있는 경우도 backfill 대상으로 판단). 신규 `POST /api/v1/maintenance/backfill-relation-endpoints` (+ `GET .../:jobId`)로 운영 중 backfill을 실행할 수 있습니다. n-hop 검색은 임베딩이 없는 relation 이웃도 1-hop 결과에 유지합니다(#708 회귀 테스트 추가).
- **sqlite-vec distance metric 계약** (#713): 모든 vec0 가상 테이블(`memory_item_vec` 및 제공자별 `tfidf`/`minilm`/`openai`/`gemini`/`mock`)을 `distance_metric=cosine`으로 생성합니다. 기존에는 metric 미명시로 sqlite-vec 기본값인 L2가 적용되어, `1 - distance`를 cosine similarity로 해석하는 결과 mapper와 slot threshold(0.8/0.6/0.4)가 어긋나 vector-only 검색이 threshold를 거의 통과하지 못했습니다. similarity는 `clamp(1 - cosine_distance, 0, 1)`로 고정되고(반대 방향 벡터는 0으로 clamp), 정의는 `vec-schema.ts`(`VEC_TABLES`) 단일 원본에서 `schema.sql`·`init-legacy-schema`·`migrate`·마이그레이션 041이 공유합니다. 기존 DB는 마이그레이션 **041 (`vec-cosine-metric`)** 이 vec 테이블을 재생성·재적재하고 insert/update/delete 트리거를 다시 만듭니다(mock 테이블 누락도 함께 수정).
- **performance alert log noise** (#697): warning severity `Performance alert generated`는 INFO로 내리고, DB 크기 기본 임계값을 500MB(`PERF_DATABASE_WARN_MB`)로 상향하며, resolve 후 `PERF_ALERT_REARM_MS`(기본 30분) 재무장 쿨다운으로 CPU/DB 플랩 WARN이 log-issue-monitor에 반복 승격되지 않게 합니다.
- **remember source agent id** (#696): `agent:<id>` URI와 bare 워크플로/에이전트 식별자(`paperclip-ceo-heartbeat` 등)를 허용·`agent:`로 정규화해 운영 WARN 노이즈를 제거합니다. personal-knowledge-agent 저장 `source`도 `agent:personal-knowledge-agent`로 통일합니다.

### Added

- **Production recall funnel + ranking hash** (#786): production adapter records per-query stages `raw_text → text_topN → raw_vector → thresholded_vector → union → final_top10` with gold any/all/fraction. Scorecard `ranking_version` is `ranking-sha256:…`; reproduction includes clean git SHA, weights-path override, eligible/excluded query ID hashes. Ranking algorithm unchanged in this slice.
- **remember write-path near-duplicate** (#730): `remember`가 INSERT 직전에 동일 `type`·`owner_id`·`project_id` 스코프에서 벡터 유사 후보를 검색합니다. 기본 `MEMENTO_REMEMBER_DEDUP_MODE=warn`은 저장 성공 + `similarity_warning`(candidates·`suggestion: incremental`). `strict`는 거절, `update_mode=incremental`은 working/episodic/semantic top 후보 UPDATE. env: `MEMENTO_REMEMBER_DEDUP_THRESHOLD`(기본 0.85).
- **Production agent-memory recall benchmark** (#737): synthetic reciprocal-rank fusion baseline is now `rrf_sim`; opt-in `npm run quality:agent-memory:production` seeds a disposable fixture-ID-preserving database and runs production `HybridSearchEngine.search` (same engine as RecallTool / memory_injection) with TF-IDF embeddings. The `memento_prod` scorecard records dataset revision/hash, ranking profile, provider, retrieval metrics, p95 budget, abstentions, failed queries, and a non-degradation gate against `fts_only`.
- **MCP transport parity spec** (#681): `runtime-transport-parity.spec.ts` — stdio·HTTP·WebSocket `tools/call`이 동일한 `ToolResult`를 반환하는지 검증.
- **Tech-debt epic #680** spec kit: `specs/049-tech-debt-680-epic/` — 2026-07-10 감사 추적 (#681–#692).
- **CI search-quality PR gate** (#665): `.github/workflows/ci.yml`에 `test-search-quality` job 추가 — `npm run test:vector-search-quality:ci`로 랭킹·벡터 검색 benchmark 회귀를 PR에서 차단.
- **Weekly nightly tests** (#665): `.github/workflows/nightly-tests.yml` — `SKIP_DB_TESTS=false`, `SKIP_INTEGRATION_TESTS=false`로 search-quality 전체 env 및 integration subset( migration-runner, lock-scenarios, memory-embedding ) 실행.
- **CI exclude inventory** (#665): `docs/reference/ko/ci-test-timeout-guide.md`에 Vitest CI exclude 패턴 표·만료 정책(2026-09-01) 문서화.
- **HTTP scoped API tokens (#662)**: `MEMENTO_API_TOKENS` JSON env로 `tools:invoke` / `admin:destructive` 스코프 분리. Legacy `ADMIN_API_KEY`는 synthetic `legacy-admin` 토큰으로 양쪽 스코프 유지(deprecation warn once). tools-only 토큰은 `/api/v1/quality/*` 403.
- **HTTP programmatic 감사 JSONL + rate limit** (#663): `/tools`, `/api/v1/agent`, `/api/v1/quality`, 보호 MCP HTTP 경로에 `{ ts, key_id, route, tool, owner_id, agent_id, latency_ms, status }` audit 미들웨어(best-effort). `/tools`·`/admin` bucket별 rate limit(429 + `Retry-After`). #660 hash-chained audit과 필드 계약 정렬.
- **HTTP owner scope enforcement** (#664): `MEMENTO_OWNER_SCOPE_MODE`(`strict`|`warn`|`off`, HTTP 기본 `strict`), `MEMENTO_HTTP_DEFAULT_AGENT_ID`, `X-Memento-Agent-Id` 헤더 → `ToolContext.agentId`. strict 모드에서 `/tools/recall`·`/tools/memory_injection`은 `owner_id` 미지정 시 에이전트 ID로 자동 필터; 식별자 없으면 400. 레거시 NULL 데이터는 `warn`/`off`로 opt-out.

### Changed

- **MCP HTTP/WebSocket tools/call** (#681): `message-processor`·`http-server-websocket`이 stdio와 동일하게 raw `ToolResult` 반환 (content JSON 래핑 제거).
- **Mechanical module splits** (#680): `llm-client-initializer`, `search-ranking`, `batch-scheduler`, `reflexion-worker`, `memento-client`, `embedding-migration-service`, `database` utils, `relation-quality-validator`, `vector-search-quality-metrics` — orchestrator ≤500줄, 동작 변경 없음.
- **Minor dependency updates** (#690): vitest, @typescript-eslint, @google/genai 등 wanted 범위 패치.
- **VectorSearchRepository.hybridSearch**: `project_id` / `owner_id` 스코프가 vector·text CTE SQL에 반영되어 `search()`와 동작이 정렬됩니다. 텍스트 하이브리드 UNION의 `last_accessed`·ORDER BY SQL 오류도 함께 수정합니다 (#387).
- **하이브리드·텍스트·벡터 검색**: `MemorySearchFilters`의 `project_id` / `owner_id`가 FTS·VEC SQL 및 임베딩 유사도(`searchBySimilarity`) fallback까지 전달되어, DB 단계에서 스코프가 적용됩니다. `memory_injection` / `buildKnowledgeContextBundle` 경로에서 좁은 스코프일 때 후보 부족을 줄이기 위해 검색 `limit` 배수를 키웁니다 (#232, PR #386 후속).

### Removed

- **[BREAKING] MCP `type` 파라미터 기본 필수화** (#636): `MEMENTO_TYPE_PARAM_MODE` 기본값이 `warn`에서 `error`로 변경됩니다. `remember` / `recall` 호출 시 `type`을 생략하면 거절됩니다. 레거시 클라이언트는 `MEMENTO_TYPE_PARAM_MODE=warn` 또는 `deprecate`로 완화할 수 있습니다.
- **[BREAKING] Deprecated repository compatibility shims 제거** (#617): 다음 re-export shim 파일들이 삭제됩니다. 직접 구현체 또는 인터페이스로 교체하세요.
  - `feedback-repository.ts` → `FeedbackRepositorySQLite` (impl), `sigmoidNormalizedNet`은 `feedback-repository.interface.ts`로 이동
  - `core-memory-repository.ts` → `core-memory-repository.interface.ts` 직접 import
  - `kg-triple-repository.ts` → `KgTripleRepositorySqlite` (impl)
  - `knowledge-vault-repository.ts` → `KnowledgeVaultRepositorySqlite` (impl)
  - `process-attribute-repository.ts` → `ProcessAttributeRepositorySqlite` (impl)
  - `embedding-service.ts` → `MemoryEmbeddingService` / `EmbeddingManager`
- **`AnchorManager.getSearchService()` / `.getCacheService()` 제거** (#617): 하위 호환 wrapper 메서드 삭제. `searchService` / `cacheService` 직접 주입 패턴 사용.
- **`PerformanceMonitor.getMemoryMetrics().heapUsagePercent` 필드 제거** (#617): `heapShareOfBudgetPercent` 사용.
- **`ReflexionWorker.removeOldestQueuedEvent()` 제거** (#617): `AsyncTaskQueue`가 자동 처리하는 no-op private 메서드.

### Documentation
- 루트 SSOT 문서(README, README.en, CONTRIBUTING)의 디렉터리·테스트 경로 설명을 현재 npm workspaces 트리에 맞게 정리 (#359).
- [1.0.0] 절의 디렉터리 트리는 당시 레이아웃의 역사적 스냅샷임을 명시 (#359).
- 패키지·앱 README 9경로: 루트 스크립트·실제 디렉터리 트리·내부 링크 정합성 정리 (#361).
- `docs/guides/ko/legacy-scripts-migration-guide.md`: 루트 `src/` 가정이 들어갈 수 있는 TS import 예시를 제거하고 CLI 실행 예시로 정리 (#362).
- `docs/guides/ko` 소형 가이드 8개(`type-param-rollout`, `recall-performance-tuning`, `multi-agent-usage`, `environment-variable-governance`, `obsidian-cli-setup`, `mcp-server-instructions`, `memento-cli-for-ai`, `sdd-workflow`): #362 기준 경로·명령 점검 — 추가 수정 없음.
- `docs/guides/ko/developer-guide.md`: 루트 `src/`·구 테스트 경로를 workspaces 기준 경로로 정리하고, ESLint 예시·실행 명령을 현재 스크립트에 맞게 조정 (#362).
- `docs/guides/ko/user-manual.md`: Docker Compose 파일명·기본 HTTP 포트(9001) 안내를 현재 스택에 맞게 조정 (#362).
- `docs/guides/ko/embedding-service-guide.md`: 예제 import 경로를 `packages/memento-core/src/domains/embedding/services/`로 정리하고, 상대 경로 가정(cwd)을 명시 (#362).

### Fixed
- **Triple extraction Gemini 503 재시도 WARN 노이즈 완화** (#551): 일시 용량 오류(503/502/429/high demand) 재시도 로그를 DEBUG로 내리고, primary provider 실패 시 대체 provider 폴백을 시도합니다.
- **[회귀] stdio MCP 서버가 1.25.0에서 시작되지 않는 버그 수정** (#302): `capabilities`에 `logging: {}` 누락 + `SetLevelRequestSchema` 핸들러 수동 등록이 결합되어 MCP SDK가 예외를 throw, `process.exit(1)`으로 프로세스가 종료되던 문제. `logging: {}` capability 추가 및 중복 핸들러 제거로 수정 (SDK가 자동 처리).
- 잘못 추적되던 `.claude/worktrees/*` gitlink 제거: `actions/checkout` Post 단계의 `git submodule foreach`가 exit 128로 경고 나던 문제 방지
- CLI(`memento remember` 등)가 HTTP/stdio MCP 서버와 동시에 실행될 때 발생하던 WAL 체크포인트 충돌 및 DB 손상 버그 수정 (#160)

### Changed
- **`PerformanceMonitor.getMemoryMetrics()`** (#287, PR #307): `usagePercent` / `rssUsagePercent`는 **RSS ÷ 메모리 예산 바이트**(`process.constrainedMemory()`가 유한·양수면 우선, 아니면 `os.totalmem()`)로 계산되어 `collectMetrics` 메모리 알림과 동일 축이다. 예전 구현의 1GB 고정 분모·heap 기반 `usagePercent` 의미와 **호환되지 않는다**. `heapShareOfBudgetPercent`(및 하위 호환 필드 `heapUsagePercent`)는 **heapUsed ÷ 동일 예산**이며, **V8 `heapUsed / heapTotal` 힙 충전률과는 다르다**. 컨테이너·cgroup 환경에서 호스트 RAM만 분모로 쓸 때 RSS 압력이 과소평가되던 문제를 완화한다.

- GitHub Actions 런타임 및 저장소 `engines` 기준 Node.js **24**로 상향; 워크플로 액션 메이저 갱신 (#211)
- `sqlite-vec` **0.1.9**로 상향: `sqlite-vec-linux-arm64@0.1.6` 미배포로 인한 `npm ci` 실패(Node 24/npm 엄격 검증) 방지 (#212)
- CLI가 DB를 직접 열지 않고 실행 중인 서버의 HTTP 관리 포트로 요청을 위임하도록 아키텍처 전환
- stdio MCP 서버가 CLI 통신을 위한 localhost-only HTTP 관리 포트를 함께 기동
- `--db-path`, `--env-file` CLI 옵션 deprecated (무시됨)

### Added

- Docker instability 분석을 위한 runtime diagnostics 모드 추가: `/app/logs/diagnostics` JSONL 로그, background service feature flags, Docker 외부 관측 스크립트(`scripts/collect-docker-diagnostics.sh`) 및 운영 가이드 포함

### 보안 강화 (011-docker-security-hardening) — Breaking Changes

#### BREAKING: Admin API 인증 동작 변경 (US2)

- **이전 동작**: `ADMIN_API_KEY` 미설정 시 모든 Admin/API/Quality 엔드포인트에 인증 없이 접근 가능 (fail-open)
- **새로운 동작**: `ADMIN_API_KEY` 미설정(absent/empty/whitespace) 시 모든 Admin/API/Quality 엔드포인트에서 401 반환 (fail-closed)
- **마이그레이션**: Admin 엔드포인트(`/admin/*`, `/api/*`, `/api/v1/quality/*`)를 사용하는 경우 반드시 `ADMIN_API_KEY` 환경변수를 설정해야 합니다.
  ```bash
  export ADMIN_API_KEY="your-secure-key"
  ```

#### BREAKING: Docker Compose 기본 설정에서 보안 우회 플래그 제거 (US1)

- **이전 동작**: `docker-compose.base.yml`에 `MEMENTO_ALLOW_INSECURE_HTTP_ADMIN: "true"` 하드코딩 — 모든 Docker 환경에서 서버 시작 보안 체크 자동 우회
- **새로운 동작**: 해당 하드코딩 제거. 기본값은 `false` (코드 레벨).
- **`MEMENTO_ALLOW_INSECURE_HTTP_ADMIN`의 정확한 역할**:
  - 이 플래그는 **서버 시작(binding) 보안 체크**만 제어합니다.
  - `ADMIN_API_KEY`가 미설정된 상태에서 non-loopback 주소로 바인딩하려 할 때 서버 시작이 거부되는 것을 우회합니다.
  - **Admin/API/Quality 엔드포인트(`/admin/*`, `/api/*`)의 인증 동작에는 영향을 주지 않습니다.**
  - Admin 엔드포인트는 이 플래그 설정 여부와 무관하게 항상 `ADMIN_API_KEY`가 필요합니다 (fail-closed).
  - `MEMENTO_ALLOW_INSECURE_HTTP_ADMIN=true`이더라도 `ADMIN_API_KEY`를 설정하지 않으면 Admin 엔드포인트는 항상 401을 반환합니다.
- **마이그레이션**: 내부 네트워크 환경에서 `ADMIN_API_KEY` 없이 non-loopback 바인딩이 필요한 경우에만 uncommitted `docker-compose.override.yml`에서 설정:
  ```yaml
  services:
    memento-mcp-server:
      environment:
        MEMENTO_ALLOW_INSECURE_HTTP_ADMIN: "true"
  ```
  단, 이 경우에도 Admin API에 접근하려면 `ADMIN_API_KEY`를 별도로 설정해야 합니다.

#### Non-root Docker 컨테이너 실행 (US3)

- `docker-compose.yml`에서 `user: root` 오버라이드 제거
- 컨테이너는 이제 Dockerfile에 정의된 `memento` 사용자(UID 1001)로 실행됩니다.

#### HTTP 보안 헤더 추가 (US4)

- `helmet.js v8+`를 Express 미들웨어로 등록하여 모든 HTTP 응답에 OWASP 최소 보안 헤더 추가:
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Content-Security-Policy` (D3.js CDN `d3js.org` 허용)
  - `Referrer-Policy: no-referrer`
- `static/graph.html` 인라인 스크립트 → `static/js/graph.js` 외부 파일로 추출 (CSP `'unsafe-inline'` 불필요)

#### Known Limitation: 브라우저 대시보드 (`/dashboard`, `/graph`)

`ADMIN_API_KEY`를 설정한 경우, 브라우저 대시보드가 호출하는 API(`/admin/graph`, `/api/anchors/map`)가 인증 헤더 없이 fetch하므로 401 응답을 받아 그래프/앵커맵이 표시되지 않습니다.

- **영향 범위**: `ADMIN_API_KEY` 설정 환경에서 대시보드 UI 사용 시
- **회피 방법**: `ADMIN_API_KEY`를 설정하지 않은 로컬 개발 환경에서는 정상 동작
- **추적**: 브라우저 대시보드용 세션 인증 지원은 별도 이슈로 추적 예정

### 추가됨
- **Issue #57 Phase 2 — Procedural Memory 확장**
  - **독립 remember_procedure 툴**: 절차적 기억 전용 MCP 툴 `remember_procedure` 추가 (검증·로깅·스키마 분리).
  - **성능 최적화 (B)**: procedural 버전 조회용 복합 인덱스(014), recall 선택 프로파일링(`MEMENTO_RECALL_PROFILE=1`), `docs/recall-performance-tuning.md` 가이드.
  - **다중 에이전트 (D)**: `memory_item.owner_id` 및 마이그레이션(015), `ToolContext.agentId`, remember/remember_procedure·recall에서 `owner_id` 저장·필터 지원, `docs/multi-agent-usage.md` 가이드.
- **앵커 시스템**: 중요한 기억을 앵커로 설정하여 컨텍스트 관리
  - `set_anchor`, `get_anchor`, `search_local`, `clear_anchor`, `restore_anchors` MCP Tools 추가
  - 앵커 주변 국소 검색 기능
  - 관계 그래프 기반 이웃 기억 탐색
- **메타 메모리 통계 시스템**: 기억 검색 성공률, 신뢰도 점수 등 통계 수집 및 조회
  - `get_meta_memory_stats` MCP Tool 추가
  - 검색 성공/실패 추적
  - 평균 신뢰도 점수 계산
- **관계 그래프 엔진**: 기억 간 의미적 관계 자동 추출 및 관리
  - Triple 추출 시스템
  - 관계 타입 분류 (SIMILAR_TO, RELATED_TO, VERSION_OF 등)
  - 관계 시각화 및 탐색
- **통합 점수 시스템 (Consolidation Score)**: 검색 품질 향상을 위한 통합 점수 계산
- **Reflexion 시스템**: 작업 성공/실패에 따른 절차적 기억 자동 업데이트
- **AriGraph Pipeline**: Episodic Memory를 Semantic Memory로 자동 변환
  - `convert_episodic_to_semantic` MCP Tool 추가
- **임베딩 마이그레이션**: 임베딩 제공자 간 마이그레이션 지원
  - `migrate_embeddings` MCP Tool 추가
- **배치 스케줄러**: 주기적 배치 작업 실행 (망각 정책, 통합 점수 계산 등)
- **품질 보증 시스템**: 검색 품질 측정 및 개선
- **벡터 검색 엔진**: sqlite-vec 기반 고성능 벡터 검색
- **다중 임베딩 제공자**: TF-IDF, MiniLM, OpenAI, Gemini 지원
- **성능 모니터링 및 알림**: 실시간 성능 모니터링 및 임계값 기반 알림
- **에러 로깅 시스템**: 구조화된 에러 로깅 및 통계 수집
- **문서화**: Cursor MCP 설정 가이드, 플랫폼별 실행 가이드, Node.js 버전 호환성 가이드 등

### 수정됨
- **프로젝트 구조**: domains/, infrastructure/ 디렉토리 구조로 리팩토링
- **sqlite-vss → sqlite-vec**: 더 안정적인 벡터 검색 라이브러리로 마이그레이션
- **MCP Tools**: 5개 → 15개로 확장
- **http-server.ts**: shebang 추가로 bin 파일로 직접 실행 가능
- **package.json**: bin 필드 최적화 및 의존성 정리
- **INSTALL.md**: 플랫폼별 실행 방법 및 npm exec 문제 해결 가이드 추가
- **README.md**: Cursor MCP 설정 링크 추가

### 개선됨
- **npm 패키지 구조**: npx 실행 시 안정성 향상
  - file: 프로토콜 의존성 제거로 npm 레지스트리 호환성 확보
  - `Cannot destructure property 'package' of 'node.target' as it is null` 오류 해결
- **문서화**: 플랫폼별 차이점 및 문제 해결 가이드 상세화
- **주석 스타일 개선**: WHAT 스타일에서 WHY 스타일로 전환
  - 모든 주석을 "무엇을 하는지" 설명에서 "왜 이런 코드가 필요한지" 설명으로 변경
  - "...하기 위해"로 끝나는 불완전한 문장을 완전한 문장으로 수정
  - 코드 작성 이유와 배경을 명확히 설명하여 가독성과 유지보수성 향상
  - 주요 변경 파일: `algorithms/`, `services/` 디렉토리의 모든 구현 파일

### 계획된 기능
- M2 팀 협업 기능 구현
- PostgreSQL 마이그레이션
- JWT 인증 시스템
- 고가용성 구성

## [1.5.0] - 2025-10-03

### 추가됨
- **sqlite-vec 마이그레이션**: sqlite-vss에서 더 안정적인 sqlite-vec로 전환
- **MCP 도구 스키마 수정**: memory_injection 도구의 inputSchema를 JSON Schema 형식으로 수정

### 수정됨
- **Feedback Event 스키마**: pin, unpin, forget 도구의 이벤트 로깅을 데이터베이스 제약조건에 맞게 수정
- **벡터 검색 엔진**: sqlite-vec 기반으로 완전히 재구현
- **Docker 설정**: Debian 기반 이미지로 변경하여 sqlite-vec 호환성 확보

### 해결됨
- **MCP 도구 인식 문제**: 모든 6개 도구가 정상적으로 인식되도록 수정
- **데이터베이스 제약조건 오류**: feedback_event 테이블의 CHECK 제약조건 위반 문제 해결
- **Docker 빌드 오류**: sqlite-vec 설치 및 설정 문제 해결

### 변경사항
- 프로젝트 초기 설정
- Cursor Rules 생성
- 문서 구조 정립

## [1.0.0] - 2025-09-22

### 추가됨

#### 🎯 프로젝트 초기 설정
- TypeScript 5.3.0 기반 MCP 서버 프로젝트 구조 생성
- ESLint, Vitest 테스트 프레임워크 설정
- tsx 개발 도구 통합
- .gitignore 파일 생성 (Node.js, TypeScript, MCP 특화)

#### 📚 문서화 시스템
- **설계 문서**:
  - `docs/Memento-Goals.md` - 프로젝트 목표 및 시스템 설계
  - `docs/Memento-M1-DetailSpecs.md` - M1 단계 상세 설계
  - `docs/Memento-Milestones.md` - 마일스톤별 아키텍처 계획
  - `docs/Search-Ranking-Memory-Decay-Formulas.md` - 검색 랭킹 및 망각 수식
- **프로젝트 문서**:
  - `README.md` - 프로젝트 개요, 설치, 사용법, 아키텍처
  - `CHANGELOG.md` - 버전별 변경사항 추적

#### 🛠️ 개발 도구 및 규칙
- **Cursor Rules** (`.cursor/rules/`):
  - `memento-project-overview.mdc` - 프로젝트 전체 개요 (항상 적용)
  - `mcp-server-development.mdc` - MCP 서버 개발 규칙 (TypeScript/JavaScript)
  - `mcp-client-development.mdc` - MCP 클라이언트 개발 규칙 (TypeScript/JavaScript)
  - `database-schema.mdc` - 데이터베이스 스키마 규칙 (SQL/TypeScript)
  - `memory-algorithms.mdc` - 기억 알고리즘 구현 규칙 (TypeScript/JavaScript)
  - `project-structure.mdc` - 프로젝트 구조 및 파일 명명 규칙 (실제 구조 반영)
  - `testing.mdc` - 테스트 작성 및 실행 규칙
  - `deployment.mdc` - 배포 및 컨테이너화 규칙
  - `implementation.mdc` - 실제 구현된 기능들에 대한 개발 규칙 (신규)

#### 🏗️ 아키텍처 설계
- **4단계 마일스톤 계획**:
  - M1: 개인용 SQLite 기반 MVP (로컬 실행)
  - M2: 팀 협업 SQLite 서버 모드 (Docker, API Key)
  - M3: 조직용 PostgreSQL + pgvector (Docker Compose, JWT)
  - M4: 엔터프라이즈 고가용성 구성 (Kubernetes, RBAC + SSO)
- **시스템 아키텍처**: Mermaid 다이어그램으로 시각화
- **프로젝트 구조**: 모듈화된 디렉토리 구조 설계

#### 🧠 기억 모델 설계
- **작업기억 (Working Memory)**: 현재 처리 중인 정보 (48시간 유지)
- **일화기억 (Episodic Memory)**: 사건과 경험 (90일 유지)
- **의미기억 (Semantic Memory)**: 지식과 사실 (무기한)
- **절차기억 (Procedural Memory)**: 방법과 절차 (무기한)

#### 🔍 검색 시스템 설계
- **2단계 검색 파이프라인**: ANN (벡터) + BM25 (키워드)
- **복합 랭킹 공식**: S = α×relevance + β×recency + γ×importance + δ×usage - ε×duplication_penalty
- **MMR 다양성 제어**: 중복 제거 및 결과 다양성 확보
- **배치 정규화**: 성능 최적화 및 안정성 향상

#### 🧹 망각 시스템 설계
- **TTL 기반 자동 삭제 정책**: 타입별 수명 관리
- **간격 반복 알고리즘**: 중요도 기반 주기적 리뷰
- **수면 통합 배치 작업**: 야간 기억 통합 및 요약

#### 🚀 실제 구현 완료 (M1 MVP)
- **MCP 서버 구현** (`src/server/index.ts` - 521줄):
  - remember, recall, forget, pin/unpin Tools 구현
  - Zod 스키마 기반 입력 검증
  - 구조화된 에러 처리 및 로깅
  - MCP 프로토콜 완전 준수
  - 하이브리드 검색 엔진 통합
  - 임베딩 서비스 통합

- **검색 엔진 구현** (`src/algorithms/search-engine.ts` - 233줄):
  - FTS5 텍스트 검색 통합
  - 검색 랭킹 알고리즘 구현
  - 고급 필터링 시스템 (타입, 태그, 시간, 고정 여부)
  - 성능 최적화된 인덱스 활용

- **하이브리드 검색 엔진 구현** (`src/algorithms/hybrid-search-engine.ts` - 200줄):
  - FTS5 텍스트 검색 + 벡터 검색 결합
  - 가중치 조정 시스템 (벡터 60%, 텍스트 40%)
  - 하이브리드 점수 계산 및 정규화
  - 고성능 하이브리드 검색 결과 제공

- **데이터베이스 시스템** (`src/database/init.ts` - 102줄):
  - SQLite 데이터베이스 초기화
  - 완전한 스키마 생성 (7개 테이블)
  - FTS5 및 일반 인덱스 설정
  - 안전한 연결 관리

- **임베딩 서비스 구현** (`src/services/embedding-service.ts` - 196줄):
  - OpenAI API 연동 (`text-embedding-3-small` 모델)
  - 텍스트를 1536차원 벡터로 변환
  - 코사인 유사도 기반 검색
  - 에러 처리 및 재시도 로직

- **메모리 임베딩 서비스 구현** (`src/services/memory-embedding-service.ts` - 237줄):
  - 메모리와 임베딩을 데이터베이스에 저장
  - 벡터 검색 및 유사도 계산
  - 자동 임베딩 생성 및 관리
  - 성능 최적화된 벡터 검색

- **클라이언트 구현** (`src/client/index.ts`):
  - MCP 프로토콜 기반 클라이언트
  - 서버 연결 및 통신 관리
  - 에러 처리 및 재시도 로직

- **망각 시스템 구현** (`src/algorithms/forgetting-algorithm.ts` - 244줄):
  - Memento-Goals.md의 망각 공식 구현
  - 최근성, 사용성, 중복 비율, 중요도, 고정 여부를 종합한 망각 점수 계산
  - U1-U5 계수를 사용한 가중치 시스템
  - 망각 결정 로직 및 특징 계산 함수

- **간격 반복 알고리즘 구현** (`src/algorithms/spaced-repetition.ts` - 239줄):
  - 중요도와 사용성 기반 리뷰 간격 계산
  - 시간 경과에 따른 리콜 확률 계산
  - 피드백에 따른 동적 간격 조정
  - 간격 반복 스케줄링 시스템

- **망각 정책 서비스 구현** (`src/services/forgetting-policy-service.ts` - 335줄):
  - 망각 알고리즘과 간격 반복 통합
  - TTL 기반 정책 (타입별 수명 관리)
  - 소프트/하드 삭제 단계적 정책
  - 배치 처리 및 메모리 관리

- **HTTP 서버 구현** (`src/server/http-server.ts` - 551줄):
  - WebSocket 지원 실시간 통신 서버
  - CORS 설정으로 웹 클라이언트 지원
  - MCP 프로토콜과의 콘솔 로그 충돌 해결
  - Express + WebSocket 통합 아키텍처

- **성능 최적화 시스템** (1,608줄):
  - **비동기 처리 최적화** (`src/services/async-optimizer.ts` - 447줄):
    - 워커 풀 관리 및 병렬 처리
    - 우선순위 기반 작업 큐 시스템
    - 배치 처리 및 재시도 로직
    - 성능 최적화된 비동기 작업 처리
  - **캐시 서비스** (`src/services/cache-service.ts` - 352줄):
    - LRU 캐시 구현 및 TTL 관리
    - 검색 결과 캐싱 및 임베딩 캐싱
    - 캐시 통계 수집 및 성능 모니터링
    - 메모리 효율적인 캐시 관리
  - **데이터베이스 최적화** (`src/services/database-optimizer.ts` - 442줄):
    - 자동 인덱스 추천 및 생성
    - 쿼리 성능 분석 및 최적화
    - 데이터베이스 성능 튜닝
    - 통계 수집 및 성능 개선
  - **성능 모니터링** (`src/services/performance-monitor.ts` - 367줄):
    - 실시간 메트릭 수집 및 분석
    - 임계값 모니터링 및 알림
    - 성능 리포트 생성 및 트렌드 분석
    - 시스템 상태 모니터링
  - **경량 하이브리드 임베딩** (`src/services/lightweight-embedding-service.ts` - 321줄):
    - **Fallback 솔루션**: OpenAI API가 없을 때 사용하는 대체 임베딩 서비스
    - **TF-IDF + 키워드 매칭**: 512차원 고정 벡터 생성
    - **다국어 지원**: 한국어/영어 불용어 제거 및 텍스트 전처리
    - **코사인 유사도**: 벡터 간 유사도 계산을 통한 검색
    - **투명한 인터페이스**: 기존 임베딩 API와 동일한 인터페이스 제공

- **테스트 시스템** (1,290줄):
  - `test-client.ts` (152줄): 클라이언트 통합 테스트
  - `test-search.ts` (152줄): 검색 기능 상세 테스트
  - `test-embedding.ts` (154줄): 임베딩 기능 테스트
  - `test-forgetting.ts` (163줄): 망각 정책 테스트
  - `test-performance-monitoring.ts` (172줄): 성능 모니터링 기능 테스트
  - `test/performance-benchmark.ts` (497줄): 종합 성능 벤치마크 테스트
  - Vitest 설정 및 모던 테스트 환경

- **빌드 시스템**:
  - TypeScript 컴파일 및 소스맵 생성
  - 에셋 복사 자동화 (schema.sql)
  - 개발/프로덕션 환경 분리

### 기술 스택

#### 핵심 기술
- **언어**: TypeScript 5.3.0
- **런타임**: Node.js 20.10.0+
- **프레임워크**: MCP SDK 0.5.0 (Model Context Protocol)

#### 데이터베이스
- **M1 (구현 완료)**: SQLite 5.1.6 + FTS5 + 완전한 스키마
- **M3+ (계획)**: PostgreSQL + pgvector + tsvector

#### 개발 도구
- **테스트**: Vitest 1.0.0 (구현 완료)
- **린팅**: ESLint 8.54.0, @typescript-eslint
- **빌드**: TypeScript 5.3.0, tsx 4.6.0
- **컨테이너**: Docker, Docker Compose

#### 배포 및 운영
- **M2**: Docker 단일 컨테이너
- **M3**: Docker Compose (서버 + DB)
- **M4**: Kubernetes, Helm Charts

### 프로젝트 구조

> **역사적 스냅샷**: 아래 트리는 **[1.0.0] (2025-09-22)** 시점 단일 패키지 레이아웃이다. **현재** 저장소는 npm workspaces(`packages/memento-core`, `packages/memento-server`, `packages/memento-client`, `apps/*`) 구조이며, 최신 경로는 [AGENTS.md](AGENTS.md)를 따른다.

```
memento/
├── src/                    # 소스 코드
│   ├── algorithms/        # 검색 및 망각 알고리즘
│   │   ├── search-engine.ts        # 검색 엔진 (233줄)
│   │   ├── hybrid-search-engine.ts # 하이브리드 검색 엔진 (200줄)
│   │   ├── search-ranking.ts       # 검색 랭킹 알고리즘
│   │   ├── forgetting-algorithm.ts # 망각 알고리즘 (244줄)
│   │   └── spaced-repetition.ts    # 간격 반복 알고리즘 (239줄)
│   ├── client/            # MCP 클라이언트
│   │   └── index.ts       # 클라이언트 구현
│   ├── config/            # 설정 관리
│   │   └── index.ts       # 설정 파일
│   ├── database/          # 데이터베이스 관련
│   │   ├── init.ts        # 데이터베이스 초기화 (102줄)
│   │   └── schema.sql     # SQLite 스키마
│   ├── server/            # MCP 서버
│   │   ├── index.ts       # 서버 메인 (521줄)
│   │   └── http-server.ts # HTTP/WebSocket 서버 (551줄)
│   ├── types/             # TypeScript 타입 정의
│   │   └── index.ts       # 공통 타입 정의
│   ├── utils/             # 유틸리티 함수
│   │   └── database.ts    # 데이터베이스 유틸리티
│   ├── services/          # 서비스 레이어 (신규)
│   │   ├── embedding-service.ts        # OpenAI 임베딩 서비스 (196줄)
│   │   ├── memory-embedding-service.ts # 메모리 임베딩 서비스 (237줄)
│   │   ├── forgetting-policy-service.ts # 망각 정책 서비스 (335줄)
│   │   ├── async-optimizer.ts          # 비동기 처리 최적화 (447줄)
│   │   ├── cache-service.ts            # 캐시 서비스 (352줄)
│   │   ├── database-optimizer.ts       # 데이터베이스 최적화 (442줄)
│   │   └── performance-monitor.ts      # 성능 모니터링 (367줄)
│   ├── test/              # 테스트 디렉토리 (신규)
│   │   └── performance-benchmark.ts # 성능 벤치마크 (497줄)
│   ├── test-client.ts     # 클라이언트 테스트 (152줄)
│   ├── test-search.ts     # 검색 테스트 (152줄)
│   ├── test-embedding.ts  # 임베딩 테스트 (154줄)
│   ├── test-forgetting.ts # 망각 정책 테스트 (163줄)
│   └── test-performance-monitoring.ts # 성능 모니터링 테스트 (172줄)
├── dist/                  # 빌드 결과물
├── data/                  # 데이터 파일
│   ├── memory.db         # SQLite 데이터베이스
│   ├── memory.db-shm     # SQLite 공유 메모리
│   └── memory.db-wal     # SQLite WAL 파일
├── docs/                 # 문서
├── .cursor/rules/        # Cursor 개발 규칙 (12개)
├── package.json          # 프로젝트 설정
├── tsconfig.json         # TypeScript 설정
├── vitest.config.ts      # Vitest 설정
└── env.example           # 환경 변수 예시
```

### 문서화

#### 사용자 문서
- README.md - 프로젝트 개요, 설치, 사용법
- 설치 및 설정 가이드 (계획됨)
- 사용자 매뉴얼 (계획됨)
- API 참조 (계획됨)

#### 개발자 문서
- 개발 환경 설정 가이드 (계획됨)
- 아키텍처 문서 (계획됨)
- 기여 가이드 (계획됨)
- 테스트 가이드 (계획됨)

#### 기술 문서
- 프로젝트 목표 및 설계 문서
- 마일스톤별 아키텍처 계획
- 검색 랭킹 및 망각 수식

## [0.2.0] - 계획됨

### 계획된 기능
- 🚀 **M1 MVP 구현**
  - MCP 서버 기본 구조 구현
  - SQLite 데이터베이스 스키마 생성
  - 기본 Tools 구현 (remember, recall, forget, pin)
  - FTS5 + VSS 검색 엔진 구현

- 🔧 **개발 도구**
  - 단위 테스트 작성
  - 통합 테스트 구현
  - 성능 벤치마크 도구
  - 로깅 및 모니터링 설정

## [0.3.0] - 계획됨

### 계획된 기능
- 🧠 **고급 기능**
  - 검색 랭킹 알고리즘 구현
  - 망각 정책 자동화
  - 간격 반복 스케줄러
  - 기억 간 관계 생성 (link)

- 📊 **성능 최적화**
  - 검색 성능 튜닝
  - 메모리 사용량 최적화
  - 배치 작업 최적화

## [1.0.0] - 계획됨

### 계획된 기능
- 🎯 **M1 완성**
  - 모든 핵심 기능 구현 완료
  - 안정성 및 성능 검증
  - 문서화 완료
  - AGENTS.md 저장소 가이드라인 추가
  - 경량 하이브리드 임베딩 서비스 문서화
  - 프로덕션 준비 완료

## [2.0.0] - 계획됨

### 계획된 기능
- 👥 **M2 팀 협업**
  - SQLite 서버 모드 전환
  - API Key 인증 구현
  - Docker 컨테이너 배포
  - 팀 단위 권한 관리

## [3.0.0] - 계획됨

### 계획된 기능
- 🏢 **M3 조직 초입**
  - PostgreSQL + pgvector 마이그레이션
  - JWT 인증 시스템
  - Docker Compose 배포
  - 사용자별 권한 관리

## [4.0.0] - 계획됨

### 계획된 기능
- 🌐 **M4 엔터프라이즈**
  - 고가용성 PostgreSQL 클러스터
  - RBAC + SSO/LDAP 연동
  - Kubernetes 배포
  - 기업 보안 정책 준수

---

## 🔗 링크

- [Unreleased]: https://github.com/your-org/memento/compare/v0.1.0...HEAD
- [0.1.0]: https://github.com/your-org/memento/releases/tag/v0.1.0

## 📋 버전 규칙

이 프로젝트는 [Semantic Versioning](https://semver.org/lang/ko/)을 준수합니다.

- **MAJOR (X.0.0)**: 호환되지 않는 API 변경
- **MINOR (X.Y.0)**: 하위 호환성을 유지하는 기능 추가
- **PATCH (X.Y.Z)**: 하위 호환성을 유지하는 버그 수정

## 📝 기여 가이드

변경사항을 추가할 때는 다음 형식을 따르세요:

### 카테고리

- **추가됨**: 새로운 기능
- **변경됨**: 기존 기능의 변경사항
- **제거됨**: 이번 릴리스에서 제거된 기능
- **수정됨**: 버그 수정
- **보안**: 보안 관련 변경사항
- **문서**: 문서 변경사항

### 형식 예시

```markdown
### 추가됨
- 새로운 MCP Tool: `summarize_thread`
- Docker Compose 개발 환경 설정

### 변경됨
- 검색 랭킹 알고리즘 성능 개선
- API 응답 형식 표준화

### 수정됨
- 메모리 누수 문제 해결
- 검색 결과 중복 제거 로직 수정

### 보안
- JWT 토큰 검증 강화
- SQL 인젝션 방지 로직 추가
```

### 날짜 형식

- **YYYY-MM-DD**: ISO 8601 형식 사용
