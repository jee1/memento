# Implementation Plan: Memento 기억 구조화 파이프라인 수정

**Branch**: `012-fix-memory-structuring` | **Date**: 2026-04-11 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `specs/012-fix-memory-structuring/spec.md`

---

## Summary

에피소딕 기억을 시맨틱 지식으로 자동 변환하는 파이프라인(Sleep Consolidation, Triple Extraction)의 버그와 잘못된 기본 설정을 수정한다. 핵심 수정 사항: ①스키마 불일치로 인한 트리플 추출 파이프라인 고장(Migration 030), ②공고화보다 망각 정리가 먼저 실행되는 타이밍 역전(인터벌 조정), ③중복 시맨틱 기억 축적(재요약 병합 로직), ④소프트 삭제 미작동(Migration 031 + 쿼리 필터), ⑤중복 경고 부재(remember-tool 확장), ⑥구조화 파이프라인 관측성 부재(텔레메트리 + admin API).

---

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js 20+), ES modules  
**Primary Dependencies**: better-sqlite3, zod, vitest — 신규 추가 없음  
**Storage**: SQLite (better-sqlite3) — Migration 030, 031 추가 (029는 타 브랜치 예약으로 건너뜀)  
**Testing**: vitest (단위 테스트 co-located), 기존 E2E 시나리오 테스트  
**Target Platform**: Linux/macOS 서버 프로세스 (MCP stdio + HTTP)  
**Project Type**: Library (`@memento/core`) + server (`memento-server`)  
**Performance Goals**: consolidation/triple extraction 배치 — 클러스터당 < 5초  
**Constraints**: SQLite 단일 파일 DB, MCP 프로토콜 비중단  
**Scale/Scope**: 단일 사용자 ~ 수십 에이전트, 수만 개 기억 레코드

**Spec traceability**: `spec.md` **FR-009**는 공고화 품질 블록을 다섯 가지 항목으로 열거하며 **SC-007**과 일치한다: 에피소딕 공고화율, 트리플 추출 성공률, 클러스터 처리 효율성, 최근 시맨틱 기억 생성 수(최근 7일), **파이프라인 오류 수**(최근 7일). 구현은 `consolidation_quality` 블록에 이 다섯 지표를 모두 포함한다.

### Terminology (spec ↔ implementation)

- **기억 주입** (`spec.md` 등) ↔ MCP 도구 `memory_injection` 및 해당 SQL·검색 경로.
- **조회·검색** ↔ `recall`, `search_local`, 하이브리드 검색(`vector-search-engine` 등) — 스펙의 “검색”은 단일 도구가 아니라 에이전트 대면 검색·조회 전반을 가리킨다.

---

## Constitution Check

| Gate | Status | Notes |
|------|--------|-------|
| I. Test-First (MUST) | REQUIRED | 각 변경 전 실패 테스트 작성 후 구현 |
| II. Backward Compatibility (MUST) | REQUIRED | MCP 도구 계약 변경 없음; remember 응답에 선택적 `similarity_warning` 필드 추가 — 기존 필드 유지 |
| III. Schema/Migration Discipline (MUST) | REQUIRED | Migration 030, 031 파일 생성 + schema.sql 동기화 필수 |
| IV. Quality Gates (MUST) | REQUIRED | `npm run lint && npm run type-check && npm test` |
| V. Observability (SHOULD) | PLANNED | 텔레메트리 + admin stats 엔드포인트 (스토리 5) |

---

## Project Structure

### Documentation (this feature)

```text
specs/012-fix-memory-structuring/
├── plan.md              # 이 파일
├── research.md          # Phase 0 출력
├── data-model.md        # Phase 1 출력
├── contracts/           # Phase 1 출력
│   └── admin-api-consolidation-stats.md
└── tasks.md             # Phase 2 출력 (/speckit.tasks)
```

### Source Code (affected files)

