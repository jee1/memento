# Tasks: Procedural Memory Enhancement

이 문서는 `0011-prd-procedural-memory-enhancement.md` PRD를 기반으로 생성된 구현 작업 목록입니다.

## Relevant Files

### 데이터베이스 스키마 및 마이그레이션
- `src/infrastructure/database/sqlite/migration/migrations/007-procedural-memory-enhancement.sql` - Procedural Memory 스키마 확장 마이그레이션 SQL (신규 생성)
  - `memory_item` 테이블에 `workflow_name`, `skill_name`, `trigger_conditions` 필드 추가
  - `memory_link` 테이블의 `relation_type` enum 확장 (버전 관리용: 'version_of' 추가)
- `src/infrastructure/database/sqlite/migration/migrations/007-procedural-memory-enhancement.ts` - 마이그레이션 실행 클래스 (신규 생성)
- `src/infrastructure/database/sqlite/migration/migrations/007-procedural-memory-enhancement.spec.ts` - 마이그레이션 테스트 (신규 생성)
- `src/infrastructure/database/sqlite/schema.sql` - 데이터베이스 스키마 정의 (업데이트)

### 타입 시스템 및 검증
- `src/shared/types/index.ts` - 타입 정의 (MemoryItem, RememberParams, RecallParams, MemorySearchResult 확장) (수정됨)
- `src/shared/utils/type-param-validator.ts` - 타입 파라미터 검증 유틸리티 (새 필드 검증 로직 추가) (수정됨)
- `src/shared/types/relation.ts` - 관계 타입 정의 (RelationType에 'VERSION_OF' 추가, ALL_RELATION_TYPES, RELATION_TYPE_BOOST_MAP, RELATION_TYPE_CATEGORY_MAP, MEMORY_TYPE_RELATION_MAP 업데이트) (수정됨)
- `src/shared/utils/relation-type-converter.ts` - DB relation_type ↔ TypeScript RelationType 변환 유틸리티 (신규 생성)
  - `memory_link` 테이블의 소문자 스네이크 케이스 ('version_of') ↔ TypeScript enum 대문자 스네이크 케이스 ('VERSION_OF') 변환
- `src/domains/relation/services/relation-graph.ts` - 관계 그래프 서비스 (허용 타입 필터/쿼리 점검 및 'VERSION_OF' 지원) (수정됨)

### MCP Tools
- `src/domains/memory/remember/remember-tool.ts` - remember Tool 확장 (workflow_name, skill_name, trigger_conditions, update_mode 지원) (수정됨)
- `src/domains/memory/tools/__tests__/remember-tool.spec.ts` - remember Tool 테스트 (수정됨)
- `src/domains/memory/recall/recall-tool.ts` - recall Tool 확장 (새 검색 옵션 및 반환 형식 선택) (수정됨)
- `src/domains/memory/tools/__tests__/recall-tool.spec.ts` - recall Tool 테스트 (수정됨)

### 저장/조회 레이어
- `src/shared/utils/database.ts` - DatabaseUtils (새 필드 읽기/쓰기 지원, `memory_link` relation_type enum 확장) (수정됨)
- `src/test/test-http-server-v2.ts` - HTTP 서버 테스트 인라인 스키마 (`memory_link` relation_type enum 확장) (수정됨)
- `src/domains/search/repositories/vector-search.repository.ts` - 벡터 검색 저장소 (새 필드 반환 지원) (수정됨)
- `src/domains/search/repositories/__tests__/vector-search.repository.spec.ts` - 벡터 검색 저장소 테스트 (수정됨)

### Reflexion 연동
- `src/infrastructure/reflexion-worker.ts` - Reflexion Worker 확장 (reflection_notes를 procedural memory로 자동 변환) (수정됨)
- `src/services/reflexion-worker.spec.ts` - Reflexion Worker 테스트 (수정됨, 기존 파일 위치 유지)
- `src/domains/memory/procedural/procedural-memory-extractor.ts` - Reflexion 결과에서 procedural memory 정보 추출 유틸리티 (신규 생성)
- `src/domains/memory/procedural/procedural-memory-extractor.spec.ts` - 추출 유틸리티 테스트 (신규 생성, 같은 디렉토리에 배치)

