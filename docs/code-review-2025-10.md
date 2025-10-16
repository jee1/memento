# 코드 검토 메모 (2025-10-14)

## 개요
- 범위: MCP 서버 검색/임베딩 경로 중심 점검
- 목적: 현재 코드 기준 잠재적 오류 및 품질 위험 식별

## 주요 발견 사항
- 스키마 불일치로 인한 런타임 오류  
  - `src/services/memory-embedding-service.ts:74`에서 `embedding_provider`, `dimensions` 컬럼을 사용하지만 `src/database/schema.sql:119`에는 정의되지 않아 초기화 및 트리거 실행 시 즉시 실패함.  
  - 동일 스키마 트리거(`src/database/schema.sql:147`, `src/database/schema.sql:170`, `src/database/schema.sql:194`)도 존재하지 않는 컬럼을 참조하므로 WAL 동기화가 전혀 이루어지지 않음.

- 벡터 검색 차원 검사 오류  
  - `src/algorithms/vector-search-engine.ts:144`가 쿼리 벡터 길이를 384로 고정 검증. OpenAI(1536), Gemini(768) 테이블이 스키마에 함께 존재하는 상황에서 해당 제공자를 사용하면 항상 검색이 실패함.

- vec0 조인 매핑 불일치  
  - `src/algorithms/vector-search-engine.ts:162`~`src/algorithms/vector-search-engine.ts:173`은 vec0 `rowid`를 `memory_item.id`(TEXT)와 직접 조인한다. 현재 트리거(`src/database/schema.sql:147`)가 `rowid`에 문자열 ID를 넣기 때문에 정수 기반 rowid 매핑이 어긋나고, 검색 결과가 비는 문제가 발생함.

- 하이브리드 검색 타입 필터 처리 버그  
  - `src/algorithms/hybrid-search-engine.ts:382`에서 `filters.type` 배열을 `join(',')`으로 문자열화해서 전달한다. 벡터 검색 쿼리는 단일 타입 비교만 지원하므로 다중 타입 필터가 깨지고, 의도와 다르게 동작함.

- OpenAI 제공자 미등록  
  - `src/services/embedding-provider-factory.ts:34`~`src/services/embedding-provider-factory.ts:55`는 OpenAI를 가용 목록에 포함시키지만 실제 인스턴스를 등록하지 않는다. `selectProvider()`가 OpenAI를 선택해도 `getProvider('openai')`가 `null`을 반환하여 폴백으로만 동작함.

## 해결 현황 (2025-10-27)
- [x] 스키마/트리거 불일치 → `memory_embedding` 컬럼 추가, vec0 트리거 재작성, `002_sync_embedding_provider` 마이그레이션 반영.  
- [x] 제공자별 벡터 차원 검증 → `VectorSearchEngine`이 메타데이터 기반 동적 차원 확인 및 차원 불일치 시 검색 중단.  
- [x] vec0 rowid 매핑 → 정수 PK 조인으로 수정하고, vec 미설치 시 안전 폴백 제공.  
- [x] 하이브리드 검색 다중 타입 필터 → IN 절과 타입 배열 전달로 수정, 폴백 경로에도 동일한 필터 적용.  
- [x] OpenAI 제공자 미등록 → 팩토리에서 OpenAI 인스턴스 등록 및 환경 변수 검증 로직 추가.  
- [x] 회귀 테스트 → 벡터/하이브리드 단위 테스트 확장으로 다중 타입·차원·폴백 시나리오 커버.

## 테스트 및 품질 갭
- 스키마와 서비스 계층이 불일치해도 실패를 잡아내는 테스트가 없음. 특히 `memory_embedding` 구조 및 vec0 트리거 동작을 검증하는 통합 테스트가 필요.
- 벡터/하이브리드 검색에 대해 다중 임베딩 제공자 시나리오, 타입 필터 조합을 검증하는 테스트가 부재하여 실제 배포 시 회귀 위험이 큼.
