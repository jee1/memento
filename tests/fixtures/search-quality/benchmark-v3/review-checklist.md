# Search Quality Benchmark Review Checklist

- Benchmark version: `v1`
- Reviewed flag: `true`

## Review Rules

- relevant: 이 기억이 실제 답변 품질을 올리면 선택
- not relevant: 키워드는 비슷하지만 답변에 도움되지 않으면 제외
- 검토 후 `ground-truth.json`을 수정하고 verify 스크립트를 실행

## Query q_001

- Query: `HTTP 서버 에러 처리`
- Language: `ko`
- Category: `incident`
- Notes: 에러 원인과 해결 기억을 찾는 질의
- Current relevant IDs: (none)

### Current Relevant Memories

- (none)

### Candidate Memories

- [ ] `bench_mem_003415`
  - source: `mem_1773755293630_27d1dp54k`
  - type: `episodic`
  - tags: `search-quality`, `benchmark`, `query-rewrite`, `analysis`
  - content: benchmark-v1 empty queries 22개를 재작성 관점으로 분류했다. 원칙은 실제 사용자 질문을 유지하되 현재 코퍼스와 완전히 어긋난 구현 내부/평가 전용 질문은 삭제 또는 보류로 분리하는 것이다. 유지군은 HTTP 서버 에러 처리, 기억 삭제 및 망각, 앵커 설정과 검…
- [ ] `bench_mem_000549`
  - source: `mem_1759560726779_qtalg6wk7`
  - type: `episodic`
  - tags: `memento`, `mcp-server`, `testing`, `test-coverage`, `http-server`, `websocket`, `completion`
  - content: Memento MCP 서버 테스트 코드 개선 작업 완료 ## 📊 최종 결과 - **26개 테스트 모두 통과** (26 passed) - **src/server/http-server.spec.ts** 완전히 수정 완료 - **src/server/index.spec.ts** 수정 완료 …
- [ ] `bench_mem_000159`
  - source: `mem_1758805799453_eo5qbw9ao`
  - type: `semantic`
  - tags: `memento`, `refactoring`, `modularization`, `mcp`, `tools`, `architecture`, `maintainability`, `2025-09-25`
  - content: Memento MCP 서버 도구 모듈화 리팩토링 완료 (2025-09-25) ## 🎯 리팩토링 목표 기존에 메인 서버 파일에 모든 도구가 구현되어 있어 유지보수가 어려웠던 문제를 해결하기 위해 각 도구를 별도 모듈로 분리 ## ✅ 완료된 작업 ### 1. 도구 모듈화 구조 설계 - …
- [ ] `bench_mem_000158`
  - source: `mem_1758805601387_laurhvi67`
  - type: `semantic`
  - tags: `memento`, `refactoring`, `modularization`, `mcp`, `tools`, `architecture`, `maintainability`, `2025-01-21`
  - content: Memento MCP 서버 도구 모듈화 리팩토링 완료 (2025-01-21) ## 🎯 리팩토링 목표 기존에 메인 서버 파일에 모든 도구가 구현되어 있어 유지보수가 어려웠던 문제를 해결하기 위해 각 도구를 별도 모듈로 분리 ## ✅ 완료된 작업 ### 1. 도구 모듈화 구조 설계 - …
- [ ] `bench_mem_001377`
  - source: `mem_1762439816896_0v1f10jae`
  - type: `episodic`
  - tags: `implementation`, `memory-neighbors`, `task-3.0`, `http-api`
  - content: 태스크 3.0 완료: HTTP API 엔드포인트 구현 구현 내용: - GET /memories/:id/neighbors 엔드포인트 추가 - URL 파라미터에서 memory_id 추출 (:id) - 쿼리 파라미터 파싱: limit (optional, default: 5), similar…
- [ ] `bench_mem_000424`
  - source: `mem_1758937296951_liua0bo9a`
  - type: `episodic`
  - tags: `performance`, `test`, `batch-1`
  - content: 성능 테스트용 기억 2: TypeScript와 React에 대한 학습 내용입니다.
- [ ] `bench_mem_000412`
  - source: `mem_1758936839309_imztwth6h`
  - type: `episodic`
  - tags: `performance`, `test`, `batch-1`
  - content: 성능 테스트용 기억 2: TypeScript와 React에 대한 학습 내용입니다.
- [ ] `bench_mem_000440`
  - source: `mem_1758937446853_bdhx4gvs5`
  - type: `episodic`
  - tags: `performance`, `test`, `batch-5`
  - content: 성능 테스트용 기억 6: TypeScript와 React에 대한 학습 내용입니다.
- [ ] `bench_mem_000537`
  - source: `mem_1759474586112_5s2ug9j1k`
  - type: `episodic`
  - tags: `testing`, `memento`, `performance-optimization`
  - content: Memento 프로젝트의 전체 테스트 실행 방법을 분석했습니다. `npm test`로 기본 테스트, `npm test -- --coverage`로 커버리지 포함 테스트를 실행합니다. 현재 feature/m1-performance-optimizatio…
- [ ] `bench_mem_000249`
  - source: `mem_1758931089027_dtnwky2a0`
  - type: `episodic`
  - tags: `performance`, `test`, `batch-8`
  - content: 성능 테스트용 기억 9: TypeScript와 React에 대한 학습 내용입니다.
