# Memento 아키텍처

## 왜 Memento인가

AI 에이전트는 기본적으로 무상태(stateless)다. 대화가 끝나면 그 안에서 벌어진 모든 일은 사라진다. Memento는 이 공백을 메운다. 인간의 기억 체계 — 단기 작업 기억, 에피소드 기억, 장기 의미 기억, 절차 기억 — 를 모사하여, 에이전트가 대화 세션을 넘어 경험을 축적할 수 있게 한다.

인터페이스는 MCP(Model Context Protocol)다. 에이전트는 `remember`, `recall`, `forget` 같은 도구를 호출하고, Memento는 나머지를 처리한다.

---

## 패키지 구조

루트는 npm workspaces 기반 모노레포다. 의존 방향은 단방향이다.

```
memento-core  ←  memento-server
              ←  memento-client
              ←  memento-assistant
              ←  memento-agent-integration
```

**`packages/memento-core` (`@memento/core`)**
모든 도메인 로직, DB 접근, 서비스, 스케줄러, MCP 도구가 여기 있다. 나머지 패키지는 모두 이 라이브러리를 소비하는 셸이다.

**`packages/memento-server`**
`@memento/core`를 외부로 노출하는 두 종류의 서버를 담고 있다.
- **MCP 서버** (`cli.ts`): AI 에이전트가 직접 연결. stdio, SSE, Streamable HTTP 트랜스포트를 지원한다.
- **HTTP 관리 서버** (`http-server.ts`): 대시보드, 배치 수동 실행, 에이전트 세션 관리 등 운영 API를 제공한다.

**`packages/memento-client` (`@jee1/memento-client`)**
서버에 원격으로 연결하는 클라이언트 라이브러리.

**`packages/memento-assistant`**
외부 어시스턴트(OpenClaw/NanoClaw 계열) 통합용 패키지.

**`packages/memento-agent-integration`**
에이전트가 Memento를 in-process로 삽입할 때 사용하는 계약(contract)과 런타임.

---

## 기억이 저장되는 여정

`remember` 도구 호출 하나가 시스템을 어떻게 통과하는지 따라가보자.

1. **수신**: MCP 서버(stdio 또는 HTTP)가 JSON-RPC 요청을 받아 `tools.routes.ts`로 전달한다.
2. **실행**: `executeTool('remember', params, context)` → `RememberTool.execute()`. 텔레메트리 컨텍스트는 `owner_id`/`agent_id` 기반으로 자동 설정된다.
3. **즉시 저장**: `memory_item` 테이블에 레코드를 기록하고 **바로 응답을 반환**한다. 후속 처리를 기다리지 않는다.
4. **잡큐 등록**: 에피소드 기억이라면, `BatchScheduler.addJob()`으로 Triple 추출 작업을 큐에 등록한다.
5. **백그라운드 정제**: 이후 배치 워커가 그 기억에서 Subject–Predicate–Object Triple을 추출하고, 관계 그래프를 업데이트한다.

이 "즉시 저장, 나중에 정제" 패턴이 Memento의 **비동기 Augmentation 파이프라인**의 핵심이다. 에이전트는 저장 즉시 응답을 받고, 정제 작업은 백그라운드에서 수렴한다.

---

## 도메인 구조

`memento-core/src/domains/` 아래 도메인이 수직으로 분리되어 있다. 각 도메인은 자신의 서비스, 저장소, 도구를 가진다.

### memory

기억의 CRUD 홈. `remember`, `recall`, `pin`, `unpin`, `forget`, `feedback` 도구가 여기서 작동한다.

메모리 타입은 4가지이며, TTL이 다르다:

| 타입 | TTL | 용도 |
|------|-----|------|
| `working` | 48시간 | 현재 작업 맥락, 임시 정보 |
| `episodic` | 90일 | 과거 대화·사건 기록 |
| `semantic` | 무제한 | 지식, 사실, 규칙 |
| `procedural` | 무제한 | 반복 가능한 절차·워크플로우 |

에피소드 기억이 쌓이면 Triple 추출과 Sleep Consolidation이 시맨틱 기억으로 증류한다. 기억은 소프트 삭제(`is_deleted = true`) 후 일정 기간 뒤 하드 삭제된다.

### search

하이브리드 검색 엔진. FTS5 텍스트 검색과 벡터 검색을 병렬로 실행한 뒤 점수를 합산해 최종 순위를 계산한다.

**랭킹 공식** (`config/ranking-weights.toml`):
```
S = α·relevance + β·recency + γ·importance + δ·usage
  + ζ·relation_weight + ζ_fb·(feedback_norm − 0.5)
  + θ·process_attribute_fit − ε·duplication_penalty
```
가중치: α=0.45, β=0.20, γ=0.20, δ=0.10, ζ=0.15, ζ_fb=0.05, θ=0.10, ε=0.10.

`relevance` 슬롯에는 벡터 유사도(0.4), BM25 점수(0.3), 태그 매칭(0.2), 제목 히트(0.1)가 합산된다. 마지막으로 MMR(Maximal Marginal Relevance)이 결과 다양성을 조절한다.

### embedding

