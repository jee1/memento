# 작업 목록: Meta-Memory(1) - 통계 기반 메타 메모리 수집

이 문서는 PRD `0022-prd-meta-memory-1-statistics-based-collection.md`를 기반으로 생성된 구현 작업 목록입니다.

## Relevant Files

- `src/infrastructure/database/database/migration/migrations/011-meta-memory-stats-schema.sql` - 메타 메모리 통계 테이블 스키마 마이그레이션
- `src/shared/types/index.ts` - MetaMemoryStats 타입 정의 및 RecallResponse 인터페이스 확장
- `src/services/meta-memory-service.ts` - 메타 메모리 통계 수집 및 관리 서비스
- `src/services/meta-memory-service.spec.ts` - MetaMemoryService 단위 테스트
- `src/domains/monitoring/tools/get-meta-memory-stats-tool.ts` - 메타 메모리 통계 조회 MCP 도구
- `src/domains/monitoring/tools/get-meta-memory-stats-tool.spec.ts` - get-meta-memory-stats-tool 단위 테스트
- `src/domains/memory/tools/recall-tool.ts` - Recall Tool에 메타 통계 수집 로직 통합
- `src/server/bootstrap.ts` - MetaMemoryService 초기화 및 ServerServices에 추가
- `src/shared/types/index.ts` - ServerServices 인터페이스에 metaMemoryService 필드 추가

### Notes

- 단위 테스트는 일반적으로 테스트하는 코드 파일과 함께 배치해야 합니다 (예: 같은 디렉토리의 `MyComponent.tsx` 및 `MyComponent.test.tsx`).
- `npm test`를 사용하여 테스트를 실행합니다. 경로 없이 실행하면 Jest 구성에서 찾은 모든 테스트를 실행합니다.
- 모든 테스트는 TDD 방법론(RED-GREEN-REFACTOR)을 따라야 하며, given/when/then 구조를 사용해야 합니다.

## Tasks

- [x] 1.0 데이터베이스 스키마 및 마이그레이션 구현
  - [x] 1.1 [RED] meta_memory_stats 테이블 스키마 마이그레이션 SQL 파일 작성 테스트 (given: 마이그레이션 파일이 존재할 때, when: 마이그레이션을 실행하면, then: meta_memory_stats 테이블이 생성되어야 함)
  - [x] 1.2 [GREEN] 011-meta-memory-stats-schema.sql 마이그레이션 파일 생성 (테이블, 인덱스, 트리거 포함)
  - [x] 1.3 [RED] 마이그레이션 검증 테스트 작성 (given: 마이그레이션 실행 후, when: 테이블 구조를 확인하면, then: 모든 필드와 인덱스가 올바르게 생성되어야 함)
  - [x] 1.4 [GREEN] 마이그레이션 TypeScript 래퍼 파일 생성 (003-consolidation-score-fields.ts 패턴 참고)
  - [x] 1.5 [REFACTOR] 마이그레이션 코드 검증 및 최적화
  - [x] 1.6 [RED] CASCADE 삭제 동작 테스트 작성 (given: memory_item이 삭제될 때, when: 해당 memory_id의 meta_memory_stats 레코드를 확인하면, then: 자동으로 삭제되어야 함)
  - [x] 1.7 [GREEN] CASCADE 삭제 동작 구현 및 검증

- [x] 2.0 타입 정의 및 인터페이스 구현
  - [x] 2.1 [RED] MetaMemoryStats 인터페이스 타입 테스트 작성 (given: 타입 정의가 있을 때, when: 타입을 사용하면, then: 모든 필드가 올바른 타입이어야 함)
  - [x] 2.2 [GREEN] MetaMemoryStats 인터페이스 정의 (memory_id, recall_count, success_count, failure_count, avg_confidence, last_recalled_at, created_at, updated_at)
  - [x] 2.3 [RED] RecallResponse 인터페이스 확장 테스트 작성 (given: RecallResponse에 meta_stats 필드가 추가될 때, when: include_metadata=true로 recall 호출하면, then: meta_stats 필드가 포함되어야 함)
  - [x] 2.4 [GREEN] RecallResponse 인터페이스에 meta_stats 필드 추가 (선택적 필드, include_metadata=true일 때만 포함)
  - [x] 2.5 [RED] GetMetaMemoryStatsParams 타입 테스트 작성 (given: 파라미터 타입이 정의될 때, when: 타입을 사용하면, then: 모든 선택적 필드가 올바르게 정의되어야 함)
  - [x] 2.6 [GREEN] GetMetaMemoryStatsParams 및 MetaMemoryStatsResult 타입 정의
  - [x] 2.7 [REFACTOR] 타입 정의 검증 및 문서화