### 검색 기능
- `src/domains/search/algorithms/hybrid-search-engine.ts` - 하이브리드 검색 엔진 (procedural memory 특화 가중치 추가) (수정됨)
- `src/domains/search/algorithms/search-ranking.ts` - 검색 랭킹 알고리즘 (procedural memory 특화 가중치 추가) (수정됨)
- `src/domains/search/algorithms/__tests__/hybrid-search-engine.spec.ts` - 하이브리드 검색 엔진 테스트 (수정됨)
- `src/domains/search/algorithms/__tests__/search-ranking.spec.ts` - 검색 랭킹 알고리즘 테스트 (수정됨)

### Notes

- **테스트 파일 위치 규칙**:
  - `src/domains/*/tools/__tests__/`, `src/domains/*/algorithms/__tests__/`, `src/infrastructure/*/__tests__/` 등: `__tests__` 서브디렉토리 사용
  - `src/shared/utils/`: 같은 디렉토리에 `.spec.ts` 파일 배치 (예: `database.spec.ts`, `type-param-validator.spec.ts`)
  - `src/services/`: 같은 디렉토리에 `.spec.ts` 파일 배치 (예: `reflexion-worker.spec.ts`)
  - 기존 파일 위치는 유지하며, 신규 파일은 해당 디렉토리의 기존 패턴을 따릅니다.
- `npm test` 명령으로 전체 테스트를 실행할 수 있습니다.
- 마이그레이션 스크립트는 `src/infrastructure/database/sqlite/migration/migrations/` 디렉토리에 버전별로 관리하며, `.sql`, `.ts`, `.spec.ts` 파일 조합으로 구성됩니다.
- 기존 `task_goal`, `steps`, `reflection_notes` 필드는 그대로 유지하며, 새 필드(`workflow_name`, `skill_name`, `trigger_conditions`)와 병행 사용합니다.
- 업데이트 모드(교체/증분/버전 관리)는 remember Tool 핸들러에서 처리하며, 버전 관리 모드의 경우 `memory_link` 테이블을 활용합니다.
- **중요: `memory_link` relation_type enum 확장 및 변환 매핑**:
  - 버전 관리 모드를 위해 `memory_link` 테이블의 `relation_type` enum을 확장해야 합니다.
  - 현재 허용값: `('cause_of', 'derived_from', 'duplicates', 'contradicts')`
  - **추가할 relation_type 값 (권장)**: `'version_of'` (단일 값 사용)
    - 의미: 새 버전이 이전 버전을 가리킴 (예: `source_id` = 새 버전, `target_id` = 이전 버전, `relation_type` = 'version_of')
    - 장점: 단일 값으로 단순하고 명확하며, 역방향 조회는 쿼리로 처리 가능
    - 대안: `'previous_version'`, `'next_version'` 두 값을 사용할 수도 있으나, 단일 값이 더 단순하고 유지보수가 쉬움
  - **DB 값 ↔ TypeScript enum 변환**:
    - `memory_link` 테이블: 소문자 스네이크 케이스 ('version_of', 'cause_of', 'derived_from', 'contradicts', 'duplicates')
    - TypeScript `RelationType`: 대문자 스네이크 케이스 ('VERSION_OF', 'CAUSES', 'DEPENDS_ON', 'CONTRASTS_WITH')
    - 변환 유틸리티: `src/shared/utils/relation-type-converter.ts`에서 매핑 관리
    - 매핑 규칙: `{ 'VERSION_OF': 'version_of', 'CAUSES': 'cause_of', 'DEPENDS_ON': 'derived_from', 'CONTRASTS_WITH': 'contradicts' }`
    - **'duplicates' 처리**: DB에는 존재하지만 TypeScript enum에 대응값이 없음 (005 마이그레이션에서 제거됨). `fromDbRelationType`에서 `null` 반환하여 무시, `relation-graph.ts`에서도 필터링하여 처리하지 않음
    - 사용 위치: `remember-tool.ts`에서 memory_link 생성 시 `toDbRelationType` 사용, DB 조회 시 `fromDbRelationType` 사용
  - **수정 대상 파일**:
    - `src/infrastructure/database/sqlite/schema.sql` (마이그레이션 007)
    - `src/shared/utils/database.ts` (테스트용 DB 생성 함수)
    - `src/test/test-http-server-v2.ts` (인라인 스키마)

