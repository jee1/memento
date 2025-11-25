# Tasks: Reflexion (교정형 성찰) 기능 구현

이 문서는 `0010-prd-reflexion-feature.md` PRD를 기반으로 생성된 구현 작업 목록입니다.

## Relevant Files

- `src/tools/remember-tool.ts` - remember Tool의 reflection_notes 파라미터 처리 로직 구현
- `src/tools/remember-tool.spec.ts` - remember Tool의 reflection_notes 처리 테스트
- `src/tools/recall-tool.ts` - recall Tool의 reflection_notes 필드 포함 로직 구현
- `src/tools/recall-tool.spec.ts` - recall Tool의 reflection_notes 조회 테스트
- `src/utils/reflection-notes-schema.ts` - reflection_notes JSON 스키마 검증 유틸리티 (필수/옵션 필드, 타입 제약, 최대 길이 정책)
- `src/utils/reflection-notes-schema.spec.ts` - reflection_notes 스키마 검증 테스트
- `src/utils/reflection-notes-merge.ts` - reflection_notes 병합 및 배열 크기 제한 공통 유틸리티 (remember Tool과 Worker에서 공통 사용)
- `src/utils/reflection-notes-merge.spec.ts` - reflection_notes 병합 로직 테스트
- `src/database/migration/migrations/006-fts5-reflection-notes.sql` - FTS5 인덱스에 reflection_notes 컬럼 추가 마이그레이션
- `src/database/migration/migrations/006-fts5-reflection-notes.spec.ts` - FTS5 마이그레이션 테스트
- `docs/architecture/zero-downtime-fts5-migration.md` - Zero-Downtime FTS5 마이그레이션 전략 문서 (트랜잭션 경계, 트리거 전환 순서, 롤백 절차)
- `src/utils/database.ts` - FTS5 트리거 업데이트 로직
- `src/algorithms/search-engine.ts` - FTS5 fallback 전략 적용 (reflection_notes 검색 시 마이그레이션 상태 확인)
- `src/algorithms/hybrid-search-engine.ts` - FTS5 fallback 전략 적용 (reflection_notes 검색 시 마이그레이션 상태 확인)
- `src/database/migration/migrations/006-fts5-reflection-notes-migration-status.sql` - FTS5 마이그레이션 상태 메타데이터 테이블 생성 (또는 memento_schema_version 확장)
- `src/utils/fts5-migration-status.ts` - FTS5 마이그레이션 상태 읽기/쓰기 유틸리티 함수
- `src/utils/fts5-migration-status.spec.ts` - FTS5 마이그레이션 상태 유틸리티 테스트
- `src/services/reflexion-worker.ts` - Reflexion Worker 서비스 구현 (Phase 2)
- `src/services/reflexion-worker.spec.ts` - Reflexion Worker 테스트 (Phase 2)
- `src/services/failure-detector.ts` - 실패 감지 시스템 구현 (Phase 2)
- `src/services/failure-detector.spec.ts` - 실패 감지 시스템 테스트 (Phase 2)
- `src/tools/base-tool.ts` - Tool 호출 실패 감지 통합 (Phase 2)
- `src/config/index.ts` - FTS5 마이그레이션 상태 플래그 및 Fallback 전략 설정

### Notes

- Unit tests should typically be placed alongside the code files they are testing (e.g., `remember-tool.ts` and `remember-tool.spec.ts` in the same directory).
- Use `npm test` to run tests. Running without a path executes all tests found by the Vitest configuration.
- FTS5 마이그레이션은 Zero-Downtime 전략을 사용하여 다운타임을 최소화합니다.

## Tasks

