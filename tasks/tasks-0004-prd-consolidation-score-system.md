# Tasks: Consolidation Score System Implementation

이 문서는 `0004-prd-consolidation-score-system.md` PRD를 기반으로 한 구현 작업 목록입니다.

## Relevant Files

- `src/database/migration/migrations/003-consolidation-score-fields.sql` - 스키마 마이그레이션 SQL 스크립트
- `src/database/migration/migrations/003-consolidation-score-fields.ts` - 마이그레이션 TypeScript 구현
- `src/services/consolidation-score-service.ts` - Consolidation Score 계산 서비스 (신규)
- `src/services/consolidation-score-service.spec.ts` - Consolidation Score 서비스 단위 테스트
- `src/workers/consolidation-score-worker.ts` - 배치 재계산 워커 (신규)
- `src/workers/consolidation-score-worker.spec.ts` - 배치 워커 단위 테스트
- `src/tools/recall-tool.ts` - 검색 도구 (수정: recall_count 업데이트 로직 추가)
- `src/tools/memory-injection-prompt.ts` - 메모리 주입 프롬프트 (수정: recall_count 업데이트 로직 추가)
- `src/tools/remember-tool.ts` - 기억 저장 도구 (수정: 신규 메모리 초기화 로직 추가)
- `src/algorithms/search-ranking.ts` - 검색 랭킹 알고리즘 (수정: consolidation_score 통합)
- `src/algorithms/search-ranking.spec.ts` - 검색 랭킹 단위 테스트
- `src/services/batch-scheduler.ts` - 배치 스케줄러 (수정: consolidation score 재계산 작업 추가)
- `src/config/index.ts` - 설정 파일 (수정: consolidation_score_enabled 플래그 추가)
- `src/utils/write-coalescing.ts` - 쓰기 결합 유틸리티 (신규)
- `src/utils/write-coalescing.spec.ts` - 쓰기 결합 단위 테스트

### Notes

- 단위 테스트는 해당 코드 파일과 같은 디렉토리에 `.spec.ts` 확장자로 배치합니다.
- 테스트 실행: `npm test` (전체) 또는 `npm test [파일경로]` (특정 파일)
- 마이그레이션은 기존 마이그레이션 시스템(`src/database/migration/`)을 활용합니다.

### 마이그레이션 정책 결정

**기존 데이터 초기화 정책 (Task 1.10)**:
- **결정**: 기존 메모리는 `recall_count=1`로 초기화
- **근거**: 
  1. 신규 메모리는 `memento.write` 시 `recall_count=1`로 초기화됨 (생성을 첫 번째 '접근'으로 간주)
  2. 일관성 유지: 기존 데이터와 신규 데이터가 동일한 초기 상태를 가지도록 함
  3. 방금 생성된 중요한 정보가 오래된 정보보다 약간의 우선순위를 가질 수 있도록 함
- **초기화 값**:
  - `recall_count = 1` (생성을 첫 번째 '접근'으로 간주)
  - `last_accessed_at = created_at` (생성 시각으로 초기화)
  - `g_value = 1` (초기값 `g_0 = 1`)
  - `consolidation_score`: Hou식 정규화 회상확률로 계산 (n=1, t=now-created_at, g_0=1, r_base=타입별 기본값)

## Tasks

