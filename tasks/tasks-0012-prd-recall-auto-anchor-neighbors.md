# tasks-0012-prd-recall-auto-anchor-neighbors.md

## Relevant Files

- `src/domains/memory/tools/recall-tool.ts` - recall 도구의 메인 구현 파일. 새로운 파라미터 추가 및 자동 앵커 설정/이웃 기억 포함 로직 구현
- `src/domains/memory/tools/__tests__/recall-tool.spec.ts` - recall 도구의 단위 테스트 파일. 새로운 기능에 대한 테스트 추가
- `src/services/anchor-manager.ts` - 앵커 관리 서비스 (하위 호환성 래퍼). 앵커 조회 및 설정에 사용
- `src/domains/anchor/services/anchor/anchor-manager.ts` - 앵커 관리자 구현. 앵커 CRUD 작업 담당
- `src/domains/memory/services/memory-neighbor-service.ts` - 이웃 기억 조회 서비스. 이웃 기억 포함 기능에 사용
- `src/domains/search/algorithms/vector-search-engine.ts` - 벡터 검색 엔진. 이웃 기억 조회에 사용

### Notes

- 단위 테스트는 `recall-tool.spec.ts`에 추가하며, given/when/then 구조를 따라야 함
- 테스트 실행: `npm test` 또는 `npm test recall-tool.spec.ts`
- 앵커의 pinned 상태는 memory_item 테이블의 pinned 필드를 조인하여 확인해야 함

## Tasks

- [ ] 1.0 RecallSchema에 새로운 파라미터 추가
  - [x] 1.1 `auto_set_anchor` 파라미터 추가 (z.boolean().optional().default(false))
  - [x] 1.2 `include_neighbors` 파라미터 추가 (z.boolean().optional().default(false))
  - [x] 1.3 `neighbors_limit` 파라미터 추가 (z.number().min(1).max(10).optional().default(3))
  - [x] 1.4 `neighbors_per_item` 파라미터 추가 (z.number().min(1).max(50).optional().default(5))
  - [x] 1.5 `neighbors_similarity_threshold` 파라미터 추가 (z.number().min(0).max(1).optional().default(0.8))
  - [x] 1.6 OpenAPI 스키마에 새 파라미터 설명 추가 (constructor의 properties 객체에 각 파라미터 설명 추가)
  - [x] 1.7 응답 스키마 타입 정의 추가 (metadata.anchor_set, metadata.anchor_set_error, metadata.anchor_set_skipped, items[].neighbors 필드에 대한 TypeScript 타입 정의, neighbors는 optional로 선언하여 neighbors_limit보다 많은 결과는 필드 없음/undefined 처리)
  - [x] 1.8 응답 OpenAPI 스키마 문서화 (응답 예시에 metadata.anchor_set 및 neighbors 필드 포함, 각 상태별 예시 추가, neighbors 필드가 optional임을 명시)
- [ ] 2.0 자동 앵커 설정 로직 구현
  - [x] 2.1 `handleAutoSetAnchor` private 메서드 생성 (검색 결과, agent_id, context를 받아 앵커 설정)
  - [x] 2.2 슬롯 A의 앵커 조회 및 pinned 상태 확인 로직 구현 (memory_item 테이블과 조인하여 pinned 확인)
  - [x] 2.3 슬롯 A에 pinned 앵커가 있으면 건너뛰기 로직 구현 (보호 정책)
  - [x] 2.4 슬롯 회전 로직 구현 (A → B → C → 제거 순서로 이동)
  - [x] 2.5 슬롯 B/C의 pinned 앵커 덮어쓰기 전 경고 로그 추가
  - [x] 2.6 새로운 기억을 슬롯 A에 설정하는 로직 구현 (AnchorManager.setAnchor 호출)
  - [x] 2.7 앵커 설정 실패 시 에러 처리 및 경고 로그 (검색 결과는 정상 반환)
  - [x] 2.8 memory_item 검색 분기에서 `auto_set_anchor`가 true이고 검색 결과가 있을 때 `handleAutoSetAnchor` 호출