## Tasks

- [x] 1.0 데이터베이스 스키마 확장 및 마이그레이션 구현
  - [x] 1.1 `007-procedural-memory-enhancement.sql` 파일 생성 (memory_item 테이블 필드 추가, memory_link relation_type enum 확장)
  - [x] 1.2 `007-procedural-memory-enhancement.ts` 마이그레이션 클래스 구현 (Migration 인터페이스 구현, validateBefore/validateAfter 포함)
  - [x] 1.3 `007-procedural-memory-enhancement.spec.ts` 마이그레이션 테스트 작성 (up/down, 검증 로직 테스트)
  - [x] 1.4 `src/infrastructure/database/sqlite/schema.sql` 업데이트 (새 필드 및 enum 확장 반영)
  - [x] 1.5 `src/shared/utils/database.ts`의 `initializeDatabase` 메서드 업데이트 (테스트용 DB 생성 시 새 필드 및 enum 포함)
  - [x] 1.6 `src/test/test-http-server-v2.ts`의 인라인 스키마 업데이트 (memory_link relation_type enum 확장)

- [ ] 2.0 타입 시스템 및 검증 계층 업데이트
  - [x] 2.1 `src/shared/types/index.ts`의 `MemoryItem` 인터페이스 확장 (workflow_name, skill_name, trigger_conditions 필드 추가)
  - [x] 2.2 `src/shared/types/index.ts`의 `RememberParams` 인터페이스 확장 (workflow_name, skill_name, trigger_conditions, update_mode 필드 추가)
  - [x] 2.3 `src/shared/types/index.ts`의 `RecallParams` 인터페이스 확장 (workflow_name, skill_name, match_trigger_conditions, return_format 필드 추가)
  - [x] 2.4 `src/shared/types/index.ts`의 `MemorySearchResult` 인터페이스 확장 (새 필드 포함, return_format에 따른 조건부 반환 지원)
  - [x] 2.5 `src/shared/utils/type-param-validator.ts`에 새 필드 검증 로직 추가 (trigger_conditions JSON 검증, workflow_name/skill_name 빈 문자열 방지)
  - [x] 2.6 `src/shared/types/relation.ts`의 `RelationType` 타입에 'VERSION_OF' 추가 (버전 관리 관계 타입)
  - [x] 2.7 `src/shared/types/relation.ts`의 `ALL_RELATION_TYPES` 배열에 'VERSION_OF' 추가
  - [x] 2.8 `src/shared/types/relation.ts`의 `RELATION_TYPE_BOOST_MAP`에 'VERSION_OF' 추가 (기본 부스트 값 설정, 권장: 1.0)
  - [x] 2.9 `src/shared/types/relation.ts`의 `RELATION_TYPE_CATEGORY_MAP`에 'VERSION_OF' 추가 (카테고리 설정, 권장: 'Structural')
  - [x] 2.10 `src/shared/types/relation.ts`의 `MEMORY_TYPE_RELATION_MAP`에 'VERSION_OF' 추가 (procedural 타입에 적용 가능하도록 설정)
  - [x] 2.11 `src/shared/utils/relation-type-converter.ts` 변환 유틸리티 생성 (DB 'version_of' ↔ TypeScript 'VERSION_OF' 변환 함수)
    - `toDbRelationType(relationType: RelationType): string` - TypeScript enum → DB 값 변환
    - `fromDbRelationType(dbValue: string): RelationType | null` - DB 값 → TypeScript enum 변환
    - 매핑 맵 정의: `{ 'VERSION_OF': 'version_of', 'CAUSES': 'cause_of', 'DEPENDS_ON': 'derived_from', 'CONTRASTS_WITH': 'contradicts' }`
    - 'duplicates' 처리: Notes 섹션의 "DB 값 ↔ TypeScript enum 변환" 참조
  - [x] 2.12 `src/domains/relation/services/relation-graph.ts` 점검 및 업데이트 (허용 타입 필터/쿼리에서 'VERSION_OF' 지원 확인, 필요 시 수정)
    - 'duplicates' 처리: Notes 섹션의 "DB 값 ↔ TypeScript enum 변환" 참조
    - `get-relations-tool.ts`와 `add-relation-tool.ts`의 Zod 스키마 및 JSON 스키마에 'VERSION_OF' 추가
    - `relation-quality-validator.ts`의 모든 Record<RelationType, ...> 타입에 'VERSION_OF' 추가
    - `rule-based-relation-extractor.ts`의 `RELATION_KEYWORD_PATTERNS`에 'VERSION_OF' 키워드 패턴 추가