- [x] 1.0 remember Tool의 reflection_notes 처리 로직 구현 (Phase 1)
  - [x] 1.1 reflection_notes 파라미터 JSON 검증 로직 구현 (단일 객체 또는 배열 모두 허용)
  - [x] 1.2 reflection_notes JSON 스키마 검증 유틸리티 함수 생성 (src/utils/reflection-notes-schema.ts)
    - [x] 1.2.1 필수 필드 정의: failure_type (enum: 'tool_error' | 'user_feedback' | 'metric_failure'), failure_description (string, 최대 5000자), timestamp (ISO 8601 형식)
    - [x] 1.2.2 옵션 필드 정의: original_task (string, 최대 2000자), lessons_learned (string, 최대 5000자), suggested_improvements (string, 최대 5000자), phase (enum: 'manual' | 'auto', 기본값: 'manual')
    - [x] 1.2.3 타입 제약 검증: timestamp ISO 8601 형식 검증, 문자열 최대 길이 검증, enum 값 검증
    - [x] 1.2.4 단일 객체 및 배열 형식 모두 지원하는 검증 함수 구현
    - [x] 1.2.5 검증 실패 시 구체적인 에러 메시지 반환 (필드명, 기대값, 실제값 포함)
  - [x] 1.3 기존 reflection_notes 조회 로직 구현 (NULL, 단일 객체, 배열 케이스 처리)
  - [x] 1.4 reflection_notes 병합 공통 유틸리티 함수 사용 (src/utils/reflection-notes-merge.ts, 1.5와 함께 구현)
  - [x] 1.5 reflection_notes 병합 및 배열 크기 제한 공통 유틸리티 함수 생성 (src/utils/reflection-notes-merge.ts)
    - [x] 1.5.1 병합 로직: NULL → 새로 저장, 단일 객체 → 배열 변환 후 추가, 배열 → 배열에 추가
    - [x] 1.5.2 배열 크기 제한: 최대 100개, 초과 시 FIFO로 가장 오래된 항목 제거 (제거 전 경고 로그)
    - [x] 1.5.3 단일 객체 최대 크기 검증: 10KB 초과 시 에러 반환
    - [x] 1.5.4 전체 필드 최대 크기 검증: 1MB 초과 시 자동 정리 (가장 오래된 항목부터 제거)
  - [x] 1.6 remember Tool의 handle 메서드에 reflection_notes 처리 로직 통합 (type='procedural'일 때만 처리, 공통 유틸리티 함수 사용)
  - [x] 1.7 에러 처리 및 검증 실패 시 명확한 에러 메시지 반환 (스키마 검증 에러, 크기 제한 에러 등)

- [x] 2.0 recall Tool에 reflection_notes 필드 포함 (Phase 1)
  - [x] 2.1 processSearchResults 메서드에 reflection_notes 필드 추가 (includeMetadata가 true일 때 포함)
  - [x] 2.2 reflection_notes JSON 파싱 로직 구현 (문자열 → 객체/배열 변환, 파싱 실패 시 원본 반환)
  - [x] 2.3 Procedural Memory 조회 시 reflection_notes 자동 포함 로직 구현
  - [x] 2.4 reflection_notes IS NOT NULL 필터링 지원 (필요 시 SQL 쿼리에 조건 추가)