```text
packages/memento-core/src/
├── infrastructure/database/database/
│   ├── schema.sql                                   # [수정] triple_extracted 3컬럼 + is_deleted/deleted_at 추가
│   └── migration/migrations/
│       ├── 030-triple-extraction-fields.ts          # [신규] triple_extracted, triple_extracted_status, triple_extraction_metadata
│       └── 031-soft-delete-fields.ts                # [신규] is_deleted, deleted_at
├── domains/
│   ├── consolidation/services/
│   │   ├── clustering-service.ts                    # [수정] getMinClusterSize() 환경 변수화 (CONSOLIDATION_MIN_CLUSTER_SIZE, 기본 2), getSimilarityThreshold() 기본값 0.65
│   │   └── sleep-consolidation-service.ts           # [수정] 재요약 병합 로직 (유사도 ≥ 0.85 기존 시맨틱 탐지 + re-summarize + UPDATE)
│   ├── consolidation/repositories/
│   │   └── consolidation-repository.ts              # [수정] findEpisodicCandidates — is_deleted 필터 추가; findSemanticsByOwner() 신규 (병합 시 기존 시맨틱 후보 로드)
│   ├── forgetting/services/
│   │   └── forgetting-policy-service.ts             # [수정] softDeleteMemory() → is_deleted=1, deleted_at=now() 설정; TTL 만료 기준 소프트 삭제
│   ├── memory/
│   │   ├── tools/remember-tool.ts                   # [수정] 저장 성공 후 동일 ownerID 유사도 검사 → similarity_warning 필드 추가
│   │   └── repositories/queries/                    # [수정] 모든 검색·주입·공고화 쿼리에 is_deleted 필터
│   └── telemetry/
│       ├── repositories/telemetry-repository.ts     # [수정] consolidation_quality 블록 추가
│       └── tools/get-telemetry-summary-tool.ts      # [수정] consolidation_quality 출력
└── infrastructure/scheduler/
    └── batch-scheduler.ts                           # [수정] sleepConsolidationInterval 기본값 1h; cleanupInterval 24h + FORGETTING_CLEANUP_INTERVAL_MS 환경 변수

packages/memento-server/src/server/routes/
└── admin.routes.ts                                  # [수정] GET /admin/stats/consolidation 엔드포인트 추가
```

---

## Phase 0: Research

### 연구 대상

1. **Migration 030 설계**: 기존 Migration 008이 `triple_extracted` 등을 추가했지만 `schema.sql`에 반영 안 됨 → 새 DB는 해당 컬럼 없이 시작. 접근법: Migration 030에서 `ADD COLUMN IF NOT EXISTS` 패턴(기존 008과 중복 방지)으로 안전하게 추가.

2. **Migration 031 설계**: `is_deleted BOOLEAN DEFAULT FALSE NOT NULL`, `deleted_at TEXT` 컬럼 추가. 기존 `softDeleteMemory()` 는 실제로 소프트 삭제를 수행하지 않고 `last_accessed`만 수정함 — 완전 교체 필요.

3. **재요약 병합 패턴**: `SleepConsolidationService.run()` 내 클러스터 처리 루프에서, `INSERT` 전 `ConsolidationRepository.findSemanticsByOwner()`로 시맨틱 후보를 로드한 뒤 코사인 유사도 ≥ 0.85인 항목을 탐지 → 탐지되면 `SummarizationService.summarizeCluster()` 에 기존 시맨틱 content + 새 에피소딕들을 합쳐 재호출 → `UPDATE memory_item SET content=?, origin_source=?` 으로 갱신.

4. **is_deleted 쿼리 필터 범위**: 모든 에이전트 대상 조회(recall, memory_injection, search_local, 공고화 후보 쿼리)에 `AND (is_deleted IS NULL OR is_deleted = 0)` 추가 필요. 어드민 엔드포인트는 포함 여부 파라미터로 선택 가능.

5. **중복 경고 구현 위치**: `remember-tool.ts`에서 DB INSERT 성공 후, VectorSearchEngine으로 동일 ownerID + 유사도 ≥ 0.85 검색 수행 → 결과 있으면 `similarity_warning` 객체를 응답에 추가. 검색 실패는 경고 없이 통과 (FR-008 엣지 케이스).

---

## Research Findings