- [x] 3.0 remember Tool 확장 (workflow_name, skill_name, trigger_conditions, update_mode 지원)
  - [x] 3.1 `remember-tool.ts`의 `RememberSchema` (Zod) 확장 (workflow_name, skill_name, trigger_conditions, update_mode 파라미터 추가)
  - [x] 3.2 `remember-tool.ts`의 BaseTool `inputSchema` 확장 (JSON Schema에 새 필드 추가)
  - [x] 3.3 `remember-tool.ts`에 파라미터 검증 로직 추가 (trigger_conditions JSON 검증, workflow_name/skill_name 빈 문자열 방지)
  - [x] 3.4 `remember-tool.ts`의 `handle` 메서드에 새 필드 저장 로직 추가 (INSERT 쿼리에 새 필드 포함)
  - [x] 3.5 `remember-tool.ts`에 업데이트 모드 처리 로직 구현 (교체/증분/버전 관리 모드, 버전 관리 시 memory_link 생성)
    - 버전 관리 모드에서 memory_link 생성 시 `relation-type-converter.ts`의 `toDbRelationType` 사용 ('VERSION_OF' → 'version_of')
  - [x] 3.6 `remember-tool.ts`의 기존 procedural memory 조회 로직 확장 (업데이트 모드에 따른 기존 항목 검색)
  - [x] 3.7 `__tests__/remember-tool.spec.ts` 테스트 작성/수정 (새 필드 저장, 업데이트 모드, 검증 로직 테스트)

- [x] 4.0 recall Tool 확장 (새 검색 옵션 및 반환 형식 선택)
  - [x] 4.1 `recall-tool.ts`의 `RecallSchema` (Zod) 확장 (workflow_name, skill_name, match_trigger_conditions, return_format 파라미터 추가)
  - [x] 4.2 `recall-tool.ts`의 BaseTool `inputSchema` 확장 (JSON Schema에 새 필드 추가)
  - [x] 4.3 `recall-tool.ts`에 workflow_name/skill_name 필터링 로직 추가 (WHERE 절에 조건 추가)
    - `MemorySearchFilters` 타입에 workflow_name, skill_name 추가
    - `search-engine.ts`에 필터 처리 로직 추가
    - SELECT 쿼리에 새 필드 포함
  - [x] 4.4 `recall-tool.ts`에 trigger_conditions 매칭 로직 추가 (match_trigger_conditions=true일 때 JSON 매칭)
    - `filterByTriggerConditions` 메서드 추가
  - [x] 4.5 `recall-tool.ts`에 return_format 처리 로직 추가 (steps_only일 때 steps만 반환)
    - `processSearchResults` 메서드에 return_format 파라미터 추가
  - [x] 4.6 `__tests__/recall-tool.spec.ts` 테스트 작성/수정 (새 검색 옵션, 반환 형식 선택 테스트)