- [x] 3.0 MetaMemoryService 구현
  - [x] 3.1 [RED] recordRecall 메서드 단위 테스트 작성 (given: 검색 결과 항목이 있을 때, when: recordRecall을 호출하면, then: 통계가 올바르게 업데이트되어야 함)
  - [x] 3.2 [GREEN] recordRecall 메서드 구현 (성공/실패 판정, confidence 계산, WriteCoalescingManager를 통한 업데이트)
  - [x] 3.3 [RED] calculateConfidence 메서드 단위 테스트 작성 (given: final_score, consolidation_score, vectorScore가 있을 때, when: calculateConfidence를 호출하면, then: 가중 평균이 올바르게 계산되어야 함)
  - [x] 3.4 [GREEN] calculateConfidence 메서드 구현 (0.6 * final_score + 0.3 * consolidation_score + 0.1 * vector_score)
  - [x] 3.5 [RED] updateAvgConfidence 메서드 단위 테스트 작성 (given: 기존 평균과 새로운 confidence가 있을 때, when: updateAvgConfidence를 호출하면, then: 누적 평균이 올바르게 계산되어야 함)
  - [x] 3.6 [GREEN] updateAvgConfidence 메서드 구현 (누적 평균 계산 로직)
  - [x] 3.7 [RED] isItemSuccess 메서드 단위 테스트 작성 (given: final_score가 0.5 이상/미만일 때, when: isItemSuccess를 호출하면, then: 올바른 성공/실패 판정이 되어야 함)
  - [x] 3.8 [GREEN] isItemSuccess 메서드 구현 (final_score >= 0.5 기준)
  - [x] 3.9 [RED] getStats 메서드 단위 테스트 작성 (given: 다양한 필터 조건이 있을 때, when: getStats를 호출하면, then: 필터링된 결과가 반환되어야 함)
  - [x] 3.10 [GREEN] getStats 메서드 구현 (memory_id, memory_ids, min_recall_count, min_confidence, limit 필터링)
  - [x] 3.11 [RED] Debounce 처리 통합 테스트 작성 (given: 짧은 시간 내 연속된 recall 호출이 있을 때, when: 통계를 확인하면, then: 마지막 업데이트만 반영되어야 함)
  - [x] 3.12 [GREEN] WriteCoalescingManager를 사용한 Debounce 처리 구현 (100ms 간격)
  - [x] 3.13 [REFACTOR] MetaMemoryService 코드 리팩토링 및 에러 처리 강화

- [x] 4.0 Recall Tool 통합
  - [x] 4.1 [RED] Recall Tool에 메타 통계 수집 통합 테스트 작성 (given: recall 호출 시 검색 결과가 있을 때, when: 통계를 확인하면, then: 각 메모리 항목의 통계가 업데이트되어야 함)
  - [x] 4.2 [GREEN] RecallTool.handle() 메서드에 통계 수집 로직 추가 (검색 결과 후처리 단계, consolidation score 업데이트 이후)
  - [x] 4.3 [RED] 검색 결과 0개 케이스 테스트 작성 (given: 검색 결과가 0개일 때, when: recall을 호출하면, then: 통계 업데이트가 발생하지 않아야 함)
  - [x] 4.4 [GREEN] 검색 결과 0개 케이스 처리 로직 구현 (collectMetaMemoryStats에서 searchItems.length === 0 체크)
  - [x] 4.5 [RED] meta_stats 필드 포함 테스트 작성 (given: include_metadata=true로 recall 호출할 때, when: 응답을 확인하면, then: meta_stats 필드가 포함되어야 함)
  - [x] 4.6 [GREEN] include_metadata 파라미터 기반 meta_stats 필드 포함 로직 구현
  - [x] 4.7 [RED] 중복 항목 처리 테스트 작성 (given: 같은 memory_id가 여러 번 검색 결과에 포함될 때, when: 통계를 확인하면, then: 각각 별도로 통계가 업데이트되어야 함)
  - [x] 4.8 [GREEN] 중복 항목 처리 로직 구현 (각 항목별로 별도 통계 업데이트 - 버퍼에 있는 값을 기반으로 계산)
  - [x] 4.9 [RED] 통계 수집 실패 시 recall 성공 여부 영향 테스트 작성 (given: 통계 수집이 실패할 때, when: recall 응답을 확인하면, then: recall은 정상적으로 성공해야 함)
  - [x] 4.10 [GREEN] 에러 처리 로직 구현 (통계 수집 실패 시 로깅만 수행, recall 성공 여부에 영향 없음 - 이미 구현되어 있음)
  - [x] 4.11 [REFACTOR] Recall Tool 통합 코드 리팩토링 및 성능 최적화

