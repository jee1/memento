# Issue #57 Phase 2 — B) 성능 최적화 설계

**일자**: 2026-02-05  
**관련 이슈**: [Issue #57](https://github.com/jee1/memento/issues/57) — Procedural Memory Phase 2  
**로드맵**: [roadmap.md](./roadmap.md) (3단계 B)

---

## 1. 목표·범위

**목표**: 이슈 #57의 "성능 최적화: 캐싱(steps-only 뷰 등), 추가 인덱스(FTS/JSON), recall 쿼리 프로파일링 및 튜닝"을 충족.

**범위**
- **캐싱**: procedural recall 결과에 대한 steps-only 응답 캐시 레이어 또는 기존 캐시 정책 확장. 대량 procedural 검색 시 응답 시간 단축.
- **인덱스**: procedural 버전 조회 가속을 위한 복합 인덱스 추가. FTS5는 기존 유지. JSON 필드에 대한 인덱스는 SQLite 제약 내에서 실용적 범위로.
- **recall 프로파일링**: recall 경로에서 쿼리 실행 시간·EXPLAIN QUERY PLAN 수집 옵션 제공. 튜닝 시 데이터 수집 가능하게 함.

**제외**: 검색 엔진 자체 알고리즘 변경(랭킹 등)은 기존 유지. 전역 쿼리 로그는 인프라 레벨에서 별도 다룸.

---

## 2. 현재 상태

- **FTS5**: `memory_item_fts` 존재. content, tags, source, reflection_notes 포함. 추가 인덱스는 마이그레이션 006 등에서 관리.
- **인덱스**: `idx_memory_item_workflow_name`, `idx_memory_item_skill_name`, `idx_memory_item_type` 존재. `version_series_id`, `version` 단독/복합 인덱스 없음.
- **캐싱**: `CoreMemoryCacheService`는 core_memory(앵커/핵심 메모리)용. recall 검색 결과 캐시는 미구현.
- **recall**: `return_format: 'steps_only'` 지원. procedural 버전 필터·version_chain 보강 이미 구현됨.

---

## 3. 캐싱 설계

### 3.1 정책

- **대상**: recall 호출 중 `type_filter`에 `procedural` 포함되고 `return_format === 'steps_only'`인 경우(선택 구현). 또는 procedural 전용 "경량 목록" 쿼리.
- **캐시 키**: `recall:procedural:steps_only:{query_hash}:{version_filter}:{limit}` 형태. query_hash는 search_query + filters의 결정론적 해시.
- **TTL**: 60초~300초(설정 가능). 무효화: remember/remember_procedure/forget로 해당 메모리 변경 시 관련 캐시 삭제(선택).
- **구현 위치**: `RecallTool` 내부 또는 `src/domains/memory/services/recall-cache-service.ts` 신규. 기존 `CoreMemoryCacheService`와 분리 유지(도메인 다름).

### 3.2 단계

1. **Phase B-1**: recall 결과 캐시 레이어 도입(선택). 비활성화 기본값으로 배포 후, 설정으로 활성화.
2. **Phase B-2**: 캐시 무효화 훅 — remember/remember_procedure/forget 성공 시 해당 memory_id 또는 쿼리 패턴 관련 캐시 무효화(선택).

**YAGNI**: 초기에는 "recall 프로파일링으로 병목 확인 후, 필요 시에만 캐시 도입"도 허용. 즉, 캐싱은 선택 구현으로 두고 인덱스·프로파일링을 우선할 수 있음.

---

## 4. 인덱스 설계

### 4.1 추가 인덱스

| 인덱스명 | 테이블 | 컬럼 | 목적 |
|----------|--------|------|------|
| `idx_memory_item_procedural_version_series` | memory_item | (type, version_series_id) | procedural 버전 시리즈별 조회 가속 |
| `idx_memory_item_procedural_version` | memory_item | (type, version_series_id, version) | getVersionChain, getLatestVersionInSeries, getNextVersionNumber 쿼리 가속 |

**조건**: `type = 'procedural'` AND `version_series_id = ?` (및 `version` 정렬) 패턴이 `procedural-versioning.ts`, `procedural-rollback-service.ts`, recall 버전 필터 후처리에서 사용됨.

### 4.2 마이그레이션

- 새 마이그레이션 파일: `014-procedural-version-indexes.ts` (또는 기존 013 이후 번호).
- `CREATE INDEX IF NOT EXISTS idx_memory_item_procedural_version_series ON memory_item(type, version_series_id) WHERE type = 'procedural';`
- `CREATE INDEX IF NOT EXISTS idx_memory_item_procedural_version ON memory_item(type, version_series_id, version) WHERE type = 'procedural';`
- SQLite는 partial index 지원하므로 `WHERE type = 'procedural'`로 procedural 전용 인덱스로 크기 절감.

### 4.3 FTS/JSON

- **FTS5**: 기존 유지. 별도 FTS 컬럼 추가는 이슈 범위 외.
- **JSON 인덱스**: SQLite에서는 steps(TEXT) 전체에 대한 인덱스만 가능. 단일 컬럼 인덱스는 이미 없음. 복합 인덱스에 steps를 넣으면 비효율적이므로 **구현하지 않음**. 필요 시 추후 JSON 함수 인덱스 검토.

---

## 5. recall 프로파일링 설계

### 5.1 요구사항

- recall 호출 시 (1) 전체 핸들러 소요 시간, (2) 검색 쿼리 실행 시간(벡터+FTS 등), (3) 선택적으로 EXPLAIN QUERY PLAN 출력을 로그 또는 구조화된 프로파일 결과로 남김.
- 기본적으로는 비활성화. 환경 변수 또는 툴 파라미터로 활성화.

### 5.2 구현 옵션

**옵션 A (권장)**: 환경 변수 `MEMENTO_RECALL_PROFILE=1`일 때만, recall 성공 응답 직전에 로그로 다음 출력:
- `recall_profile: { total_ms, search_ms?, version_filter_ms?, applied_filters }`
- (선택) `EXPLAIN QUERY PLAN` 결과를 debug 레벨 로그에 한 줄 요약.

**옵션 B**: recall 스키마에 `profile: true` 옵션 추가. true이면 응답 메타데이터에 `_profile: { total_ms, search_ms }` 포함. 클라이언트가 성능 확인 가능.

**선택**: 옵션 A로 1차 구현. 옵션 B는 필요 시 확장.

### 5.3 구현 위치

- `RecallTool.handle` 내부: 시작 시각 저장, 검색 호출 전후 시각 저장, 버전 필터/후처리 구간 시각 저장.
- 검색 엔진 호출부(`vector-search.repository`, `search-engine`)에서 소요 시간 반환하거나 콜백으로 전달. 최소 침습으로는 RecallTool에서 `handle` 전체 시간만 측정해도 됨.

### 5.4 튜닝

- 프로파일링으로 `search_ms`가 지배적이면: 인덱스 적용 여부 확인, FTS5 사용 여부 확인, limit·후보 수 조정 검토.
- 문서화: `docs/`에 "recall 성능 튜닝" 짧은 절 추가. 환경 변수·인덱스 요약 정리.

---

## 6. 에러 처리·테스트·파일 배치

**에러 처리**: 캐시/프로파일링 실패는 recall 자체를 실패시키지 않음. 로그만 남기고 계속 진행.

**테스트**
- 인덱스: 마이그레이션 014 스펙에서 인덱스 생성·down 시 삭제 검증.
- 프로파일링: recall 툴 스펙에서 `MEMENTO_RECALL_PROFILE=1` 시 로그 또는 응답에 프로파일 필드 존재하는지 검증.
- 캐시(구현 시): recall 동일 쿼리 2회 호출 시 두 번째가 캐시 히트인지(또는 프로파일에서 cache_hit 플래그) 검증.

**파일 배치**
- 마이그레이션: `src/infrastructure/database/database/migration/migrations/014-procedural-version-indexes.ts`, `.sql`, `.spec.ts`
- 스키마 반영: `src/infrastructure/database/database/schema.sql`에 인덱스 정의 추가(동기화)
- recall 프로파일링: `src/domains/memory/tools/recall-tool.ts` 내부 또는 `src/domains/memory/services/recall-profile.ts` 유틸
- 캐시(선택): `src/domains/memory/services/recall-cache-service.ts`

---

## 7. 우선순위 요약

1. **필수**: 인덱스 추가(014) + recall 프로파일링(환경 변수 + total_ms 로그).
2. **선택**: steps_only/procedural 전용 recall 캐시 레이어(설정으로 활성화).
3. **문서**: recall 성능 튜닝 가이드 짧은 절.

이 순서로 구현 계획에 반영한다.