다중 임베딩 프로바이더를 지원한다. `EmbeddingProviderFactory`가 환경 설정에 따라 적절한 프로바이더를 선택한다:

| 프로바이더 | 특징 |
|-----------|------|
| **TF-IDF** | 외부 API 없이 로컬 실행. 기본값. |
| **MiniLM** | 경량 로컬 모델. |
| **OpenAI** (`text-embedding-3-small`) | API 키 필요, 1536차원. |
| **Gemini** | Google Gemini 임베딩. |

임베딩은 `memory_embedding` 테이블에 저장되고 sqlite-vec 인덱스로 근사 최근접 이웃(ANN) 검색을 제공한다.

### forgetting

TTL이 만료된 기억을 정리하는 정책 서비스(`ForgettingPolicyService`). Forget Score는 나이, 중요도, 사용 빈도를 고려한 지수 감쇠 함수로 계산된다. 고정(`pinned`)된 기억은 삭제 대상에서 제외된다. `BatchScheduler`가 24시간마다 정리 작업을 실행한다.

### anchor

A/B/C 세 슬롯의 컨텍스트 앵커. 현재 작업과 밀접한 기억을 앵커로 지정하면, `search_local` 도구가 그 주변 관계 그래프를 탐색해 맥락 관련 기억을 좁은 범위에서 빠르게 찾는다.

앵커는 DB에 영구 저장되어 서버 재시작 후에도 자동으로 복원된다. `owner_id`로 에이전트마다 독립된 앵커맵을 가질 수 있다.

### relation

메모리 간 관계를 추출하고 관리한다. 두 레이어가 있다:
- **`memory_link` 테이블**: 기억 간 명시적 관계(`cause_of`, `derived_from`, `duplicates`, `contradicts`, `version_of`)를 저장한다.
- **Triple 추출**: `ExtractTriplesTool`이 에피소드 기억에서 Subject–Predicate–Object Triple을 추출해 `memory_item`의 semantic 레코드로 저장한다. 에피소드 저장 시 비동기로 큐에 등록되고, `TripleExtractionBatchJob`이 배치로 처리한다.

`triple_extracted_status` 컬럼이 처리 상태를 추적하여 실패 시 재시도한다.

### procedural

버전 관리가 가능한 절차 기억. 동일한 워크플로우의 여러 버전을 `version_series_id`로 추적한다. `remember_procedure`로 새 버전을 저장하고, `procedural_diff`로 버전 간 차이를 확인하고, `procedural_rollback`으로 이전 버전으로 되돌린다.

### consolidation

에피소드 기억을 시맨틱 기억으로 증류하는 **Sleep Consolidation** 서비스. `SleepConsolidationService`가 1시간마다 실행되어 에피소드 기억에서 핵심 사실을 시맨틱 메모리로 응축한다. 이름이 "수면 통합"인 것은, 인간이 자는 동안 단기 기억이 장기 기억으로 전환되는 기제를 모사하기 때문이다.

### monitoring

세 계층의 모니터링이 있다:
- **`ErrorLoggingService`**: LOW/MEDIUM/HIGH/CRITICAL 심각도와 DATABASE/NETWORK/VALIDATION 등 카테고리별 구조화된 오류 로깅.
- **`PerformanceMonitor`**: 메모리·CPU·데이터베이스 크기·쿼리 시간 경보를 모니터 소유 단일 스토어에 생성한다. `performance_alerts` 도구와 텔레메트리 요약이 같은 생명주기 상태를 읽고, 알림 서비스는 경보를 복제하지 않고 전달 이벤트만 발행한다.
- **`FailureDetector` + `ReflexionWorker`**: 반복 실패 패턴을 감지하고, `MetaMemoryIntrospectionService`가 신뢰도 낮은 기억을 식별해 자기 교정을 돕는다.

### telemetry

도구 호출과 메모리 접근 패턴을 추적한다. `TelemetryService`가 `owner_id`/`agent_id` 기반으로 컨텍스트를 격리하여 에이전트별 사용 통계를 제공한다. `get_telemetry_summary` 도구로 조회하고, HTTP 관리 API로도 접근 가능하다.

---

## MCP 도구 목록

서버가 에이전트에게 노출하는 18개 도구:

| 도구 | 카테고리 | 설명 |
|------|----------|------|
| `remember` | memory | 기억 저장 |
| `recall` | memory | 하이브리드 검색으로 기억 조회 |
| `forget` | memory | 기억 삭제 (소프트/하드) |
| `pin` / `unpin` | memory | 기억 고정·해제 |
| `feedback` | memory | 기억 유용성 피드백 |
| `memory_injection` | memory | 현재 세션에 기억을 주입하는 프롬프트 생성 |
| `get_memory_neighbors` | memory | 관련 기억 이웃 탐색 |
| `set_anchor` / `get_anchor` / `clear_anchor` | anchor | 컨텍스트 앵커 설정·조회·해제 |
| `search_local` | anchor | 앵커 주변 로컬 검색 |
| `remember_procedure` | procedural | 버전 관리 절차 기억 저장 |
| `procedural_diff` / `procedural_rollback` | procedural | 버전 비교·롤백 |
| `extract_triples` | relation | 에피소드에서 Triple 수동 추출 |
| `get_introspection_summary` | meta | 메모리 품질 인트로스펙션 요약 |
| `get_telemetry_summary` | telemetry | 에이전트 사용 통계 조회 |