### Decision 1: Migration 030 중복 방지 전략
- **Decision**: `PRAGMA table_info`로 컬럼 존재 여부 확인 후 `ADD COLUMN` 실행 (Migration 008과 동일 패턴)
- **Rationale**: 일부 배포에 Migration 008이 이미 적용되어 있을 수 있음. `IF NOT EXISTS` 는 SQLite `ALTER TABLE ADD COLUMN`에서 지원 안 됨 — 존재 여부를 먼저 확인하는 방어 코드 필요
- **Alternatives**: `CREATE TABLE ... AS` 재구축 — 복잡성 대비 이점 없음

### Decision 2: 재요약 병합 — 기존 소스 참조 확장
- **Decision**: `origin_source` JSON에 기존 소스 ID + 신규 에피소딕 ID를 합산하여 재직렬화. `content`는 재요약 결과로 교체.
- **Rationale**: 소스 참조 추적이 감사 가능성에 중요. 기존 `origin_source` 구조 (`source_episodic_ids` 배열)를 그대로 활용.

### Decision 3: Forgetting 정리 인터벌 환경 변수
- **Decision**: `FORGETTING_CLEANUP_INTERVAL_MS` 신규 환경 변수 추가, 기본값 24h. 기존 `cleanupInterval` 기본값 1h → 24h로 변경.
- **Rationale**: FR-004 — "공고화가 정리보다 먼저". consolidation이 1h, cleanup이 24h이면 에피소딕이 삭제되기 전에 공고화 기회가 충분.

### Decision 4: CONSOLIDATION_LOOKBACK_DAYS
- **Decision**: `ConsolidationRepository.getLookbackDays()` 에서 `CONSOLIDATION_LOOKBACK_DAYS` 환경 변수 읽기 (기존 기본값 확인 후 90d로 조정).
- **Rationale**: 에피소딕 TTL 180d 이내에서 여러 공고화 기회를 보장.

### Decision 5: 소프트 삭제 + 쿼리 필터 범위
- **Decision**: `forgetting-policy-service.ts`의 `softDeleteMemory()`를 `is_deleted=1, deleted_at=now()`로 교체. 하드 삭제는 `deleted_at < now() - GRACE_PERIOD_DAYS`를 기준으로 별도 스윕 실행.
- **Rationale**: 기존 `softDeleteMemory()`는 실제로 소프트 삭제를 수행하지 않음 — 완전 재구현 필요. 에이전트 `forget` 도구는 별도 `DELETE FROM memory_item` 경로를 유지(변경 없음).

---

## Phase 1: Design & Contracts

### Data Model

→ [data-model.md](./data-model.md)

### API Contracts

→ [contracts/admin-api-consolidation-stats.md](./contracts/admin-api-consolidation-stats.md)

---

## Implementation Phases

### Phase A — 기초 수정 (P1 스토리 1~2 대응)

**목표**: 파이프라인이 실제로 실행되도록 기반 수정. 배포 후 SC-001~003 충족 가능.

**A1. Migration 030 — 트리플 추출 필드 (FR-003, FR-011)**
- 대상 파일: `030-triple-extraction-fields.ts` (신규)
- 변경: `memory_item`에 `triple_extracted BOOLEAN DEFAULT FALSE NOT NULL`, `triple_extracted_status TEXT`, `triple_extraction_metadata TEXT` 추가 (컬럼 미존재 시에만)
- `schema.sql` 동기화: `is_consolidated` 바로 아래에 3컬럼 + 인덱스 추가
- 테스트: Migration 030 up/down + validateAfter (컬럼 존재 확인)

**A2. ClusteringService 파라미터 환경 변수화 (FR-005)**
- 대상 파일: `clustering-service.ts`
- 변경:
  - `getMinClusterSize()`: `CONSOLIDATION_MIN_CLUSTER_SIZE` 환경 변수 읽기, 기본값 `2` (기존 하드코드 `5`)
  - `getSimilarityThreshold()`: 기본값 `0.65` (기존 `0.75`)
- 테스트: 환경 변수 미설정 시 기본값, 환경 변수 설정 시 적용 확인

**A3. BatchScheduler 인터벌 조정 (FR-004)**
- 대상 파일: `batch-scheduler.ts`
- 변경:
  - `sleepConsolidationInterval` 기본값: 24h → 1h (환경 변수 `SLEEP_CONSOLIDATION_INTERVAL_MS` 유지)
  - `cleanupInterval`: `FORGETTING_CLEANUP_INTERVAL_MS` 환경 변수 추가, 기본값 24h (기존 하드코드 1h)