- [x] 1.0 데이터베이스 스키마 마이그레이션 구현
  - [x] 1.1 `memory_item` 테이블에 `recall_count` (INTEGER, NOT NULL, DEFAULT 0) 필드 추가
  - [x] 1.2 `memory_item` 테이블에 `last_accessed_at` (TIMESTAMP, NULL 허용) 필드 추가
  - [x] 1.3 `memory_item` 테이블에 `consolidation_score` (REAL, NULL 허용) 필드 추가
  - [x] 1.4 `memory_item` 테이블에 `g_value` (REAL, NULL 허용) 필드 추가
  - [x] 1.5 `idx_memory_item_last_accessed` 인덱스 생성 (last_accessed_at DESC)
  - [x] 1.6 `idx_memory_item_consol_desc` 인덱스 생성 (consolidation_score DESC)
  - [x] 1.7 `idx_memory_item_consol_active` partial index 생성 (consolidation_score > 0.2)
  - [x] 1.8 마이그레이션 SQL 스크립트 작성 (`003-consolidation-score-fields.sql`)
  - [x] 1.9 마이그레이션 TypeScript 클래스 구현 (`003-consolidation-score-fields.ts`)
  - [x] 1.10 기존 데이터 초기화 로직 구현
    - **정책 결정**: 기존 메모리는 `recall_count=1`로 초기화 (신규 메모리와의 일관성 유지)
    - **근거**: 신규 메모리는 생성 시 `recall_count=1`로 초기화되므로, 기존 데이터도 동일한 정책을 적용하여 일관성 확보
    - `recall_count = 1` (생성을 첫 번째 '접근'으로 간주)
    - `last_accessed_at = created_at` (생성 시각으로 초기화)
    - `g_value = 1` (초기값 `g_0 = 1`)
    - `consolidation_score`는 Hou식 정규화 회상확률로 1회 산출 (n=1, t=now-created_at, g_0=1)
  - [x] 1.11 마이그레이션 검증 로직 구현 (validateBefore, validateAfter)
  - [x] 1.12 마이그레이션 롤백 로직 구현 (down 메서드)
  - [x] 1.13 마이그레이션 테스트 작성 및 실행

- [x] 2.0 Consolidation Score 계산 서비스 구현
  - [x] 2.1 `ConsolidationScoreService` 클래스 생성 및 기본 구조 구현
  - [x] 2.2 `S(t)` 함수 구현: `(1 - e^(-t)) / (1 + e^(-t))`
  - [x] 2.3 `g_n` 계산 로직 구현: `g_n = g_{n-1} + S(t)`, `g_0 = 1`
    - **최적화 이유**: 점화식 형태이므로 recall_count가 높은 메모리의 경우 n번 반복 계산이 필요. `g_value` 필드에 저장된 값을 사용하여 배치 작업 시 연산 비용을 크게 줄임
  - [x] 2.4 Hou et al. 정규화 회상 확률 공식 구현: `p_n(t) = (1 - exp(-r * e^(-t/g_n))) / (1 - e^(-1))`
  - [x] 2.5 타입별 초기값 설정 (procedural: r_base=0.6, episodic/semantic: r_base=0.5)
  - [x] 2.6 핀 고정 메모리 최소값 보장 로직 (pinned=true일 때 최소 0.25)
  - [x] 2.7 `calculateScore` 메서드 구현 (recall_count, last_accessed_at, g_value, type, pinned 입력)
  - [x] 2.8 `updateGValue` 메서드 구현 (g_value 업데이트 로직)
  - [x] 2.9 NULL 값 처리 로직 (last_accessed_at이 NULL일 때 created_at 사용, g_value가 NULL일 때 재계산)
  - [x] 2.10 점수 클램핑 로직 (0.0 ~ 1.0 범위)
  - [x] 2.11 단위 테스트 작성 (다양한 recall_count, 시간 경과, 타입별 시나리오)
  - [x] 2.12 엣지 케이스 테스트 (NULL 값, 극단적 값, 경계값)

