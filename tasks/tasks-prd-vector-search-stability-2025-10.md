## Relevant Files

- `src/database/schema.sql` - 메인 스키마 정의 및 트리거 수정이 필요한 위치.
- `src/database/init.ts` - 초기화 시 새 스키마/트리거와 호환되도록 조정.
- `src/database/migrate.ts` - 새 마이그레이션을 등록하고 실행 순서를 관리.
- `src/database/migrations/002_sync_embedding_provider.sql` - 신규로 작성할 마이그레이션(업/다운) 스크립트.
- `src/services/memory-embedding-service.ts` - 임베딩 저장 로직과 통계 API가 새 컬럼을 활용하도록 수정.
- `src/utils/database.ts` - vec0 트리거와 연동되는 유틸리티 로직 보완, 잠금 검사 등 재사용.
- `src/algorithms/vector-search-engine.ts` - 제공자별 차원 지원, rowid 매핑 수정.
- `src/algorithms/hybrid-search-engine.ts` - 다중 타입 필터 처리와 벡터 검색 옵션 조정.
- `src/services/embedding-provider-factory.ts` - OpenAI 제공자 등록 및 폴백 로직 정비.
- `env.example` - OpenAI 및 기타 임베딩 설정 변수를 명확히 안내.
- `docs/prd-vector-search-stability-2025-10.md` - 요구사항 준수/진행 현황과 릴리스 노트 초안 기록.
- `docs/code-review-2025-10.md` - 문제 배경과 해결 여부 체크.
- `src/algorithms/vector-search-engine.spec.ts` - 벡터 검색 회귀 테스트 강화(다중 타입 필터·차원 불일치·vec0 미설치 시나리오 포함).
- `src/algorithms/hybrid-search-engine.spec.ts` - 하이브리드 검색 필터/가중치 테스트 보완(다중 타입 및 폴백 경로).
- `src/services/memory-embedding-service.spec.ts` - 임베딩 저장/통계 단위 테스트 추가 또는 갱신.
- `src/services/vector-search/vector-search.service.spec.ts` - (필요 시) 통합 검색 경로 검증.

### Notes

- 새 마이그레이션은 `npm run db:migrate`로 적용되며, 롤백 스크립트도 함께 제공해야 합니다.
- 현재 `npm run db:migrate -- --down`은 별도 처리 로직이 없어 동일 업 마이그레이션을 다시 실행하므로, 실제 롤백이 필요할 경우 새로운 다운 전용 스크립트를 호출하거나 수동으로 실행해야 합니다.
- 통합 테스트는 sqlite-vec 확장이 없을 때와 있을 때의 폴백 경로를 모두 검사하는 것이 좋습니다.
- 테스트 실행: `npm test` (전체) · `npm run test:search` (검색 시나리오) · 필요 시 개별 파일을 Vitest로 실행.

## Tasks

- [x] 1.0 데이터베이스 스키마 및 트리거 정비
  - [x] 1.1 `schema.sql`과 기존 마이그레이션을 검토하여 `embedding_provider`, `dimensions` 컬럼과 관련 인덱스/트리거의 현재 상태를 파악한다.
  - [x] 1.2 `src/database/migrations/002_sync_embedding_provider.sql`를 추가해 신규 컬럼 생성, 기본값/기존 데이터 백필, 관련 인덱스/트리거 업데이트, 다운 스크립트(컬럼/인덱스 제거)까지 정의한다.
  - [x] 1.3 `schema.sql`, `init.ts`, `migrate.ts`를 수정해 신규 컬럼/트리거를 반영하고 vec0 연동이 문자열 ID 대신 정수 PK 또는 별도 매핑을 사용하도록 재구성한다.
  - [x] 1.4 로컬에서 `npm run db:migrate` 및 (가능하다면) 롤백을 실행해 스키마가 기대대로 변하는지 검증하고, 문제 발생 시 로그와 해결책을 정리한다.

- [x] 2.0 임베딩 저장 서비스 및 DB 유틸리티 개편
  - [x] 2.1 `MemoryEmbeddingService`에서 임베딩 저장 시 새 컬럼(`embedding_provider`, `dimensions`)을 채우고, JSON 파싱 실패나 sqlite-vec 미로딩 상황에 대한 방어 로직을 추가한다.
  - [x] 2.2 임베딩 통계 조회, 삭제 로직 등에서 새 컬럼을 활용하고 누락된 값이 있을 때의 폴백 전략을 정의한다.
  - [x] 2.3 `DatabaseUtils`(또는 연관 유틸)에서 vec0 관련 보조 함수가 새 키 매핑을 사용하도록 조정하고, 필요 시 트랜잭션/락 처리 로직을 보완한다.

- [x] 3.0 벡터/하이브리드 검색 엔진 개선
  - [x] 3.1 `VectorSearchEngine`이 제공자별 벡터 차원을 동적으로 조회하거나 구성으로 받아 검증하도록 수정한다.
  - [x] 3.2 vec0 조인 시 문자열 ID 대신 일관된 키(예: `memory_embedding.id`)를 사용하도록 검색 쿼리와 트리거를 함께 조정하고, includeContent/metadata 옵션을 검증한다.
  - [x] 3.3 `HybridSearchEngine`에서 타입 배열을 벡터 검색에 전달할 때 IN 절 등을 사용해 다중 타입 필터를 지원하도록 로직과 옵션 정의를 업데이트한다.
  - [x] 3.4 벡터 검색 실패 시 텍스트 검색으로 안전하게 폴백하는 경로와 로깅을 재검토하고, OpenAI/Gemini 등 고차원 모델에서도 정상 작동하는지 수동 테스트한다.

- [x] 4.0 임베딩 제공자 팩토리 및 구성 확장
  - [x] 4.1 `EmbeddingProviderFactory`에 OpenAI 제공자 인스턴스를 실제로 등록하고, 환경 변수 미설정 시 다른 제공자로 폴백하도록 구현한다.
  - [x] 4.2 OpenAI용 구성(`env.example`, 관련 문서)을 업데이트해 필요한 키/모델/차원 값을 명시하고, 런타임 검증 로직을 추가한다.
  - [x] 4.3 Gemini/TF-IDF 등 기존 제공자 등록 절차를 재확인하며, 우선순위/폴백 리스트가 PRD 요구와 일치하는지 검토한다.

- [x] 5.0 테스트 및 문서 보강
  - [x] 5.1 임베딩 저장부터 vec0 반영, 벡터 검색까지 이어지는 통합 테스트 시나리오를 각 제공자(TF-IDF, MiniLM, OpenAI, Gemini)별로 작성하거나 기존 테스트를 확장한다.
- [x] 5.2 다중 타입 필터, 차원 불일치, vec0 미설치 등 회귀 위험이 높은 경로를 커버하는 단위/통합 테스트를 `vector-search-engine.spec.ts`, `hybrid-search-engine.spec.ts` 등에 추가한다.
- [x] 5.3 업데이트된 동작을 개발자 문서(`docs/prd-vector-search-stability-2025-10.md` 등)에 반영하고, 변경 사항을 공유하기 위한 릴리스 노트 초안을 준비한다.
- [x] 5.4 `npm test`, `npm run test:search`를 실행해 전체 스위트가 통과하는지 확인하고, 실패 시 원인 분석과 수정 계획을 남긴다.