- 테스트: 기본값 확인 단위 테스트

**A4. ConsolidationRepository 룩백 90d + is_deleted 필터 (FR-001, FR-006)**
- 대상 파일: `domains/consolidation/repositories/consolidation-repository.ts`
- 변경:
  - `getLookbackDays()` 기본값: 30d → 90d (환경 변수 `CONSOLIDATION_LOOKBACK_DAYS`)
  - `findEpisodicCandidates()` 쿼리: `AND (m.is_deleted IS NULL OR m.is_deleted = 0)` 추가
- 주의: Migration 031이 `is_deleted` 컬럼을 추가하기 전이면 이 필터가 필요 없지만, 쿼리는 `IS NULL` 포함으로 기존 DB와 호환 가능

---

### Phase B — 중복 시맨틱 병합 (P1 스토리 1 핵심)

**목표**: 공고화 재실행 시 중복 시맨틱 생성 방지. SC-004 충족.

**B1. ConsolidationRepository — findSemanticsByOwner()**
- 대상 파일: `domains/consolidation/repositories/consolidation-repository.ts`
- 변경: `findSemanticsByOwner(ownerId)` 메서드 추가 — 특정 ownerID의 시맨틱 기억 id + content + origin_source 반환 (유사도 ≥ 0.85 매칭은 서비스 레이어에서 임베딩 비교)

**B2. SleepConsolidationService — 재요약 병합 로직 (FR-002)**
- 대상 파일: `sleep-consolidation-service.ts`
- 변경: 클러스터 루프 내 `insertSemanticMemory` 전에:
  1. `repo.findSemanticsByOwner(cluster.ownerId)` 호출
  2. 각 시맨틱에 대해 임베딩 코사인 유사도 계산 (클러스터 요약 vs 기존 시맨틱)
  3. 유사도 ≥ 0.85 시맨틱 발견 → `summarizationService.summarizeCluster()` 에 기존 시맨틱 content를 첫 에피소딕으로 추가하여 재호출
  4. 재요약 결과로 기존 시맨틱 content + origin_source 업데이트 (`repo.updateSemanticMemory()`)
  5. 신규 INSERT 생략; `result.semanticsCreated` 대신 `semanticsMerged` 카운터 추가
  6. **동시 실행(스펙 엣지 케이스)**: 이전 공고화 실행이 아직 진행 중이면 새 `run()` 호출은 정상적으로 거부/무시되어 중복 처리가 나지 않도록 단일 비행 락 또는 동등한 가드 적용
- 테스트: 유사한 클러스터 2회 공고화 → 시맨틱 2개가 아닌 1개 (content 갱신)

**NFR (성능)**: 클러스터당 처리 목표 < 5초는 구현 시 루프·LLM 호출·DB 경로를 과도하게 직렬화하지 않도록 하고, 필요 시 단위/통합 테스트에서 모킹된 빠른 경로로 상한을 검증한다(플래키 방지 위해 엄격한 ms 단언은 선택).

---

### Phase C — 소프트 삭제 (P2 스토리 3)

**목표**: TTL 만료 기억이 검색에서 즉시 제외, 30일 유예 후 하드 삭제. SC-005 충족.

**C1. Migration 031 — 소프트 삭제 필드 (FR-006, FR-007)**
- 대상 파일: `031-soft-delete-fields.ts` (신규)
- 변경: `memory_item`에 `is_deleted BOOLEAN DEFAULT FALSE NOT NULL`, `deleted_at TEXT` 추가
- `schema.sql` 동기화
- 테스트: Migration 031 up/down

**C2. ForgettingPolicyService — 소프트 삭제 구현 (FR-006, FR-007)**
- 대상 파일: `forgetting-policy-service.ts`
- 변경:
  - `softDeleteMemory()` 완전 재구현: `UPDATE memory_item SET is_deleted=1, deleted_at=? WHERE id=?`
  - `hardDeleteSoftDeleted()` 신규 메서드: `DELETE FROM memory_item WHERE is_deleted=1 AND deleted_at < ?` (유예 기간 = `SOFT_DELETE_GRACE_PERIOD_DAYS` 환경 변수, 기본 30d)
  - 고정(pinned) 기억 소프트 삭제 시 무시 (기존 `!r.features.pinned` 체크 유지)
  - `executeMemoryCleanup()` 내 하드 삭제 단계: 점수 기반 → 소프트 삭제된 것 중 유예 기간 초과분 하드 삭제로 교체