- [ ] 5.0 MCP 도구 구현
  - [ ] 5.1 [RED] get_meta_memory_stats 도구 스키마 검증 테스트 작성 (given: 도구가 등록될 때, when: 스키마를 확인하면, then: 모든 파라미터가 올바르게 정의되어야 함)
  - [ ] 5.2 [GREEN] get-meta-memory-stats-tool.ts 파일 생성 및 기본 구조 구현 (BaseTool 상속, 스키마 정의)
  - [ ] 5.3 [RED] get_meta_memory_stats 도구 핸들러 단위 테스트 작성 (given: 다양한 파라미터로 호출할 때, when: 도구를 실행하면, then: 필터링된 결과가 반환되어야 함)
  - [ ] 5.4 [GREEN] get_meta_memory_stats 도구 handle() 메서드 구현 (MetaMemoryService.getStats() 호출)
  - [ ] 5.5 [RED] 파라미터 검증 테스트 작성 (given: 잘못된 파라미터로 호출할 때, when: 도구를 실행하면, then: 적절한 에러가 발생해야 함)
  - [ ] 5.6 [GREEN] 파라미터 검증 로직 구현 (Zod 스키마 사용)
  - [ ] 5.7 [RED] 도구 등록 테스트 작성 (given: 도구가 생성될 때, when: 도구 레지스트리를 확인하면, then: get_meta_memory_stats 도구가 등록되어야 함)
  - [ ] 5.8 [GREEN] tools/index.ts에 get_meta_memory_stats 도구 등록
  - [ ] 5.9 [REFACTOR] MCP 도구 코드 리팩토링 및 문서화

- [ ] 6.0 서비스 초기화 및 통합
  - [ ] 6.1 [RED] ServerServices 인터페이스 확장 테스트 작성 (given: ServerServices 타입이 있을 때, when: metaMemoryService 필드를 확인하면, then: 필드가 포함되어야 함)
  - [ ] 6.2 [GREEN] ServerServices 인터페이스에 metaMemoryService 필드 추가 (선택적 필드)
  - [ ] 6.3 [RED] MetaMemoryService 초기화 테스트 작성 (given: bootstrap.ts에서 서비스를 초기화할 때, when: 서비스를 확인하면, then: MetaMemoryService 인스턴스가 생성되어야 함)
  - [ ] 6.4 [GREEN] bootstrap.ts에 MetaMemoryService 초기화 로직 추가 (WriteCoalescingManager와 함께 초기화)
  - [ ] 6.5 [RED] ToolContext에 metaMemoryService 주입 테스트 작성 (given: ToolContext가 생성될 때, when: services를 확인하면, then: metaMemoryService가 포함되어야 함)
  - [ ] 6.6 [GREEN] ToolContext 생성 로직에 metaMemoryService 주입 (context.ts 또는 bootstrap.ts에서)
  - [ ] 6.7 [RED] 통합 E2E 테스트 작성 (given: 전체 시스템이 초기화될 때, when: recall을 호출하고 get_meta_memory_stats로 조회하면, then: 통계가 올바르게 수집되고 조회되어야 함)
  - [ ] 6.8 [GREEN] 통합 E2E 테스트 구현 및 검증
  - [ ] 6.9 [REFACTOR] 서비스 초기화 코드 리팩토링 및 에러 처리 강화