- [x] 3.0 FTS5 인덱스에 reflection_notes 컬럼 추가 및 마이그레이션 (Phase 1)
  - [x] 3.1 Zero-Downtime 마이그레이션 전략 설계 문서 작성 (docs/architecture/zero-downtime-fts5-migration.md)
    - [x] 3.1.1 마이그레이션 단계별 상세 절차 정의 (1. 새 테이블 생성, 2. 기존 데이터 재인덱싱, 3. 트리거 일시 중지, 4. 원자적 교체, 5. 새 트리거 활성화)
    - [x] 3.1.2 트랜잭션 경계 명확화 (각 단계별 트랜잭션 범위, 롤백 가능 지점 정의)
    - [x] 3.1.3 트리거 전환 순서 정의 (기존 트리거 비활성화 → 새 트리거 활성화, 중간 단계에서 신규 write 버퍼링/동기화 전략)
    - [x] 3.1.4 신규 write 동기화 전략 정의 (마이그레이션 중 발생하는 INSERT/UPDATE를 새 테이블에도 반영하는 방법, 트리거 이중 삽입 방지)
      - [x] 3.1.4.1 임시 이중 트리거 전략 설계 (기존 트리거는 memory_item_fts에, 새 임시 트리거는 memory_item_fts_new에 동시 삽입)
      - [x] 3.1.4.2 버퍼 테이블 전략 대안 검토 메모 (미구현, 성능/복잡도 트레이드오프 분석 참고용)
      - [x] 3.1.4.3 신규 write 동기화 전략 결정 (이중 트리거 vs 버퍼 테이블, 성능/복잡도 트레이드오프 분석, **이중 트리거 전략 선택**)
      - [x] 3.1.4.4 선택되지 않은 전략 경로 정리 (버퍼 테이블 전략은 구현하지 않음으로 명시, 문서에서 제거 또는 "구현하지 않음" 표시)
      - [x] 3.1.4.5 신규 write 동기화 테스트 시나리오 작성 (선택된 전략에 대한 마이그레이션 중 INSERT/UPDATE 발생 시나리오, 동기화 검증)
    - [x] 3.1.5 롤백 절차 정의 (마이그레이션 실패 시 각 단계별 되돌리기 방법, 데이터 무결성 보장)
    - [x] 3.1.6 예상 다운타임 및 성능 영향 분석 (대용량 데이터 재인덱싱 시간, 검색 공백 최소화 전략)
  - [x] 3.2 reflection_notes JSON 정규화 유틸리티 함수 구현 (배열 병합, 키 토큰 포함, 값 필드 토큰화)
  - [x] 3.3 새 FTS5 테이블 생성 마이그레이션 스크립트 작성 (memory_item_fts_new, reflection_notes 컬럼 포함)
  - [x] 3.4 기존 데이터 재인덱싱 로직 구현 (memory_item 테이블의 모든 row를 새 FTS5 테이블에 인덱싱, 배치 처리로 성능 최적화)
  - [x] 3.5 신규 write 동기화 메커니즘 구현 (이중 트리거 전략, 3.1.4.3에서 결정된 전략)
    - [x] 3.5.1 임시 이중 트리거 생성 (기존 트리거는 memory_item_fts에 유지, 새 임시 트리거는 memory_item_fts_new에 동시 삽입)
    - [x] 3.5.2 트리거 이중 삽입 방지 로직 구현 (트랜잭션 내에서 중복 방지, 성능 최적화, 3.11.3 테스트 대상)
  - [x] 3.6 원자적 테이블 교체 로직 구현 (트랜잭션 내에서 memory_item_fts 삭제, memory_item_fts_new를 memory_item_fts로 이름 변경, 임시 이중 트리거 정리)
  - [x] 3.7 FTS5 트리거 업데이트 (memory_item_fts_insert, memory_item_fts_update, memory_item_fts_delete에 reflection_notes 추가)
  - [x] 3.8 트리거 내 JSON 정규화 로직 구현 (reflection_notes 파싱 및 토큰화, 정규화 유틸리티 함수 사용)
  - [x] 3.9 Fallback 전략 구현 (마이그레이션 실패 시 기존 테이블 유지, reflection_notes 검색은 LIKE 쿼리로 대체)
    - [x] 3.9.1 마이그레이션 상태 플래그 구현 및 영속 위치 정의
      - [x] 3.9.1.1 마이그레이션 상태 메타데이터 테이블 생성 (memento_schema_version 테이블에 FTS5 마이그레이션 상태 저장 또는 별도 메타데이터 테이블 생성, 006-fts5-reflection-notes-migration-status.sql)
      - [x] 3.9.1.2 마이그레이션 상태 테이블 초기화 로직 구현 (테이블 생성, 초기 상태 'pending' 삽입)
      - [x] 3.9.1.3 마이그레이션 상태 읽기/쓰기 유틸리티 함수 구현 (getMigrationStatus, setMigrationStatus, 상태 전이 검증)
      - [x] 3.9.1.4 config에 FTS5_MIGRATION_STATUS 추가 (런타임 캐시용, 초기값: 'pending')
      - [x] 3.9.1.5 상태 전이 다이어그램 정의: 'pending' → 'in_progress' (마이그레이션 시작) → 'completed' (성공) 또는 'failed' (실패) → 'pending' (재시도)
      - [x] 3.9.1.6 상태 로드 및 캐시 로직 구현 (애플리케이션 부팅 시 initializeDatabase 또는 별도 초기화 훅에서 DB 상태를 읽어 config에 캐시)
      - [x] 3.9.1.7 상태 업데이트 책임 정의 (마이그레이션 스크립트: 시작 시 'in_progress', 성공 시 'completed', 실패 시 'failed', DB와 config 동시 업데이트)
      - [x] 3.9.1.8 마이그레이션 상태 테이블 생성/읽기/쓰기 테스트 작성 (상태 전이 검증, DB-config 동기화 검증)
    - [x] 3.9.2 Fallback 적용 경로 정의 (SearchEngine과 HybridSearchEngine에서 reflection_notes 검색 시 마이그레이션 상태 확인)
      - [x] 3.9.2.1 SearchEngine.checkFTS5Availability 메서드 확장 (reflection_notes 컬럼 사용 가능 여부 확인)
      - [x] 3.9.2.2 SearchEngine.search 메서드에 reflection_notes 검색 분기 추가 (마이그레이션 상태가 'failed' 또는 'pending'일 때 LIKE 쿼리 사용)
      - [x] 3.9.2.3 HybridSearchEngine.executeTextSearch 메서드에 reflection_notes 검색 분기 추가 (SearchEngine을 사용하므로 자동 처리)
      - [x] 3.9.2.4 reflection_notes 검색 쿼리 빌더 함수 생성 (FTS5 MATCH 쿼리 또는 LIKE 쿼리 선택)
    - [x] 3.9.3 Fallback 종료 조건 정의 (마이그레이션 재시도 성공 시 자동으로 FTS5 검색으로 전환, 수동 재시도 메커니즘 제공)
    - [x] 3.9.4 환경 변수 지원 (MEMENTO_FTS5_FALLBACK_ENABLED=true 시 강제로 LIKE 쿼리 사용, 테스트/디버깅용)
  - [x] 3.10 DatabaseUtils.initializeDatabase에 새 FTS5 스키마 반영 및 마이그레이션 상태 로드
    - [x] 3.10.1 DatabaseUtils.initializeDatabase에 새 FTS5 스키마 반영
    - [x] 3.10.2 initializeDatabase 함수에 FTS5 마이그레이션 상태 로드 로직 추가 (DB에서 상태 읽어 config에 캐시, 초기화 시점에 실행)
    - [x] 3.10.3 마이그레이션 상태 로드 실패 시 기본값 'pending' 설정 및 경고 로그
  - [x] 3.11 마이그레이션 스크립트 테스트 (006-fts5-reflection-notes.spec.ts, Zero-Downtime 전략, 신규 write 동기화, 롤백 절차, Fallback 전략 포함)
    - [x] 3.11.1 마이그레이션 상태 테이블 생성/초기화 테스트
    - [x] 3.11.2 마이그레이션 중 INSERT/UPDATE 발생 시나리오 테스트 (이중 트리거 전략에 대한 신규 write 동기화 검증)
    - [x] 3.11.3 트리거 이중 삽입 방지 테스트 (임시 이중 트리거가 memory_item_fts와 memory_item_fts_new에 동시 삽입하는지 검증, 트랜잭션 내에서 중복 방지 로직 검증)
    - [x] 3.11.4 롤백 절차 테스트 (각 단계별 롤백 검증, 상태 롤백 포함)
    - [x] 3.11.5 Fallback 전략 테스트 (마이그레이션 실패 시 LIKE 쿼리 사용 검증, 상태 불일치 시나리오)
    - [x] 3.11.6 마이그레이션 상태 로드/캐시 테스트 (initializeDatabase에서 상태 로드 검증, DB-config 동기화 검증)