**C3. 쿼리 필터 추가 (FR-006)**
- 대상 파일: 검색·주입·공고화 관련 모든 쿼리 (아래 목록)
  - `consolidation-repository.ts` (A4에서 처리)
  - `core-memory-repository-sqlite.impl.ts`
  - `vector-search-engine.ts` (SQL 쿼리 부분)
  - `memory-neighbor-service.ts`
  - `memory-injection` 관련 쿼리
- 변경: `WHERE ... AND (is_deleted IS NULL OR is_deleted = 0)` 추가
- 테스트: 소프트 삭제된 기억이 recall/search_local/memory_injection 결과에 나타나지 않음

---

### Phase D — 중복 경고 (P2 스토리 4)

**목표**: 저장 시 유사 기억 존재를 에이전트에게 알림. SC-006 충족.

**D1. RememberTool — 유사도 경고 (FR-008)**
- 대상 파일: `remember-tool.ts`
- 변경: DB INSERT 성공 후 (augmentation 큐 등록 전):
  1. `VectorSearchEngine` 또는 `getVectorSearchEngine()` 으로 동일 ownerID 내 유사도 ≥ 0.85 검색 (top-3 반환)
  2. 결과 있으면 응답 JSON에 `similarity_warning: { count: N, similar_ids: [...] }` 추가
  3. 검색 실패 또는 결과 없으면 `similarity_warning` 필드 생략 (기존 응답과 동일)
  4. ownerID null인 경우 null 소유자 기억들 사이에서만 검색
- 테스트: 유사 기억 후 저장 → 경고 포함; 다른 기억 저장 → 경고 없음; 검색 실패 → 경고 없이 저장 성공

---

### Phase E — 관측성 (P3 스토리 5)

**목표**: 파이프라인 상태를 에이전트/운영자가 조회 가능. SC-007 충족.

**E1. TelemetryRepository — consolidation_quality 블록 (FR-009, SC-007)**
- 대상 파일: `telemetry-repository.ts`
- 변경: `queryMemoryQuality()` 반환값에 `consolidation_quality` 추가:
  - `episodic_consolidation_rate`: `is_consolidated=1` 에피소딕 수 / 전체 에피소딕 수
  - `triple_extraction_success_rate`: `triple_extracted_status='success'` 수 / `triple_extracted=1` 수
  - `cluster_processing_efficiency`: `telemetry_events` 테이블에서 최근 `consolidation.performed` 이벤트의 `clusters_processed / clusters_found` 평균
  - `recent_semantic_count_7d`: 지난 7일간 생성된 시맨틱 기억 수
  - `pipeline_error_count`: **SC-007**의 “파이프라인 오류 수” — 최근 7일 내 구조화 파이프라인 관련 `telemetry_events` 실패/오류 건수 (FR-009 다섯 번째 지표)

**E2. GetTelemetrySummaryTool — consolidation_quality 출력 (FR-009)**
- 대상 파일: `get-telemetry-summary-tool.ts`
- 변경: `memory_quality` 블록 옆에 `consolidation_quality` 블록 출력 (null-safe)

**E3. Admin API — /admin/stats/consolidation (FR-010, SC-007)**
- 대상 파일: `admin.routes.ts`
- **Contract (필수)**: 응답 필드·중첩 구조는 [contracts/admin-api-consolidation-stats.md](./contracts/admin-api-consolidation-stats.md)와 일치해야 한다. 파일이 없으면 Phase E 구현 착수 전에 FR-010·본 절을 기준으로 작성한다. HTTP 라우트 테스트는 계약에 명시된 키를 기준으로 단언한다.
- 변경: `GET /admin/stats/consolidation` 신규 엔드포인트:
  - 응답: 주간 시맨틱 기억 생성 시계열, 트리플 추출 상태 분포, 최근 공고화 실행 요약, **파이프라인 오류 건수/요약**(텔레메트리 `pipeline_error_count`와 동일 정의 또는 하위 집합)
  - 데이터 소스: `telemetry_events` + `memory_item` 직접 쿼리

