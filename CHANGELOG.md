# Changelog

이 파일은 Memento MCP Server 프로젝트의 모든 중요한 변경사항을 기록합니다.

형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.0.0/)를 따르며,
이 프로젝트는 [Semantic Versioning](https://semver.org/lang/ko/)을 준수합니다.

## [Unreleased]

<!-- 다음 릴리스에 나갈 항목만 둡니다. 릴리스 직후 아래 형식으로 버전 절을 만들고 이 절을 비웁니다. -->

### Added

- **검색 기각 게이트** (#1095, #922): 무관한 질의에 검색 결과를 0건으로 기각합니다. `SEARCH_REJECTION_GATE=off|typesafe|ollama` 로 켜고 끄며 **기본값은 `off`** 이라 켜기 전까지 검색 동작은 그대로입니다. `typesafe` 는 TypeSafe Jev(System One) 의 보정 확률을 임계값 `SEARCH_REJECTION_GATE_THRESHOLD`(기본 0.5)와 비교합니다. 운영 DB 9,470건 실측에서 무관 질의 12건을 전부 차단하면서 재랭킹 p50 260ms 였습니다 — 같은 조건의 로컬 cross-encoder(`bge-reranker-base` q8)는 무관 4/12 를 통과시켰고 1257ms·메모리 +465MB 였습니다. 임계값이 코퍼스에 독립인 것이 결정적 차이입니다(raw logit 이 아니라 보정 확률이라서). 게이트가 점수를 얻지 못하면(WAF 차단·타임아웃·네트워크 실패) **기각하지 않습니다** — 게이트 장애가 검색 실패로 번지면 안 되기 때문입니다. `ollama` 는 향후 내부 모듈 교체 자리이며 아직 구현이 없습니다. 알려진 한계: Cloudflare WAF 가 코드펜스 뒤의 `curl -s`·`curl -sL`·`wget -q` 가 든 후보 본문을 차단하고, 후보 1건만 막혀도 배치 전체가 실패해 그 질의는 기각되지 않습니다.

- **MCP HTTP modern era(`2026-07-28`) POST 디스패치** (#840, Phase 1b): `params._meta.protocolVersion` 으로 era 를 라우팅하고, modern 응답에만 전용 검증 경계와 HTTP status 매핑을 적용합니다. legacy 경로는 바이트·상태 parity 를 그대로 유지합니다. `MEMENTO_MCP_ERA` 로 롤백할 수 있고, 활성화되면 `server/discover` 가 `2026-07-28` 을 광고합니다. modern CORS preflight 는 `MCP-Protocol-Version`·`Mcp-Method`·`Mcp-Name` 을 허용하고, modern GET/DELETE 의 405 에 `Allow: POST` 를 붙입니다.

- **stdio dual-era** (#840 Phase 2, #1110): stdio 는 저장소에 남은 마지막 legacy 전용 표면이었습니다 — `@modelcontextprotocol/sdk@1.29` 의 `LATEST_PROTOCOL_VERSION` 이 `2025-11-25` 라 stdio 클라이언트는 `2026-07-28` 에 도달할 방법이 없었습니다. `@modelcontextprotocol/server@2.0.0` 을 v1 **옆에** 추가해(교체가 아닙니다) `serveStdio` 로 서빙합니다. `MEMENTO_MCP_ERA=legacy` 는 기존 v1 `Server` + `StdioServerTransport` 경로를 그대로 탑니다 — 새 코드로 되돌아가는 것은 롤백이 아니기 때문입니다.

- **`remember` 의 `expected_version` compare-and-swap** (#1093, Phase 1): 여러 에이전트가 같은 기억을 동시에 고칠 때 마지막 쓰기가 조용히 이기지 않도록, `persistMemoryItem` 단일 변이 경계에서 CAS 를 수행하고 `owner_id`·`project_id` 가드를 함께 검사합니다. `expected_version` 을 주지 않는 기존 호출자는 동작이 바뀌지 않고 스키마 마이그레이션도 없습니다. `version` 이 NULL 이면 CAS 계산에서만 1 로 읽습니다.

- **검토 큐의 서버 필터·페이지네이션** (#897): `GET /admin/memory/review-candidates` 가 importance·미사용 기간·memory type·후보 사유 필터와 25/50 서버 페이지를 받습니다. 전에는 대기 후보 500행을 한 덩어리로 스크롤할 수밖에 없어 "중요도 높은 오래된 semantic 기억부터" 보는 것이 불가능했습니다. 확장 쿼리가 하나라도 있을 때만 적용되므로 status 만 주는 기존 호출은 계약이 그대로입니다. 잘못된 숫자 파라미터는 `parseInt` 절단 없이 거부합니다 — `25abc`·`10days` 는 통과하지 못합니다.

- **무관 질의 거부 기준선 하네스** (#922): 재랭킹 방식을 고르기 전에, 지금 검색기가 무관 질의에 어떻게 반응하는지 재현 가능하게 재는 오프라인 측정기입니다 (`scripts/quality-benchmark-rejection-baseline.ts`). 게이트는 넣지 않습니다. 기준선이 기록한 것은 **무관 질의 6/6 에 여전히 결과를 돌려준다**는 현재 동작이고, 앞으로 리랭커를 비교할 때 이 JSON 과 대조합니다.

- **max-sim 대 mean-pooling 오프라인 측정 하네스** (#1107, Phase 1): 윈도별 벡터를 꺼내는 public seam `generateWindowEmbeddings` 와 `npm run quality benchmark:maxsim` 리포트를 추가합니다. 측정은 하이브리드 엔진을 거치지 않습니다 — FTS 채널과 `characteristic_length` 감쇠가 섞이면 임베딩 레이어의 효과가 보이지 않기 때문입니다. benchmark-v3 3,461건에서 recall@50 0.5172 → 0.5862, recall@100 0.5862 → 0.6552 로 효과가 크지만 **상위 20위에서는 보이지 않습니다** (MRR@20 0.2619 → 0.2616).

- **관계 기반 recall 후보 확장 PoC** (#959, opt-in): 호출자가 `relationRecallExpansion` 을 `plain` 또는 `weighted` 로 줄 때만, 최종 절단 직전에 `memory_relation` 간선을 따라 후보를 넓힙니다 (seed ≤ 5, hop ≤ 2, 추가 ≤ 30). 탐색은 tenant 경계와 live 행만 보고, 추가분에도 recall 필터 전체가 적용되며, 그래프 실패 시 primary ranking 으로 폴백합니다. 측정은 **채택을 지지하지 않아 기본 활성화를 보류**했습니다 — mean MRR 이 off 0.5476, weighted 0.5417, plain 0.5370 입니다.

- **`*_FILE` Docker secrets 규약 구현** (#1115): `docker/docker-compose.prod.secrets.example.yml` 과 `docs/reference/ko/security.md` 가 `OPENAI_API_KEY_FILE`·`GEMINI_API_KEY_FILE`·`MEMENTO_API_TOKENS_FILE` 을 설명하고 있었지만 **그 코드가 저장소에 없었습니다.** 토큰만의 문제가 아니라, 문서대로 Docker secrets 를 구성하면 OpenAI·Gemini 키까지 전부 로드되지 않았습니다. `scripts/inject-file-secrets.sh` 가 규약을 구현하고 `start-container.sh` 가 이를 source 합니다. **경로가 지정됐는데 읽을 수 없으면 조용히 넘어가지 않고 기동을 중단합니다** — 시크릿 없이 뜬 컨테이너는 모든 programmatic 경로가 401 인 상태라, 조용한 성공보다 즉시 실패가 낫습니다. 값은 로그에 찍지 않습니다.

### Changed

- **장문 디스트랙터 픽스처를 윈도 단위로 재생성** (#1122, #1103 후속): `bench_syn_long_*` 디스트랙터는 질의를 한 문장으로 길게 반복하기만 했고, #973 이 정답키 누출을 걷어낸 뒤에는 8건 중 2건만 벡터 채널에 도달했습니다. 나머지 6건은 `distractorIdx === -1` 트립와이어로 고정돼 있었는데, 그것은 계측기가 죽어 있다는 기록이지 고친 것이 아닙니다. 측정해 보니 막고 있던 것은 문구가 아니라 **윈도 경계**였습니다 — 같은 주제 문단이 패딩과 510토큰 윈도를 공유하면 0.1785, 그 윈도를 혼자 차지하면 0.7668 입니다. 이제 각 본문은 윈도 경계에 맞춘 질의 밀집 문단 하나로 끝나고 그 앞은 무관한 장문 패딩입니다. **8건 중 7건이 top-20 에 도달합니다**(이전 2건). `bench_syn_long_0009` 는 자기 정답(0.5518)보다 아래에 두려고 일부러 남겨 두었고, `bench_syn_long_0010` 은 재생성본이 무관 질의를 오염시켜 원본을 유지합니다. 문서 길이(11,548~14,426자)·importance·`created_at`·태그·`corpus_size` 는 그대로이고 비가시 문자나 공백 패딩은 쓰지 않았습니다. nightly 의 long distractor 스텝은 계속 non-blocking 입니다 — 남은 실패 1건은 0011 의 정답 문서가 아예 검색되지 않는 #1095 결함입니다.

- **`forget` 파괴적 삭제에 신뢰 가능한 `agentId` owner scope 강제** (#1094): `ToolContext.agentId` 가 설정된 호출은 읽기·soft UPDATE·hard DELETE(배치 포함)가 전부 `owner_id IS ?` 로 좁혀집니다. 다른 owner 의 행을 지우려는 시도는 존재 여부를 흘리지 않는 not-found 로 끝나고 행을 건드리지 않습니다. 클라이언트가 보낸 `owner_id`·`project_id`·중첩 context 는 scope 를 켜지 못합니다 — 그것을 신뢰하면 owner spoofing 이 성립하기 때문입니다. **`agentId` 를 보내던 기존 클라이언트는 이제 다른 owner 의 기억을 지울 수 없습니다.** `agentId` 가 없는 레거시 호출자는 동작이 바뀌지 않습니다.

- **max-sim 윈도 벡터 색인과 프리페치 깊이 분리** (#1112, #1107 Phase 2): 윈도가 2개 이상인 MiniLM 문서만 `projection_type = 'window:N'` 행을 추가로 저장하고, 검색이 `MIN(distance) GROUP BY memory_id` 로 집계합니다 — 이것이 정확히 max-sim 입니다. 단일 윈도 문서는 `meanPoolNormalize([v]) === v` 라서 추가 행이 없습니다. 함께 `resolveVectorPrefetchLimit(limit)` = `clamp(limit × 8, 100, 512)` 로 프리페치 깊이를 최종 limit 에서 분리했습니다 — 둘 중 하나만 가면 나머지가 통째로 버려집니다. 벡터 채널 단독(limit=20) 실측은 MRR@20 0.5324 → 0.5830, recall@20 0.8500 → 0.8750 입니다. **검색 결과의 순서가 바뀝니다.** 새 마이그레이션 파일은 없습니다 — `migrate.ts` 가 매 마이그레이션마다 vec 트리거를 재생성하므로 기존 DB 는 자동으로 갱신됩니다. 깊이는 `MEMENTO_VECTOR_PREFETCH_MULTIPLIER` 로 덮어쓸 수 있습니다.

- **importance 랭킹 시그널 압축** (#1082): `γ·importance` 가 `[0,1]` 전 구간을 쓰는 동안 relevance 는 #1079 이후에도 좁은 폭에 머물러, `benchmark-v3` macro 버킷이 `scale=1` 에서 게이트를 통과하지 못했습니다. `config/ranking-weights.toml` 에 `[importance_signal].scale` 을 두고 `calculateImportance` 이후 `0.5 + (raw − 0.5) × scale` 을 적용합니다. 기본값 `0.35` 는 macro MRR ≥ 0.5 게이트 4개를 모두 통과하는 최대값입니다 (0.15–0.35 평탄부에서 고른 값이지 argmax 가 아닙니다). recall p95 는 `scale=1` 530.2ms 에서 342.0ms 로 내려갔습니다. scale 이 `getRankingVersion()` 해시 입력에 들어가므로 이전 점수 스냅샷과 구분됩니다. **검색 순위가 바뀝니다.**

- **벤치마크 `incident_ops` 버킷을 4 → 7질의로 확대** (#1104): 질의가 4건뿐이라 `MRR >= 0.5` 게이트가 이산적으로 튀었습니다 — 정확히 `0.5000` 이던 버킷은 정답 하나가 1위에서 2위로 밀리면 `0.3750` 으로 한 번에 게이트 아래로 떨어집니다. 중간값이 없었습니다. 임계값은 건드리지 않았습니다. 문제는 임계값이 아니라 해상도입니다. 코퍼스도 그대로이고 (`corpus_size` 3,461) 정답은 전부 기존 스냅샷 문서에서 골랐습니다.

- **nightly 의 long distractor 스텝을 진단으로 내림** (#1103): 이 스텝이 실패하며 잡 전체를 죽이는 바람에 뒤따르는 `MiniLM Korean embedding quality`(#889·#928)가 2026-09-20·09-21 두 run 모두 **실행되지 않았습니다** — 한국어 임베딩 품질 회귀가 보이지 않는 상태였습니다. 바로 위의 `Length-decay coefficient sweep` 은 같은 #961 산출물이고 같은 시드를 쓰는데 이미 `continue-on-error: true` 입니다. 진짜 게이트인 `Gate category search quality (MRR >= 0.5)` 는 4/4 통과 중입니다.

- **long distractor 단언을 실패 종류별로 분리** (#1103): (A) 벡터 도달률과 (B) 랭킹 품질을 한 spec 에서 뭉쳐 재고 있어 무엇이 깨졌는지 구분되지 않았습니다. 분리 과정에서 원인이 이슈 본문이 지목한 #973 이 아니라 **#1020** (`d74e736f`, 긴 한국어 기억을 토크나이저 윈도로 임베딩) 이라는 것이 드러났습니다 — 그때부터 본문 전체가 평균 풀링에 들어가므로, `bench_syn_long_0001` 에서 `cos(질의, 앞 1024자)` 0.5087 이 `cos(질의, 전체 12,000자)` 0.0422 로 희석됩니다. 기대값 재기준선은 #1103 에 남아 있습니다.

### Security

- **컨테이너 포트를 기본으로 루프백에만 게시** (#1126): `docker-compose.yml` 이 `"9001:9001"` 로 게시해 `0.0.0.0` 에 바인딩됐습니다. 컨테이너 안 `MEMENTO_HTTP_BIND_HOST` 는 도커 게시가 프로세스에 닿으려면 `0.0.0.0` 이어야 하므로, 외부 노출 여부를 정하는 것은 compose `ports:` 앞자리 하나뿐인데 그게 비어 있었습니다. 결과적으로 LAN 의 누구나 `/tools`·`/mcp`·`/api/v1/*` 에 도달할 수 있었습니다. 이제 기본값이 `127.0.0.1` 이고, LAN·원격 노출이 필요하면 `.env` 에 `MCP_PUBLISH_HOST=0.0.0.0` 을 명시합니다 (그때는 `MEMENTO_API_TOKENS` 를 반드시 함께 설정하십시오). `apps/multi-agent-orchestration/docker-compose.yml` 템플릿도 같이 고쳤습니다 — 복사해 쓰는 배포에 같은 기본값이 퍼지기 때문입니다. 운영 반영에는 `docker compose up -d --force-recreate` 가 필요합니다.

- **환경변수 이름이 값 자리에 들어간 자격증명을 폐기** (#1126): `MEMENTO_API_TOKENS` 와 `ADMIN_API_KEY` 의 값이 "이 프로세스에 실제로 설정된 다른 환경변수의 이름"이면 비밀이 아니라 `.env` 편집 사고이므로 값을 버리고 `error` 를 남깁니다. 2026-09-23 운영에서 두 키가 **동시에** 문자열 `MEMENTO_ALLOW_INSECURE_HTTP_ADMIN` 이었고, 그 문자열이 그대로 인증을 통과해 `admin:destructive` 까지 열려 있었습니다. 둘이 같이 오염돼 사람 눈으로는 대조가 되지 않았습니다. 경고로는 부족합니다 — 당시에도 `MEMENTO_API_TOKENS is not valid JSON` 에러가 로그에 있었지만 아무도 보지 않았습니다. 폐기하면 programmatic 경로가 401 로 fail-closed 되고, 루프백이 아닌 바인딩이면 기동 자체가 막혀 무증상으로 지나가지 않습니다. 판정 기준은 SCREAMING_SNAKE_CASE(밑줄 1개 이상) **이면서** 그 이름의 환경변수가 실제로 설정돼 있을 때뿐이라, 밑줄 없는 대문자 16진수 비밀은 걸리지 않습니다. 폐기 로그에 값 자체는 남기지 않습니다 — 판정이 틀렸다면 그것이 진짜 비밀이기 때문입니다.

### Fixed

- **`MEMENTO_API_TOKENS` 가 컨테이너에 도달하지 못하던 문제** (#1115): `docker-compose.base.yml` 이 legacy `ADMIN_API_KEY` 만 전달해서, `.env` 에 스코프 토큰을 넣어도 값이 서버 프로세스에 닿지 않고 **조용히 legacy 키로 폴백**했습니다. `env.example` 이 JSON 배열 형식까지 정확히 안내하고 있어 더 나빴습니다 — 문서를 정확히 따른 운영자가 아무 효과도 경고도 얻지 못합니다. 그 상태에서 "이전했으니 legacy 키 삭제" 순서를 밟으면 토큰이 0개가 되어 `/tools`·`/mcp`·`/messages`·`/api/v1/*` 가 전부 401 로 fail-closed 됩니다. 이제 compose 가 호스트 값을 그대로 넘기고, `MEMENTO_API_TOKENS` 가 설정됐는데 유효 토큰이 0개라 legacy 로 내려가는 상태를 `error` 로 남깁니다 (미설정 시에는 찍히지 않습니다). 운영 반영에는 `docker compose up -d --force-recreate` 가 필요합니다 — `up -d` 만으로는 `.env` 변경이 반영되지 않습니다.

- **그래프 배지의 라이브 리전 announce 가 건너뛰어지던 문제** (#955): `requestAnimationFrame` 콜백은 그 프레임의 **페인트 이전**에 실행되므로, 한 번만 감싸면 `display` 전환과 텍스트 주입이 브라우저 입장에서 같은 페인트로 합쳐질 수 있습니다. 그러면 라이브 리전 변경이 "갱신 시점에 숨어 있던 요소"로 보여 announce 가 건너뛰어집니다 — #950 이 애초에 막으려던 상황 그대로입니다. `ns.nextFrame` 을 이중 rAF 로 바꿨습니다. 실제 스크린리더 확인은 #955 에 남아 있습니다.

- **벤치마크 시드가 윈도 행 없이 조용히 만들어지던 문제** (#1103): `scripts/lib/benchmark-search-database.ts` 는 `MemoryEmbeddingService` 를 `@memento/core` 에서 import 하는데 그 specifier 가 **dist 로 해석됩니다** — `vitest.config.ts` 의 src alias 는 vitest 에만 적용되고 `npx tsx scripts/seed-benchmark-db.ts` 에는 적용되지 않습니다. dist 가 #1112 이전이면 `storeWindowEmbeddings` 가 아예 없어 `window:N` 행이 0개로 시드되고, **에러도 경고도 없이 측정값만 달라집니다.** 같은 커밋에서 문서화된 재현 절차가 8 failed 대신 10 failed 를 냈던 원인입니다. 이제 윈도 행 없이 시드되면 `npm run build -w @memento/core` 를 안내하며 실패합니다. `WINDOW_CANDIDATE_MIN_CHARS` 는 다른 윈도 상수들이 있는 `window-embedding-write.ts` 로 옮겨 단일 출처가 됐습니다. CI 는 영향이 없었습니다 — `nightly-tests.yml` 이 시드 직전에 core 를 빌드합니다.

## [1.32.0] - 2026-09-20

### Added

- **검토 큐 화면을 결정 중심으로 재작업** (#897): 버튼 옆에 각 동작이 실제로 무엇을 바꾸는지 적었습니다 — dismiss·expire 는 `memory_item` 을 건드리지 않고 후보 행만 옮기며, 다음 배치에서 다시 생성되므로 되돌릴 수 있습니다. "검토"는 메모리의 `last_accessed` 를 갱신해 보존 기간에 영향을 주므로 **보존**으로 개명했습니다. 전체 선택 체크박스는 "보이는 항목"이 아니라 적재된 후보 최대 500행을 선택하므로 문구를 사실에 맞췄습니다. 큐 지표 위에는 `window1h` 로 판정한 상태 배너(`확인 필요`/`처리 없음`/`backlog 증가`/`정상`)를 붙였고, 320px 폭까지 쓸 수 있게 했습니다.

- **`server/discover` 응답** (#840, Phase 1a): 이 서버가 실제로 말하는 프로토콜 버전 목록과 capabilities 를 `initialize` 와 **같은 값**으로 광고합니다. 두 응답이 어긋나면 클라이언트가 무엇을 믿어야 할지 알 수 없습니다.

- **`GET /admin/graph` 의 `exclude_orphans`** (#837): `memory_relation` 에 나타나는 노드만 고릅니다. limit 창을 고립 노드로 낭비하지 않습니다. `relation_types` 가 주어지면 그 타입만 관계로 셉니다 — 아니면 연결된 것으로 뽑혀 놓고 간선이 하나도 안 보이는 노드가 생깁니다. Phase 1 클라이언트 토글(#836)의 View orphan 정의(응답 안에서 degree 0)와는 다른 정의입니다.

- **`quality_measurement_history` 보존 정책** (#908): 다른 보조 테이블에는 전부 있는 정리 작업이 이 테이블에만 없어 측정값이 무한히 쌓였습니다. 측정 배치 안에서 측정 직전에 실행하며, 실패해도 작업을 깨지 않고 경고만 남깁니다. 비교는 `datetime(measured_at)` 으로 정규화합니다 — 저장값은 `T`/`Z` 가 붙은 ISO-8601 이고 `datetime('now', ...)` 는 공백 구분 문자열이라 문자열 비교로는 컷오프가 엉뚱한 곳에 놓입니다. 보조 테이블 전체의 보존 창을 문서에 적었습니다.

- **벤치마크 시더의 relation 적재** (#959): `relations.jsonl` 이 있으면 `benchmark_id → source_memory_id` 로 매핑해 넣고, 모르는 id 는 던집니다. 랭킹 공식의 `ζ·relation_weight` 항은 지금까지 벤치마크에서 항상 0이었습니다.

### Fixed

- **BM25 랭크 → relevance 시그모이드가 텍스트 랭킹 신호를 버리던 문제** (#1079): `1/(1+exp(rank))` 의 온도가 사실상 1로 고정돼 있었습니다. 실측 rank 구간 `-19.756 ~ -2.401` 이 전부 포화 꼬리에 들어가 동적 범위가 **0.083** 으로 뭉개졌고, 최종 점수 기여도가 `α·relevance` 0.022 대 `γ·importance` 0.17 로 **7.7배** 차이가 나 검색 결과가 질의와 무관해졌습니다. `config/ranking-weights.toml` 에 `[fts_relevance].temperature = 10` 을 두고 로더가 읽습니다. T 를 5/8/10/12/15 로 훑어 8~12 구간의 평탄부에서 10을 골랐습니다 — argmax 가 아니라, 질의 26개에 과적합하지 않는 값입니다. `procedural` MRR 0.2154 → 0.6500, `conceptual` 0.4071 → 0.6000.

- **MCP `initialize` 가 실제 버전과 capabilities 를 알리지 않던 문제** (#840, Phase 0): HTTP 레그가 클라이언트 요청과 무관하게 `protocolVersion` 을 항상 `2024-11-05` 로 답해, `2025-11-25` 를 협상하던 클라이언트가 조용히 네 리비전 아래로 끌려 내려갔습니다. 이제 SDK 가 지원하면 요청받은 버전을 되돌려 주고, 아니면 지원 최신 버전으로 떨어집니다. capabilities 도 `tools` 만 알렸는데 같은 파일이 `prompts/*`·`resources/*` 를 처리하고 있어, capabilities 를 존중하는 클라이언트는 그것들을 영영 호출하지 않았습니다. `serverInfo` 는 `memento-memory 0.1.0` 이었습니다.

- **서버 이름·버전이 네 곳에 하드코딩돼 있던 문제** (#1077): `/health` 와 `initialize` 가 실제 발행 버전이 아닌 값을 보고했습니다. 사본은 코드 기본값(`environment.ts`)·`env.example`·운영 `.env`·`docker-compose.base.yml` 의 **네 개**였고, 앞의 셋만 고치면 compose 의 `${MCP_SERVER_NAME:-memento-memory}` 폴백으로 떨어져 오히려 나빠집니다. 이제 `package.json` 이 단일 출처이고, `scripts/check-version-sync.ts` 가 매니페스트 3건의 일치를 CI 에서 강제하며, 릴리스 워크플로는 버전을 **덮어쓰지 않고 태그와 일치하는지 검증**합니다. env 템플릿과 루트 `docker-compose*.yml` 에 버전 핀이 다시 생기면 테스트가 잡습니다.

- **Docker 이미지가 저장소가 아니라 호스트의 빌드 산출물을 실어 나르던 문제** (#1090): 컨테이너 안의 `ranking-weights.toml` md5 가 저장소와 달랐습니다(`a942d244` ≠ `f11d27cc`). `.dockerignore` 의 `dist` 는 컨텍스트 루트만 제외해 `packages/*/dist` 가 그대로 COPY 됐고, Dockerfile 은 루트 `config/` 를 한 번도 복사하지 않았으며, `copy-assets.js` 는 `if (existsSync)` 로 조용히 건너뛰었습니다. `**/dist` 제외 + `COPY config/` 로 고쳤고, config 원본이 없으면 빌드가 죽습니다.

- **벤치마크 메타데이터를 정답지에서 시딩하던 문제** (#973): `seedOneCorpusRow` 가 `ground-truth.json` 에서 만든 `isRelevant` 플래그로 `importance`·`last_accessed_at`·`recall_count` 를 골랐습니다. 두 importance 대역이 겹치지 않아, 검색이 돌기도 전에 정답 31건이 distractor 3,430건을 랭킹 피처 세 개에서 전부 앞섰습니다. 이제 문서 id 만으로 운영 `memory_item` 분포에 맞춰 뽑습니다. 문서마다 PRNG 를 시딩해 순서 의존성도 없앴습니다 — 전에는 문서 하나를 추가하면 그 뒤 문서가 전부 뒤섞였습니다.

- **`vi.mock` 경로 게이트가 `vi.doMock` 과 템플릿 리터럴을 놓치던 문제** (#826): 게이트 정규식이 따옴표 리터럴이 붙은 `vi.mock` 만 잡았습니다. `vi.doMock` 은 경로가 틀리면 똑같이 조용히 아무것도 안 하고, 뒤이은 같은 경로의 동적 import 가 가로채여 결함이 런타임에 드러나지 않습니다. 오래된 baseline 항목에서 종료 코드 1을 내는 `--strict` 를 옵트인으로 추가했습니다(기본은 계약대로 0 유지).

### Changed

- **벤치마크 macro category `episodic_recent` → `incident_ops` 개명** (#1074): 이름이 recency 를 측정한다고 말하지만 그 버킷의 질의는 장애·운영 문서를 찾는 것이고, 코퍼스가 한 시점에 몰려 있어 `β·recency` 항의 실측 범위가 episodic 안에서 **0.0026** 에 불과합니다. 측정할 수 없는 것을 이름이 약속하고 있었습니다. 네 macro category 가 각각 무엇을 재는지 `docs/reference/ko/benchmark-macro-categories.md` 에 적었습니다.

- **`report-comparison.ts` 3,094줄 분할** (#910): 순수 이동, 동작 변경 없음. `measureConsolidationQuality`·`calculateQualityDegradation` 은 모듈 경계를 넘느라 export 로 바뀌었지만 `report-comparison.ts` 에서 재수출하지 않으므로 공개 표면은 그대로입니다.

## [1.31.0] - 2026-09-19

### Added

- **운영 스트립** (#1025): 대시보드 탭 바 아래에 `/admin/status`를 한 번 읽어 임베딩 문제·검토 대기·실패 실행을 요약하는 접이식 스트립(`static/js/ops-strip.js`)을 추가합니다. 폴링하지 않고, 값이 없으면 `—`로 조용히 낮춥니다. 라벨은 상태 탭의 어휘를 그대로 씁니다. 메모리 상세는 사이드바에서 빠져 지도 아래 자체 인스펙터(`<details id="memory-inspector">`)로 옮겼습니다.

- **테이블·지표 프리미티브** (#1024): `components.css`에 `.m-table`/`.m-table--dense`/`.m-table__num`/`.m-metric-grid`를 추가하고, 대시보드에 흩어져 있던 표 3벌과 모노스페이스 선언 5벌을 여기로 접었습니다.

### Fixed

- **npm 설치본에 `static/`이 없어 `/dashboard`가 404** (#1057): 패키지 `files`에 `static`을 추가하고, 정적 루트 해석을 `packages/memento-server/src/server/static-root.ts`로 분리했습니다. 전역 설치된 bin은 사용자 cwd에서 실행되므로 cwd 기준 후보만으로는 자산을 찾지 못했고(`ENOENT … /static/dashboard.html`), 이제 모듈 경로를 위로 5단계까지 거슬러 찾습니다. `MEMENTO_STATIC_ROOT`로 덮어쓸 수 있습니다(`env.example`).

- **실패 실행 점이 30일 누적을 색으로 칠하던 문제** (#1054): 최근 24시간 안에 실패가 있었는지로 판정합니다. 실측 창(79,837 실행 / 실패 1건 / 13일)에서 누적 건수는 오래 전 실패 하나를 무기한 빨강으로 유지했습니다. `batchImpact.status`는 집계 쿼리의 성공 여부만 뜻하므로 점의 근거로 쓰지 않습니다.

### Changed

- **관리 화면 크롬 정리** (#1023): 브랜드 그라디언트를 걷어내고 잉크 톤 + 단일 teal 강조(`--color-brand-primary: #0f766e`)로 통일했습니다. 모노스페이스는 `--font-family-mono` 한 곳에서 옵니다. 에이전트 타임라인은 색으로 이벤트를 가르는 범주형 팔레트라 기존 색을 유지합니다.

- **문서**: `/graph` 다크 · `/dashboard` 라이트 이중 테마를 유지하기로 결정 기록(#1026), `docs/DESIGN.md`를 상태판이 아닌 제안 기록으로 정리(#1056), `specs/065`의 운영자 백업 보존 조항에 supersede 표기(#1052), `CHANGELOG.md`의 누적분을 버전 절로 정리하고 릴리스 직후 절차를 문서화(#1049).

## [1.6.0] – [1.30.2] (일괄) - 2026-09-19

아래 항목은 `1.6.0`부터 `1.30.2`까지 25개 릴리스에 걸쳐 실제로 배포된 것들입니다.
`1.5.0` 이후 버전 절을 만드는 절차가 없어 `[Unreleased]`에 누적됐고, 이 절로 한 번에 옮겼습니다
(이슈 #1049). **어느 항목이 어느 버전에 나갔는지는 이 파일이 아니라
[GitHub Releases](https://github.com/jee1/memento/releases)가 정본입니다** — 릴리스 노트는
`gh release create --notes-file`로 직접 작성되며, 배포 버전은 git 태그에서 옵니다
(`.github/workflows/release.yml`). 여기서 버전별로 쪼개 적으면 없는 근거를 만들어 내는 셈이라 하지 않았습니다.

### Fixed

- **recall 필터 벡터 레인 누출** (#998): `time_from`/`time_to`·`pinned`·`tags`·`privacy_scope`·`has_reflection_notes`·`workflow_name`/`skill_name`·`id` 필터가 벡터 레인 SQL에 없어 recall 결과가 필터 창 밖으로 새 나오던 문제를 수정합니다. `importance_min`/`importance_max` 사문 배선, `created_at` ISO·공백 형식 혼재로 텍스트 레인 시간 필터가 ~24% 행을 놓치던 문제(`julianday` 비교)도 함께 고칩니다. 필터 절은 `buildMemoryFilterSql` 한 곳에서 정의하고 텍스트·벡터 레인이 공유합니다.

- **Docker 배포 게이트 호스트 백업 실패** (#1001): 컨테이너 소유 `~/.memento/data` 에서 WAL `-shm` 사이드카를 호스트 사용자가 만들 수 없어 `SQLITE_READONLY_DIRECTORY` 로 실패하는 경우를 `source-dir-unwritable` 로 분류합니다. `npm run db:backup:docker` (컨테이너 uid 1001 + 호스트 gid) 와 `db:pre-docker-deploy` 자동 폴백을 추가했습니다.

- **remember `update_mode` 명시 타깃** (#1000): `memory_id` 파라미터를 추가해 episodic/semantic 등에서 `replace`·`incremental`·`versioned` 갱신 대상을 지정할 수 있습니다. `RememberSchema`를 `.strict()`로 전환해 미지원 키(`id`, `memoryId` 등)는 조용히 strip되지 않고 `-32602`로 거절됩니다(**호환성 주의**: 오타 키를 쓰던 클라이언트는 실패가 표면화됩니다). 성공 응답에 `updated: true`를 추가해 UPDATE와 INSERT를 구분합니다. `memory_id` 지정 시 near-dup 탐색을 건너뜁니다.

### Changed

- **remember near-duplicate 어휘 가드** (#997): write-path near-dup 후보에 char 3-gram Jaccard 어휘 겹침 게이트를 추가합니다. `MEMENTO_REMEMBER_DEDUP_LEXICAL_FLOOR`(기본 0.3) 미만 후보는 제외하고, `update_mode=incremental` 자동 병합은 `MEMENTO_REMEMBER_DEDUP_MERGE_LEXICAL_FLOOR`(기본 0.7) 이상일 때만 수행합니다. `similarity_warning.suggestion`은 병합 바닥 통과 시에만 붙이며, 벡터 검색이 8건을 반환하면 `truncated: true`를 표시합니다.

- **`sharp` root 직접 의존 제거** (#993): `package.json`에서 선언 삭제 — `@huggingface/transformers@4.3.0`이 hard dependency로 `sharp@0.35.4`를 유지하므로 배포 산출물 불변. Dockerfile의 no-op `npm rebuild sharp` 제거. `dependency-range.spec.ts`를 lockfile 단일 엔트리·보안 floor 검증으로 재작성.

- **Production dependency audit High 4건 해소** (#989): `sharp` `^0.34.4→^0.35.4` (wanted-only 예외 — `AGENTS.md` deps), lockfile에서 `@huggingface/transformers@4.3.0`·`onnxruntime-node@1.30.0`·`adm-zip@0.6.1` 전이 bump. `security/accepted-audit.json` allowlist 비움. MiniLM 실증 테스트 V1~V6 추가.

- **search-quality length-decay sweep instrumentation** (#961): `CategoryMetricsOptions`로 short-only GT 서브셋·vector-dominant arm을 선택적으로 켜고, `mean_top10_long_doc_ratio`(>2,000자 top-10 점유율)를 리포트에 추가합니다. `npm run quality -- benchmark length-decay-sweep`가 k∈{40,80,160,320}×arm×subset 진단 TSV를 출력합니다(exit 0, 게이트 아님). 장문 near-clone 디스트랙터는 임베딩 지평(앞 1,024자) 안 주제 밀도를 높여 벡터 채널에 진입하도록 픽스처를 재작성했습니다.

### Breaking

- **[BREAKING] MCP `tools/list` 기본 노출을 4개로 축소** (#769): 등록 도구는 22개 그대로지만 `tools/list`는 기본적으로 `recall`·`remember`·`memory_injection`·`feedback`만 반환합니다. 도구 정의는 세션 내내 클라이언트 컨텍스트를 점유하고, Memento는 늘 켜두는 서버라 상시 점유 비용이 큽니다 — 측정 결과 직렬화된 목록이 23,440 → 11,817 바이트(추정 5,860 → 2,954 토큰, **49.6% 감소**)입니다.

  **마이그레이션**: 나머지 18개는 **등록된 채로 남아 `tools/call`로 그대로 호출됩니다** — 목록에서만 빠지므로 도구 이름을 이미 아는 클라이언트·스킬·스크립트는 영향이 없습니다. 영향을 받는 것은 `tools/list` 결과만 보고 도구를 고르는 에이전트입니다. 이전처럼 22개를 전부 나열하려면 MCP 호스트 설정에 `MEMENTO_TOOLSET=full`을 추가하세요(stdio·HTTP·WebSocket 모두 동일). 잘못된 값은 경고 후 `core`로 폴백합니다. 측정 재현: `npm run mcp:tool-surface`.

- **CLI bin alias `memento-mcp` removed** (#766): use `memento-mcp-server` only (same stdio entrypoint). The short alias collided with the unrelated npm/GitHub project `gannonh/memento-mcp`. Update MCP host configs and scripts that invoked `memento-mcp`. npm package name remains `memento-mcp-server`.

### Changed

- **수용 audit 목록 게이트화** (#942): upstream-blocked(고칠 수 없는) High/Critical 을 `security/accepted-audit.json` 에 고정하고, 목록에 없는 항목이 나타나면 production·`--include-dev` 두 레인 모두 실패합니다(이전에는 stdout 로그만 남기고 통과). 목록과 `docs/reference/{ko,en}/security.md` Upstream-blocked 표의 동기화는 `scripts/lib/accepted-audit-allowlist.spec.ts` 가 집합 동일성으로 검증합니다.
- **Migration run-scoped backup** (#851): `runMigrations` creates at most one pre-run DB snapshot for the whole batch (not one per version). Direct `runMigration` still backs up once per call. Retention cleanup runs once after that create. Fail-closed if the run backup fails before any `up`.
- **log_rotation family expansion** (#852): batch job now cleans migration (`keepCount` default 500), docker-diagnostics (256 MiB budget), log-issue-monitor (trim jsonl / keep `state.json`), and triple-extraction (30d age). Env overrides: `LOG_ROTATION_*`. Job `details` additive; reports avoid absolute paths.
- **Admin Jobs Dashboard Phase 3** (#834): `POST /admin/batch/run`의 `jobType` 허용 범위를 등록된 전 schedule job 이름으로 확대합니다(기존 3종 whitelist → runner registry 전체). 동일 job이 이미 실행 중이면 **409 Conflict**(`job already running`). `GET /admin/batch/runs/:runId/logs`, `POST /admin/batch/pause`, `POST /admin/batch/resume` 추가. `ADMIN_JOBS_READ_ONLY=true`면 쓰기 POST는 **403**, GET은 허용.
- **memory_embedding Float32 BLOB storage** (#809): `embedding` 컬럼을 JSON TEXT에서 little-endian Float32 BLOB로 전환합니다. 마이그레이션 043이 원자적으로 변환하고, 쓰기/읽기 경로는 `encodeFloat32Embedding` / `embeddingColumnToNumbers`를 사용합니다. MCP recall 응답 스키마는 불변입니다.
- **규칙 기반 폴백 로그 사유 구분** (#819): 폴백 로그에 `reason` 필드가 붙습니다. 하이브리드 폴백은 LLM 미가용(`llm_unavailable`)과 LLM 호출 실패(`llm_call_failed`)를 구분하고, 초기화가 예외로 끝난 경우는 생성자 로그가 `init_failed`로 남깁니다. 미가용의 구체적 원인(키 부재 / 연결 점검 실패)은 `LLMClientInitializer`가 모두 warning으로 흡수하므로 폴백 지점에서는 알 수 없고, 초기화 시점의 `LLM 초기화 경고` 로그에 남습니다. 값은 세 개로 고정이며 기존 로그 문구는 그대로입니다.
- **`LLMBasedRelationExtractor.extractRelations` 직접 호출 시 동작 변경** (#819): 초기화 완료 전 조기 throw를 제거하면서 이 클래스를 **직접** 호출하는 경우 두 가지가 달라졌습니다 — 미가용 시 예외 문구가 `'LLM 서비스를 사용할 수 없습니다. OPENAI_API_KEY 또는 …'`로 통일되고, `existingMemories`가 빈 배열이면 예외 대신 `[]`를 반환합니다. production 호출자는 `RelationExtractor` 하나뿐이며 그쪽 문구와 빈 배열 처리는 변경 없습니다.
- **Recall latency** (#735): `include_metadata` 경로의 고정 150ms 대기를 제거하고, pending `recordRecall` 통계를 `getStats`/`getStatsById`에서 즉시 읽는다. hybrid search는 FTS와 vector 분기를 `Promise.all`로 동시에 시작한다. ranking weight·score breakdown은 그대로다.

### Fixed

- **의존성 경계 검사가 동적 import를 검출** (#926): `dependency-boundaries.spec.ts`의 줄 단위 정규식을 TypeScript AST 수집기로 교체했습니다. 정적 import뿐 아니라 동적 `import()`·`export ... from` 재수출·다중행 import·side-effect import가 모두 경계 검사에 포함됩니다. 그동안 누락돼 있던 domain→infrastructure 의존 1건(`domains/memory/remember/remember-tool-core.ts`)이 새로 검출되어 rationale과 함께 allowlist에 등재됐고, `FROZEN_DOMAIN_TO_INFRA_ALLOWLIST_SIZE`는 18 → 19가 됐습니다. 프로덕션 동작 변경·신규 의존성 추가는 없습니다.
- **search-quality category-report coverage when a macro has zero scored queries** (#934): empty scored buckets still emit `query_count: 0` with full `authored_query_count` so coverage cannot read `1.000` while authored queries are missing. Adds unit coverage for `meanTop10ContentLength` and near-clone long distractors for the length-bias instrument (k-sweep MRR direction still not reproduced — see `sweep-934` artifact).
- **search-quality 벤치마크 길이 편향 관측 가능화** (#934): `benchmark-v3` 코퍼스에 5,000자 초과 합성 문서 13건을 포함한 21건을 추가하고(스냅샷 3,440건은 동결), 미채점이던 7개 쿼리의 ground truth를 작성했다. `category-report`가 `queries_authored`/`queries_scored`/`coverage`와 macro별 `scored/authored`·top-10 평균 길이를 출력하며, 커버리지가 100% 미만이면 exit 1이다. 랭킹 동작과 `characteristic_length = 40`은 변경 없음.
- **Anchor Map 로드 실패 표시** (#904): 맵 데이터 로드 실패를 `alert` 대신 맵 영역 안의 `.map-error-message` 로 표시합니다. `alert`는 auto-refresh 중 억제되어 주기 실패가 완전히 침묵했습니다. 빈 상태(`.map-empty-message`)·로딩(`.map-loading-message`)과 클래스가 분리되고 상호 배타이며, WebSocket 이 끊긴 뒤 폴링 폴백도 없는 경우를 같은 오류로 표시합니다. 같은 실패의 반복 폴링은 내용 기반 dedupe 로 1회만 렌더합니다.
- **CLI HTTP 인증** (#841): `callToolViaHttp`가 `ADMIN_API_KEY`를 Bearer 헤더로 보내 CLI·훅의 인증 경로를 맞춥니다. `MCP_SERVER_PORT=0`을 보존해 실제 할당 포트로 서버를 검색할 수 있습니다.
- **misc repair export · injection 손상 필터 · MCP -32602 · hybrid 유사도** (#811): `memory:repair-triple-sentences`용 `@memento/core` export 스모크를 추가하고, `memory_injection` 후보의 손상 triple 문장(`hasBrokenTripleConjugation`)을 adaptive overfetch+조기 필터로 예산 고갈을 막습니다(`함합니다` #781 정책 유지). recall/remember 입력 검증은 `ToolInputValidationError` → JSON-RPC `-32602`로 매핑합니다(스키마 불변). 하이브리드 검색은 SQL이 `vector_distance`를 반환하고 유사도 변환은 `cosineDistanceToSimilarity`만 사용합니다. 진단 프로브는 `auto_set_anchor: false`를 문서화했습니다.
- **Semantic triple predicate 정규화 게이트** (#813): `TripleNormalizer`가 구·영문·재조립불가 predicate를 pass-through하지 않고 drop합니다(형태 (2) 폴백 차단). 수용분만 semantic/`kg_triple`에 남고, skip reason·카운터는 metadata/로그에만 기록됩니다(MCP recall/remember 스키마 불변). 전부 게이트 실패해도 remember·변환 primary 경로는 soft-success입니다. 운영 관측: `npm run memory:kg-triple-predicate-quality`(read-only JSON, `--sample-limit`≤20).
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

- **Memory Graph 「연결 없는 노드 숨기기」 토글** (#836, epic #835): `/graph`·대시보드 Graph 탭에서 현재 화면의 엣지 기준 degree=0 노드를 숨기고 `N개 숨김` 을 표시합니다. **기본값 off** — 고립 기억 발견(#126) 용도를 유지합니다. 클라이언트 전용이며 `GET /admin/graph` 요청·응답은 변경 없습니다. 판정 기준은 **View orphan**(현재 응답 엣지에서 degree=0)이라 DB 에 관계가 있어도 상대 노드가 limit 밖이면 숨겨집니다 — DB orphan 기준 필터는 Phase 2(#837).
- **Opt-in stdio HTTP 사이드카** (#841): `MEMENTO_HTTP_SIDECAR=1`로 stdio가 만든 core를 공유하는 HTTP 서버를 기동합니다. 기존 서버 검색·단일 기동 lock·포트 충돌 격리·소유한 HTTP 리소스 종료를 지원하며 기본값은 꺼짐입니다. 설정 및 운영 방식은 `docs/agents/commands.md`를 참고하세요.
- **Backup backlog cleanup operator docs** (#065): `db:backup:cleanup` preview와 `db:backup:cleanup -- --apply` 사용법을 Docker/agent/script 문서에 추가했습니다. Apply 전 MCP 서버·restore·다른 cleanup/backup 작업 중지, 절대 `DB_PATH` 사용(`~` 미확장), preview 기본값, operator 백업 최근 10개 상한(초과분은 `surplus-operator` 로 삭제, #1043), 오류/cleanup report의 경로 비노출 계약을 명시했습니다. 재현 원인은 migration main-file copy, operator validation 전 sidecar cleanup, production에서 호출되지 않던 넓은 `mtime` cleanup helper였습니다.
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