- [ ] 3.0 자동 이웃 기억 포함 로직 구현
  - [x] 3.1 `handleIncludeNeighbors` private 메서드 생성 (검색 결과, 파라미터, context를 받아 이웃 기억 포함)
  - [x] 3.2 상위 `neighbors_limit`개 결과 추출 로직 구현 (검색 결과 개수보다 작으면 검색 결과 개수로 제한)
  - [x] 3.3 MemoryNeighborService.getNeighbors 호출 시 옵션 객체 구성 (neighbors_per_item을 limit으로, neighbors_similarity_threshold를 similarity_threshold로 전달)
  - [x] 3.4 각 상위 결과에 대해 이웃 기억 조회를 병렬 처리하는 로직 구현 (Promise.all 사용, 인덱스와 함께 매핑하여 순서 보존)
  - [x] 3.5 개별 이웃 기억 조회에 타임아웃 적용 (각 조회당 최대 2초, 타임아웃 시 빈 배열 반환)
  - [x] 3.6 전체 요청 타임아웃 적용 (2.5초, 부분 성공 결과 반환, 완료된 조회 결과만 포함)
  - [x] 3.7 결과 순서 보존 로직 구현 (원본 검색 결과 순서에 맞춰 neighbors 배열 정렬)
  - [x] 3.8 이웃 기억 조회 실패 시 에러 처리 및 경고 로그 (해당 항목의 neighbors를 빈 배열로 설정)
  - [x] 3.9 검색 결과 항목에 neighbors 필드 추가 (각 항목에 neighbors 배열 포함, neighbors_limit보다 많은 결과는 neighbors 필드 없음)
  - [x] 3.10 memory_item 검색 분기에서 `include_neighbors`가 true이고 검색 결과가 있을 때 `handleIncludeNeighbors` 호출
- [ ] 4.0 응답 메타데이터 스키마 확장
  - [x] 4.1 `createSuccessResult` 호출 시 metadata 객체에 `anchor_set` 필드 추가 (성공/실패/건너뜀 상태에 따라 다른 값 설정)
  - [x] 4.2 앵커 설정 성공 시 metadata.anchor_set에 {memory_id, slot: "A", agent_id} 포함
  - [x] 4.3 앵커 설정 실패 시 metadata.anchor_set을 null로 설정하고 anchor_set_error: true 추가
  - [x] 4.4 앵커 설정 건너뜀 시 metadata.anchor_set을 null로 설정하고 anchor_set_skipped: true, anchor_set_skipped_reason: "pinned_anchor_protected" 추가
  - [x] 4.5 앵커 설정 비활성화 시 metadata.anchor_set을 null로 설정 (anchor_set_error, anchor_set_skipped 없음)