- [x] 5.0 저장/조회 레이어 업데이트 (새 필드 읽기/쓰기 지원)
  - [x] 5.1 `src/shared/utils/database.ts`의 `initializeDatabase` 메서드에 새 필드 및 enum 확장 반영 (1.5에서 이미 완료 확인)
  - [x] 5.2 `src/test/test-http-server-v2.ts`의 인라인 스키마에 새 필드 및 enum 확장 반영 (workflow_name, skill_name, trigger_conditions 추가)
  - [x] 5.3 `src/domains/search/repositories/vector-search.repository.ts`의 검색 결과 매핑에 새 필드 포함 (workflow_name, skill_name, trigger_conditions 반환)
    - search 메서드의 SELECT 쿼리 및 결과 매핑에 새 필드 추가
    - hybridSearch 메서드의 SELECT 쿼리 및 결과 매핑에 새 필드 추가
  - [x] 5.4 `src/domains/search/repositories/__tests__/vector-search.repository.spec.ts` 테스트 작성/수정 (새 필드 반환 검증)

- [x] 6.0 Reflexion 자동 연동 (reflection_notes를 procedural memory로 자동 변환)
  - [x] 6.1 `src/domains/memory/procedural/procedural-memory-extractor.ts` 유틸리티 생성 (reflection_notes에서 workflow_name, skill_name, steps 추출)
  - [x] 6.2 `procedural-memory-extractor.ts`에 trigger_conditions 자동 생성 로직 구현 (실패 이벤트 정보 기반)
  - [x] 6.3 `procedural-memory-extractor.ts`에 유사도 기반 병합 로직 구현 (기존 procedural memory와 유사도 계산, 임계값 기반 업데이트/생성 결정)
  - [x] 6.4 `src/infrastructure/reflexion-worker.ts`에 자동 변환 로직 통합 (reflection_notes 생성 시 procedural memory 변환 시도)
    - `convertToProceduralMemory` 메서드 추가
    - `updateProceduralMemory` 메서드 추가 (replace, incremental, versioned 모드 지원)
    - `createProceduralMemory` 메서드 추가
    - `autoReflect` 메서드에서 자동 변환 호출
  - [x] 6.5 `reflexion-worker.ts`에 업데이트 모드 선택 로직 추가 (기본값: 증분 모드, 유사도 기반 자동 결정)
    - `determineMergeStrategy`를 사용하여 유사도 기반 업데이트 모드 결정
  - [x] 6.6 `src/domains/memory/procedural/procedural-memory-extractor.spec.ts` 테스트 작성 (추출 로직, 유사도 계산, 병합 로직 테스트)
  - [x] 6.7 `src/services/reflexion-worker.spec.ts` 테스트 수정 (자동 변환 통합 테스트)

- [x] 7.0 검색 기능 강화 (하이브리드 랭킹에 procedural memory 특화 가중치 추가)
  - [x] 7.1 `src/domains/search/algorithms/search-ranking.ts`에 procedural memory 특화 가중치 계산 로직 추가 (workflow_name +0.1, skill_name +0.1, trigger_conditions +0.15)
    - SearchFeatures 인터페이스에 procedural memory 필드 추가
    - calculateProceduralMemoryBoost 메서드 추가
    - calculateFinalScore에서 procedural memory boost 적용
  - [x] 7.2 `src/domains/search/algorithms/hybrid-search-engine.ts`에 procedural memory 특화 가중치 적용 로직 통합 (랭킹 점수 계산 시 추가)
    - fetchProceduralMemoryMatches 메서드 추가
    - combineAndSortResults에서 procedural memory 매칭 정보 조회 및 적용
  - [x] 7.3 `src/domains/search/algorithms/__tests__/search-ranking.spec.ts` 테스트 작성/수정 (procedural memory 특화 가중치 계산 테스트)
  - [x] 7.4 `src/domains/search/algorithms/__tests__/hybrid-search-engine.spec.ts` 테스트 작성/수정 (procedural memory 특화 가중치 적용 통합 테스트)