- [ ] 4.0 Phase 1 테스트 작성 및 검증 (Phase 1)
  - [x] 4.1 reflection_notes 스키마 검증 유틸리티 단위 테스트 작성 (필수/옵션 필드, 타입 제약, 최대 길이, enum 값, 에러 메시지 포맷)
  - [x] 4.2 reflection_notes 병합 공통 유틸리티 단위 테스트 작성 (NULL 처리, 단일 객체 → 배열 변환, 배열 추가, 크기 제한, FIFO 제거)
  - [x] 4.3 remember Tool의 reflection_notes 처리 단위 테스트 작성 (JSON 검증, 스키마 검증, 병합 로직, 배열 크기 제한, 공통 유틸리티 함수 사용)
  - [x] 4.4 recall Tool의 reflection_notes 조회 단위 테스트 작성 (필드 포함, JSON 파싱, Procedural Memory 필터링)
  - [x] 4.5 FTS5 reflection_notes 검색 통합 테스트 작성 (단일 객체, 배열, 키 토큰 검색, 검색 쿼리 예시, Fallback 전략)
    - [x] 4.5.1 SearchEngine의 reflection_notes 검색 fallback 테스트 (마이그레이션 상태별 분기 검증)
    - [x] 4.5.2 HybridSearchEngine의 reflection_notes 검색 fallback 테스트
  - [x] 4.6 E2E 테스트 시나리오 작성 (remember로 reflection_notes 저장 → recall로 조회 → FTS5 검색)
  - [x] 4.7 에러 케이스 테스트 작성 (잘못된 JSON 형식, 스키마 검증 실패, NULL 처리, 빈 배열, 크기 제한 초과 등)