---

## Release verification (SC-001, SC-003, SC-004)

단위·통합 테스트만으로는 재현하기 어려운 **시간 창·플릿 비율** 기준이다. 수정 배포 후 **스테이징 또는 프로덕션 모니터링**으로 확인하고, 결과는 PR·이슈·릴리스 노트 등에 기록한다 (`tasks.md` T038).

- **SC-001** (배포 후 24시간 이내, 지난 90일 에피소딕 중 클러스터 임계 충족 분의 30% 이상이 시맨틱으로 공고화): `get_telemetry_summary`의 `consolidation_quality`·어드민 지표 또는 DB 집계로 에피소딕 공고화 비율과 표본 크기를 **24시간 윈도우 종료 시점**에 재측정한다.
- **SC-003** (배포 후 첫 1주일 이내 `clusters_processed / clusters_found` > 0.5): `cluster_processing_efficiency`(또는 동일 정의) 주간·일간 집계로 확인한다.
- **SC-004** (배포 후 4주 이내 주당 신규 시맨틱 생성률 안정화): 어드민 **주간 시맨틱 시계열**(또는 주차별 `type=semantic` 생성 수) 추세를 보고 급격한 선형 증가가 완화되는지 판단한다(수치+정성).

---

## Implementation Order & Dependencies

```
A1 (Migration 030) ──→ A4 (lookup days + filter)
A2 (ClusteringService)
A3 (BatchScheduler)
              ↓
         B1 (findSemanticsByOwner) ──→ B2 (re-summarize merge)
              ↓
C1 (Migration 031) ──→ C2 (ForgettingPolicy) ──→ C3 (query filters)
              ↓
         D1 (remember dedup warning)
              ↓
    E1 (telemetry) ──→ E2 (tool output) ──→ E3 (admin endpoint)
```

A1~A4는 병렬 가능. B는 A4 완료 후. C1은 독립. C2/C3는 C1 완료 후. D는 C3 완료 후 (is_deleted 필터 필요). E는 D 완료 후. E3 **계약 문서**(`tasks.md` T032)는 라우트·HTTP 테스트(T033–T034)보다 선행한다.

---

## Constitution Compliance

| Principle | How Met |
|-----------|---------|
| I. Test-First | 각 Phase 단위마다 실패 테스트 먼저 작성 (Red → Green → Refactor) |
| II. Backward Compatibility | `remember` 응답에 선택적 `similarity_warning` 추가 — 기존 필드 유지. MCP 도구 스키마 변경 없음 |
| III. Schema + Migration | Migration 030, 031 파일 + schema.sql 동기화. 기존 Migration 008 의존성 고려한 중복 방지 |
| IV. Quality Gates | 각 Phase 완료 후 `npm run lint && npm run type-check && npm test` |
| V. Observability | Phase E에서 텔레메트리 블록 + admin endpoint로 파이프라인 상태 가시화 |

---

## Risk & Mitigation

| Risk | Mitigation |
|------|-----------|
| Migration 008이 일부 DB에 적용, 030에서 중복 ADD COLUMN 실패 | `PRAGMA table_info` 컬럼 존재 확인 후 조건부 ADD |
| 재요약 병합 중 LLM 실패 → extractive fallback으로도 기존 시맨틱 덮어쓸 수 있음 | 병합 성공 시에만 UPDATE; 재요약 실패(빈 결과) 시 새 독립 INSERT로 폴백 (기존 시맨틱 보호) |
| is_deleted 필터 누락으로 소프트 삭제된 기억 노출 | Phase C3에서 모든 조회 경로 체계적 수정 + 검색 결과 포함 여부 검증 테스트 |
| remember-tool 유사도 검색 실패로 저장 차단 | try-catch로 래핑, 검색 실패 시 경고 없이 저장 성공 처리 |

---

## Complexity Tracking

해당 사항 없음. 모든 변경은 기존 도메인 경계 내에서 이루어지며 새로운 패키지/추상화를 추가하지 않는다.