- [ ] 5.0 테스트 작성
  - [x] 5.1 RecallSchema 파라미터 검증 테스트 작성 (given: 새 파라미터들, when: 스키마 파싱, then: 기본값 확인 및 범위 검증)
  - [x] 5.2 자동 앵커 설정 성공 시나리오 테스트 작성 (given: 검색 결과 있음, when: auto_set_anchor=true, then: 슬롯 A에 앵커 설정됨)
  - [x] 5.3 슬롯 회전 로직 테스트 작성 (given: 슬롯 A/B/C에 앵커 있음, when: auto_set_anchor=true, then: A→B→C→제거 순서로 이동)
  - [x] 5.4 슬롯 A의 pinned 앵커 보호 정책 테스트 작성 (given: 슬롯 A에 pinned 앵커 있음, when: auto_set_anchor=true, then: 앵커 설정 건너뜀)
  - [x] 5.5 슬롯 B/C의 pinned 앵커 덮어쓰기 테스트 작성 (given: 슬롯 B/C에 pinned 앵커 있음, when: auto_set_anchor=true, then: 경고 로그 및 덮어쓰기)
  - [x] 5.6 앵커 설정 실패 시 에러 처리 테스트 작성 (given: 앵커 설정 실패, when: auto_set_anchor=true, then: 검색 결과는 정상 반환, metadata에 anchor_set_error 포함)
  - [x] 5.7 자동 이웃 기억 포함 성공 시나리오 테스트 작성 (given: 검색 결과 있음, when: include_neighbors=true, then: 상위 결과에 neighbors 필드 포함)
  - [x] 5.8 이웃 기억 조회 병렬 처리 테스트 작성 (given: 여러 검색 결과, when: include_neighbors=true, then: 모든 이웃 기억이 병렬로 조회됨)
  - [x] 5.9 이웃 기억 조회 개별 타임아웃 테스트 작성 (given: 느린 이웃 기억 조회, when: include_neighbors=true, then: 개별 조회 타임아웃 내에 응답 반환, 타임아웃된 항목은 빈 배열)
  - [x] 5.10 이웃 기억 조회 전체 타임아웃 테스트 작성 (given: 전체 요청이 2.5초 초과, when: include_neighbors=true, then: 완료된 조회 결과만 반환, 미완료 항목은 빈 배열, 로그/메타데이터 정상)
  - [x] 5.11 이웃 기억 조회 실패 시 에러 처리 테스트 작성 (given: 이웃 기억 조회 실패, when: include_neighbors=true, then: 해당 항목의 neighbors는 빈 배열, 다른 항목은 정상)
  - [x] 5.11a 이웃 기억 순서 보존 테스트 작성 (given: 검색 결과 5개(역순 ID 등), neighbors_limit=3, when: include_neighbors=true, then: 상위 3개 결과가 원본 검색 결과 순서대로 neighbors 필드를 포함)
  - [x] 5.12 neighbors_limit 적용 테스트 작성 (given: 검색 결과 10개, neighbors_limit=3, when: include_neighbors=true, then: 상위 3개 결과만 neighbors 필드 포함)
  - [x] 5.13 neighbors_per_item 적용 테스트 작성 (given: neighbors_per_item=2, when: include_neighbors=true, then: 각 항목의 neighbors 배열이 최대 2개)
  - [x] 5.14 neighbors_similarity_threshold 필터링 테스트 작성 (given: 유사도 0.7, 0.8, 0.9인 이웃 기억, neighbors_similarity_threshold=0.8, when: include_neighbors=true, then: 0.8 이상만 포함)
  - [x] 5.15 하위 호환성 테스트 작성 (given: 새 파라미터 없음, when: recall 호출, then: 기존 동작과 동일하게 동작, metadata.anchor_set=null, neighbors 필드 없음)
  - [x] 5.16 앵커 설정 성공 시 메타데이터 테스트 작성 (given: 앵커 설정 성공, when: auto_set_anchor=true, then: metadata.anchor_set={memory_id, slot: "A", agent_id}, anchor_set_error/anchor_set_skipped 없음)
  - [x] 5.17 앵커 설정 실패 시 메타데이터 테스트 작성 (given: 앵커 설정 실패, when: auto_set_anchor=true, then: metadata.anchor_set=null, anchor_set_error=true, anchor_set_skipped 없음)
  - [x] 5.18 앵커 설정 건너뜀 시 메타데이터 테스트 작성 (given: 슬롯 A에 pinned 앵커 있음, when: auto_set_anchor=true, then: metadata.anchor_set=null, anchor_set_skipped=true, anchor_set_skipped_reason="pinned_anchor_protected", anchor_set_error 없음)
  - [x] 5.19 앵커 설정 비활성화 시 메타데이터 테스트 작성 (given: auto_set_anchor=false, when: recall 호출, then: metadata.anchor_set=null, anchor_set_error/anchor_set_skipped 없음)
  - [x] 5.20 검색 결과 없을 때 자동 앵커 설정 메타데이터 테스트 작성 (given: 검색 결과 없음, auto_set_anchor=true, when: recall 호출, then: metadata.anchor_set=null, anchor_set_error/anchor_set_skipped 없음)