- [ ] 5.0 실패 감지 시스템 구현 (Phase 2)
  - [ ] 5.1 FailureDetector 서비스 클래스 생성 (src/services/failure-detector.ts)
  - [ ] 5.2 MCP Tool 호출 실패 감지 로직 구현 (ToolError, ValidationError, DatabaseError 등 에러 타입 감지)
  - [ ] 5.3 BaseTool에 실패 감지 훅 통합 (handle 메서드에서 에러 발생 시 FailureDetector 호출)
  - [ ] 5.4 사용자 피드백 기반 실패 감지 로직 구현 (키워드 기반 감지, 텍스트 메시지 분석)
  - [ ] 5.5 성능 지표 미달 감지 로직 구현 (응답 시간 임계값, 정확도 지표, 에러율 임계값)
  - [ ] 5.6 실패 이벤트 큐잉 시스템 구현 (AsyncTaskQueue 활용, 우선순위 기반 큐)
  - [ ] 5.7 실패 이벤트 데이터 구조 정의 (tool_name, error_type, error_message, timestamp, context 등)

- [ ] 6.0 Reflexion Worker 구현 (Phase 2)
  - [ ] 6.1 ReflexionWorker 서비스 클래스 생성 (src/services/reflexion-worker.ts)
  - [ ] 6.2 중복 감지 방지 로직 구현 (이벤트 키 생성: SHA256({tool_name}_{error_type}_{error_message_hash}), 슬라이딩 윈도우 5분)
  - [ ] 6.3 재시도 및 백오프 로직 구현 (최대 3회 재시도, 지수 백오프: 1초, 2초, 4초)
  - [ ] 6.4 동시성 제한 로직 구현 (최대 5개 동시 실행, 우선순위 기반 큐 처리)
  - [ ] 6.5 큐 크기 제한 로직 구현 (최대 100개, 초과 시 FIFO로 가장 오래된 항목 제거)
  - [ ] 6.6 장애 처리 로직 구현 (Worker 크래시 자동 재시작 최대 3회, 큐 적체 임계값 50개 경고)
  - [ ] 6.7 auto_reflect 내부 함수 구현 (MCP Tool로 노출되지 않음, 실패 정보를 바탕으로 Reflexion 데이터 생성)
  - [ ] 6.8 Reflexion 데이터 자동 생성 로직 구현 (failure_type 설정, 실패 설명 추출, 원래 작업 목표 추출, 템플릿 기반 개선 방안 제안)
  - [ ] 6.9 BatchScheduler에 Reflexion Worker 통합 (백그라운드 실행, 메인 프로세스 격리)

- [ ] 7.0 동일 작업 반복 실패 처리 로직 구현 (Phase 2)
  - [ ] 7.1 동일 task_goal 감지 로직 구현 (Procedural Memory의 task_goal 필드 기준)
  - [ ] 7.2 기존 reflection_notes 조회 로직 구현 (동일 task_goal에 대한 이전 Reflexion 기록 조회)
  - [ ] 7.3 reflection_notes 업데이트 로직 구현 (공통 유틸리티 함수 사용: src/utils/reflection-notes-merge.ts, 1.5에서 구현된 함수 재사용)
  - [ ] 7.4 배열 크기 제한 로직 구현 (공통 유틸리티 함수 사용: src/utils/reflection-notes-merge.ts, 1.5에서 구현된 함수 재사용)
  - [ ] 7.5 반복 실패 패턴 분석 로직 구현 (동일 작업의 반복 실패 횟수 추적, 실패 패턴 분석)
  - [ ] 7.6 ReflexionWorker에 반복 실패 처리 통합 (auto_reflect 함수 내에서 동일 task_goal 확인 및 공통 유틸리티 함수로 업데이트)

- [ ] 8.0 Phase 2 테스트 작성 및 검증 (Phase 2)
  - [ ] 8.1 FailureDetector 단위 테스트 작성 (MCP Tool 호출 실패 감지, 사용자 피드백 감지, 성능 지표 미달 감지)
  - [ ] 8.2 ReflexionWorker 단위 테스트 작성 (중복 감지, 재시도 및 백오프, 동시성 제한, 큐 크기 제한)
  - [ ] 8.3 동일 작업 반복 실패 처리 통합 테스트 작성 (task_goal 기반 감지, reflection_notes 업데이트, 배열 변환)
  - [ ] 8.4 E2E 테스트 시나리오 작성 (Tool 호출 실패 → 자동 Reflexion 기록 → 동일 작업 재시도 시 개선 방안 적용)
  - [ ] 8.5 성능 테스트 작성 (동시성, 큐 적체 시나리오, Worker 실패 복구)
  - [ ] 8.6 측정 지표 수집 로직 구현 (실패 감지 재현율, 정밀도, Reflexion 기록 성공률)

