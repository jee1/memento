# tasks-0008-prd-multi-provider-search-support.md

## Relevant Files

- `src/algorithms/hybrid-search-engine.ts` - 다중 provider 검색 로직을 추가할 하이브리드 검색 엔진
- `src/algorithms/hybrid-search-engine.spec.ts` - 하이브리드 검색 엔진 테스트
- `src/algorithms/vector-search-engine.ts` - Provider 필터링을 지원하도록 수정할 벡터 검색 엔진
- `src/algorithms/vector-search-engine.spec.ts` - 벡터 검색 엔진 테스트
- `src/tools/recall-tool.ts` - provider_filter 파라미터를 추가할 recall MCP 도구
- `src/tools/recall-tool.spec.ts` - recall 도구 테스트
- `src/tools/migrate-embeddings-tool.ts` - 새로 생성할 마이그레이션 MCP 도구
- `src/tools/migrate-embeddings-tool.spec.ts` - 마이그레이션 도구 테스트
- `src/types/index.ts` - EmbeddingProvider 타입 정의 확인
- `src/services/unified-embedding-service.ts` - 다중 provider 임베딩 생성 지원 확인
- `src/services/memory-embedding-service.ts` - 임베딩 저장 서비스 확인

### Notes

- Unit tests should typically be placed alongside the code files they are testing (e.g., `HybridSearchEngine.ts` and `HybridSearchEngine.spec.ts` in the same directory).
- Use `npm test` to run tests. Running without a path executes all tests found by the Vitest configuration.

## Tasks

- [ ] 1.0 다중 Provider 감지 기능 구현
  - [x] 1.1 `detectStoredEmbeddingProvider()` 메서드를 `detectAllStoredEmbeddingProviders()`로 변경 (단일 provider → 모든 provider 목록 반환)
  - [x] 1.2 Provider 통계 정보 인터페이스 정의 (provider, count, avg_dimensions 포함)
  - [x] 1.3 데이터베이스 쿼리 수정 (GROUP BY로 모든 provider 조회, LIMIT 1 제거) - 1.1에서 완료
  - [x] 1.4 기존 `detectStoredEmbeddingProvider()` 호출부를 `detectAllStoredEmbeddingProviders()`로 변경
  - [x] 1.5 다중 provider 감지 기능 테스트 작성 (단일 provider, 다중 provider, 빈 데이터 케이스)

- [ ] 2.0 병렬 다중 Provider 검색 구현
  - [x] 2.1 `executeVecSearch()` 메서드를 다중 provider 검색으로 확장
  - [x] 2.2 `Promise.allSettled()`를 사용한 병렬 검색 로직 구현
  - [x] 2.3 각 provider 검색에 2초 hard timeout 설정 (Promise.race와 타임아웃 Promise 조합)
  - [x] 2.4 실패한 provider 처리 및 상세 로깅 (타임아웃, 에러 메시지 기록)
  - [x] 2.5 provider_filter 옵션 지원 (지정된 provider만 검색) - 2.1에서 구현 완료
  - [x] 2.6 병렬 검색 기능 테스트 작성 (성공 케이스, 타임아웃 케이스, 부분 실패 케이스)
  - [x] 2.7 전체 검색 프로세스의 maximum timeout 설정 (예: 3초, 모든 provider 타임아웃 시에도 응답 보장)
    - 타임아웃 발생 시: 현재까지 성공한 provider 결과만 반환, 실패한 provider는 failure 통계에 포함

- [ ] 3.0 결과 통합 및 정규화 로직 구현
  - [x] 3.1 Min-Max 정규화 함수 구현 (`normalized_score = (score - min_score) / (max_score - min_score)`)
  - [x] 3.1-1 `max_score === min_score` edge case 처리 로직 구현 (0으로 나누기 방지, 모든 점수를 1.0으로 설정 - 정보 부족 시 정상화 불필요)
  - [x] 3.1-2 Provider별 score 방향성 통일 (similarity 기준으로 변환, distance는 1-distance로 변환) - vector-search-engine에서 이미 처리됨
  - [x] 3.2 Provider별 검색 결과 정규화 로직 구현 (각 provider의 결과를 독립적으로 정규화)
  - [x] 3.3 중복 제거 로직 구현 (memory_id 기준, 최고 점수만 유지)
  - [x] 3.4 통합 결과 재랭킹 로직 구현 (정규화된 점수로 정렬)
  - [x] 3.5 검색 통계에 provider별 결과 수 포함 - 이미 구현됨 (providerStats에 resultCount 포함)
  - [x] 3.6 결과 통합 및 정규화 테스트 작성 (정규화 정확도, 중복 제거, 재랭킹 검증)

- [ ] 4.0 Provider 필터링 옵션 추가
  - [x] 4.1 `HybridSearchQuery` 인터페이스에 `provider_filter?: EmbeddingProvider[]` 필드 추가 - 2.1에서 선행 구현 완료
  - [x] 4.2 `recall-tool.ts`의 스키마에 `provider_filter` 파라미터 추가 (선택적, string[] 타입)
  - [x] 4.3 `recall-tool.ts`의 `handle()` 메서드에서 `provider_filter` 파라미터 처리 로직 추가
  - [x] 4.4 `HybridSearchEngine.search()` 메서드에서 `provider_filter` 옵션 처리 로직 추가 - 2.1에서 선행 구현 완료
  - [x] 4.5 Provider 필터링 기능 테스트 작성 (단일 provider 필터, 다중 provider 필터, 필터 없음 케이스)

- [ ] 5.0 마이그레이션 도구 구현
  - [x] 5.1 `migrate-embeddings-tool.ts` 파일 생성 (BaseTool 상속)
  - [x] 5.2 마이그레이션 스키마 정의 (source_provider, target_provider, batch_size, dry_run 파라미터)
  - [x] 5.3 배치 처리 로직 구현 (기본 100개씩, 진행 상황 로깅)
  - [x] 5.3-1 `source_provider === target_provider` 케이스 처리 (에러 반환: "재임베딩 불필요 - source와 target이 동일합니다" 메시지와 함께 명확한 misuse 에러 반환)
  - [x] 5.4 재임베딩 로직 구현 (기존 임베딩 유지, 새 임베딩 추가 저장)
  - [x] 5.5 에러 처리 구현 (재임베딩 실패 시 스킵, 실패 목록 수집, 전체 작업 중단 없음)
  - [x] 5.6 마이그레이션 결과 반환 형식 정의 (total_count, success_count, failed_count, failed_memory_ids, errors)
  - [x] 5.7 `src/tools/index.ts`에 마이그레이션 도구 등록
  - [x] 5.8 마이그레이션 도구 테스트 작성 (성공 케이스, 부분 실패 케이스, 배치 처리 검증)
  - [x] 5.8-1 dry_run 모드에서 DB write 없이 로그/결과만 검증하는 테스트 추가 (dry_run 버그 방지)

- [x] 6.0 성능 및 안정성 검증 (선택적)
  - [x] 6.1 성능 벤치마크용 manual 테스트 스크립트/노트 작성 (다중 provider 검색 응답 시간 측정)
  - [x] 6.2 단일 provider 환경에서 기존 성능 유지 확인 (regression 테스트)