- [ ] `bench_mem_001127`
  - source: `mem_efb203df03974085891dd35edbc6d233`
  - type: `semantic`
  - tags: `code-metadata`, `validateRememberArgs`
  - content: {"methodName":"validateRememberArgs","parameters":[{"name":"args","type":"RememberArgs"}],"returnType":"void","filePath":"src/tools/remember-tool.ts","startLin…
- [ ] `bench_mem_001157`
  - source: `mem_a85c1016a2c54ee98a5fa380825b150e`
  - type: `semantic`
  - tags: `code-metadata`, `getPinStats`
  - content: {"methodName":"getPinStats","parameters":[{"name":"db","type":"any"}],"returnType":"Promise<{\n total_pinned: number;\n pinned_by_priority: Record<number, numb…
- [ ] `bench_mem_001147`
  - source: `mem_65ea04aaed0a4506a1c564ab90f94623`
  - type: `semantic`
  - tags: `code-metadata`, `softDeleteMemory`
  - content: {"methodName":"softDeleteMemory","parameters":[{"name":"db","type":"any"},{"name":"memoryId","type":"string"}],"returnType":"Promise<void>","filePath":"src/too…
- [ ] `bench_mem_000413`
  - source: `mem_1758936839318_8u1twwwb5`
  - type: `episodic`
  - tags: `performance`, `test`, `batch-2`
  - content: 성능 테스트용 기억 3: TypeScript와 React에 대한 학습 내용입니다.
- [ ] `bench_mem_000443`
  - source: `mem_1758937446869_eeh1ys731`
  - type: `episodic`
  - tags: `performance`, `test`, `batch-8`
  - content: 성능 테스트용 기억 9: TypeScript와 React에 대한 학습 내용입니다.

## Query q_002

- Query: `검색 품질 측정 방법`
- Language: `ko`
- Category: `testing`
- Notes: precision recall nDCG 관련
- Current relevant IDs: (none)

### Current Relevant Memories

- (none)

### Candidate Memories

- [ ] `bench_mem_003402`
  - source: `mem_1773743224235_wniimx8w6`
  - type: `semantic`
  - tags: `search-quality`, `ground-truth`, `evaluation`, `best-practice`, `ci`, `retrieval`
  - content: Memento의 검색 품질 평가 체계는 IR 지표(precision/recall/nDCG/MRR)와 임계값, 배치 측정 경로를 갖추고 있어 모니터링 프레임워크로는 유용하지만, 자동 생성 Ground Truth(generateGroundTruth)가 memoryIds에서 random/f…
- [ ] `bench_mem_003409`
  - source: `mem_1773753292531_8utacjjyq`
  - type: `episodic`
  - tags: `completed`, `search-quality`, `ground-truth`, `manual-review`
  - content: feature-search-quality-benchmark 브랜치에서 search-quality benchmark의 ground-truth를 보수적으로 수동 보정하기 시작했다. q_001 HTTP 서버 에러 처리와 q_005 MCP 서버 기동 방법은 코퍼스 내 확실한 관련 기억을 찾지…
- [ ] `bench_mem_002161`
  - source: `mem_1765685400705_yca97y78g`
  - type: `episodic`
  - tags: `prd`, `issue-62`, `quality-assurance`, `completed`
  - content: #62 품질 보장 전략 및 품질 측정 지표 정의 PRD 작성 완료. 파일: tasks/0014-prd-quality-assurance-strategy-and-metrics.md. 주요 내용: 통합 품질 관리 시스템, 검색/저장/임베딩/관계추출/시스템 전반 품질 지표 정의, 배치 및 테…
- [ ] `bench_mem_002372`
  - source: `mem_1766887120682_79upb44vz`
  - type: `episodic`
  - tags: `quality-assurance`, `metrics`, `testing`, `cleanup`, `completed`
  - content: 2025-12-19 작업 완료 주요 작업 내용: 1. Memory Quality Assurance 시스템 구현 (#62, #68) 2. 품질 지표 수집기 테스트 실패 수정 3. 검색 품질 지표 수집 개선 및 자동 측정 기능 추가 4. 불필요한 파일 및 디렉토리 정리 작업 유형: 품질 …
- [ ] `bench_mem_002202`
  - source: `mem_1765972239317_5nk597tqd`
  - type: `episodic`
  - tags: `quality-assurance`, `ground-truth`, `completed`, `improvement-needed`
  - content: 품질 측정 재실행 완료 실행 결과: - Ground Truth 데이터 생성 완료 (5개 쿼리, 각 5개 관련 결과) - 품질 측정 실행 완료 - 하지만 검색 품질 지표는 여전히 0으로 표시됨 원인: - QualityMetricsCollector.collectSearchMetrics는 …
- [ ] `bench_mem_002204`
  - source: `mem_1765972521520_c35ue18v1`
  - type: `episodic`
  - tags: `quality-assurance`, `ground-truth`, `search`, `completed`
  - content: 품질 측정 재실행 완료 실행 결과: - Ground Truth 자동 로드: 성공 (5개 쿼리) - 검색 수행: 성공 (각 쿼리마다 검색 실행) - 검색 결과: 0개 (쿼리와 메모리 내용 불일치) 원인 분석: - Ground Truth 쿼리: "React", "TypeScript", "…
- [ ] `bench_mem_002201`
  - source: `mem_1765972210878_cgprwhzok`
  - type: `episodic`
  - tags: `quality-assurance`, `ground-truth`, `in-progress`
  - content: 품질 측정 재실행 시도 중 현재 상황: - Ground Truth 데이터 생성 완료 (5개 쿼리, 각 5개 관련 결과) - 하지만 품질 측정 결과는 여전히 0으로 표시됨 원인 분석: - QualityMetricsCollector.collectSearchMetrics는 Ground Tr…
- [ ] `bench_mem_002198`
  - source: `mem_1765970579788_3ml076enu`
  - type: `semantic`
  - tags: `quality-assurance`, `architecture`, `best-practice`
  - content: Memory Quality Assurance 시스템 아키텍처 핵심 컴포넌트: 1. QualityAssuranceService: 중앙 품질 관리 서비스 2. QualityEvaluator: 품질 평가 엔진 (검색 품질, 관계 추출 품질, Consolidation 점수) 3. Qualit…
- [ ] `bench_mem_002184`
  - source: `mem_1765802036775_yhtnpv3k2`
  - type: `episodic`
  - tags: `quality-assurance`, `consolidation-metrics`, `completed`
  - content: Quality Assurance 시스템 구현 작업 진행 중 완료된 작업: - 3.7 Consolidation 점수 품질 지표 수집기 구현 완료 - collectConsolidationMetrics 메서드에 실제 측정 로직 구현 - generateOrderPreservationRepor…
- [ ] `bench_mem_002180`
  - source: `mem_1765800740552_ug7mrpl68`
  - type: `episodic`
  - tags: `quality-assurance`, `search-metrics`, `completed`
  - content: Quality Assurance 시스템 구현 작업 진행 중 완료된 작업: - 3.1 검색 품질 지표 수집기 구현 완료 - collectSearchMetrics 메서드에 실제 측정 로직 구현 - Ground Truth 데이터를 옵션으로 받아 실제 측정 수행 - Precision@K, R…
- [ ] `bench_mem_001660`
  - source: `mem_1763196645051_41nlmw7uq`
  - type: `episodic`
  - tags: `prd`, `semantic-relations`, `improvement`, `feedback`, `completed`
  - content: PRD 개선 완료: 기억 간 의미적 관계 엔진 PRD에 사용자 피드백 반영 개선 사항: 1. MVP 범위 명확화 - Phase 1 (MVP)와 Phase 2 (확장 버전) 구분 2. 관계 유형 계층화 - Causal/Temporal/Structural/Semantic 계층 구조 추가 …
- [ ] `bench_mem_000286`
  - source: `mem_1758933645588_rsbt72xs2`
  - type: `episodic`
  - tags: `test`, `react`, `integration`
  - content: 통합 테스트용 기억입니다. React Hook에 대해 학습했습니다.
- [ ] `bench_mem_001354`
  - source: `mem_1762432272451_wj04iotfc`
  - type: `episodic`
  - tags: `documentation`, `cursor-mcp-setup`, `db-path`, `environment-variables`, `memento`
  - content: cursor-mcp-setup.ko.md 파일에 DB_PATH 환경 변수 설정을 추가했습니다. **작업 내용:** - 방법 1 (로컬 경로): Windows/Linux 예시에 DB_PATH 추가 - 방법 2 (npx): DB_PATH 설정 및 참고 사항 추가 - 방법 3 (전역 설치)…
- [ ] `bench_mem_001362`
  - source: `mem_1762437748953_kp3gknzgc`
  - type: `episodic`
  - tags: `tasks`, `vector-search`, `memory-neighbors`, `subtasks`
  - content: 벡터 기반 기억 이웃 탐색 태스크 리스트 서브 태스크 생성 완료 (Phase 2) 5개 상위 태스크를 총 45개의 세부 서브 태스크로 분해: 1. Memory Neighbor Service 구현 (10개 서브 태스크) - 서비스 클래스 생성, 메모리 ID 검증, 임베딩 조회, 벡터 검…
- [ ] `bench_mem_001330`
  - source: `mem_1761740023465_wqlps67f2`
  - type: `working`
  - tags: `magic-formula`, `task-list`, `implementation`
  - content: Magic Formula 투자 전략 구현을 위한 태스크 리스트의 상위 레벨을 생성했습니다. Classic Value Investing 패턴을 따라 5개의 주요 태스크로 구성했습니다: DTO 정의, 팩터 계산 서비스, 랭킹 알고리즘, 모듈 통합, 테스트 및 문서화. 사용자 확인을 기다리…
- [ ] `bench_mem_002595`
  - source: `mem_1768626753233_uzcrqcyce`
  - type: `episodic`
  - tags: `phase-1`, `task-1.6`, `triple-extraction`, `interface-definition`
  - content: Phase 1.0 작업 진행 상황 - 작업 1.6 완료 **완료된 작업**: - 1.6: TripleExtractionService 분리를 위한 인터페이스 정의 및 테스트 작성 완료 - ITripleExtractor 인터페이스 정의 (extract 메서드) - ITripleParser…
- [ ] `bench_mem_000922`
  - source: `mem_1f05389cc120461ea23ee0f6bb7d2214`
  - type: `semantic`
  - tags: `code-metadata`, `extractClassNames`
  - content: {"methodName":"extractClassNames","parameters":[{"name":"ast","type":"any"}],"returnType":"string[]","filePath":"src/services/code-metadata.service.ts","startL…
- [ ] `bench_mem_002589`
  - source: `mem_1768574394583_whd1n95nr`
  - type: `episodic`
  - tags: `completed`, `task-completion`, `memento`, `process-task-list`, `documentation`, `error-handling`
  - content: 작업 완료: process-task-list.md에 작업 중 기억 저장 기능 추가 - 완료된 작업: 1. 작업 중 기억 저장 프로토콜 추가 2. 에러 발생 시 즉시 저장 가이드 추가 3. 실패한 시도 기록 및 교훈 저장 가이드 추가 4. 해결 방법 발견 시 저장 가이드 추가 5. AI…
- [ ] `bench_mem_002541`
  - source: `mem_1768190754842_7gskoq55e`
  - type: `episodic`
  - tags: `model-manager`, `prepare`, `pattern-analysis`
  - content: 5.0.1 작업 완료: 기존 모델 관리 패턴 확인. ollama_installer.py의 패턴을 참고하여 model_manager.py를 구현할 예정. 주요 패턴: subprocess 사용, 타임아웃 설정, 에러 처리, click 사용. ollama_client.py에서 모델은 초기화…
- [ ] `bench_mem_002579`
  - source: `mem_1768573104866_c9tvapp9l`
  - type: `episodic`
  - tags: `branch-creation`, `code-improvement`, `refactoring`
  - content: 종합 코드 개선 작업(0023)을 위한 브랜치를 생성했습니다. 브랜치명: feature/0023-comprehensive-code-improvement. 이 작업은 클린코드 철학 기반으로 대형 파일 분리, 긴 함수 분리, 타입 안정성 강화, 전역 변수 제거, MCP 도구 노출 정책 정…
- [ ] `bench_mem_001487`
  - source: `mem_1762665968622_1oaz5nlu3`
  - type: `episodic`
  - tags: `anchor-system`, `search-local`, `n-hop`, `task-3.4`, `completed`
  - content: 앵커 시스템 작업 3.4 완료: N-hop 검색 확장 구현. searchNHop 메서드 추가, 반복적 hop 계산, 중복 방지(Set 사용), 각 hop 레벨별 임베딩 조회, 유사도 및 hop 거리 기준 정렬 포함.

## Query q_003

- Query: `DB 마이그레이션 절차`
- Language: `ko`
- Category: `procedure`
- Notes: 마이그레이션 실행 순서
- Current relevant IDs: `bench_mem_003421`, `bench_mem_003437`

### Current Relevant Memories

- [x] `bench_mem_003421`
  - source: `mem_1773756350512_uihlqldua`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `database`, `migration`, `knowledge`
  - content: DB 초기화는 `npm run db:init -w @memento/core`, 마이그레이션은 `npm run db:migrate -w @memento/core`로 수행한다. 작업 전 `.env` 또는 `DB_PATH`로 SQLite 경로를 맞추고, 스키마 변경 시 마이그레이션 SQL과…
- [x] `bench_mem_003437`
  - source: `mem_1773828883144_ywp22pt39`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `database`, `migration`, `knowledge`
  - content: 질문: 데이터베이스 초기화와 마이그레이션은 어떻게 하나. 답: `npm run db:init -w @memento/core`로 초기화하고 `npm run db:migrate -w @memento/core`로 마이그레이션한다. DB 경로는 `.env` 또는 `DB_PATH`로 맞춘다.

### Candidate Memories

- [ ] `bench_mem_003081`
  - source: `mem_1771064758893_6wwszbqdl`
  - type: `semantic`
  - tags: `memento`, `database`, `schema`, `documentation`, `knowledge`
  - content: Memento 저장소 DB 설계 문서 존재 여부 확인 결과: 단일 "DB 설계 문서"라는 제목의 독립 문서는 없음. DB 설계/스키마 관련 내용은 다음에 분산되어 있음. (1) docs/en/Memento-M1-DetailSpecs.md §4 "Database Design (SQLit…
- [ ] `bench_mem_003275`
  - source: `mem_1772543241796_ct6rskphh`
  - type: `episodic`
  - tags: `ci`, `scripts`, `check-retry-usage`, `archive`, `fix`
  - content: CI에서 check-retry-usage.ts 실행 시 ERR_MODULE_NOT_FOUND 해결: 스크립트가 scripts/archive/check-retry-usage.ts로 이동된 상태에서 .github/workflows/ci.yml이 scripts/check-retry-usag…
- [ ] `bench_mem_003205`
  - source: `mem_1772293742823_6ao982tbl`
  - type: `episodic`
  - tags: `memento`, `developer-continuity-assistant`, `phase1`, `task4`, `completed`
  - content: Developer Continuity Assistant Phase 1 Task 4 완료: AssistantClient(assistantServerUrl, fetch 기반 POST /assistant/tools/:name), startSession/saveContext/endSessio…
- [ ] `bench_mem_001313`
  - source: `mem_1761556918409_n2y079ln9`
  - type: `procedural`
  - tags: `finnaut`, `recommendation`, `api`, `backend`
  - content: Finnaut 프로젝트의 Task 4.1 완료: RecommendationController와 라우트 설계, RecommendationQueryDTO, FactorAnalysisQueryDTO, RecommendationService 구현 완료. 백엔드 API 엔드포인트 구조 구축.
- [ ] `bench_mem_001303`
  - source: `mem_1761450976193_lqob6t234`
  - type: `procedural`
  - tags: `finnaut`, `m2-core-features`, `app-module`, `module-registration`, `task-1-4`
  - content: Finnaut 프로젝트 M2 코어 기능 개발 - 서브태스크 1.4 완료 완료된 작업: 1. app.module.ts에 신규 모듈 등록 - StrategyModule import 및 등록 - RankingModule import 및 등록 - RecommendationModule impo…
- [ ] `bench_mem_001373`
  - source: `mem_1762439226915_xw732bjrt`
  - type: `episodic`
  - tags: `implementation`, `memory-neighbors`, `task-2.1`
  - content: 태스크 2.1 완료: get-memory-neighbors-tool.ts 파일 생성 구현 내용: - GetMemoryNeighborsTool 클래스 생성 (BaseTool 상속) - 기본 파일 구조 및 클래스 정의 - 다음 태스크에서 Zod 스키마 및 inputSchema 구현 예정 …
- [ ] `bench_mem_000489`
  - source: `mem_1759231389887_gharil4xl`
  - type: `episodic`
  - tags: `storyloom`, `testing`, `duplicate-elements`, `completed`, `2025-09-28`
  - content: Storyloom 프로젝트 중복 요소 테스트 문제 해결 완료 (2025년 9월 28일) ## 완료된 작업 **중복 요소 문제 해결**: StoryCard 테스트에서 "21개월 전" 텍스트가 두 곳에 나타나는 문제를 성공적으로 해결했습니다. ### 문제 원인 - StoryCard 컴포넌…
- [ ] `bench_mem_002060`
  - source: `mem_1765284034980_8ja858by8`
  - type: `episodic`
  - tags: `recall-tool`, `test`, `metadata`, `anchor-disabled`, `task-0012`
  - content: recall 도구의 앵커 설정 비활성화 시 메타데이터 테스트 작성 완료. auto_set_anchor=false로 recall을 호출하면 metadata.anchor_set=null이고, anchor_set_error/anchor_set_skipped가 없는지 확인하는 테스트를 추가함.
- [ ] `bench_mem_000522`
  - source: `mem_1759326127732_hitrbn6m7`
  - type: `episodic`
  - tags: `github-actions`, `자동-브랜치`, `현재-브랜치`, `워크플로우-수정`
  - content: 사용자가 자동으로 현재 브랜치가 선택되도록 하고 싶어해서 GitHub Actions와 README.md를 수정했습니다. 주요 변경사항: 1. GitHub Actions: feature/auto-build, develop 브랜치도 트리거하도록 수정 2. GitHub Actions: ${…
- [ ] `bench_mem_001996`
  - source: `mem_1765196843240_rpsw2d8aj`
  - type: `procedural`
  - tags: (none)
  - content: Reflexion: recall 실패 기록
- [ ] `bench_mem_000542`
  - source: `mem_1759537605029_gx51o6rsu`
  - type: `episodic`
  - tags: `memento`, `integration-test`, `hybrid-approach`, `100%`, `success`, `m1`
  - content: Memento M1 통합 테스트 수정 프로젝트 완료 - 합의안의 하이브리드 접근법으로 100% 통과율 달성 **최종 성과:** - 테스트 통과율: 18/18 (100%) - 실행 시간: 85ms - 에러: 0개 **해결된 주요 문제들:** 1. 스키마 불일치 (memory_item_t…

## Query q_004

- Query: `임베딩 모델 설정`
- Language: `ko`
- Category: `config`
- Notes: 벡터 검색 임베딩
- Current relevant IDs: `bench_mem_003438`

### Current Relevant Memories

- [x] `bench_mem_003438`
  - source: `mem_1773828883158_fofp9xipp`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `embedding`, `provider`, `knowledge`
  - content: 질문: OpenAI와 Gemini 임베딩 provider는 어떻게 다루나. 답: Memento는 OpenAI와 Gemini 같은 임베딩 provider를 병렬 검색하고 결과를 정규화해 합칠 수 있다. 필요하면 `provider_filter`로 특정 provider만 검색한다.

### Candidate Memories

- [ ] `bench_mem_000557`
  - source: `mem_1759584405821_pbrq78vfs`
  - type: `episodic`
  - tags: `memento`, `embedding-service`, `refactoring`, `completion`, `clean-code`, `tdd`
  - content: Memento 임베딩 서비스 리팩토링 프로젝트 완료 상황 ## 🎯 프로젝트 개요 - **목표**: TF-IDF, MiniLM, OpenAI, Gemini 4가지 임베딩 제공자를 지원하는 통합 시스템 구축 - **브랜치**: feature/embedding-service-refacto…
- [ ] `bench_mem_001292`
  - source: `mem_1761355198569_8ewpf4h9j`
  - type: `procedural`
  - tags: `cursor-rules`, `memento`, `workflow`, `automation`, `memory-management`
  - content: Cursor Rules 생성 완료 - Memento MCP 기반 작업 워크플로우 규칙을 .cursor/rules/memento-workflow.mdc 파일에 작성. alwaysApply: true로 설정하여 모든 요청에 자동 적용되도록 함. 작업 시작 전 기억 검색, 작업 중간 진행상…
- [ ] `bench_mem_001284`
  - source: `mem_9d8b908ecc094bf6b03ece9dbf15843c`
  - type: `semantic`
  - tags: `code-metadata`, `getStopWords`
  - content: {"methodName":"getStopWords","parameters":[{"name":"language","type":"string"}],"returnType":"string[]","filePath":"src/utils/stopwords.ts","startLine":320,"en…
- [ ] `bench_mem_002998`
  - source: `mem_1770252818470_hold4jwve`
  - type: `semantic`
  - tags: `best-practice`, `knowledge`, `testing`, `flaky-tests`
  - content: 통합/성능 테스트 플래키 방지: CI·로컬 환경 변동으로 인한 실패를 줄이려면 (1) 절대 시간 임계값(예: 10ms)은 여유 있게(예: 15ms) 설정하거나, (2) 상대 비교(배치 vs 개별, 캐시 미스 vs 히트)는 multiplier를 완화(예: 1.5배→3배·7배)하거나 Ma…
- [ ] `bench_mem_002982`
  - source: `mem_1770245515117_qwur0djkr`
  - type: `semantic`
  - tags: `best-practice`, `knowledge`, `memento`, `recall`, `procedural`, `version-management`
  - content: Memento recall 툴에 버전 관련 옵션을 넣을 때: version_filter는 검색 결과 후처리로 적용하는 것이 구현이 단순함(latest_only=시리즈당 version 최대 1건, specific_version=version_series_id+version_number …
- [ ] `bench_mem_002922`
  - source: `mem_1769815525314_s1pbdrn1i`
  - type: `semantic`
  - tags: (none)
  - content: 주요 주는 nm, wy, co, ut, nd 등 27개 주를 범위합니다
- [ ] `bench_mem_002070`
  - source: `mem_1765370467600_2gl5o7f1r`
  - type: `episodic`
  - tags: `arigraph`, `pipeline`, `prd`, `refinement`, `implementation-details`
  - content: AriGraph 파이프라인 PRD 문서를 사용자의 세부 조정 제안을 반영하여 더욱 구체화했습니다. 주요 개선사항: Triple Similarity 계산 기준 구체화 (predicate 정확 일치, subject/object 정규화+유사도), TripleExtractionService …
- [ ] `bench_mem_002918`
  - source: `mem_1769815525295_50fn3hcwf`
  - type: `semantic`
  - tags: (none)
  - content: 데이터 import는 postgresql postgres 데이터베이스를 완료합니다
- [ ] `bench_mem_000102`
  - source: `mem_1758600241691_xhhmljwld`
  - type: `semantic`
  - tags: `performance`, `test`, `batch-3`
  - content: 성능 테스트 메모리 19: 다양한 타입의 메모리를 생성하여 성능을 측정합니다.
- [ ] `bench_mem_000138`
  - source: `mem_1758600550064_rxey5nbuq`
  - type: `episodic`
  - tags: `duplicate`, `similar`
  - content: 중복된 내용: 이미 저장된 내용과 유사한 정보입니다.
- [ ] `bench_mem_001407`
  - source: `mem_1762530122615_ysflzbinm`
  - type: `episodic`
  - tags: `task-1.3`, `type-system`, `npm-client`, `memorytype`
  - content: 작업 1.3 완료: src/npm-client/types.ts에서 MemoryType을 6개 값으로 확장 ('core', 'vault' 추가). 타입 체크 통과를 위해 src/npm-client/utils.ts의 getDefaultSettingsForType과 memoriesToMar…

## Query q_005

- Query: `Memento MCP 서버는 어떻게 실행하나`
- Language: `ko`
- Category: `operations`
- Notes: 개발/운영 실행
- Current relevant IDs: `bench_mem_003419`, `bench_mem_003427`

### Current Relevant Memories

- [x] `bench_mem_003419`
  - source: `mem_1773756350404_ymgndx40d`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `server-run`, `knowledge`
  - content: Memento MCP 서버 실행 기본 명령은 루트 기준 `npm run dev`, `npm start`이며 HTTP 서버는 `npm run dev:http`를 사용한다. 서버 진입점은 `packages/memento-server`이고 빌드 …
- [x] `bench_mem_003427`
  - source: `mem_1773828882873_k1pazm4ot`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `server-run`, `knowledge`
  - content: 질문: Memento MCP 서버는 어떻게 실행하나. 답: 루트에서 `npm run dev`로 MCP 개발 서버를 실행하고, `npm start`로 빌드된 서버를 실행한다. HTTP 서버가 필요하면 `npm run dev:http`를 사용한…

### Candidate Memories

- [ ] `bench_mem_003427`
  - source: `mem_1773828882873_k1pazm4ot`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `server-run`, `knowledge`
  - content: 질문: Memento MCP 서버는 어떻게 실행하나. 답: 루트에서 `npm run dev`로 MCP 개발 서버를 실행하고, `npm start`로 빌드된 서버를 실행한다. HTTP 서버가 필요하면 `npm run dev:http`를 사용한…
- [ ] `bench_mem_002566`
  - source: `mem_1768229269763_paydkstjl`
  - type: `episodic`
  - tags: `bugfix`, `import-error`, `cli`
  - content: blogbot cli.py에서 `_generate_slug_from_title` 함수가 `re` 모듈을 사용하지만 모듈 레벨에서 import되지 않아 NameError가 발생했습니다. 파일 상단에 `import re`를 추가하여 해결했습니다.
- [ ] `bench_mem_001249`
  - source: `mem_e31cbb29638243439d7d59912b77dc83`
  - type: `semantic`
  - tags: `code-metadata`, `getConnection`
  - content: {"methodName":"getConnection","parameters":[{"name":"connectionId","type":"string"}],"returnType":"DatabaseConnection | null","filePath":"src/utils/database.ts…
- [ ] `bench_mem_001255`
  - source: `mem_6791eb7b3f874734a900eae625da8d15`
  - type: `semantic`
  - tags: `code-metadata`, `log`
  - content: {"methodName":"log","parameters":[{"name":"level","type":"LogLevel"},{"name":"message","type":"string"},{"name":"metadata","type":"any"},{"name":"error","type"…
- [ ] `bench_mem_001265`
  - source: `mem_1cb790f5e642466db198ff7866d563c4`
  - type: `semantic`
  - tags: `code-metadata`, `setContext`
  - content: {"methodName":"setContext","parameters":[{"name":"context","type":"string"}],"returnType":"void","filePath":"src/utils/logger.ts","startLine":351,"endLine":353…
- [ ] `bench_mem_001225`
  - source: `mem_17c86b0852584ea1a5b568445237b743`
  - type: `semantic`
  - tags: `code-metadata`, `extractMethods`
  - content: {"methodName":"extractMethods","parameters":[{"name":"code","type":"string"}],"returnType":"any[]","filePath":"src/tools/recommend-code-tool.ts","startLine":20…
- [ ] `bench_mem_001231`
  - source: `mem_687c96a1080643c8b9d5ac25a493a1a3`
  - type: `semantic`
  - tags: `code-metadata`, `extractImports`
  - content: {"methodName":"extractImports","parameters":[{"name":"code","type":"string"}],"returnType":"string[]","filePath":"src/tools/recommend-code-tool.ts","startLine"…
- [ ] `bench_mem_001295`
  - source: `mem_1761381220418_dae120j56`
  - type: `working`
  - tags: `테스트`, `jest`, `nestjs`, `수정완료`
  - content: 테스트 실패 문제 해결 진행상황: 1. ✅ 누락된 상수 파일들 생성 (api.constants.ts, collection.constants.ts, common.types.ts) 2. ✅ DateUtil 테스트 수정 (시간대 처리, 날짜 파싱 검증, 날짜 차이 계산) 3. ✅ Strin…
- [ ] `bench_mem_003327`
  - source: `mem_1772929395774_g5365nmlt`
  - type: `episodic`
  - tags: `memento`, `monorepo`, `implementation-plan`, `thin-server`, `verification`, `completed`
  - content: feature/monorepo-memento-core 브랜치 검증 완료: docs/plans/ko/2026-03-04-monorepo-memento-core-implementation-plan.md와 docs/plans/ko/2026-03-04-monorepo-phase3-thin-s…
- [ ] `bench_mem_002360`
  - source: `mem_1766815932016_gsgdpagau`
  - type: `episodic`
  - tags: `security`, `path-traversal`, `task-0019`, `green-phase`, `completed`
  - content: 작업 3.2 완료: Path Traversal 방지 유틸리티 구현 (GREEN 단계) 완료. path-validator.ts 파일을 생성하여 validateFilePath()와 sanitizeFileName() 메서드를 구현했습니다. Path Traversal 패턴(../, ..\\,…
- [ ] `bench_mem_003357`
  - source: `mem_1773303586258_2w11d4d3g`
  - type: `semantic`
  - tags: `memento`, `cli-for-ai`, `implementation-plan`, `tasks`, `atomic`, `one-at-a-time`, `completed`
  - content: Memento CLI for AI 구현 계획서 TASKS를 "한 번에 하나씩(One at a time)" 원자 단위로 재작성함. 변경: (1) TASK-03을 bin 등록만, TASK-04를 tsconfig cli 포함만으로 분리. (2) TASK-04(구)를 TASK-05 creat…

## Query q_006

- Query: `기억은 어떻게 삭제되거나 자동으로 망각되나`
- Language: `ko`
- Category: `forgetting`
- Notes: forget TTL
- Current relevant IDs: `bench_mem_003428`

### Current Relevant Memories

- [x] `bench_mem_003428`
  - source: `mem_1773828882892_8t8wt0x20`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `forgetting`, `knowledge`
  - content: 질문: 기억은 어떻게 삭제되거나 자동으로 망각되나. 답: `forget` 도구로 기억을 삭제할 수 있고, 기억은 TTL과 망각 정책에 따라 자동으로 약화되거나 정리될 수 있다. 프로젝트는 forgetting 도메인과 TTL 기반 정책을 포함한다.

### Candidate Memories

- [ ] `bench_mem_003428`
  - source: `mem_1773828882892_8t8wt0x20`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `forgetting`, `knowledge`
  - content: 질문: 기억은 어떻게 삭제되거나 자동으로 망각되나. 답: `forget` 도구로 기억을 삭제할 수 있고, 기억은 TTL과 망각 정책에 따라 자동으로 약화되거나 정리될 수 있다. 프로젝트는 forgetting 도메인과 TTL 기반 정책을 포함한다.
- [ ] `bench_mem_001699`
  - source: `mem_1763379280247_945y9mwht`
  - type: `episodic`
  - tags: `ghost-archive`, `sqlite`, `database`, `completed`
  - content: Ghost Archive 기능 구현 작업 시작. 서브 태스크 1.1 완료: SQLite 데이터베이스 초기화 유틸리티 생성 (src/utils/db.ts). 서버리스 환경 호환성을 고려하여 sql.js를 선택하고, 환경변수 SQLITE_DB_PATH 지원 (기본값: /tmp/note24…
- [ ] `bench_mem_000705`
  - source: `mem_04cb238c136641d7bc614e535903a3de`
  - type: `semantic`
  - tags: `code-metadata`, `initializeProviders`
  - content: {"methodName":"initializeProviders","parameters":[],"returnType":"void","filePath":"src/services/embedding-provider-factory.ts","startLine":51,"endLine":56,"de…
- [ ] `bench_mem_002459`
  - source: `mem_1767879400996_pemnxhcxn`
  - type: `episodic`
  - tags: `meta-memory`, `statistics`, `service`, `testing`, `completed`
  - content: Meta-Memory(1) 작업 3.1 완료: recordRecall 메서드 단위 테스트 작성 완료된 작업: - 3.1 [RED]: recordRecall 메서드 단위 테스트 작성 완료 구현 내용: 1. 테스트 파일 생성: - src/services/meta-memory-service…
- [ ] `bench_mem_002421`
  - source: `mem_1767151825335_pmngauz2e`
  - type: `episodic`
  - tags: `completed`, `logging`, `domains`, `refactoring`
  - content: 1.7.2 작업 완료: src/domains/ 디렉토리의 핵심 서비스 파일에서 console.log를 MCP Logger로 전환 - 총 16개 파일 전환 완료 (약 62개 console.* → 0개) - 전환된 파일 목록: 1. memory-neighbor-service.ts (9개)…
- [ ] `bench_mem_000137`
  - source: `mem_1758600549549_8j3tltcc2`
  - type: `procedural`
  - tags: `procedure`, `old`, `method`
  - content: 오래된 프로시저: 특정 작업을 수행하는 방법을 기록했습니다.
- [ ] `bench_mem_000157`
  - source: `mem_1758805572223_seojmf0or`
  - type: `semantic`
  - tags: `typescript`, `types`, `programming`
  - content: TypeScript의 타입 시스템에 대해 설명했다. 인터페이스와 타입 별칭의 차이점을 다뤘다.
- [ ] `bench_mem_000147`
  - source: `mem_1758721845564_dkjjdo68z`
  - type: `episodic`
  - tags: `bridge`, `ca-milestone`, `completed`, `update`, `status`
  - content: Bridge 프로젝트 CA 마일스톤 완료 상태 업데이트 (2025-01-21) ## CA 마일스톤 완료 확인 CA 마일스톤 3.3 & 3.4가 성공적으로 완료되었습니다. ### ✅ 완료된 기능들 1. **데이터 품질 관리 시스템 (3.3)**: - 종합 품질 메트릭 (6가지 차원) -…
- [ ] `bench_mem_002541`
  - source: `mem_1768190754842_7gskoq55e`
  - type: `episodic`
  - tags: `model-manager`, `prepare`, `pattern-analysis`
  - content: 5.0.1 작업 완료: 기존 모델 관리 패턴 확인. ollama_installer.py의 패턴을 참고하여 model_manager.py를 구현할 예정. 주요 패턴: subprocess 사용, 타임아웃 설정, 에러 처리, click 사용. ollama_client.py에서 모델은 초기화…
- [ ] `bench_mem_000084`
  - source: `mem_1758600241657_v359gsgpd`
  - type: `semantic`
  - tags: `performance`, `test`, `batch-0`
  - content: 성능 테스트 메모리 1: 다양한 타입의 메모리를 생성하여 성능을 측정합니다.
- [ ] `bench_mem_000092`
  - source: `mem_1758600241672_t4sffp5gs`
  - type: `semantic`
  - tags: `performance`, `test`, `batch-1`
  - content: 성능 테스트 메모리 9: 다양한 타입의 메모리를 생성하여 성능을 측정합니다.

## Query q_007

- Query: `앵커를 설정하면 검색 범위가 어떻게 달라지나`
- Language: `ko`
- Category: `search`
- Notes: search_local
- Current relevant IDs: `bench_mem_003429`

### Current Relevant Memories

- [x] `bench_mem_003429`
  - source: `mem_1773828882988_ex9nn48em`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `anchor`, `search-local`, `knowledge`
  - content: 질문: 앵커를 설정하면 검색 범위가 어떻게 달라지나. 답: anchor를 설정하면 그 기억을 기준으로 국소 검색을 수행할 수 있고, `search_local`은 anchor 주변 기억을 우선 탐색한다. pin과는 달리 anchor는 현재 컨텍스트의 검색 기준점을 만든다.

### Candidate Memories

- [ ] `bench_mem_003429`
  - source: `mem_1773828882988_ex9nn48em`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `anchor`, `search-local`, `knowledge`
  - content: 질문: 앵커를 설정하면 검색 범위가 어떻게 달라지나. 답: anchor를 설정하면 그 기억을 기준으로 국소 검색을 수행할 수 있고, `search_local`은 anchor 주변 기억을 우선 탐색한다. pin과는 달리 anchor는 현재 컨텍스트의 검색 기준점을 만든다.
- [ ] `bench_mem_002866`
  - source: `mem_1769472725010_0nih4398a`
  - type: `semantic`
  - tags: (none)
  - content: services/ 디렉토리는 모든 서비스 파일들이 완전히 구현됨를 구현됨합니다
- [ ] `bench_mem_002854`
  - source: `mem_1769458317609_xd5d2znf2`
  - type: `semantic`
  - tags: (none)
  - content: ca 마일스톤는 3.3 & 3.4를 완료됨합니다
- [ ] `bench_mem_002814`
  - source: `mem_1769260388371_2o68hpz20`
  - type: `episodic`
  - tags: `completed`, `git`, `commit`, `triple-extraction`
  - content: 커밋 완료: "fix: stabilize triple extraction initialization flow". 변경 7개 파일(remember-tool, convert-episodic-to-semantic-tool, relation extractor, triple-extraction…
- [ ] `bench_mem_002806`
  - source: `mem_1769237966392_nd59zyhfi`
  - type: `episodic`
  - tags: `test-fix`, `llm-provider`, `isAvailable`, `fallback`
  - content: LLMBasedRelationExtractor.isAvailable() 메서드 수정 및 테스트 업데이트 완료 문제: 1. isAvailable() 메서드가 preferredProvider가 null일 때 무조건 false를 반환하여 fallback이 작동하지 않음 2. 테스트들이 in…
- [ ] `bench_mem_003434`
  - source: `mem_1773828883091_3n3l2rh28`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `remember`, `knowledge`
  - content: 질문: remember 도구로 어떤 기억을 저장할 수 있나. 답: remember 도구는 `working`, `episodic`, `semantic`, `procedural` 기억을 저장할 수 있다. content와 importance 같은 기본 필드 외에도 procedural용 `t…
- [ ] `bench_mem_003402`
  - source: `mem_1773743224235_wniimx8w6`
  - type: `semantic`
  - tags: `search-quality`, `ground-truth`, `evaluation`, `best-practice`, `ci`, `retrieval`
  - content: Memento의 검색 품질 평가 체계는 IR 지표(precision/recall/nDCG/MRR)와 임계값, 배치 측정 경로를 갖추고 있어 모니터링 프레임워크로는 유용하지만, 자동 생성 Ground Truth(generateGroundTruth)가 memoryIds에서 random/f…
- [ ] `bench_mem_002111`
  - source: `mem_1765459734750_zb6w789o3`
  - type: `episodic`
  - tags: `arigraph`, `semantic-memory`, `triple-extraction`, `episodic-edge`, `testing`, `completed`
  - content: AriGraph Pipeline 구현 작업 진행: 4.10 관계 중복 방지 단위 테스트 작성 완료 작업 내용: - semantic-memory-update-service.spec.ts에 관계 중복 방지 테스트 추가 - Given/When/Then 패턴을 따르는 단위 테스트 작성 주요 …
- [ ] `bench_mem_001899`
  - source: `mem_1764984695027_jdkp9r65t`
  - type: `episodic`
  - tags: `procedural-memory`, `task-generation`, `prd`
  - content: Procedural Memory Enhancement PRD 기반 작업 목록 생성 완료. 상위 레벨 작업 5개 생성: 1) 데이터베이스 스키마 확장, 2) remember Tool 확장, 3) recall Tool 확장, 4) Reflexion 자동 연동, 5) 검색 기능 강화. 파일…
- [ ] `bench_mem_000560`
  - source: `mem_1759628743499_xmprqt3fy`
  - type: `episodic`
  - tags: `memento`, `embedding`, `vec0`, `provider-specific`, `implementation`, `success`
  - content: Memento 프로젝트에서 제공자별 vec0 테이블 구현을 완료했습니다. **주요 성과:** - 제공자별 vec0 테이블 구현: memory_item_vec_tfidf (512차원), memory_item_vec_minilm (384차원), memory_item_vec_openai (…
- [ ] `bench_mem_002865`
  - source: `mem_1769472725009_vm2nnndja`
  - type: `semantic`
  - tags: (none)
  - content: memento 프로젝트는 2025-01-21를 코드베이스 조사 완료합니다

## Query q_009

- Query: `이 저장소에서 테스트와 CI는 어떻게 돌리나`
- Language: `ko`
- Category: `testing`
- Notes: vitest npm test
- Current relevant IDs: `bench_mem_003420`, `bench_mem_003430`

### Current Relevant Memories

- [x] `bench_mem_003420`
  - source: `mem_1773756350423_ls7517np0`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `testing`, `ci`, `knowledge`
  - content: 이 저장소는 Vitest 기반이며 루트에서 `npm test`, `npm run type-check`, `npm run lint`를 사용한다. 시나리오 테스트는 `src/test` 아래 `test-*.ts`에 있고, 검색 품질 벤치마크는 `test:vector-search-qualit…
- [x] `bench_mem_003430`
  - source: `mem_1773828883065_ghgs1kwae`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `testing`, `ci`, `knowledge`
  - content: 질문: 이 저장소에서 테스트와 CI는 어떻게 돌리나. 답: 루트에서 `npm test`, `npm run type-check`, `npm run lint`를 실행한다. 검색 품질 벤치마크는 `npm run test:vector-search-quality`로 실행한다.

### Candidate Memories

- [ ] `bench_mem_003430`
  - source: `mem_1773828883065_ghgs1kwae`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `testing`, `ci`, `knowledge`
  - content: 질문: 이 저장소에서 테스트와 CI는 어떻게 돌리나. 답: 루트에서 `npm test`, `npm run type-check`, `npm run lint`를 실행한다. 검색 품질 벤치마크는 `npm run test:vector-search-quality`로 실행한다.
- [ ] `bench_mem_000941`
  - source: `mem_f005277613b846b4b9932ad9f0a4e0bf`
  - type: `semantic`
  - tags: `code-metadata`, `extractFunctionNames`
  - content: {"methodName":"extractFunctionNames","parameters":[{"name":"ast","type":"any"}],"returnType":"string[]","filePath":"src/services/code-metadata.service.ts","sta…
- [ ] `bench_mem_002737`
  - source: `mem_1769083487084_ruvyjapjj`
  - type: `episodic`
  - tags: `code-review`, `refactoring`, `memory-evolution-demo`, `completed`
  - content: 코드 리뷰 개선 사항 반영 작업을 완료했습니다. 완료된 작업: 1. ConsolidationView.tsx와 ForgettingChart.tsx에서 timelinePoints 하드코딩을 MAJOR_TIMELINE_POINTS로 대체 (코드 중복 제거) 2. timeline-utils.…
- [ ] `bench_mem_002049`
  - source: `mem_1765282577628_fqzj8ll9g`
  - type: `episodic`
  - tags: `recall-tool`, `test`, `timeout`, `task-0012`
  - content: recall 도구의 이웃 기억 조회 개별 타임아웃 테스트 작성 완료. 느린 이웃 기억 조회(2초 이상)가 있을 때 include_neighbors=true로 호출하면 개별 조회 타임아웃(2초) 내에 응답이 반환되고, 타임아웃된 항목은 빈 배열로 반환되는지 확인하는 테스트를 추가했으며,…
- [ ] `bench_mem_000829`
  - source: `mem_3025a847894d4276adacea71063d1669`
  - type: `semantic`
  - tags: `code-metadata`, `updateReviewSchedule`
  - content: {"methodName":"updateReviewSchedule","parameters":[{"name":"db","type":"any"},{"name":"schedule","type":"ReviewSchedule"}],"returnType":"Promise<void>","filePa…
- [ ] `bench_mem_000551`
  - source: `mem_1759563621881_3s2e60vmu`
  - type: `episodic`
  - tags: `testing`, `vector-search-engine`, `test-fixes`, `completed`
  - content: VectorSearchEngine 테스트 수정 완료! 31개 테스트 모두 통과. 주요 수정사항: 1) Mock 데이터베이스 대신 실제 메서드 모킹 방식으로 변경, 2) VSS vs VEC 속성명 불일치 수정, 3) VEC 가용성 확인 모킹 개선, 4) 에러 처리 테스트 로직 수정. 새…
- [ ] `bench_mem_001021`
  - source: `mem_8a115292fcfd4957b89b28d5f39648b9`
  - type: `semantic`
  - tags: `code-metadata`, `cacheKey`
  - content: {"methodName":"cacheKey","parameters":[{"name":"query","type":"string"},{"name":"filters","type":"MemorySearchFilters | undefined"}],"returnType":"string","fil…
- [ ] `bench_mem_001035`
  - source: `mem_4765bc2eb0454d9da40c0cde4c8a42d4`
  - type: `semantic`
  - tags: `code-metadata`, `rebuildIndex`
  - content: {"methodName":"rebuildIndex","parameters":[{"name":"provider","type":"string"}],"returnType":"Promise<void>","filePath":"src/algorithms/vector-search-engine.ts…
- [ ] `bench_mem_000891`
  - source: `mem_f3236d7f3aad4b35a7dd43069e1b180f`
  - type: `semantic`
  - tags: `code-metadata`, `set`
  - content: {"methodName":"set","parameters":[{"name":"key","type":"string"},{"name":"data","type":"T"},{"name":"ttl","type":"number"}],"returnType":"void","filePath":"src…
- [ ] `bench_mem_002613`
  - source: `mem_1768632580523_wx8rcu0a6`
  - type: `semantic`
  - tags: `best-practice`, `knowledge`, `phase-2`, `refactoring`, `code-quality`, `verification`
  - content: Phase 2 작업 완료: combineAndSortResults() 메서드 분리 및 검증 - 작업 내용: 115줄의 combineAndSortResults() 메서드를 작은 함수들로 분리 - 분리된 메서드: 1. mergeResults() - 결과 병합 (15줄) 2. normali…
- [ ] `bench_mem_002643`
  - source: `mem_1768818897861_kvm99q7on`
  - type: `episodic`
  - tags: `github`, `issue-template`, `project-management`, `completed`
  - content: 프로젝트 포지셔닝 문서의 다음 액션 아이템을 바탕으로 3개의 GitHub 이슈 템플릿을 작성했습니다: 1) 기억 진화 데모 (즉시 실행), 2) 개발자용 AI 기억 백엔드 MVP (단기), 3) 개인 지식 축적 Agent (중기). 각 이슈는 사용자가 요청한 형식에 맞춰 상세히 작성되…

## Query q_010

- Query: `Reflexion 기록은 어떻게 남기나`
- Language: `ko`
- Category: `procedural`
- Notes: reflection_notes
- Current relevant IDs: `bench_mem_003431`

### Current Relevant Memories

- [x] `bench_mem_003431`
  - source: `mem_1773828883067_75k5ysv4r`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `reflexion`, `knowledge`
  - content: 질문: Reflexion 기록은 어떻게 남기나. 답: procedural 기억이나 관련 도구에 `reflection_notes`를 넣어 Reflexion 기록을 저장한다. reflection_notes는 recall 검색과 memory 검색 컨텍스트에서 함께 조회할 수 있다.

### Candidate Memories

- [ ] `bench_mem_003431`
  - source: `mem_1773828883067_75k5ysv4r`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `reflexion`, `knowledge`
  - content: 질문: Reflexion 기록은 어떻게 남기나. 답: procedural 기억이나 관련 도구에 `reflection_notes`를 넣어 Reflexion 기록을 저장한다. reflection_notes는 recall 검색과 memory 검색 컨텍스트에서 함께 조회할 수 있다.
- [ ] `bench_mem_001372`
  - source: `mem_1762439119925_n0g8dj0ax`
  - type: `episodic`
  - tags: `implementation`, `memory-neighbors`, `task-1.11`
  - content: 태스크 1.11 완료: 실시간 인접 기억 갱신 로직 구현 구현 내용: - updateNeighborsForNewMemory 메서드 구현 - 새 기억의 임베딩 조회 - VectorSearchEngine을 사용하여 기존 모든 기억과의 유사도 계산 - 유사도가 임계값(0.8) 이상인 기억들…
- [ ] `bench_mem_001216`
  - source: `mem_72a6817604ca4eec949ca19548e2572f`
  - type: `semantic`
  - tags: `code-metadata`, `cleanup`
  - content: {"methodName":"cleanup","parameters":[],"returnType":"Promise<void>","filePath":"src/tools/check-duplication-tool.ts","startLine":374,"endLine":382,"descriptio…
- [ ] `bench_mem_001260`
  - source: `mem_93ed17a9ba314fb9ae65804822cdeae3`
  - type: `semantic`
  - tags: `code-metadata`, `writeToFile`
  - content: {"methodName":"writeToFile","parameters":[{"name":"entry","type":"LogEntry"}],"returnType":"void","filePath":"src/utils/logger.ts","startLine":279,"endLine":28…
- [ ] `bench_mem_001276`
  - source: `mem_586267a8f04f4f3f9d28e545ea71cd5f`
  - type: `semantic`
  - tags: `code-metadata`, `tokenize`
  - content: {"methodName":"tokenize","parameters":[{"name":"text","type":"string"}],"returnType":"string[]","filePath":"src/utils/stopwords.ts","startLine":186,"endLine":1…
- [ ] `bench_mem_000333`
  - source: `mem_1758935739366_wtco3hko6`
  - type: `episodic`
  - tags: `performance`, `test`, `batch-3`
  - content: 성능 테스트용 기억 4: TypeScript와 React에 대한 학습 내용입니다.
- [ ] `bench_mem_000383`
  - source: `mem_1758936449780_ct470vk0w`
  - type: `episodic`
  - tags: `performance`, `test`, `batch-8`
  - content: 성능 테스트용 기억 9: TypeScript와 React에 대한 학습 내용입니다.
- [ ] `bench_mem_000393`
  - source: `mem_1758936582099_lg2pgmqpm`
  - type: `episodic`
  - tags: `performance`, `test`, `batch-7`
  - content: 성능 테스트용 기억 8: TypeScript와 React에 대한 학습 내용입니다.
- [ ] `bench_mem_002641`
  - source: `mem_1768818605954_ugnarbe3m`
  - type: `episodic`
  - tags: `project-positioning`, `strategy`, `documentation`, `completed`
  - content: Memento 프로젝트 포지셔닝 및 전략 문서 작성 완료. 프로젝트를 "Agent OS의 기억 계층"으로 정의하고, 두 가지 핵심 Use Case(개발자용 AI 기억 백엔드, 개인 지식 축적 Agent)를 정리했습니다. README.md 상단에 정체성 문장("Memento is a m…
- [ ] `bench_mem_002679`
  - source: `mem_1769007976652_0ors69ecl`
  - type: `episodic`
  - tags: `completed`, `task-completion`, `memory-evolution-demo`, `simulation-data`, `consolidation`
  - content: 작업 완료: 2.10 통합 과정 시각화용 데이터 생성 함수 구현 완료된 작업: - demo/src/data/simulation-data.ts에 generateConsolidationVisualizationData 함수 추가 - ConsolidationVisualizationInput …
- [ ] `bench_mem_000961`
  - source: `mem_1f76bfd041d14857a8d46596f5fd2fd1`
  - type: `semantic`
  - tags: `code-metadata`, `calculateDiversity`
  - content: {"methodName":"calculateDiversity","parameters":[{"name":"results","type":"any[]"}],"returnType":"number","filePath":"src/algorithms/search-ranking.ts","startL…

## Query q_011

- Query: `relation 추출 기능은 어떻게 검증하나`
- Language: `ko`
- Category: `relation`
- Notes: relation quality
- Current relevant IDs: `bench_mem_003432`

### Current Relevant Memories

- [x] `bench_mem_003432`
  - source: `mem_1773828883082_1jbye4v19`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `relation`, `knowledge`
  - content: 질문: relation 추출 기능은 어떻게 검증하나. 답: relation 추출 검증은 relation_type, memory_relation 저장, 방향 검증, 중복 방지, 테스트 데이터베이스 기반 검증으로 수행한다. relation 도메인과 triple extraction 결과를 …

### Candidate Memories

- [ ] `bench_mem_003432`
  - source: `mem_1773828883082_1jbye4v19`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `relation`, `knowledge`
  - content: 질문: relation 추출 기능은 어떻게 검증하나. 답: relation 추출 검증은 relation_type, memory_relation 저장, 방향 검증, 중복 방지, 테스트 데이터베이스 기반 검증으로 수행한다. relation 도메인과 triple extraction 결과를 …
- [ ] `bench_mem_003174`
  - source: `mem_1772210300451_tusdbp3f8`
  - type: `episodic`
  - tags: `memento`, `notion`, `technical-writer`, `작업정리`, `completed`
  - content: 2026-02-28 Memento 프로젝트 작업 정리 문서를 Technical Writer 스킬로 작성해 Notion PARA Note DB(노트 보기)에 등록함. 제목: "Memento 프로젝트 — 2026-02-28 작업 정리". 내용: 작업 개요, 수행한 작업(주제 브레인스토밍·…
- [ ] `bench_mem_000154`
  - source: `mem_1758804725844_8zwek2usl`
  - type: `episodic`
  - tags: `memento`, `code-analysis`, `mocking`, `implementation-status`, `2025-01-21`
  - content: Memento 프로젝트 코드베이스 모킹 코드 조사 완료 (2025-01-21) ## 조사 결과 요약 ### ✅ 실제로 구현된 코드들 1. **services/ 디렉토리**: 모든 서비스 파일들이 완전히 구현됨 - embedding-service.ts (196줄) - memory-emb…
- [ ] `bench_mem_000186`
  - source: `mem_1758896188480_wn5uvbwbd`
  - type: `semantic`
  - tags: `memory-tag`, `improvement-analysis`, `m1-milestone`, `priority`, `optimization`
  - content: memory_tag 테이블 개선 필요성 분석 완료: 현재 M1 단계에서는 개선하지 않는 것이 좋습니다. 이유: 1) M1은 개인용 MVP로 기본 기능에 집중해야 함, 2) 현재 태그 시스템이 정상 작동하고 성능 문제 없음, 3) 사용량이 많지 않아 과도한 최적화, 4) 더 중요한 우선…
- [ ] `bench_mem_002521`
  - source: `mem_1768133716397_oeoc3g0ka`
  - type: `semantic`
  - tags: `best-practice`, `pattern`, `knowledge`, `bug-fix`
  - content: 임베딩 및 시스템 안정성 문제 해결 패턴 ## 문제 해결 패턴 ### 레거시 스키마 호환성 - **패턴**: `PRAGMA table_info()`로 컬럼 존재 여부 확인 후 `ALTER TABLE ADD COLUMN` 사용 - **이유**: 기존 데이터를 보존하면서 새 컬럼 추가 필…
- [ ] `bench_mem_000850`
  - source: `mem_835cf269e63b4f79b11eb9f2dbb0d1e9`
  - type: `semantic`
  - tags: `code-metadata`, `runMonitoring`
  - content: {"methodName":"runMonitoring","parameters":[],"returnType":"Promise<BatchJobResult>","filePath":"src/services/batch-scheduler.ts","startLine":368,"endLine":430…
- [ ] `bench_mem_001559`
  - source: `mem_1762767229990_jvl4p0ruy`
  - type: `episodic`
  - tags: `tdd`, `testing`, `migration`, `dependency-validator`, `migration-detector`, `migration-logger`, `milestone-9`, `completed`
  - content: 9단계 데이터베이스 마이그레이션 테스트 완료: dependency-validator.spec.ts, migration-detector.spec.ts, migration-logger.spec.ts 테스트 작성 완료. dependency-validator는 validateAll, vali…
- [ ] `bench_mem_000223`
  - source: `mem_1758929339545_ezv0gayj6`
  - type: `episodic`
  - tags: `performance`, `test`, `batch-5`
  - content: 성능 테스트용 기억 6: TypeScript와 React에 대한 학습 내용입니다.
- [ ] `bench_mem_002284`
  - source: `mem_1766632380687_kkkaz0lre`
  - type: `episodic`
  - tags: `0017`, `completion`, `verification`, `completed`
  - content: 작업 0017 전체 완료 기준 검증 완료 - Lint 통과 ✅ - 타입 체크 통과 ✅ - 모든 테스트 통과 ✅ - 테스트 커버리지 80% 이상 ✅ - 파일 크기 검증 ✅ (핵심 파일 500줄 이하) - 타입 안정성 검증 ✅ (any 타입 약 8개, 목표 50개 이하 달성) - 로깅 일…
- [ ] `bench_mem_000233`
  - source: `mem_1758929881674_k9av62hup`
  - type: `episodic`
  - tags: `performance`, `test`, `batch-4`
  - content: 성능 테스트용 기억 5: TypeScript와 React에 대한 학습 내용입니다.
- [ ] `bench_mem_003107`
  - source: `mem_1771084273881_bncf8levg`
  - type: `episodic`
  - tags: `code-review`, `consolidation`, `multi-dimension`, `report`
  - content: 다차원 코드 리뷰 통합 보고서 작성 완료: security(High 2, Medium 4, Low 2), performance/architecture/testing(결과 없음), accessibility(결과 없음). 규칙: 동일 file:line+이슈 병합, 심각도 충돌 시 상위 적…

## Query q_012

- Query: `로그 및 모니터링`
- Language: `ko`
- Category: `operations`
- Notes: 로깅 설정
- Current relevant IDs: (none)

### Current Relevant Memories

- (none)

### Candidate Memories

- [ ] `bench_mem_002520`
  - source: `mem_1768133716389_4vm7ame05`
  - type: `episodic`
  - tags: `bug-fix`, `system-stability`, `embedding`, `vector-dimension`, `logging`, `quality-assurance`, `completed`
  - content: 임베딩 및 시스템 안정성 문제 해결 작업 완료 (2026-01-11) ## 해결된 문제들 ### Phase 1: 시스템 안정성 1. **DB 스키마 불일치 해결** - `ensureLegacySchema`에 embedding 컬럼 추가 로직 추가 - `migrate.ts`에서 레거시 …
- [ ] `bench_mem_001298`
  - source: `mem_1761446852488_bok3ilrpg`
  - type: `semantic`
  - tags: `finnaut`, `m1`, `milestone`, `progress`, `data-pipeline`, `backend`
  - content: Finnaut 프로젝트 M1 마일스톤 완료 상태 분석 ## 현재 진행 상황 (2025-10-26) ### ✅ 완료된 작업 (M1 목표 달성) 1. **데이터 수집 파이프라인 완성** - 일별 KIS API 수집 서비스 구현 완료 - 분기별 DART API 수집 서비스 구현 완료 - 배…
- [ ] `bench_mem_002132`
  - source: `mem_1765541205601_1egm4dhid`
  - type: `episodic`
  - tags: `arigraph`, `conflict-prevention`, `job-queue`, `max-concurrent-jobs`, `completed`
  - content: AriGraph Pipeline 구현 작업 진행: 6.10 기존 배치 작업과의 충돌 방지 로직 구현 완료 작업 내용: - 기존 배치 작업과의 충돌 방지 로직 문서화 및 확인 - maxConcurrentJobs 고려 및 독립적인 작업 큐 관리 확인 - PRD 6.2 요구사항 반영 주요 …
- [ ] `bench_mem_000144`
  - source: `mem_1758614671494_nyej08fza`
  - type: `episodic`
  - tags: `bridge`, `project-status`, `analytics`, `mcp`, `current-state`
  - content: Bridge 프로젝트 현재 상태 분석 (2025-01-21) ## 프로젝트 개요 Bridge는 Model Context Protocol(MCP) 기반의 데이터 통합 및 AI 오케스트레이션 시스템입니다. 다양한 데이터 소스(PostgreSQL, MongoDB, Elasticsearch …
- [ ] `bench_mem_002322`
  - source: `mem_1766667549892_zg2jzm46w`
  - type: `episodic`
  - tags: `task-0018`, `database-lock-monitor`, `tdd`, `completed`
  - content: 작업 2.9 완료: busy_timeout 초과 통계 추적 - TDD 방법론 적용 (RED-GREEN-REFACTOR) - busyCount 증가 로직 구현 (이미 작업 2.3, 2.4에서 구현됨) - busyEventTimes 배열로 busy_timeout 발생 시간 기록 - upd…
- [ ] `bench_mem_001312`
  - source: `mem_1761459623446_u2d4i6top`
  - type: `procedural`
  - tags: `finnaut`, `ranking-engine`, `unit-testing`, `edge-cases`, `error-handling`, `task-3-4`
  - content: 랭킹 엔진 단위 테스트 강화 작업 완료 (2024-01-15) **완료된 작업:** - 경계값·에러 케이스를 포함한 랭킹 엔진 단위 테스트 구성 강화 - 추가 경계값 테스트 케이스 작성 (극값, NaN, Infinity 처리) - 에러 케이스 테스트 강화 (네트워크 오류, 데이터베이스…
- [ ] `bench_mem_001686`
  - source: `mem_1763272286041_d8xaaf0rp`
  - type: `episodic`
  - tags: `prd`, `feedback`, `improvement`, `multi-provider`, `search`
  - content: 다중 임베딩 제공자 검색 PRD 피드백 반영 및 개선 완료 ## 개선 사항 반영 1. Goals에 "정확도 저하 최소화" 명시 추가 2. 병렬 검색 타임아웃 로직 명확화 (hard timeout 2초) 3. Result normalization에서 provider 간 차이 고려 명시 …
- [ ] `bench_mem_002787`
  - source: `mem_1769226496900_otblrbdkt`
  - type: `episodic`
  - tags: `completed`, `task-completion`, `triple-extractor`, `llm-provider-initialization`, `tdd-green`
  - content: 작업 4.6 완료: TripleExtractor의 determineProvider() 메서드 구현 완료 - 작업 내용: - initializedProviders 필드 추가 - initializeClients()에서 initializedProviders 설정 - determineProv…
- [ ] `bench_mem_002797`
  - source: `mem_1769230359601_jhev7g163`
  - type: `semantic`
  - tags: `best-practice`, `knowledge`, `refactoring`, `llm-provider`
  - content: LLM Provider 초기화 리팩토링 베스트 프랙티스 리팩토링 전략: 1. 중복 코드 제거: 중복된 JSDoc 주석 제거 2. 테스트 우선: 리팩토링 전후 테스트 실행하여 회귀 방지 3. 작은 변경: 큰 리팩토링보다 작은 개선 사항부터 시작 주의사항: - 각 서비스마다 약간씩 다른 …
- [ ] `bench_mem_002767`
  - source: `mem_1769170119335_d9iqfc40u`
  - type: `episodic`
  - tags: `completed`, `task-completion`, `llm-provider`, `tdd`, `green-phase`, `triple-extraction-service`
  - content: 작업 완료: LLM Provider 초기화 로직 개선 - 작업 2.2 GREEN 단계 완료 - 작업: initializeClients() 메서드에서 LLMClientInitializer.initialize()를 호출하도록 변경하여 테스트 통과 - 완료 내용: - `src/domains…
- [ ] `bench_mem_002025`
  - source: `mem_1765279450069_q81wdqtm3`
  - type: `episodic`
  - tags: `recall-tool`, `auto-anchor`, `implementation`, `task-0012`
  - content: recall 도구의 memory_item 검색 분기에서 auto_set_anchor가 true이고 검색 결과가 있을 때 handleAutoSetAnchor 호출 구현 완료. 파라미터 파싱에 auto_set_anchor, include_neighbors, neighbors_limit, …
- [ ] `bench_mem_002055`
  - source: `mem_1765283266070_ccrkx8tsa`
  - type: `episodic`
  - tags: `recall-tool`, `test`, `similarity-threshold`, `task-0012`
  - content: recall 도구의 neighbors_similarity_threshold 필터링 테스트 작성 완료. 유사도 0.7, 0.8, 0.9인 이웃 기억에 대해 neighbors_similarity_threshold=0.8으로 include_neighbors=true를 호출하면 0.8 이상의…
- [ ] `bench_mem_001177`
  - source: `mem_5abe488fc1e742a0b8ed6a8f0f0bde11`
  - type: `semantic`
  - tags: `code-metadata`, `buildFilters`
  - content: {"methodName":"buildFilters","parameters":[{"name":"args","type":"MemoryInjectionArgs"}],"returnType":"MemorySearchFilters","filePath":"src/tools/memory-inject…
- [ ] `bench_mem_002923`
  - source: `mem_1769815525315_i2opbevhn`
  - type: `semantic`
  - tags: (none)
  - content: 토지 분류는 federal, native american, mixed exploratory를 분류합니다
- [ ] `bench_mem_002933`
  - source: `mem_1769828827274_5y9w8kddr`
  - type: `semantic`
  - tags: `best-practice`, `knowledge`, `ma-cross`, `repository`
  - content: MA Cross(골든크로스) 도메인: 전일(기준일 직전 거래일) 도출은 리포지토리 한 곳에서 담당한다. MaCrossRepository.getPreviousTradeDate(baselineDate)는 fin_daily_prices에서 trade_date < baselineDate 조건…
- [ ] `bench_mem_001881`
  - source: `mem_1764505639478_xmn6iegxw`
  - type: `episodic`
  - tags: `test`, `fix`, `complete`, `final`, `success`
  - content: 테스트 실패 수정 작업 최종 완료 상태: 1. Import 경로 문제 완전히 해결 (0개 남음) 2. Anchor 관련 문제 완전히 해결 (의존성 주입 패턴 적용) 3. EmbeddingService gemini 관련 문제 해결 4. EmbeddingProviderFactory fal…
- [ ] `bench_mem_001719`
  - source: `mem_1763382305643_b6t12vxkn`
  - type: `episodic`
  - tags: `ghost-archive`, `api`, `filtering`, `pagination`, `completed`
  - content: 서브 태스크 4.1-4.4 완료: Archive API 엔드포인트 구현. src/app/api/archive/route.ts 파일 생성. SQLiteArchiveRepository에 findWithFilters 메서드 추가 (복합 필터링 및 페이지네이션 지원). GET /api/arc…

## Query q_013

- Query: `하이브리드 검색에서 점수는 어떻게 합쳐지나`
- Language: `ko`
- Category: `search`
- Notes: vector_weight text_weight
- Current relevant IDs: `bench_mem_003433`

### Current Relevant Memories

- [x] `bench_mem_003433`
  - source: `mem_1773828883090_n5cvj2e4q`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `hybrid-search`, `knowledge`
  - content: 질문: 하이브리드 검색에서 점수는 어떻게 합쳐지나. 답: 하이브리드 검색은 텍스트 검색 점수와 벡터 검색 점수를 결합해 최종 순위를 만든다. 구현에 따라 정규화, 재랭킹, provider별 점수 보정이 적용될 수 있다.

### Candidate Memories

- [ ] `bench_mem_003433`
  - source: `mem_1773828883090_n5cvj2e4q`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `hybrid-search`, `knowledge`
  - content: 질문: 하이브리드 검색에서 점수는 어떻게 합쳐지나. 답: 하이브리드 검색은 텍스트 검색 점수와 벡터 검색 점수를 결합해 최종 순위를 만든다. 구현에 따라 정규화, 재랭킹, provider별 점수 보정이 적용될 수 있다.
- [ ] `bench_mem_002092`
  - source: `mem_1765400472857_sfkse490e`
  - type: `episodic`
  - tags: `arigraph`, `triple-extraction`, `error-handling`, `fallback`, `task-2.17`
  - content: AriGraph 파이프라인 작업 진행: 2.17 에러 처리 및 폴백 메커니즘 구현 완료 구현 내용: - classifyErrorType 메서드 추가: 에러 타입 분류 - network: 네트워크 오류 (재시도 가능) - api_key: API 키 오류 (즉시 실패) - rate_lim…
- [ ] `bench_mem_000783`
  - source: `mem_36b2949f7479461686a6a58de5e0cb87`
  - type: `semantic`
  - tags: `code-metadata`, `emitAlert`
  - content: {"methodName":"emitAlert","parameters":[{"name":"event","type":"Omit<AlertEvent, 'createdAt' | 'acknowledged'> & { createdAt?: Date; acknowledged?: boolean }"}…
- [ ] `bench_mem_001747`
  - source: `mem_1763386419149_5zze9jd66`
  - type: `episodic`
  - tags: `ghost-archive`, `performance`, `testing`, `completed`
  - content: 서브 태스크 6.11 완료: 메모 생성 API 응답 시간 측정 및 자동 분석이 응답 시간에 영향을 주지 않는지 확인. note/route.ts에 성능 측정 로깅 추가: 요청 시작 시간, 응답 반환 시간, 메타데이터 저장 시간, 자동 분석 시간(실행 시간, 전체 시간). 응답 시간 로깅…
- [ ] `bench_mem_002799`
  - source: `mem_1769230465539_v0x2jigbk`
  - type: `semantic`
  - tags: `best-practice`, `knowledge`, `documentation`, `llm-provider`
  - content: LLM Provider 설정 문서화 베스트 프랙티스 문서 구조: 1. 개요: 모듈의 목적과 지원하는 기능 설명 2. 환경 변수 설정: 설정 방법과 우선순위 설명 3. 사용법: 기본 사용법과 API 예시 4. Provider 선택 및 Fallback 전략: 각 provider별 동작 방…
- [ ] `bench_mem_002785`
  - source: `mem_1769226376602_b96xmn722`
  - type: `episodic`
  - tags: `completed`, `task-completion`, `triple-extractor`, `llm-provider-initialization`, `tdd-green`
  - content: 작업 4.4 완료: TripleExtractor의 LLMClientInitializer 결과를 사용하여 클라이언트 설정 확인 완료 - 작업 내용: - 이미 작업 4.2에서 구현이 완료되어 있었음 - 테스트 실행하여 모든 테스트 통과 확인 (5개 테스트 모두 통과) - 테스트 결과: 모…
- [ ] `bench_mem_002719`
  - source: `mem_1769055975031_aigira9mc`
  - type: `semantic`
  - tags: `best-practice`, `knowledge`, `testing`, `consolidation`, `step-by-step-visualization`
  - content: 단계별 통합 과정 시각화 검증 패턴 통합 과정 단계: 1. 초기 단계 (1일): - 모든 기억이 Episodic 타입 - Semantic 기억이 없음 (0개) - 통합이 시작되기 전 상태 2. 중간 단계 (30일): - 통합이 시작됨 (consolidationScore >= 0.5 &…
- [ ] `bench_mem_002751`
  - source: `mem_1769135211297_l6rnmyyn5`
  - type: `episodic`
  - tags: `completed`, `task-generation`, `review`, `refactoring`
  - content: 작업 목록 테스트 파일 위치 규칙 명확화 사용자 요청 반영: - 단위 테스트는 동일 디렉토리에 배치 - 통합 테스트는 __tests__ 디렉토리에 배치 - 신규 파일은 위 규칙을 따라야 함 - 기존 __tests__에 있는 단위 테스트는 그대로 유지 (점진적 이동은 별도 이슈) 수정 …
- [ ] `bench_mem_001405`
  - source: `mem_1762529929180_3e8omy653`
  - type: `episodic`
  - tags: `task-1.1`, `type-system`, `memorytyperequest`, `type-guard`
  - content: 작업 1.1 완료: src/types/index.ts에 MemoryTypeRequest 타입과 isMemoryItemType() 타입 가드 함수 추가. MemoryType은 도메인 모델용으로 유지, MemoryTypeRequest는 요청 파라미터용으로 'core', 'vault' 포함…
- [ ] `bench_mem_000656`
  - source: `mem_1760451584595_ozknet54w`
  - type: `working`
  - tags: `memento`, `current-status`, `vector-search`, `schema-alignment`, `fix-branch`
  - content: Memento 프로젝트 현재 상황 (2025-01-21) ## 현재 브랜치 및 Git 상태 - 브랜치: fix/search-embedding-schema-alignment - 수정된 파일: src/database/init.ts, src/database/migrate.ts, src/da…
- [ ] `bench_mem_002745`
  - source: `mem_1769088873695_6hyi0t4wl`
  - type: `episodic`
  - tags: `completed`, `prd`, `llm-provider`, `initialization`, `refactoring`, `task-generation`
  - content: PRD 기반 작업 목록 생성 완료: LLM Provider 초기화 로직 개선 및 통일 생성된 작업 목록: - 상위 작업 5개 - 하위 작업 총 31개 주요 작업 내용: 1. LLMClientInitializer 공통 모듈 생성 (11개 하위 작업) - 인터페이스 및 클래스 정의 - 환…

## Query q_014

- Query: `remember 도구로 어떤 기억을 저장할 수 있나`
- Language: `ko`
- Category: `memory`
- Notes: episodic semantic procedural
- Current relevant IDs: `bench_mem_003422`, `bench_mem_003434`

### Current Relevant Memories

- [x] `bench_mem_003422`
  - source: `mem_1773756350614_yk8cttyms`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `remember`, `memory-types`, `knowledge`
  - content: `remember` 도구는 `working`, `episodic`, `semantic`, `procedural` 유형의 기억을 저장한다. 기본 입력은 `content`이고, `procedural` 기억에는 `task_goal`, `steps`, `reflection_notes` 같은 …
- [x] `bench_mem_003434`
  - source: `mem_1773828883091_3n3l2rh28`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `remember`, `knowledge`
  - content: 질문: remember 도구로 어떤 기억을 저장할 수 있나. 답: remember 도구는 `working`, `episodic`, `semantic`, `procedural` 기억을 저장할 수 있다. content와 importance 같은 기본 필드 외에도 procedural용 `t…

### Candidate Memories

- [ ] `bench_mem_003434`
  - source: `mem_1773828883091_3n3l2rh28`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `remember`, `knowledge`
  - content: 질문: remember 도구로 어떤 기억을 저장할 수 있나. 답: remember 도구는 `working`, `episodic`, `semantic`, `procedural` 기억을 저장할 수 있다. content와 importance 같은 기본 필드 외에도 procedural용 `t…
- [ ] `bench_mem_000566`
  - source: `mem_1759636763269_q8kxhuv1w`
  - type: `procedural`
  - tags: `github`, `branch-protection`, `git`, `workflow`
  - content: GitHub main 브랜치 보호 설정 방법: Settings > Branches > Add rule에서 main 브랜치 보호 규칙 생성. 필수 설정: PR 요구, 승인 요구, 상태 확인 요구(린트, 타입체크, 테스트, 빌드), 대화 해결 요구. 관리자 예외 해제, 강제 푸시/삭제 방…
- [ ] `bench_mem_003249`
  - source: `mem_1772375283777_541oairwg`
  - type: `semantic`
  - tags: `compound-engineering`, `superpowers`, `cursor`, `comparison`
  - content: Compound Engineering vs Superpowers 비교: CE=4단계(Plan80%→Work20%→Review→Compound), 다중에이전트·지식복리 핵심. Superpowers=14개 스킬 규칙 기반(brainstorming→writing-plans→executing…
- [ ] `bench_mem_003255`
  - source: `mem_1772376674336_rdgw4gz60`
  - type: `episodic`
  - tags: `completed`, `superpowers`, `brainstorming`, `memento`, `recall`
  - content: brainstorming 스킬 체크리스트에 0단계 추가함: Recall related memories — Memento recall/memory_injection으로 주제·프로젝트·기능 관련 과거 완료·실패·패턴 조회 후 설계에 반영. Process Flow 다이어그램에도 동일 단계 …
- [ ] `bench_mem_003265`
  - source: `mem_1772453753909_7y3xcrt8h`
  - type: `episodic`
  - tags: `correction`, `dropped`, `2026-03-01`, `developer-continuity-assistant`, `host-adapter`, `brainstorming`
  - content: 2026-03-01 어제 작업 정리 보정: 1번(Developer Continuity Assistant Phase1 — 리메디에이션·runtime wiring·branch-aware/strict branch-safe resume·코드 리뷰), 2번(Host Adapter — main …
- [ ] `bench_mem_003225`
  - source: `mem_1772352018013_s33vu0gnj`
  - type: `episodic`
  - tags: `completed`, `documentation`, `planning`, `developer-continuity`, `ide-panel`
  - content: 2026-03-01 created three follow-up planning docs for the developer continuity IDE panel: a wireframe design, a Cursor-first technical design, and an implementa…
- [ ] `bench_mem_003231`
  - source: `mem_1772365242974_igynt7ox5`
  - type: `semantic`
  - tags: `git`, `branch-strategy`, `developer-continuity`, `knowledge`
  - content: Branch strategy guidance for developer continuity work: if the current feature branch has become a coherent Phase 1 deliverable, open a PR for it and start IDE…
- [ ] `bench_mem_003295`
  - source: `mem_1772714874562_r6nt4r7mw`
  - type: `episodic`
  - tags: `monorepo`, `memento-core`, `implementation-plan`, `workflows-work`, `completed`
  - content: 모노레포 Memento core 구현 계획(docs/plans/ko/2026-03-04-monorepo-memento-core-implementation-plan.md) 워크 실행 완료. 수행한 작업: (1) 루트 package.json에 build:all 추가 - core → ser…
- [ ] `bench_mem_001327`
  - source: `mem_1761656467225_dtvnfh1p3`
  - type: `semantic`
  - tags: `finnaut`, `readme`, `documentation`, `m2-features`
  - content: README.md에 M2 투자 전략 추천 API 문서 추가 완료: **추가된 내용**: 1. API 문서 섹션에 M2 추천 API 상세 설명 추가 - 사용 가능한 전략 목록 조회 엔드포인트 - 전략별 추천 종목 조회 (모든 쿼리 파라미터 포함) - 특정 종목의 팩터 상세 분석 엔드포인…
- [ ] `bench_mem_000360`
  - source: `mem_1758935828991_kjx890o3s`
  - type: `episodic`
  - tags: `performance`, `test`, `batch-8`
  - content: 성능 테스트용 기억 9: TypeScript와 React에 대한 학습 내용입니다.
- [ ] `bench_mem_001357`
  - source: `mem_1762434676627_crfidqf3e`
  - type: `episodic`
  - tags: `onboarding`, `project-setup`, `memento`
  - content: Memento MCP Server 프로젝트 온보딩 완료. 프로젝트 개요, 코드 구조, 테스트 가이드라인을 메모리에 저장했습니다. TypeScript 기반 AI Agent 기억 보조 시스템으로, 4가지 기억 타입(working, episodic, semantic, procedural)을…

## Query q_015

- Query: `recall 결과에는 어떤 정보가 포함되나`
- Language: `ko`
- Category: `search`
- Notes: limit score
- Current relevant IDs: `bench_mem_003423`, `bench_mem_003435`

### Current Relevant Memories

- [x] `bench_mem_003423`
  - source: `mem_1773756350620_b62z4uf98`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `recall`, `result-format`, `knowledge`
  - content: `recall` 결과에는 보통 기억의 `id`, `content`, `type`, `importance`, `created_at` 같은 기본 필드가 포함된다. 설정과 검색 경로에 따라 점수 계열 정보나 관련 메타데이터가 함께 반환될 수 있다.
- [x] `bench_mem_003435`
  - source: `mem_1773828883141_ylexqliti`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `recall`, `knowledge`
  - content: 질문: recall 결과에는 어떤 정보가 포함되나. 답: recall 결과에는 기억의 `id`, `content`, `type`, `importance`, `created_at` 같은 필드가 포함될 수 있다. 검색 경로에 따라 score, final_score, consolidatio…

### Candidate Memories

- [ ] `bench_mem_003435`
  - source: `mem_1773828883141_ylexqliti`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `recall`, `knowledge`
  - content: 질문: recall 결과에는 어떤 정보가 포함되나. 답: recall 결과에는 기억의 `id`, `content`, `type`, `importance`, `created_at` 같은 필드가 포함될 수 있다. 검색 경로에 따라 score, final_score, consolidatio…
- [ ] `bench_mem_000444`
  - source: `mem_1758937446875_dnxmc8aue`
  - type: `episodic`
  - tags: `performance`, `test`, `batch-9`
  - content: 성능 테스트용 기억 10: TypeScript와 React에 대한 학습 내용입니다.
- [ ] `bench_mem_001387`
  - source: `mem_1762462873169_kcsqs0phh`
  - type: `episodic`
  - tags: `bug-fix`, `race-condition`, `async`, `database`
  - content: Race condition 문제 해결: remember-tool.ts의 비동기 처리 로직 개선 수정 내용: 1. setTimeout + .then() 체인을 async IIFE로 변경하여 await를 제대로 사용 2. context.db! 대신 dbRef를 미리 저장하여 비동기 콜백에…
- [ ] `bench_mem_001397`
  - source: `mem_1762528514360_c73t9yzjd`
  - type: `episodic`
  - tags: `prd`, `recall-schema`, `validation`, `memory-types`, `filtering`
  - content: PRD RecallSchema 확장 구체적 지침 및 memory_types 배열 처리 전략 추가 완료. 주요 수정사항: 1) RecallSchema 확장 구체적 코드 예시 추가: query를 optional로 변경, type/key/agent_id 파라미터 추가, refine()을 사…
- [ ] `bench_mem_002400`
  - source: `mem_1767146733423_3sq56grbk`
  - type: `semantic`
  - tags: `best-practice`, `knowledge`, `task-generation`, `tdd`
  - content: PRD 기반 작업 목록 생성 패턴: 1. PRD 분석 → 코드베이스 상태 파악 → 상위 작업 생성 → 하위 작업 세분화 2. TDD 방법론 적용: 각 하위 작업은 RED-GREEN-REFACTOR 사이클 포함 3. given/when/then 구조: 테스트 코드와 메서드명에 명시 4.…
- [ ] `bench_mem_000312`
  - source: `mem_1758934908935_e8rv37vxa`
  - type: `episodic`
  - tags: (none)
  - content: 테스트 기억입니다
- [ ] `bench_mem_000304`
  - source: `mem_1758933661839_b92g1xb94`
  - type: `episodic`
  - tags: `performance`, `test`, `batch-6`
  - content: 성능 테스트용 기억 7: TypeScript와 React에 대한 학습 내용입니다.
- [ ] `bench_mem_002294`
  - source: `mem_1766655050427_uqu4gx20w`
  - type: `episodic`
  - tags: `database`, `sqlite`, `wal`, `cache`, `synchronization`, `prd`, `fix`
  - content: PRD 문서(0018-prd-database-lock-and-cache-sync.md) 구현 세부사항 수정 완료. 문제점 해결: 1) stop()에서 await 추가로 비동기 종료 문제 해결, 2) executeCheckpoint에서 better-sqlite3 pragma 결과 처리 …
- [ ] `bench_mem_001912`
  - source: `mem_1764989874307_6qwbu7fa8`
  - type: `episodic`
  - tags: `procedural-memory`, `migration`, `testing`, `task-1.3`
  - content: Procedural Memory Enhancement 작업 1.3 완료: 007-procedural-memory-enhancement.spec.ts 마이그레이션 테스트 작성. validateBefore, up, validateAfter, down 메서드 테스트 포함. 새 필드 추가, …
- [ ] `bench_mem_001964`
  - source: `mem_1765110876255_d2t8cf33e`
  - type: `episodic`
  - tags: `batch-scheduler`, `validation`, `fix`
  - content: weeklyRelationValidationTimeout이 validateConfig에서 검증되지 않아 0/음수/NaN 값이 setTimeout에 전달될 수 있는 문제를 해결했습니다. validateConfig에 weeklyRelationValidationTimeout 검증을 추가하여…
- [ ] `bench_mem_001988`
  - source: `mem_1765119670645_42wj9pr4y`
  - type: `episodic`
  - tags: `procedural-memory`, `commit`, `refactoring`, `scheduler`, `testing`
  - content: Procedural Memory Enhancement 브랜치에서 대규모 커밋 완료. 절차기억 기능 구현, 스케줄러 시스템 리팩토링, 관계 시스템 개선, 검색 엔진 개선, 테스트 코드 대폭 추가 (89개 파일 변경, 10,185줄 추가, 589줄 삭제). 주요 신규 파일: procedu…

## Query q_016

- Query: `FTS5 마이그레이션 fallback`
- Language: `ko`
- Category: `database`
- Notes: reflection_notes 검색
- Current relevant IDs: (none)

### Current Relevant Memories

- (none)

### Candidate Memories

- [ ] `bench_mem_001844`
  - source: `mem_1764072167350_48cdp1nd9`
  - type: `episodic`
  - tags: `testing`, `migration`, `fts5`, `reflexion`, `completed`
  - content: 작업 3.11 마이그레이션 스크립트 테스트 전체 완료 - 모든 하위 작업 완료: - 3.11.1: 마이그레이션 상태 테이블 생성/초기화 테스트 (5개 테스트) - 3.11.2: 마이그레이션 중 INSERT/UPDATE 발생 시나리오 테스트 (3개 테스트) - 3.11.3: 트리거 이중…
- [ ] `bench_mem_001836`
  - source: `mem_1763993437857_jlis9wczo`
  - type: `episodic`
  - tags: `reflexion`, `fts5`, `migration`, `fallback`, `status-tracking`, `phase1`, `task-3.9`
  - content: 작업 3.9 완료: Fallback 전략 구현 구현 내용: - 작업 3.9.1: 마이그레이션 상태 플래그 구현 - fts5_migration_status 테이블 생성 SQL 파일 작성 - initializeMigrationStatusTable 함수 구현 - getMigrationSta…
- [ ] `bench_mem_000542`
  - source: `mem_1759537605029_gx51o6rsu`
  - type: `episodic`
  - tags: `memento`, `integration-test`, `hybrid-approach`, `100%`, `success`, `m1`
  - content: Memento M1 통합 테스트 수정 프로젝트 완료 - 합의안의 하이브리드 접근법으로 100% 통과율 달성 **최종 성과:** - 테스트 통과율: 18/18 (100%) - 실행 시간: 85ms - 에러: 0개 **해결된 주요 문제들:** 1. 스키마 불일치 (memory_item_t…
- [ ] `bench_mem_001813`
  - source: `mem_1763985432221_qfwg9gcbf`
  - type: `episodic`
  - tags: `prd`, `reflexion`, `issue-36`, `documentation`, `risk`, `mitigation`
  - content: Issue #36 PRD 최종 완성. 잔여 리스크/테스트 고려사항 추가 완료: 1) 실패 이벤트 샘플 부족 시 대응 방안 (기간 확장, 누적 샘플링, 테스트 환경 활용 등), 2) FTS5 마이그레이션 다운타임 최소화 계획 (Zero-Downtime 전략, Fallback 전략, 검색…
- [ ] `bench_mem_001837`
  - source: `mem_1763993605302_7jkfrn3ny`
  - type: `episodic`
  - tags: `reflexion`, `fts5`, `migration`, `test`, `status-tracking`, `phase1`, `task-3.9.1.8`
  - content: 작업 3.9.1.8 완료: 마이그레이션 상태 테이블 생성/읽기/쓰기 테스트 작성 구현 내용: - fts5-migration-status.spec.ts 테스트 파일 작성 - 테스트 케이스: - initializeMigrationStatusTable: 테이블 생성, 인덱스 생성, 초기 상…
- [ ] `bench_mem_001816`
  - source: `mem_1763986520789_12p5l5qr1`
  - type: `episodic`
  - tags: `reflexion`, `task-generation`, `prd-0010`, `improvement`, `completed`
  - content: PRD 0010 작업 목록 추가 개선 완료. 주요 개선사항: 1) SearchEngine과 HybridSearchEngine을 Relevant Files에 추가하고 fallback 경로 명시, 2) FTS5_MIGRATION_STATUS 플래그의 상태 전이 다이어그램과 영속 위치 정의…
- [ ] `bench_mem_001842`
  - source: `mem_1764071880856_9ow994wnm`
  - type: `episodic`
  - tags: `testing`, `migration`, `fts5`, `reflexion`, `fallback`
  - content: 작업 3.11.5 Fallback 전략 테스트 완료 - 5개의 테스트 케이스 작성 및 모두 통과: 1. 마이그레이션 상태가 pending일 때 LIKE 쿼리 조건 반환 검증 2. 마이그레이션 상태가 failed일 때 LIKE 쿼리 조건 반환 검증 3. 마이그레이션 상태가 complet…
- [ ] `bench_mem_001851`
  - source: `mem_1764075926263_fj144wzrb`
  - type: `episodic`
  - tags: `reflexion`, `testing`, `search-engine`, `fts5`, `task-4.5`
  - content: Reflexion 기능 구현 작업 중 4.5 FTS5 reflection_notes 검색 통합 테스트를 작성했습니다. SearchEngine의 reflection_notes 검색 fallback 테스트(마이그레이션 상태별 분기 검증, 단일 객체/배열 검색, 키 토큰 검색, has_re…
- [ ] `bench_mem_000982`
  - source: `mem_1402e5afb91e4ff18a8ce35e8d89c02d`
  - type: `semantic`
  - tags: `code-metadata`, `sortByForgetPriority`
  - content: {"methodName":"sortByForgetPriority","parameters":[{"name":"results","type":"ForgettingResult[]"}],"returnType":"ForgettingResult[]","filePath":"src/algorithms…
- [ ] `bench_mem_000994`
  - source: `mem_eb04afae51af424287e456bacfa4719f`
  - type: `semantic`
  - tags: `code-metadata`, `optimizeWeights`
  - content: {"methodName":"optimizeWeights","parameters":[{"name":"trainingData","type":"Array<{ features: ForgettingFeatures; shouldForget: boolean }>"},{"name":"learning…
- [ ] `bench_mem_002700`
  - source: `mem_1769054425259_orskf7keq`
  - type: `episodic`
  - tags: `completed`, `task-completion`, `scenario1-view`, `memory-evolution-demo`, `ui-component`
  - content: 작업 완료: 시나리오 1 뷰 구현 (작업 4.1) 완료된 작업: - Scenario1View 컴포넌트 구현 (demo/src/components/Scenario1View.tsx) - Scenario1View 컴포넌트 테스트 작성 (demo/src/components/Scenario1V…
- [ ] `bench_mem_001039`
  - source: `mem_75b68370c346411c8b6f4a84a0dd7d20`
  - type: `semantic`
  - tags: `code-metadata`, `getProviderDimensions`
  - content: {"methodName":"getProviderDimensions","parameters":[],"returnType":"Record<string, number>","filePath":"src/algorithms/vector-search-engine.ts","startLine":541…
- [ ] `bench_mem_001081`
  - source: `mem_b57b6b050fdf4debad5df1597d430274`
  - type: `semantic`
  - tags: `code-metadata`, `analyzeReviewPerformance`
  - content: {"methodName":"analyzeReviewPerformance","parameters":[{"name":"performances","type":"ReviewPerformance[]"}],"returnType":"{\n totalReviews: number;\n successR…
- [ ] `bench_mem_002056`
  - source: `mem_1765283336355_f0ov28kro`
  - type: `episodic`
  - tags: `recall-tool`, `test`, `backward-compatibility`, `task-0012`
  - content: recall 도구의 하위 호환성 테스트 작성 완료. 새 파라미터(auto_set_anchor, include_neighbors 등) 없이 recall을 호출하면 기존 동작과 동일하게 작동하고, metadata.anchor_set=null이며, neighbors 필드가 없는지 확인하는 …
- [ ] `bench_mem_002040`
  - source: `mem_1765280905614_00wsnqh0z`
  - type: `episodic`
  - tags: `recall-tool`, `metadata`, `anchor-set`, `task-0012`
  - content: recall 도구의 앵커 설정 비활성화 시 metadata.anchor_set을 null로 설정 확인 완료. auto_set_anchor가 false이거나 검색 결과가 없을 때 anchorSetResult는 null이 되고, metadata 구성 시 anchorSetResult?.an…
- [ ] `bench_mem_002076`
  - source: `mem_1765372159125_2jtc6dp61`
  - type: `episodic`
  - tags: `completed`, `task-refinement`, `prd-compliance`, `arigraph-pipeline`
  - content: 작업: AriGraph 파이프라인 태스크 리스트 PRD 요구사항 반영 수정 날짜: 2025-01-XX 작업 범위: tasks/tasks-0013-prd-arigraph-pipeline.md 파일의 누락된 PRD 요구사항 추가 주요 수정 내용: 1. Triple 단위 metadata 저…
- [ ] `bench_mem_002036`
  - source: `mem_1765280572577_no4tj60jx`
  - type: `episodic`
  - tags: `recall-tool`, `metadata`, `anchor-set`, `task-0012`
  - content: recall 도구의 createSuccessResult 호출 시 metadata 객체에 anchor_set 필드 추가 구현 완료. anchorSetResult를 기반으로 metadata 객체를 구성하여 createSuccessResult에 포함시켰으며, 성공/실패/건너뜀 상태에 따라 …
- [ ] `bench_mem_002024`
  - source: `mem_1765279346232_vlyqyvfht`
  - type: `episodic`
  - tags: `recall-tool`, `auto-anchor`, `error-handling`, `task-0012`
  - content: recall 도구의 앵커 설정 실패 시 에러 처리 및 경고 로그 확인 완료. handleAutoSetAnchor 메서드에서 try-catch 블록으로 에러를 처리하고, logError로 경고 로그를 기록하며, 검색 결과는 정상 반환하도록 하는 로직이 이미 구현되어 있음.

## Query q_017

- Query: `PII 마스킹 로깅`
- Language: `ko`
- Category: `security`
- Notes: logger 마스킹
- Current relevant IDs: (none)

### Current Relevant Memories

- (none)

### Candidate Memories

- [ ] `bench_mem_002433`
  - source: `mem_1767166414928_tqd5px2qn`
  - type: `episodic`
  - tags: `unused-feature-improvement`, `phase3`, `completed`, `work-summary`, `branch`, `feature/unused-feature-improvement`, `prd-0021`
  - content: feature/unused-feature-improvement 브랜치에서 작업 완료. PRD 0021 기반 기능 미활용 개선 작업(Phase 3)을 수행했습니다. **작업 범위:** - 총 77개 파일 변경, 8,523줄 추가, 516줄 삭제 - 4개 주요 작업 영역 완료 **1. 로…
- [ ] `bench_mem_002434`
  - source: `mem_1767166427893_ki31lc6wz`
  - type: `semantic`
  - tags: `best-practice`, `knowledge`, `mcp-logging`, `retry-pattern`, `magic-number-removal`, `legacy-migration`
  - content: **MCP 로깅 스펙 준수 패턴:** - MCP 서버는 initialize 응답에 logging capability를 선언해야 함 - logging/setLevel 요청을 처리해야 함 - notifications/message 형식으로 로그 전송 (MCP SDK의 sendLogging…
- [ ] `bench_mem_002423`
  - source: `mem_1767152235797_y37y4oavr`
  - type: `episodic`
  - tags: `completed`, `logging`, `mcp-spec`, `helpers`
  - content: 1.8.1, 1.8.2 작업 완료: 로깅 필드 스키마 통일 및 검증 (MCP 스펙 준수) - 1.8.1: 구조화된 로깅 메타데이터 스키마 테스트 작성 완료 - src/shared/utils/__tests__/logger-schema.spec.ts 생성 - MCP notification…
- [ ] `bench_mem_002402`
  - source: `mem_1767146904316_s59a8mrno`
  - type: `semantic`
  - tags: `best-practice`, `knowledge`, `mcp-spec`, `logging`
  - content: MCP 스펙 준수 로깅 시스템: 1. mcpLogger는 이미 구현되어 있음 (src/server/mcp-logger.ts) - server.sendLoggingMessage() 사용 (MCP SDK의 구현) - logMCPProtocol: MCP 프로토콜 로그 (Cursor로 전송)…
- [ ] `bench_mem_002334`
  - source: `mem_1766804695493_xppk5l7xo`
  - type: `episodic`
  - tags: `prd`, `technical-debt`, `security`, `refactoring`, `code-quality`
  - content: Memento 프로젝트의 기술 부채 정리 작업을 위해 세 개의 PRD를 생성했습니다: 1. 0019-prd-security-hardening.md: 보안 강화 (Phase 1) - SQL Injection 방지, PII 마스킹, Path Traversal 방지 2. 0020-prd-d…
- [ ] `bench_mem_002333`
  - source: `mem_1766804084538_cr9y4ts7l`
  - type: `episodic`
  - tags: `refactoring`, `code-review`, `security`, `cleanup`
  - content: 코드 리뷰 결과를 바탕으로 보안, 중복 구현, 기능 미활용 개선 작업을 위한 브랜치 생성. 브랜치명: refactor/security-redundancy-cleanup. 주요 작업 영역: 1) 보안 검토 (SQL Injection, PII 마스킹, Path Traversal), 2) …
- [ ] `bench_mem_002090`
  - source: `mem_1765377224603_z53brvou4`
  - type: `episodic`
  - tags: `arigraph`, `triple-extraction`, `logging`, `rawllmoutput`, `task-2.15`
  - content: AriGraph 파이프라인 작업 진행: 2.15 rawLLMOutput 저장 정책 구현 완료 구현 내용: - TripleExtractionService에 tripleExtractionLogger 통합 - extractTriples 메서드에 memoryId 파라미터 추가 (로깅용) - …
- [ ] `bench_mem_002398`
  - source: `mem_1767146667024_d3kb2vdfp`
  - type: `episodic`
  - tags: `prd`, `task-generation`, `unused-feature-improvement`, `phase3`
  - content: PRD 0021 기반 작업 목록 생성 시작. 4가지 주요 개선 영역 식별: 1. 로깅 시스템 통일: console.log → Logger 전환, ESLint 규칙 강화 2. 재시도 전략 통일: RetryManager 확장 (외부 API 호출용), 개별 재시도 로직 제거 3. 설정 값 …
- [ ] `bench_mem_002355`
  - source: `mem_1766814504049_v0a9jxwbx`
  - type: `episodic`
  - tags: `security`, `pii-masking`, `task-0019`, `green-phase`, `completed`
  - content: 작업 2.5 완료: 모든 catch 블록에서 오류 로깅 시 PII 마스킹 적용 완료. console.error를 사용하는 catch 블록을 찾아서 PII 마스킹을 적용했습니다. 주요 수정 파일: src/scripts/check-migration-status.ts (error.messa…
- [ ] `bench_mem_002089`
  - source: `mem_1765376852353_5g08drs1h`
  - type: `episodic`
  - tags: `arigraph`, `triple-extraction`, `logging`, `task-2.14`
  - content: AriGraph 파이프라인 작업 진행: 2.14 Triple 추출 전용 로거 구현 완료 구현 내용: - TripleExtractionLogger 클래스 구현: rawLLMOutput을 로그 파일에 저장 - 주요 기능: - logExtraction: Triple 추출 결과 로깅 (비동기…
- [ ] `bench_mem_002842`
  - source: `mem_1769451150249_zytgqcmdi`
  - type: `semantic`
  - tags: (none)
  - content: bridge는 기본 아키텍처를 소유함합니다
- [ ] `bench_mem_001714`
  - source: `mem_1763381673996_7j8xal5yw`
  - type: `episodic`
  - tags: `ghost-archive`, `analysis-update`, `error-handling`, `completed`
  - content: 서브 태스크 2.7, 2.8 완료: 이미 2.6에서 구현됨. 2.7은 archiveRepository.update()로 tags, category, sentiment_score 필드 업데이트 구현됨. 2.8은 Promise.allSettled의 rejected 상태 처리와 개별 에러 …
- [ ] `bench_mem_002854`
  - source: `mem_1769458317609_xd5d2znf2`
  - type: `semantic`
  - tags: (none)
  - content: ca 마일스톤는 3.3 & 3.4를 완료됨합니다
- [ ] `bench_mem_001766`
  - source: `mem_1763801660184_0oiam4nyp`
  - type: `episodic`
  - tags: `test`, `coverage`, `tdd`, `completed`, `progress`
  - content: 테스트 커버리지 개선 작업 완료. stock.service.ts (4.76% → 58.73%), kis.client.ts (16.03% → 59.43%), ranking.repository.ts (테스트 추가), dart.client.ts (테스트 추가) 개선 완료. 전체 커버리지 약…
- [ ] `bench_mem_000528`
  - source: `mem_1759447095539_c74ijb8vs`
  - type: `episodic`
  - tags: `bridge`, `mcp-server`, `implementation-verification`, `business-logic`, `complete-features`
  - content: Bridge MCP 서버 도구 실제 구현 상태 확인 완료: 30개 도구 모두 완전한 비즈니스 로직이 구현되어 있음을 확인. 단순한 메소드 정의가 아닌 실제 데이터 처리, 분석, 변환 로직이 모두 구현되어 있으며, Bridge Analytics의 실제 클래스들과 함수들을 호출하는 완전한…
- [ ] `bench_mem_002236`
  - source: `mem_1766537270318_a2nwdpevx`
  - type: `episodic`
  - tags: `prd`, `architecture`, `database-abstraction`, `core-memory`, `refactoring`
  - content: CoreMemoryRepository 데이터베이스 인터페이스 추상화 PRD 작성 완료. 두 계층 인터페이스 설계: SQL 저수준(DatabaseConnection) + Repository 메서드 레벨. SQLite 구현체 먼저, PostgreSQL은 후속 작업. 기존 인터페이스 활용,…
- [ ] `bench_mem_002284`
  - source: `mem_1766632380687_kkkaz0lre`
  - type: `episodic`
  - tags: `0017`, `completion`, `verification`, `completed`
  - content: 작업 0017 전체 완료 기준 검증 완료 - Lint 통과 ✅ - 타입 체크 통과 ✅ - 모든 테스트 통과 ✅ - 테스트 커버리지 80% 이상 ✅ - 파일 크기 검증 ✅ (핵심 파일 500줄 이하) - 타입 안정성 검증 ✅ (any 타입 약 8개, 목표 50개 이하 달성) - 로깅 일…
- [ ] `bench_mem_002135`
  - source: `mem_1765541880868_1d7rssfwu`
  - type: `episodic`
  - tags: `arigraph`, `batch-job`, `unit-test`, `given-when-then`, `completed`
  - content: AriGraph Pipeline 구현 작업 진행: 6.16 배치 작업 단위 테스트 작성 완료 작업 내용: - TripleExtractionBatchJob 단위 테스트 작성 - Given/When/Then 패턴 준수 - PRD 6.16 요구사항 반영 주요 구현: 1. 테스트 파일 생성:…
- [ ] `bench_mem_002121`
  - source: `mem_1765536828042_culvpfdkw`
  - type: `episodic`
  - tags: `arigraph`, `async-test`, `remember-tool`, `completed`
  - content: AriGraph Pipeline 구현 작업 진행: 5.14 비동기 처리 테스트 작성 완료 작업 내용: - remember Tool의 비동기 Triple 추출 처리 테스트 작성 - PRD 5.14 요구사항 반영 주요 구현: 1. 테스트 케이스 추가: - remember-tool.spec…
- [ ] `bench_mem_002151`
  - source: `mem_1765603567740_o2hao4xcm`
  - type: `episodic`
  - tags: `git`, `merge`, `conflict`, `pr`, `fix`, `completed`
  - content: 2025-12-13 작업: triple-extraction-batch-job PR 병합 충돌 해결 완료 문제: - PR #64 생성 후 병합 충돌 발생 - triple-extraction-batch-job.spec.ts 파일에 충돌 마커(<<<<<<< HEAD) 남아있음 - PR에서 …

## Query q_018

- Query: `재시도 전략 RetryManager`
- Language: `ko`
- Category: `resilience`
- Notes: 외부 API 재시도
- Current relevant IDs: (none)

### Current Relevant Memories

- (none)

### Candidate Memories

- [ ] `bench_mem_002433`
  - source: `mem_1767166414928_tqd5px2qn`
  - type: `episodic`
  - tags: `unused-feature-improvement`, `phase3`, `completed`, `work-summary`, `branch`, `feature/unused-feature-improvement`, `prd-0021`
  - content: feature/unused-feature-improvement 브랜치에서 작업 완료. PRD 0021 기반 기능 미활용 개선 작업(Phase 3)을 수행했습니다. **작업 범위:** - 총 77개 파일 변경, 8,523줄 추가, 516줄 삭제 - 4개 주요 작업 영역 완료 **1. 로…
- [ ] `bench_mem_002429`
  - source: `mem_1767152989945_ctlkvx1bd`
  - type: `episodic`
  - tags: `completed`, `retry`, `retry-manager`, `external-api`, `ci`
  - content: 2.0 작업 전체 완료: 재시도 전략 통일 및 RetryManager 확장 - 2.1: RetryManager에 외부 API 호출용 retry 메서드 추가 완료 - 2.2: 재시도 옵션 설정 파일 생성 완료 (config/retry-options.toml) - 2.3: 외부 API 호…
- [ ] `bench_mem_002437`
  - source: `mem_1767166449744_83chbkjen`
  - type: `procedural`
  - tags: `procedure`, `workflow`, `refactoring`, `code-improvement`
  - content: **기능 미활용 개선 작업 프로세스** **작업 목표:** 코드베이스의 미사용 기능을 개선하고 통일된 패턴을 적용하는 작업 **단계별 절차:** 1. 작업 목록 생성: PRD 기반으로 상세 작업 목록 작성 (tasks/tasks-*.md) 2. 로깅 시스템 통일: MCP 스펙 준수, …
- [ ] `bench_mem_002434`
  - source: `mem_1767166427893_ki31lc6wz`
  - type: `semantic`
  - tags: `best-practice`, `knowledge`, `mcp-logging`, `retry-pattern`, `magic-number-removal`, `legacy-migration`
  - content: **MCP 로깅 스펙 준수 패턴:** - MCP 서버는 initialize 응답에 logging capability를 선언해야 함 - logging/setLevel 요청을 처리해야 함 - notifications/message 형식으로 로그 전송 (MCP SDK의 sendLogging…
- [ ] `bench_mem_002399`
  - source: `mem_1767146733009_sugxutdkv`
  - type: `episodic`
  - tags: `prd`, `task-generation`, `unused-feature-improvement`, `phase3`, `completed`
  - content: PRD 0021 기반 상세 작업 목록 생성 완료. 4개 상위 작업에 대해 총 24개 하위 작업 생성: 1. 로깅 시스템 통일 (6개 하위 작업) - ESLint 규칙 강화, console 오버라이드 전환, services/domains 디렉토리 전환, 로깅 스키마 통일, 검증 스크립트…
- [ ] `bench_mem_002398`
  - source: `mem_1767146667024_d3kb2vdfp`
  - type: `episodic`
  - tags: `prd`, `task-generation`, `unused-feature-improvement`, `phase3`
  - content: PRD 0021 기반 작업 목록 생성 시작. 4가지 주요 개선 영역 식별: 1. 로깅 시스템 통일: console.log → Logger 전환, ESLint 규칙 강화 2. 재시도 전략 통일: RetryManager 확장 (외부 API 호출용), 개별 재시도 로직 제거 3. 설정 값 …
- [ ] `bench_mem_000078`
  - source: `mem_1758600206724_zatmxsern`
  - type: `semantic`
  - tags: `performance`, `test`, `batch-3`
  - content: 성능 테스트 메모리 15: 다양한 타입의 메모리를 생성하여 성능을 측정합니다.
- [ ] `bench_mem_002491`
  - source: `mem_1768005435511_kkvvy68mr`
  - type: `procedural`
  - tags: `procedure`, `task-generation`, `prd`
  - content: PRD에서 작업 목록 생성 절차: 1. PRD 파일 읽기 및 분석 2. 코드베이스 구조 확인 (glob_file_search) 3. SERENA로 유사 기능 검색 (find_symbol, search_for_pattern) 4. MEMENTO 관련 기억 조회 및 앵커 설정 5. 상위 …
- [ ] `bench_mem_000062`
  - source: `mem_1758600070808_pxddolnev`
  - type: `semantic`
  - tags: `performance`, `test`, `batch-3`
  - content: 성능 테스트 메모리 19: 다양한 타입의 메모리를 생성하여 성능을 측정합니다.
- [ ] `bench_mem_000014`
  - source: `mem_1758596608047_huttgj11u`
  - type: `episodic`
  - tags: `important`, `user`, `question`
  - content: 중요한 에피소드 기억: 사용자가 중요한 질문을 했고, 상세히 답변했습니다.
- [ ] `bench_mem_000934`
  - source: `mem_7c5f980c4ad74d529016fcd30dbcb385`
  - type: `semantic`
  - tags: `code-metadata`, `calculateFunctionComplexity`
  - content: {"methodName":"calculateFunctionComplexity","parameters":[{"name":"node","type":"any"}],"returnType":"number","filePath":"src/services/code-metadata.service.ts…
- [ ] `bench_mem_000902`
  - source: `mem_5e1264876824426393cbaa36f7fd00b8`
  - type: `semantic`
  - tags: `code-metadata`, `extractStructure`
  - content: {"methodName":"extractStructure","parameters":[{"name":"ast","type":"any"}],"returnType":"string[]","filePath":"src/services/code-duplication.service.ts","star…
- [ ] `bench_mem_000950`
  - source: `mem_49df6f8c55444be9961a5028b365442e`
  - type: `semantic`
  - tags: `code-metadata`, `findAlternativeCodes`
  - content: {"methodName":"findAlternativeCodes","parameters":[{"name":"filePath","type":"string"},{"name":"context","type":"RecommendationContext"},{"name":"maxResults","…
- [ ] `bench_mem_000191`
  - source: `mem_1758897318153_mc4vjswpd`
  - type: `episodic`
  - tags: `react`, `hooks`, `javascript`
  - content: React Hook에 대해 설명했다. useState는 상태를 관리하고, useEffect는 사이드 이펙트를 처리한다.
- [ ] `bench_mem_001640`
  - source: `mem_1763158371521_bo1knpc9k`
  - type: `procedural`
  - tags: `classic-momentum-investing`, `procedure`, `implementation`
  - content: Classic Momentum Investing 전략 구현 절차 단계별 절차: 1. DTO 및 타입 정의 - shared/strategies/classic-momentum-investing.dto.ts 파일 생성 - 팩터 배열, 가중치 인터페이스, 쿼리/응답 DTO 정의 - share…
- [ ] `bench_mem_001612`
  - source: `mem_1763067277079_qntb7pkjc`
  - type: `episodic`
  - tags: `bug-fix`, `retry-logic`, `test-isolation`, `type-safety`, `ranking-recalculation`
  - content: 랭킹 재계산 서비스의 재시도 로직 및 테스트 코드 개선 작업 완료 주요 수정 사항: 1. retry 로직 수정 (ranking-recalculation.service.ts) - maxAttempts를 3에서 4로 변경 (초기 1회 + 재시도 3회 = 총 4회 시도) - PRD 요구사항…

## Query q_019

- Query: `이 프로젝트의 코드 스타일과 린트 규칙은 무엇인가`
- Language: `ko`
- Category: `dev`
- Notes: ESLint 포맷
- Current relevant IDs: (none)

### Current Relevant Memories

- (none)

### Candidate Memories

- [ ] `bench_mem_003192`
  - source: `mem_1772289729641_tgbyoytdh`
  - type: `episodic`
  - tags: `design`, `brainstorming`, `assistant`, `openclaw`, `developer-assistant`, `completed`
  - content: 2026-02-28에 memento 기반 개인 AI 비서 방향에 대한 딥리서치 및 브레인스토밍을 진행했다. 결론은 OpenClaw clone보다 memory-native developer assistant가 적합하다는 것이다. 제품 방향은 개인 데스크톱 비서, 메신저는 후속 확장, 우…
- [ ] `bench_mem_003207`
  - source: `mem_1772294483480_aln8rp510`
  - type: `episodic`
  - tags: `code-review`, `developer-continuity-assistant`, `phase1`, `completed`
  - content: 2026-02-28 developer continuity assistant Phase 1 코드 리뷰 수행. 주요 지적사항: 1) 루트 패키지 배포 산출물에 packages/memento-assistant 및 memento-continuity CLI가 포함되지 않음(package.jso…
- [ ] `bench_mem_003215`
  - source: `mem_1772326319563_6p69w65di`
  - type: `episodic`
  - tags: `completed`, `code-review`, `developer-continuity`, `phase1`, `hardening`
  - content: 코드 리뷰 완료: feature/developer-continuity-assistant-phase1 브랜치를 2026-02-28 continuity implementation plan 및 phase1 hardening design 기준으로 검토함. 주요 미충족 사항: 루트 packag…
- [ ] `bench_mem_003209`
  - source: `mem_1772297442213_tuakbfbcq`
  - type: `episodic`
  - tags: `developer-continuity-assistant`, `phase1`, `hardening`, `design`, `implementation-plan`, `completed`
  - content: Developer Continuity Assistant Phase 1 코드 리뷰 후속 작업으로 hardening 설계 문서와 구현 계획 문서를 작성함. 과도기 하이브리드 배포 전략을 선택했고, 루트 패키지에서 continuity CLI를 배포하면서 packages/memento-ass…
- [ ] `bench_mem_003367`
  - source: `mem_1773319396856_yh1r8a1bb`
  - type: `episodic`
  - tags: `code-review`, `ts-pre-reviewer`, `feat/110-cli-for-ai`, `memento-cli`, `completed`
  - content: feat/110-cli-for-ai 브랜치에 대해 ts-pre-reviewer 서브에이전트로 TypeScript 사전 코드 리뷰 수행함. docs/code_review/ko/2026-03-11-feat-110-cli-for-ai-ts-pre-review.md 갱신. 이미 반영됨: en…
- [ ] `bench_mem_003361`
  - source: `mem_1773317869793_7uxmkpvob`
  - type: `episodic`
  - tags: `code-review`, `ts-pre-reviewer`, `feat-110-cli-for-ai`, `completed`
  - content: feat/110-cli-for-ai 브랜치 TypeScript 코드에 대해 ts-pre-reviewer 서브에이전트로 사전 코드 리뷰 위임 완료. 산출물: docs/code_review/ko/2026-03-11-feat-110-cli-for-ai-ts-pre-review.md. 리뷰 …
- [ ] `bench_mem_003360`
  - source: `mem_1773317831011_6m795jm7j`
  - type: `episodic`
  - tags: `code-review`, `feat-110`, `cli-for-ai`, `ts-pre-review`, `completed`
  - content: feat/110-cli-for-ai 브랜치 TypeScript 사전 코드 리뷰 완료 (2026-03-12). 리뷰 대상: packages/memento-server/src/cli.ts, env-loader.ts, option-map.ts, cli-ac5-ac6.spec.ts, pack…
- [ ] `bench_mem_003318`
  - source: `mem_1772858593519_trtw99qwn`
  - type: `episodic`
  - tags: `paperclip`, `500-error`, `root-cause`, `pino-http`, `api-v1`
  - content: Paperclip 500 오류 조사 완료: GET /api/v1/tasks/:id, GET /api/v1/comments/:id 요청 시 500 발생. 로그의 "failed with status code 500"은 pino-http가 500 응답 시 생성하는 합성 에러이며 실제 원인 …
- [ ] `bench_mem_003227`
  - source: `mem_1772355521648_mv612w7al`
  - type: `episodic`
  - tags: `code-review`, `developer-continuity-assistant`, `phase1`, `completed`
  - content: feature/developer-continuity-assistant-phase1 브랜치 코드 리뷰 수행 완료 (2026-03-01). code-reviewer 서브에이전트로 db07415→3359b76 범위 검토. 결과: Critical 없음. Important 2건 – (1) co…
- [ ] `bench_mem_002992`
  - source: `mem_1770249728562_8fu1ea8l1`
  - type: `semantic`
  - tags: `best-practice`, `knowledge`, `typescript`, `code-review`, `type-safety`
  - content: TypeScript 코드 리뷰에서 any 축소 시 권장 패턴: (1) MCP 도구 handle 파라미터는 Zod 스키마가 있으면 z.infer<typeof Schema>로 타입 지정(RecallParams, RememberParams). (2) db 인자는 better-sqlite3의…
- [ ] `bench_mem_002986`
  - source: `mem_1770247524342_mr9oapifi`
  - type: `procedural`
  - tags: `procedure`, `code-review`, `implementation-order`, `memento`
  - content: 코드 리뷰 반영 시 권장 순서: (1) 타입 변경을 모듈별로 진행(types → extractor → recall-tool → search-engine → remember-tool → 기타), 각 단계 후 type-check와 해당 스펙 실행. (2) 파싱 실패 로깅 추가( catch…
- [ ] `bench_mem_002546`
  - source: `mem_1768215941353_stwaljev5`
  - type: `semantic`
  - tags: `best-practice`, `knowledge`, `factory`, `migration`, `interface`
  - content: 팩토리 패턴 구현 방법 (AI 클라이언트): 1. 함수 기반 팩토리 사용 권장: create_ai_client(config) 함수 2. 설정 기반 클라이언트 생성: ai.provider 설정에 따라 적절한 클라이언트 반환 3. 하위 호환성 유지: 기존 설정 구조도 지원 (ollama …
- [ ] `bench_mem_003201`
  - source: `mem_1772292457721_g8vwiv66v`
  - type: `semantic`
  - tags: `memento`, `design`, `implementation-plan`, `review`, `core-assistant`
  - content: 2026-02-28 Memento 설계·구현계획 재검토(수정본): 이전 보완 제안이 반영됨. 설계 §6.4 origin_source로 통일 완료. 구현계획: Phase 1 core 위치 명시(엔트리포인트·공개 계약만, 기존 구현은 루트 src 유지, core 코드 이동은 후속), Ta…
- [ ] `bench_mem_002613`
  - source: `mem_1768632580523_wx8rcu0a6`
  - type: `semantic`
  - tags: `best-practice`, `knowledge`, `phase-2`, `refactoring`, `code-quality`, `verification`
  - content: Phase 2 작업 완료: combineAndSortResults() 메서드 분리 및 검증 - 작업 내용: 115줄의 combineAndSortResults() 메서드를 작은 함수들로 분리 - 분리된 메서드: 1. mergeResults() - 결과 병합 (15줄) 2. normali…
- [ ] `bench_mem_002664`
  - source: `mem_1769006393564_xh6hzluw4`
  - type: `semantic`
  - tags: `best-practice`, `knowledge`, `forgetting-calculator`, `tdd`
  - content: 망각 점수 계산 함수 구현 패턴 구현 방법: - 실제 알고리즘 코드(src/domains/forgetting/algorithms/forgetting-algorithm.ts)를 참고하여 동일한 공식 구현 - 인터페이스 정의: ForgettingFeatures, ForgettingWeig…
- [ ] `bench_mem_002764`
  - source: `mem_1769169076745_gkc36iqpx`
  - type: `semantic`
  - tags: `best-practice`, `knowledge`, `refactoring`, `code-quality`, `llm-provider`
  - content: LLM 클라이언트 초기화 코드 리팩토링 베스트 프랙티스 리팩토링 전략: 1. 중복 제거: 유사한 로직을 헬퍼 메서드로 추출 - 클라이언트 초기화 로직 (initializeOpenAI, initializeGemini) - 에러 메시지 생성 (getErrorMessage) - 경고 메시지…
- [ ] `bench_mem_002609`
  - source: `mem_1768631887017_8q2xvjc07`
  - type: `semantic`
  - tags: `best-practice`, `knowledge`, `phase-2`, `refactoring`, `code-quality`
  - content: Phase 2 작업 완료: combineAndSortResults() 메서드 분리 - 작업 내용: 115줄의 combineAndSortResults() 메서드를 작은 함수들로 분리 - 분리된 메서드: 1. mergeResults() - 결과 병합 (15줄) 2. normalizeSco…
- [ ] `bench_mem_002993`
  - source: `mem_1770249730684_frd829px0`
  - type: `procedural`
  - tags: `procedure`, `type-safety`, `code-review`, `typescript`
  - content: 코드 리뷰 타입 안정성 반영 절차: (1) 해당 파일에서 any 사용처 grep으로 파악. (2) 공유 타입(MemoryItem, MemorySearchFilters, ReflectionNotes 등)과 Zod 스키마 존재 여부 확인. (3) 도구: handle(params)는 스키마…
- [ ] `bench_mem_002789`
  - source: `mem_1769227898119_xv179o4ad`
  - type: `semantic`
  - tags: `best-practice`, `knowledge`, `triple-extractor`, `refactoring`, `llm-provider`, `code-quality`
  - content: TripleExtractor 리팩토링 패턴 및 베스트 프랙티스: 1. **LLMClientInitializer 통합**: - 공통 초기화 로직을 LLMClientInitializer로 통일 - 환경 변수 우선순위: process.env['LLM_PROVIDER'] > mementoCo…
- [ ] `bench_mem_002781`
  - source: `mem_1769179647337_khsel2qme`
  - type: `semantic`
  - tags: `best-practice`, `knowledge`, `llm-provider`, `refactoring`, `error-handling`
  - content: LLMBasedRelationExtractor 리팩토링 패턴 및 베스트 프랙티스 아키텍처 결정: - LLMClientInitializer를 사용하여 모든 LLM 클라이언트 초기화 통일 - 비동기 초기화를 위한 initializationPromise 패턴 사용 - determinePro…
- [ ] `bench_mem_001518`
  - source: `mem_1762671957230_3mo9lhuiu`
  - type: `episodic`
  - tags: `embedding`, `dimension-mismatch`, `fix`, `vector-search`, `tfidf`, `in-progress`
  - content: 벡터 차원 불일치 문제 추가 수정: TF-IDF가 512차원을 생성하지만 VectorSearchEngine이 384차원을 기대하는 문제. 저장된 임베딩의 실제 차원을 확인하고, 쿼리 벡터의 차원이 저장된 차원과 일치하면 사용하도록 수정. getActualStoredDimensions를…
- [ ] `bench_mem_001562`
  - source: `mem_1762767487506_jvzucsw48`
  - type: `episodic`
  - tags: `tdd`, `testing`, `audit-report`, `final-update`, `completed`
  - content: TDD 감사 보고서 최종 업데이트 완료: 결론 섹션의 "최근 완료된 작업"과 "최근 개선 사항"을 모두 업데이트하여 실제 완료된 모든 테스트 항목을 반영했습니다. 총 6개 카테고리의 테스트 작성이 완료되었음을 명시했습니다.
- [ ] `bench_mem_001574`
  - source: `mem_1762865103882_xfanvnkeg`
  - type: `episodic`
  - tags: `task-generation`, `prd-0007`, `api-authentication`, `completed`
  - content: PRD 0007 (API 인증 및 인가 구현)에 대한 작업 목록 생성 완료. generate-tasks.md 규칙에 따라 Phase 1과 Phase 2를 모두 완료했습니다. 작업 내용: - Phase 1: 상위 작업 5개 생성 (1.0 인증 가드 구현, 2.0 컨트롤러 적용, 3.0 …
- [ ] `bench_mem_003422`
  - source: `mem_1773756350614_yk8cttyms`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `remember`, `memory-types`, `knowledge`
  - content: `remember` 도구는 `working`, `episodic`, `semantic`, `procedural` 유형의 기억을 저장한다. 기본 입력은 `content`이고, `procedural` 기억에는 `task_goal`, `steps`, `reflection_notes` 같은 …
- [ ] `bench_mem_003418`
  - source: `mem_1773756177090_mcm9ulykm`
  - type: `episodic`
  - tags: `search-quality`, `benchmark`, `zero-results`, `corpus-supplement`, `analysis`
  - content: 사용자-facing benchmark-v1 label-candidates를 재생성한 뒤 0건 쿼리를 분석했다. 현재 23개 사용자 쿼리 중 22개가 search result 0건으로 추정된다. 판별 기준은 label-candidates.json에서 candidate_benchmark_…
- [ ] `bench_mem_002259`
  - source: `mem_1766585112412_ftflvyms4`
  - type: `episodic`
  - tags: `0017`, `phase2`, `refactoring`, `in-progress`
  - content: 작업 2.7.1, 2.7.2 완료: anchor-search-service.ts 리팩토링 - 분리된 모듈들(NHopSearchService, QueryFilterService, FallbackSearchService) 사용하도록 수정 완료 - 기존 API 유지 확인 - 타입 호환성 확…
- [ ] `bench_mem_002229`
  - source: `mem_1766496301927_ant2z78vc`
  - type: `episodic`
  - tags: `procedural-memory`, `reflexion-worker`, `tasks-0015`, `trigger-conditions`, `test`
  - content: 서브태스크 2.6 완료: Trigger 조건 매칭 검증 테스트 구현 완료. 실패 이벤트와 동일 조건으로 검색, 개선된 메모리 우선순위 확인, fetchProceduralMemoryMatches 로직 검증. 필터 검색이 실패한 경우 직접 DB 쿼리로 확인하고, trigger_condit…
- [ ] `bench_mem_002291`
  - source: `mem_1766634829291_wv5wato8b`
  - type: `episodic`
  - tags: `lint`, `code-quality`, `testing`, `completed`
  - content: lint 오류 수정 작업 완료: console.log를 logger로 교체하고 테스트 코드도 수정함. 282개 에러를 모두 수정했고, base-tool.spec.ts 테스트도 logger 모킹으로 수정하여 통과시킴.
- [ ] `bench_mem_000248`
  - source: `mem_1758931089021_7cplnoqtr`
  - type: `episodic`
  - tags: `performance`, `test`, `batch-7`
  - content: 성능 테스트용 기억 8: TypeScript와 React에 대한 학습 내용입니다.
- [ ] `bench_mem_002873`
  - source: `mem_1769476307190_5r6mhovs1`
  - type: `semantic`
  - tags: (none)
  - content: usestate는 상태를 관리합니다

## Query q_020

- Query: `이 모노레포는 어떤 순서로 빌드되나`
- Language: `ko`
- Category: `build`
- Notes: core server client
- Current relevant IDs: `bench_mem_003436`

### Current Relevant Memories

- [x] `bench_mem_003436`
  - source: `mem_1773828883142_snzs6tnqw`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `workspace`, `build`, `knowledge`
  - content: 질문: 이 모노레포는 어떤 순서로 빌드되나. 답: 루트 `npm run build`는 core → server → client 순서로 빌드한다. 저장소는 npm workspaces 모노레포이며 주요 패키지는 `packages/memento-core`, `packages/memento-…

### Candidate Memories

- [ ] `bench_mem_003436`
  - source: `mem_1773828883142_snzs6tnqw`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `workspace`, `build`, `knowledge`
  - content: 질문: 이 모노레포는 어떤 순서로 빌드되나. 답: 루트 `npm run build`는 core → server → client 순서로 빌드한다. 저장소는 npm workspaces 모노레포이며 주요 패키지는 `packages/memento-core`, `packages/memento-…
- [ ] `bench_mem_002926`
  - source: `mem_1769815525327_nr5kigrnl`
  - type: `semantic`
  - tags: (none)
  - content: 데이터 분석 결과 요약는 총 volume: 62,418,309,090를 결과합니다
- [ ] `bench_mem_002622`
  - source: `mem_1768706347236_4ijd1cpc3`
  - type: `episodic`
  - tags: `completed`, `task-completion`, `phase5`, `mcp-tools`, `http-api`
  - content: Phase 5.3 작업 완료: 관리/운영성 도구 분리 완료된 작업: - HTTP API 엔드포인트 4개 추가 (admin.routes.ts) - POST /admin/anchors/restore - POST /admin/embeddings/migrate - POST /admin/mem…
- [ ] `bench_mem_002986`
  - source: `mem_1770247524342_mr9oapifi`
  - type: `procedural`
  - tags: `procedure`, `code-review`, `implementation-order`, `memento`
  - content: 코드 리뷰 반영 시 권장 순서: (1) 타입 변경을 모듈별로 진행(types → extractor → recall-tool → search-engine → remember-tool → 기타), 각 단계 후 type-check와 해당 스펙 실행. (2) 파싱 실패 로깅 추가( catch…
- [ ] `bench_mem_001493`
  - source: `mem_1762666514925_6rsupj2vu`
  - type: `episodic`
  - tags: `anchor-system`, `search-local`, `result-formatting`, `task-3.10`, `completed`
  - content: 앵커 시스템 작업 3.10 확인 완료: 결과 포맷팅이 이미 구현되어 있음. SearchResult 인터페이스에 local_results_count와 fallback_used 필드 정의, searchLocal 메서드에서 정확히 설정, fallbackToGlobalSearch에서도 설정됨.
- [ ] `bench_mem_001551`
  - source: `mem_1762764410286_35b8z7mf3`
  - type: `episodic`
  - tags: `tdd`, `testing`, `embedding-service`, `embedding-provider-factory`, `milestone-1`
  - content: 1단계 임베딩 서비스 테스트 작성 완료: embedding-service.spec.ts와 embedding-provider-factory.spec.ts 테스트 작성 완료. embedding-service는 generateEmbedding, searchSimilar, isAvailabl…
- [ ] `bench_mem_003432`
  - source: `mem_1773828883082_1jbye4v19`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `relation`, `knowledge`
  - content: 질문: relation 추출 기능은 어떻게 검증하나. 답: relation 추출 검증은 relation_type, memory_relation 저장, 방향 검증, 중복 방지, 테스트 데이터베이스 기반 검증으로 수행한다. relation 도메인과 triple extraction 결과를 …
- [ ] `bench_mem_002881`
  - source: `mem_1769483501107_xi3w4ts2w`
  - type: `semantic`
  - tags: (none)
  - content: react는 usestate hook를 Hook합니다
- [ ] `bench_mem_002895`
  - source: `mem_1769497915721_6iw6mv6kv`
  - type: `semantic`
  - tags: (none)
  - content: memento mcp 서버 프로젝트는 @memento/client를 npm 클라이언트 라이브러리 이름 결정합니다
- [ ] `bench_mem_002825`
  - source: `mem_1769265818354_774gr1shn`
  - type: `episodic`
  - tags: `completed`, `fix`, `triple-extraction`, `openai-client`
  - content: triple extraction OpenAI client 초기화 문제 수정 작업 완료 작업 내용: - triple extraction을 위한 OpenAI client 초기화 로직 개선 - remember-tool에서 triple extraction 사용 시 client 초기화 보장 -…
- [ ] `bench_mem_000109`
  - source: `mem_1758600273923_bkuv7p882`
  - type: `episodic`
  - tags: `performance`, `test`, `batch-1`
  - content: 성능 테스트 메모리 6: 다양한 타입의 메모리를 생성하여 성능을 측정합니다.

## Query q_027

- Query: `데이터베이스 초기화와 마이그레이션은 어떻게 하나`
- Language: `ko`
- Category: `database`
- Notes: db:init db:migrate
- Current relevant IDs: `bench_mem_003421`, `bench_mem_003437`

### Current Relevant Memories

- [x] `bench_mem_003421`
  - source: `mem_1773756350512_uihlqldua`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `database`, `migration`, `knowledge`
  - content: DB 초기화는 `npm run db:init -w @memento/core`, 마이그레이션은 `npm run db:migrate -w @memento/core`로 수행한다. 작업 전 `.env` 또는 `DB_PATH`로 SQLite 경로를 맞추고, 스키마 변경 시 마이그레이션 SQL과…
- [x] `bench_mem_003437`
  - source: `mem_1773828883144_ywp22pt39`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `database`, `migration`, `knowledge`
  - content: 질문: 데이터베이스 초기화와 마이그레이션은 어떻게 하나. 답: `npm run db:init -w @memento/core`로 초기화하고 `npm run db:migrate -w @memento/core`로 마이그레이션한다. DB 경로는 `.env` 또는 `DB_PATH`로 맞춘다.

### Candidate Memories

- [ ] `bench_mem_003437`
  - source: `mem_1773828883144_ywp22pt39`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `database`, `migration`, `knowledge`
  - content: 질문: 데이터베이스 초기화와 마이그레이션은 어떻게 하나. 답: `npm run db:init -w @memento/core`로 초기화하고 `npm run db:migrate -w @memento/core`로 마이그레이션한다. DB 경로는 `.env` 또는 `DB_PATH`로 맞춘다.
- [ ] `bench_mem_003007`
  - source: `mem_1770278480537_9qwlwrv8v`
  - type: `episodic`
  - tags: `completed`, `ci`, `sqlite`, `owner_id`, `test`
  - content: CI test:ci SQLITE_ERROR no such column m.owner_id 수정 완료. 원인: SearchEngine이 SELECT에 m.owner_id를 사용하는데 테스트용 memory_item 테이블에 owner_id 컬럼이 없었음(Issue #57 Phase 2 D…
- [ ] `bench_mem_001460`
  - source: `mem_1762594102321_zc0bzq95b`
  - type: `episodic`
  - tags: `consolidation-score`, `write-coalescing`, `performance-optimization`, `task-3.7`, `task-3.8`, `task-3.9`, `task-3.10`
  - content: Task 3.7~3.10 완료: 쓰기 결합(Write Coalescing) 유틸리티 구현 및 적용 완료. WriteCoalescingManager 클래스를 생성하여 메모리 버퍼를 사용하여 쓰기 작업을 결합하고 주기적으로(1초마다) flush하도록 구현. 서버 초기화 시 WriteCoa…
- [ ] `bench_mem_003067`
  - source: `mem_1770898652880_o7kegdomm`
  - type: `semantic`
  - tags: `finnaut`, `data-collection`, `dart`, `alternative-api`, `knowledge`
  - content: 한국 상장사 재무제표 수집 대안: (1) DART(opendart.fss.or.kr) - 공식이지만 연결 끊김 시 대체 필요. (2) 공공데이터포털(data.go.kr) - 금융감독원 정기보고서 재무정보 API(15060626)는 DART와 동일/연동 가능성 있음. (3) 금융위원회 …
- [ ] `bench_mem_003077`
  - source: `mem_1771058904028_78lpxvgyv`
  - type: `semantic`
  - tags: `typescript`, `astro`, `dom`, `event-type`
  - content: frontend RankingTable.astro keydown 이벤트: addEventListener 콜백은 DOM에서 Event 타입으로 전달됨. e.key 사용 시 (e: KeyboardEvent)로 쓰면 오버로드 불일치로 ts(2769) 발생. (e: Event)로 받고 내부에…
- [ ] `bench_mem_002812`
  - source: `mem_1769259989945_umod9hdvs`
  - type: `semantic`
  - tags: `best-practice`, `knowledge`, `subagent`, `cursor`
  - content: Cursor 서브에이전트는 .cursor/agents/<name>.md에 YAML frontmatter(name, description)와 시스템 프롬프트를 작성해 생성한다. 사전 코드 리뷰 서브에이전트는 리뷰 우선순위, 체크리스트, 출력 템플릿, 한국어 응답 규칙을 포함해야 한다.
- [ ] `bench_mem_000703`
  - source: `mem_dc102e57491244fe8dd6855ff3a6c442`
  - type: `semantic`
  - tags: `code-metadata`, `validateProviderCompatibility`
  - content: {"methodName":"validateProviderCompatibility","parameters":[{"name":"vector","type":"number[]"},{"name":"provider","type":"EmbeddingProvider"},{"name":"overrid…
- [ ] `bench_mem_002872`
  - source: `mem_1769476298268_0qiprsxkm`
  - type: `semantic`
  - tags: (none)
  - content: 설명는 usestate와 useeffect의 차이점를 정보 제공합니다
- [ ] `bench_mem_000948`
  - source: `mem_43082b60e8314d7484d3c6b802e9bf78`
  - type: `semantic`
  - tags: `code-metadata`, `extractMethodSnippet`
  - content: {"methodName":"extractMethodSnippet","parameters":[{"name":"content","type":"string"},{"name":"methodName","type":"string"}],"returnType":"string","filePath":"…
- [ ] `bench_mem_003173`
  - source: `mem_1772210098626_rb50ijr55`
  - type: `episodic`
  - tags: `memento`, `blog`, `notion`, `content-creator`, `completed`
  - content: Notion PARA Note에 등록된 Memento 블로그 5편 시리즈를 Content Creator 스킬 기준으로 블로그 수준으로 보강함. 각 편에 훅·문제/해결 구조·Key Takeaways·Next Steps·표·불릿·짧은 문단 적용. 1편: 소개(기억하는 척 한계, 메모리 운…
- [ ] `bench_mem_003163`
  - source: `mem_1772108275181_z4ttprick`
  - type: `episodic`
  - tags: `completed`, `agent`, `session-management`, `implementation`
  - content: Memento Agent 세션 관리 개선 구현을 서브에이전트 기반으로 완료함. Task 1: session-store-types.ts. Task 2: session-store.ts (read/write, getOrCreateSessionId, updateSessionEntry) + s…

## Query q_028

- Query: `OpenAI와 Gemini 임베딩 provider는 어떻게 다루나`
- Language: `ko`
- Category: `embedding`
- Notes: multi provider
- Current relevant IDs: `bench_mem_003438`

### Current Relevant Memories

- [x] `bench_mem_003438`
  - source: `mem_1773828883158_fofp9xipp`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `embedding`, `provider`, `knowledge`
  - content: 질문: OpenAI와 Gemini 임베딩 provider는 어떻게 다루나. 답: Memento는 OpenAI와 Gemini 같은 임베딩 provider를 병렬 검색하고 결과를 정규화해 합칠 수 있다. 필요하면 `provider_filter`로 특정 provider만 검색한다.

### Candidate Memories

- [ ] `bench_mem_003438`
  - source: `mem_1773828883158_fofp9xipp`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `embedding`, `provider`, `knowledge`
  - content: 질문: OpenAI와 Gemini 임베딩 provider는 어떻게 다루나. 답: Memento는 OpenAI와 Gemini 같은 임베딩 provider를 병렬 검색하고 결과를 정규화해 합칠 수 있다. 필요하면 `provider_filter`로 특정 provider만 검색한다.
- [ ] `bench_mem_002732`
  - source: `mem_1769080868737_f9v260i35`
  - type: `episodic`
  - tags: `completed`, `task-completion`, `i18n`, `korean`, `localization`, `memory-evolution-demo`
  - content: 작업 완료: 한국어 텍스트 추가 (작업 5.7) 완료된 작업: - 모든 UI 텍스트를 한국어로 변경 - MemoryStatus: "Episodic" → "사건 기억", "Semantic" → "의미 기억" - ForgettingChart: "Working" → "작업 기억", "Epi…
- [ ] `bench_mem_002724`
  - source: `mem_1769056683399_0hjk6zvp5`
  - type: `episodic`
  - tags: `completed`, `task-completion`, `consolidation-view`, `memory-evolution-demo`, `testing`, `consolidation-score`
  - content: 작업 완료: 통합 점수 변화 그래프 검증 (작업 4.13) 완료된 작업: - ConsolidationView 테스트 강화 (demo/src/components/ConsolidationView.test.tsx) 주요 변경사항: - 통합 점수 변화 그래프 검증 테스트 추가 - 시간에 따라…
- [ ] `bench_mem_002624`
  - source: `mem_1768707429286_5pmdij04s`
  - type: `episodic`
  - tags: `completed`, `task-completion`, `phase5`, `documentation`, `api-reference`
  - content: Phase 5.5 작업 완료: 정책 문서 업데이트 및 도구 분류 문서화 완료된 작업: - README.md 업데이트 - MCP Tools: 15개 → 11개로 변경 - HTTP 관리 API 섹션에 4개 엔드포인트 추가 (앵커 관리, 임베딩 관리, 메모리 관리) - docs/ko/api…
- [ ] `bench_mem_002680`
  - source: `mem_1769007979313_fhsdttyou`
  - type: `semantic`
  - tags: `best-practice`, `knowledge`, `simulation-data`, `consolidation`, `tdd`
  - content: 통합 과정 시각화용 데이터 생성 함수 구현 패턴 구현 방법: - generateConsolidationVisualizationData: 여러 Episodic 기억을 입력받아 통합 과정 시뮬레이션 - 모든 기억을 Episodic 타입으로 보장 - 높은 중요도(0.7) 설정하여 통합 가능…
- [ ] `bench_mem_002696`
  - source: `mem_1769053495594_swyb6v9uq`
  - type: `episodic`
  - tags: `completed`, `task-completion`, `memory-status`, `memory-evolution-demo`, `ui-component`, `styling`
  - content: 작업 완료: MemoryStatus 컴포넌트에 색상 스키마 적용 (작업 3.7) 완료된 작업: - MemoryStatus 컴포넌트에 색상 스키마 적용 - 색상 스키마 테스트 작성 및 통과 주요 변경사항: - Episodic 기억에 파란색(#3B82F6) 클래스 추가 (memory-ep…
- [ ] `bench_mem_000088`
  - source: `mem_1758600241664_y4deeozrx`
  - type: `semantic`
  - tags: `performance`, `test`, `batch-1`
  - content: 성능 테스트 메모리 5: 다양한 타입의 메모리를 생성하여 성능을 측정합니다.
- [ ] `bench_mem_000008`
  - source: `mem_1758596584609_0l6vwppwt`
  - type: `working`
  - tags: `old`, `setup`, `completed`
  - content: 오래된 작업 기억: 프로젝트 초기 설정 작업을 완료했습니다.
- [ ] `bench_mem_001813`
  - source: `mem_1763985432221_qfwg9gcbf`
  - type: `episodic`
  - tags: `prd`, `reflexion`, `issue-36`, `documentation`, `risk`, `mitigation`
  - content: Issue #36 PRD 최종 완성. 잔여 리스크/테스트 고려사항 추가 완료: 1) 실패 이벤트 샘플 부족 시 대응 방안 (기간 확장, 누적 샘플링, 테스트 환경 활용 등), 2) FTS5 마이그레이션 다운타임 최소화 계획 (Zero-Downtime 전략, Fallback 전략, 검색…
- [ ] `bench_mem_001803`
  - source: `mem_1763976980248_q0haa9yp5`
  - type: `episodic`
  - tags: `classic-momentum-investing`, `bug-fix`, `data-collection`, `in-progress`
  - content: classic-momentum-investing 계산 0건 문제 해결 진행 상황 작업 시간: 2025-11-23 23:03:26 KST 완료된 작업: 1. 문제 원인 파악: - 주가 데이터 부족 (51일치만 존재) - KIS API가 30일치를 제공하지만 코드에서 특정 날짜만 저장 2…
- [ ] `bench_mem_001583`
  - source: `mem_1762867417795_y8t5dtoj8`
  - type: `episodic`
  - tags: `api-authentication`, `health-check`, `completed`
  - content: 서브태스크 2.6 완료: 헬스체크 엔드포인트 생성 완료. backend/src/common/controllers/health.controller.ts 파일 생성, @Public() 데코레이터 적용하여 인증 없이 접근 가능, AppModule에 등록. GET /health 엔드포인트가 …

## Query q_029

- Query: `memory injection은 어떤 컨텍스트를 주입하나`
- Language: `ko`
- Category: `search`
- Notes: query context
- Current relevant IDs: `bench_mem_003424`, `bench_mem_003439`

### Current Relevant Memories

- [x] `bench_mem_003424`
  - source: `mem_1773756350706_6l301wfst`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `memory-injection`, `prompt`, `knowledge`
  - content: `memory_injection`은 검색된 관련 기억을 요약해 프롬프트 컨텍스트로 주입한다. 입력은 `query`, `token_budget`, `max_memories` 등을 받고, 출력은 `role`과 `content`를 가진 메시지 배열 형태다.
- [x] `bench_mem_003439`
  - source: `mem_1773828883166_o994chfoe`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `memory-injection`, `knowledge`
  - content: 질문: memory injection은 어떤 컨텍스트를 주입하나. 답: memory injection은 query와 관련된 기억을 요약해 프롬프트 컨텍스트에 주입한다. 보통 max_memories와 token_budget 범위 안에서 관련 기억을 골라 role/content 메시지로 …

### Candidate Memories

- [ ] `bench_mem_003439`
  - source: `mem_1773828883166_o994chfoe`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `memory-injection`, `knowledge`
  - content: 질문: memory injection은 어떤 컨텍스트를 주입하나. 답: memory injection은 query와 관련된 기억을 요약해 프롬프트 컨텍스트에 주입한다. 보통 max_memories와 token_budget 범위 안에서 관련 기억을 골라 role/content 메시지로 …
- [ ] `bench_mem_000980`
  - source: `mem_cbc019808d4c4ac08a58cdb0de71454e`
  - type: `semantic`
  - tags: `code-metadata`, `calculateForgetScore`
  - content: {"methodName":"calculateForgetScore","parameters":[{"name":"features","type":"ForgettingFeatures"}],"returnType":"number","filePath":"src/algorithms/forgetting…
- [ ] `bench_mem_000924`
  - source: `mem_263115b2e6fd47ec8a2863a54698c082`
  - type: `semantic`
  - tags: `code-metadata`, `generateId`
  - content: {"methodName":"generateId","parameters":[],"returnType":"string","filePath":"src/services/code-metadata.service.ts","startLine":742,"endLine":744,"description"…
- [ ] `bench_mem_001638`
  - source: `mem_1763158363145_o2z3iyzei`
  - type: `episodic`
  - tags: `classic-momentum-investing`, `implementation`, `completed`, `backend`, `strategy`
  - content: Classic Momentum Investing 전략 구현 작업 완료 (2025-01-13) 작업 완료 내용: 1. 작업 1.0: DTO 및 타입 정의 완료 - ClassicMomentumInvestingQueryDTO, ClassicMomentumInvestingResponseDTO…
- [ ] `bench_mem_000826`
  - source: `mem_fd7c591d37ce44b98f30932dbf210308`
  - type: `semantic`
  - tags: `code-metadata`, `log`
  - content: {"methodName":"log","parameters":[{"name":"message","type":"string"},{"name":"data","type":"any"}],"returnType":"void","filePath":"src/services/performance-mon…
- [ ] `bench_mem_000722`
  - source: `mem_0e9b30121aff406b9867f7639efe6196`
  - type: `semantic`
  - tags: `code-metadata`, `preprocessText`
  - content: {"methodName":"preprocessText","parameters":[{"name":"text","type":"string"}],"returnType":"string[]","filePath":"src/services/lightweight-embedding-service.ts…
- [ ] `bench_mem_002441`
  - source: `mem_1767871283466_yku1389xn`
  - type: `episodic`
  - tags: `meta-memory`, `issue-66`, `prd`, `statistics`, `monitoring`
  - content: Issue #66 기반 Meta-Memory(1) 통계 기반 메타 메모리 수집 기능 PRD 작성 완료. 파일명: 0022-prd-meta-memory-1-statistics-based-collection.md. 주요 결정사항: 성공/실패 판정(relevance score >= 0.5 …
- [ ] `bench_mem_002409`
  - source: `mem_1767147948113_pkapflni7`
  - type: `procedural`
  - tags: `procedure`, `task-generation`, `prd`
  - content: PRD 기반 작업 목록 생성 절차: 1. PRD 분석 및 코드베이스 상태 파악 - PRD 파일 읽기 - 관련 기억 조회 (Memento) - 기존 코드베이스 분석 (SERENA) - 유사 기능 확인 2. 상위 작업 생성 - PRD의 Phase별 요구사항 기반 - 코드베이스 상태 반영 …
- [ ] `bench_mem_000886`
  - source: `mem_cdded1caf71d4c0faf9d426816f2f2ba`
  - type: `semantic`
  - tags: `code-metadata`, `setEmbedding`
  - content: {"methodName":"setEmbedding","parameters":[{"name":"text","type":"string"},{"name":"embedding","type":"number[]"},{"name":"ttl","type":"number"}],"returnType":…
- [ ] `bench_mem_002489`
  - source: `mem_1768005432682_f18yokriy`
  - type: `episodic`
  - tags: `blogbot`, `tasks`, `prd`, `completed`, `tdd`
  - content: blogbot CLI 작업 목록 생성 완료. PRD 기반으로 5개 상위 작업과 37개 하위 작업 생성 완료. 각 하위 작업은 TDD 방법론(given/when/then)을 따르며, RED-GREEN-REFACTOR 사이클을 포함합니다. 관련 파일 50개 이상 식별 완료. 작업 파일: …
- [ ] `bench_mem_002996`
  - source: `mem_1770251074291_ztfm36uoa`
  - type: `episodic`
  - tags: `completed`, `code-review`, `feat-procedural-llm-extractor`
  - content: feat/procedural-llm-extractor 브랜치 ts-pre-reviewer 사전 리뷰 수행. 반영 완료: BatchScheduler isJobQueued/isJobRunning, reflexion-worker parseReflectionNotes 반환 타입. 리뷰 문서 …

## Query q_030

- Query: `anchor, pin, unpin은 각각 무엇에 쓰이나`
- Language: `ko`
- Category: `anchor`
- Notes: scope search
- Current relevant IDs: `bench_mem_003425`, `bench_mem_003440`

### Current Relevant Memories

- [x] `bench_mem_003425`
  - source: `mem_1773756350709_3kcslitf2`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `anchor`, `pin`, `unpin`, `knowledge`
  - content: `anchor`는 특정 기억을 현재 컨텍스트의 기준점으로 삼아 주변 검색을 돕고, `pin`은 중요한 기억을 고정해 보존 우선순위를 높인다. `unpin`은 그 고정을 해제해 일반 수명주기 정책을 다시 적용하게 한다.
- [x] `bench_mem_003440`
  - source: `mem_1773828883205_ztybyxdpe`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `anchor`, `pin`, `unpin`, `knowledge`
  - content: 질문: anchor, pin, unpin은 각각 무엇에 쓰이나. 답: anchor는 검색 기준점을 만들고, pin은 중요한 기억을 고정하며, unpin은 그 고정을 해제한다. anchor는 검색 컨텍스트를 바꾸고 pin/unpin은 보존 우선순위를 바꾼다.

### Candidate Memories

- [ ] `bench_mem_003440`
  - source: `mem_1773828883205_ztybyxdpe`
  - type: `semantic`
  - tags: `search-quality`, `benchmark-corpus`, `anchor`, `pin`, `unpin`, `knowledge`
  - content: 질문: anchor, pin, unpin은 각각 무엇에 쓰이나. 답: anchor는 검색 기준점을 만들고, pin은 중요한 기억을 고정하며, unpin은 그 고정을 해제한다. anchor는 검색 컨텍스트를 바꾸고 pin/unpin은 보존 우선순위를 바꾼다.
- [ ] `bench_mem_000376`
  - source: `mem_1758936449748_crzsjrva3`
  - type: `episodic`
  - tags: `performance`, `test`, `batch-1`
  - content: 성능 테스트용 기억 2: TypeScript와 React에 대한 학습 내용입니다.
- [ ] `bench_mem_002096`
  - source: `mem_1765457429288_i8h4ozwc3`
  - type: `episodic`
  - tags: `arigraph`, `triple-extraction`, `entity-linker`, `exception-rule`, `unit-test`, `task-2.21`
  - content: AriGraph 파이프라인 작업 진행: 2.21 Entity Linking 예외 규칙 테스트 작성 완료 구현 내용: - EntityLinker 예외 규칙 테스트 추가 (given/when/then 패턴) - 구조화된 엔티티 예외 처리 상세 테스트: 1. 숫자 예외 처리: - 정수 (1…
- [ ] `bench_mem_002088`
  - source: `mem_1765376676380_ku7in17nd`
  - type: `episodic`
  - tags: `arigraph`, `pii-masking`, `security`, `task-2.13`
  - content: AriGraph 파이프라인 작업 진행: 2.13 PII 마스킹 유틸리티 구현 완료 구현 내용: - PIIMasker 클래스 구현: 로그 파일에 저장되는 rawLLMOutput에서 민감 정보 마스킹 - 마스킹 대상: - 이메일 주소: user@example.com → [EMAIL] - …
- [ ] `bench_mem_002040`
  - source: `mem_1765280905614_00wsnqh0z`
  - type: `episodic`
  - tags: `recall-tool`, `metadata`, `anchor-set`, `task-0012`
  - content: recall 도구의 앵커 설정 비활성화 시 metadata.anchor_set을 null로 설정 확인 완료. auto_set_anchor가 false이거나 검색 결과가 없을 때 anchorSetResult는 null이 되고, metadata 구성 시 anchorSetResult?.an…
- [ ] `bench_mem_002076`
  - source: `mem_1765372159125_2jtc6dp61`
  - type: `episodic`
  - tags: `completed`, `task-refinement`, `prd-compliance`, `arigraph-pipeline`
  - content: 작업: AriGraph 파이프라인 태스크 리스트 PRD 요구사항 반영 수정 날짜: 2025-01-XX 작업 범위: tasks/tasks-0013-prd-arigraph-pipeline.md 파일의 누락된 PRD 요구사항 추가 주요 수정 내용: 1. Triple 단위 metadata 저…
- [ ] `bench_mem_001552`
  - source: `mem_1762765018739_a19riis31`
  - type: `episodic`
  - tags: `tdd`, `testing`, `performance-alert-service`, `milestone-2`
  - content: 2단계 성능 알림 서비스 테스트 작성 완료: performance-alert-service.spec.ts 테스트 작성 완료. checkPerformanceMetric, resolveAlert, getAlertStats, getActiveAlerts, searchAlerts, updat…
- [ ] `bench_mem_001532`
  - source: `mem_1762678711552_dtvmt4x9e`
  - type: `episodic`
  - tags: `bug-fix`, `typescript`, `type-errors`, `completed`
  - content: TypeScript 타입 오류 수정 완료: hybrid-search-engine.ts의 IVectorSearchEngine 인터페이스에 provider 파라미터 추가, anchor-manager.ts의 bestCandidate undefined 체크 추가 및 fallbackItems …
- [ ] `bench_mem_000820`
  - source: `mem_b470d83e320a44ab8a487d102c9848fe`
  - type: `semantic`
  - tags: `code-metadata`, `exportMetrics`
  - content: {"methodName":"exportMetrics","parameters":[],"returnType":"Promise<string>","filePath":"src/services/performance-monitor.ts","startLine":643,"endLine":657,"de…
- [ ] `bench_mem_001378`
  - source: `mem_1762439916698_cn0zucnpx`
  - type: `episodic`
  - tags: `implementation`, `memory-neighbors`, `task-4.1-4.6`, `testing`
  - content: 태스크 4.1-4.6 완료: MemoryNeighborService 단위 테스트 작성 구현 내용: - src/services/memory-neighbor-service.spec.ts 생성 - 초기화 테스트: 의존성 검증, 데이터베이스 설정 검증 - 정상 케이스 테스트: - 임베딩이 없…
- [ ] `bench_mem_002113`
  - source: `mem_1765460355557_05lm9ktby`
  - type: `episodic`
  - tags: `arigraph`, `remember-tool`, `triple-extraction`, `completed`
  - content: AriGraph Pipeline 구현 작업 진행: 5.2 remember Tool에서 type='episodic'일 때 Triple 추출 파이프라인 호출 로직 구현 완료 작업 내용: - remember-tool.ts에 Triple 추출 파이프라인 통합 - PRD 4.1 remember…