- [x] 3.0 MCP 도구에 실시간 업데이트 로직 통합
  - [x] 3.1 `ConsolidationScoreService`를 MCP 도구 컨텍스트에 주입
  - [x] 3.2 `recall-tool.ts`에 recall_count 업데이트 로직 추가
    - **'성공적인 검색' 정의 (v1 전략)**: 메모리가 검색 결과로 반환될 때를 '성공적인 검색'으로 간주
    - **고려사항**: 에이전트가 검색 결과로 메모리를 보기만 하고 실제로 사용하지 않는 경우에도 recall_count가 증가할 수 있음 (노출수 vs 클릭수)
    - **v1 전략**: 현재 설계대로 진행하되, 이 현상을 인지하고 모니터링. 대부분의 경우 검색 결과 상위 노출은 사용으로 이어질 가능성이 높으므로 초기 버전으로는 합리적
    - **v2 (장기 고려)**: 에이전트가 검색된 메모리를 후속 작업에서 실제로 활용했음을 나타내는 피드백 루프 추가 (검색된 memory_id가 다음 memento.write나 다른 도구 호출에 인자로 사용될 때 카운트)
  - [x] 3.3 `recall-tool.ts`에 last_accessed_at 업데이트 로직 추가
  - [x] 3.4 `recall-tool.ts`에 g_value 업데이트 로직 추가 (기존 g_value 읽어서 계산)
  - [x] 3.5 `memory-injection-prompt.ts`에 동일한 업데이트 로직 추가 (3.2-3.4와 동일한 '성공적인 검색' 정의 적용)
  - [x] 3.6 `remember-tool.ts`에 신규 메모리 초기화 로직 추가 (recall_count=1, last_accessed_at=created_at, g_value=1)
  - [x] 3.7 쓰기 결합(Write Coalescing) 유틸리티 구현 (`write-coalescing.ts`)
  - [x] 3.8 쓰기 결합을 recall_count/last_accessed_at 업데이트에 적용
  - [x] 3.9 에러 처리 및 로깅 추가 (업데이트 실패 시 검색 결과는 정상 반환)
  - [x] 3.10 기능 플래그 확인 로직 추가 (consolidation_score_enabled 체크)
  - [x] 3.11 통합 테스트 작성 (MCP 도구 호출 시 업데이트 확인)

- [x] 4.0 검색 랭킹에 Consolidation Score 통합
  - [x] 4.1 `SearchRanking` 클래스에 consolidation_score 파라미터 추가
  - [x] 4.2 최종 점수 계산 수식 수정: `Final_Score = w1 * vector_similarity + w2 * consolidation_score`
  - [x] 4.3 기본 가중치 설정 (w1=0.8, w2=0.2)
  - [x] 4.4 검색 프로파일별 가중치 구현 (recent: 0.9/0.1, balanced: 0.8/0.2, memory: 0.7/0.3)
  - [x] 4.5 w2 상한 제한 로직 구현 (최대 0.4)
    - **근거**: 의미적 유사도(w1)가 항상 최소 60%의 영향력을 갖도록 보장하여, 아무리 자주 사용되었더라도 관련 없는 내용이 최상위에 노출되는 것을 방지
    - 검색 품질을 유지하면서 기억 강화 효과를 균형있게 적용하기 위한 방어 장치
  - [x] 4.6 `SearchEngine`에서 consolidation_score 조회 로직 추가
  - [x] 4.7 `HybridSearchEngine`에서 consolidation_score 조회 및 통합
  - [x] 4.8 검색 결과에 consolidation_score 포함 (include_metadata 옵션)
  - [x] 4.9 기능 플래그 확인 로직 추가 (비활성 시 기존 점수식만 사용)
  - [x] 4.10 단위 테스트 작성 (다양한 가중치 조합, 상한 제한)
  - [x] 4.11 통합 테스트 작성 (검색 결과 랭킹에 consolidation_score 반영 확인)

- [x] 5.0 배치 재계산 워커 및 스케줄러 통합
  - [x] 5.1 `ConsolidationScoreWorker` 클래스 생성
  - [x] 5.2 시간당 증분 재계산 로직 구현 (최근 1~12시간 내 갱신된 레코드만)
  - [x] 5.3 Changed-since 인덱스 활용한 효율적 쿼리 구현
  - [x] 5.4 야간 전체 스윕 로직 구현 (전체 레코드 재계산)
  - [x] 5.5 바닥값/상한 재적용 로직 구현
  - [x] 5.6 배치 크기 제한 및 청크 단위 처리 구현
  - [x] 5.7 `BatchScheduler`에 consolidation score 재계산 작업 등록
  - [x] 5.8 시간당 증분 재계산 스케줄 설정 (1시간마다)
  - [x] 5.9 야간 전체 스윕 스케줄 설정 (하루 1회, 심야 시간대)
  - [x] 5.10 배치 작업 에러 처리 및 재시도 로직
  - [x] 5.11 배치 작업 성능 모니터링 및 로깅
  - [x] 5.12 단위 테스트 작성 (재계산 로직, 배치 처리)
  - [x] 5.13 통합 테스트 작성 (스케줄러 통합, 실제 데이터 재계산)