---

## BatchScheduler와 백그라운드 파이프라인

`BatchScheduler`가 다음 작업들을 주기적으로 관리한다. 작업마다 타임아웃·재시도 정책이 있고, HTTP 관리 API(`/admin/batch/run`)로 수동 실행도 가능하다.

| 작업 | 기본 주기 | 역할 |
|------|-----------|------|
| `triple_extraction` | 1시간 | 미처리 에피소드에서 Triple 추출 |
| `sleep_consolidation` | 1시간 | 에피소드 → 시맨틱 증류 |
| `consolidation_score_incremental` | 1시간 | 통합 점수 증분 업데이트 |
| `consolidation_score_full_sweep` | 24시간 (새벽 3시) | 전체 통합 점수 재계산 |
| `quality_measurement` | 24시간 | 메모리 품질 측정 |
| `forgetting_cleanup` | 24시간 | TTL 만료 기억 정리 |
| `memory_review_candidates` | 24시간 | 복습 후보 갱신 |
| `meta_memory_introspection` | 6시간 | 신뢰도 낮은 기억 식별 |
| `relation_validation` | 7일 (일요일 새벽 2시) | 관계 유효성 검증 |
| `log_rotation` | 24시간 | 로그 파일 순환 |
| `telemetry_cleanup` | 24시간 | 텔레메트리 데이터 정리 |

Triple 추출은 두 단계로 이루어진다. `remember`가 에피소드를 저장할 때 잡큐에 per-item 작업을 등록한다. 1시간마다 실행되는 배치는 누락된 에피소드를 배치 크기 10개 단위로 처리한다. 실패한 항목은 `triple_extracted_status = 'failed'`로 기록되어 다음 배치에서 재처리된다.

---

## 데이터베이스

Memento는 현재 **SQLite(better-sqlite3)** 단일 스토리지를 사용한다. WAL 모드로 동시 읽기 성능을 확보하고, `WalCheckpointScheduler`가 WAL 파일을 주기적으로 체크포인트한다. `DatabaseLockMonitor`가 잠금 경합을 감시한다.

주요 테이블:
- **`memory_item`**: 모든 기억의 홈. 타입, 내용, 중요도, 태그, 임베딩 메타, Triple 필드, 버전 필드 등이 한 테이블에 있다.
- **`memory_tag` / `memory_item_tag`**: N:N 태그 관계.
- **`memory_link`**: 기억 간 명시적 관계.
- **`memory_embedding`**: 벡터 임베딩 (sqlite-vec ANN 검색).
- **`memory_item_fts`** (가상 테이블): FTS5 전문 검색 인덱스.
- **`anchor`**: 앵커 영구 저장 (migration 004).
- **`meta_memory_stats`**: 기억별 리콜 성공/실패 통계.
- **`telemetry_events` / `telemetry_daily_metrics`**: 텔레메트리 데이터.
- **`memory_review_candidate`**: 복습 후보 목록.
- **`kg_triple`**: 기억에서 추출된 Knowledge Graph Triple (중복 제거 포함).

스키마 변경은 `packages/memento-core/src/infrastructure/database/sqlite/migration/migrations/` 아래 번호 순으로 실행되는 마이그레이션으로 관리된다. 실행 가능한 DDL의 원본은 `schema.sql`이다.

PostgreSQL, Redis, Kubernetes 기반 멀티테넌트 확장은 현재 구현되어 있지 않다. 향후 로드맵 항목이다.

---

## 서비스 초기화 순서

서버가 시작될 때 `initializeServices(db)`가 다음 순서로 서비스를 초기화한다:

1. **검색 + 임베딩**: `HybridSearchEngine`, `MemoryEmbeddingService`, `ForgettingPolicyService`, `DatabaseOptimizer`
2. **구조화 로깅**: `ErrorLoggingService`
3. **앵커 스택**: `VectorSearchEngine`, `AnchorManager`
4. **실패 감지**: `FailureDetector`, `ReflexionWorker`
5. **모니터링 스케줄러**: `PerformanceMonitor`, `WalCheckpointScheduler`, `DatabaseLockMonitor`, `RuntimeDiagnosticsLogger`
6. **메타 + 콘솔리데이션**: `WriteCoalescingManager`, `ConsolidationScoreService`, `MetaMemoryService`
7. **배치 파이프라인**: `BatchScheduler`, `TelemetryService`, `RelationGraph`, `SleepConsolidationService`, `IntrospectionScanCache`
8. **런타임 진단 샘플러**: 부트스트랩 이벤트 기록

모든 서비스가 준비된 후에야 MCP 서버가 요청을 받기 시작한다.

---

관련 문서:
- [비동기 Augmentation 파이프라인](./async-augmentation-pipeline.md)
- [데이터베이스 설계](./database-design.md)
- [데이터베이스 ERD](./database-erd.md)
