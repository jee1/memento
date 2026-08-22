# tasks-0001-prd-embedding-provider-compatibility.md

## Relevant Files

- `src/services/unified-embedding-service.ts` - 통합 임베딩 서비스 강화 (다중 모델 지원)
- `src/services/embedding-provider-factory.ts` - 제공자 팩토리 개선 (가용성 체크 및 폴백)
- `src/services/embedding-migration-service.ts` - 마이그레이션 엔진 (새로 생성)
- `src/services/embedding-migration-service.spec.ts` - 마이그레이션 서비스 단위 테스트
- `src/services/migration-monitor-service.ts` - 마이그레이션 실시간 진행 상황 브로드캐스트
- `src/services/migration-monitor-service.spec.ts` - 마이그레이션 모니터링 서비스 단위 테스트
- `src/services/migration-history-service.ts` - 마이그레이션 이력 및 로그 관리 서비스
- `src/services/migration-history-service.spec.ts` - 마이그레이션 이력 서비스 단위 테스트
- `src/services/model-availability-service.ts` - 모델 가용성 체크 서비스 (새로 생성)
- `src/services/model-availability-service.spec.ts` - 모델 가용성 서비스 단위 테스트
- `src/services/vector-search/vector-search-result-normalizer.ts` - 검색 결과 정규화 유틸리티
- `src/services/vector-search/vector-search-result-normalizer.spec.ts` - 검색 결과 정규화 단위 테스트
- `src/services/alert-notification-service.ts` - 통합 알림 브로커
- `src/services/alert-notification-service.spec.ts` - 알림 브로커 단위 테스트
- `src/utils/logger.ts` - 공용 로깅 유틸리티
- `src/services/performance-monitor.spec.ts` - 성능 모니터 메트릭 분석 테스트
- `src/utils/logger.ts` - 공용 로깅 유틸리티
- `src/services/vector-compatibility-service.ts` - 벡터 호환성 관리 서비스 (새로 생성)
- `src/services/vector-compatibility-service.spec.ts` - 벡터 호환성 서비스 단위 테스트
- `src/database/schema.sql` - 다중 차원 벡터 지원 스키마 업데이트
- `src/database/migrate.ts` - 마이그레이션 로직 개선
- `src/database/migrations/003_embedding_compatibility.sql` - 임베딩 호환성 마이그레이션 (새로 생성)
- `src/config/index.ts` - 설정 관리 개선
- `src/config/environment.ts` - 환경 변수 기본값/우선순위 해석 헬퍼
- `src/utils/configuration-validator.ts` - 설정 검증 유틸리티 (새로 생성)
- `src/types/migration.types.ts` - 마이그레이션 타입 정의 (새로 생성)
- `src/types/embedding.types.ts` - 임베딩 타입 확장
- `docker-compose.base.yml` - Docker 공통 서비스 정의 앵커
- `docker-compose.yml` - 기본 환경 설정 통합
- `docker/docker-compose.dev.yml` - 개발 환경 설정 통합
- `docker/docker-compose.prod.yml` - 프로덕션 환경 설정 통합
- `src/test/embedding-migration.test.ts` - 마이그레이션 테스트 (새로 생성)
- `src/services/model-availability-service.spec.ts` - 모델 가용성 테스트 (새로 생성)
- `src/test/vector-compatibility.test.ts` - 벡터 호환성 테스트 (새로 생성)

### Notes

- Unit tests should typically be placed alongside the code files they are testing (e.g., `MyComponent.tsx` and `MyComponent.test.tsx` in the same directory).
- Use `npm run test` to run tests. Running without a path executes all tests found by the Vitest configuration.
- 기존 데이터 호환성을 보장하면서 점진적으로 새로운 기능을 도입해야 함
- 마이그레이션 과정에서 데이터 무결성을 보장해야 함
- Docker 환경에서 설정 일관성을 유지해야 함

## Tasks

- [ ] 1.0 데이터 호환성 관리 시스템 구축
  - [x] 1.1 벡터 차원 불일치 문제 분석 및 해결 방안 설계
    - 분석: `memory_embedding` 단일 레코드(UNIQUE memory_id) 구조와 고정 차원 vec0 테이블 때문에 제공자 전환 시 기존 384차원 데이터가 768/1536차원 테이블로 이동하지 못해 sqlite-vec에서 Dimension mismatch 에러가 발생하고, 검색 엔진도 단일 차원을 전제함.
    - 해결 방안: 임베딩 저장소를 memory_id+provider 복합 키 구조로 재설계하고, provider별 vec0 테이블/뷰를 동적으로 관리하며 VectorCompatibilityService에서 패딩·축소·정규화를 담당하도록 하여 마이그레이션 시 Zero padding 기반의 호환 벡터를 생성하고 검색 시 목표 차원으로 변환하도록 한다.
  - [x] 1.2 다중 차원 벡터 지원을 위한 데이터베이스 스키마 업데이트
    - 변경 사항: `memory_embedding`을 `(memory_id, embedding_provider, projection_type)` 복합 키 기반으로 재구성하고 차원/정규화/버전을 명시하는 메타데이터 컬럼을 추가했으며, `embedding_model_registry` 테이블로 모델별 차원과 vec 슬롯을 정의할 수 있도록 함. vec 트리거는 차원 조건을 검사해 384/768/1536 테이블에 안전하게 삽입·재삽입하도록 갱신하였다.
  - [x] 1.3 벡터 변환 서비스 구현 (차원 축소/확장, 패딩)
    - 구현: `VectorCompatibilityService`가 확장(제로 패딩/반복/보간)과 축소(평균 풀링/절단) 전략을 지원해 목표 차원으로 투영하며, L2·Min-Max 정규화 옵션을 포함한 일관된 결과 메타데이터(`projectionType`, 사용 전략)를 반환하도록 구성.
  - [x] 1.4 벡터 호환성 검증 시스템 구현
    - 검증: `VectorCompatibilityService`에 차원 불일치·비유한 값·제로 벡터 감지와 제공자별 기본 차원 기반 `assess/validateProviderCompatibility`를 추가하고, `MemoryEmbeddingService`가 저장 전에 검증/자동 투영 및 경고 로깅을 수행하도록 연동.
  - [x] 1.5 기존 데이터 호환성 테스트 작성
    - 테스트: `vector-compatibility-service.spec.ts`로 384→1536 투영과 비정상 값 보정 시나리오를 검증하고, `memory-embedding-service.integration.spec.ts`에 레거시 OpenAI 벡터 자동 패딩 케이스를 추가해 저장된 차원/투영 메타데이터를 확인.

- [ ] 2.0 자동 마이그레이션 엔진 개발
  - [x] 2.1 마이그레이션 서비스 인터페이스 설계
    - 산출물: `src/types/migration.types.ts`로 플랜/대상/결과/오류 타입을 정의하고, `embedding-migration-service.ts`에 계획 생성·대상 조회·진행 상태 초기화를 포함한 인터페이스를 구현함.
  - [x] 2.2 벡터 데이터 마이그레이션 로직 구현
    - 로직: `embedding-migration-service.ts`에서 배치 조회/재투영/업서트 실행을 구현하고, `embedding-migration-service.spec.ts`로 성공/드라이런/타깃 나열 시나리오를 검증함.
  - [x] 2.3 마이그레이션 진행 상황 모니터링 시스템
    - 모니터링: `MigrationMonitorOptions`와 진행 핸들러를 추가해 배치 처리마다 진행률/스텝 상태를 브로드캐스트하고 테스트에서 콜백 기반 모니터링을 검증함.
  - [x] 2.4 롤백 시스템 구현
    - 롤백: 마이그레이션 시 기존 타겟 행을 백업하거나 신규 행 목록을 `rollbackEntries`로 수집하고, `rollback` 메서드로 삭제·복원 시나리오를 지원하는 테스트를 작성함.
  - [x] 2.3 마이그레이션 진행 상황 모니터링 시스템
    - 실시간: `migration-monitor-service`가 런 ID별 진행 스냅샷을 캐싱·브로드캐스트하며, `MigrationMonitorOptions.runId` 지정 시 자동으로 전역 리포터가 progress/완료 이벤트를 발행하도록 `embedding-migration-service`를 확장함.
  - [x] 2.4 롤백 시스템 구현
    - 자동: 마이그레이션 실패 시 기본적으로 자동 롤백이 작동하도록 `autoRollbackOnFailure` 옵션을 도입하고, 실패 시 기록된 변경분을 즉시 되돌리며 결과에 `rolledBack` 상태를 포함하도록 개선함.
  - [x] 2.5 마이그레이션 이력 및 로그 관리
    - 이력관리: `migration-history-service`로 DB 저장/조회·요약·정리 기능을 캡슐화하고, `MigrationHistoryFilter`/`Summary` 타입으로 상태 기반 검색과 `pruneHistory` 정리 옵션을 제공하며 실행 시 콘솔 로그로 요약 결과를 남기도록 했다.

- [ ] 3.0 Docker 환경 설정 통합 및 검증
  - [x] 3.1 환경 변수 우선순위 및 기본값 정리
    - 정리: `environment.ts`에서 공통 기본값과 우선순위를 통합 정의하고, `mementoConfig`가 `MCP_SERVER_PORT` 등 일관된 키를 사용하도록 정비했으며 Compose/`.env` 예시도 동일한 명칭과 기본값을 따르도록 갱신함.
  - [x] 3.2 설정 검증 유틸리티 구현
    - 검증: `configuration-validator`에서 오류/경고를 구조화해 API 키 누락, 포트/검색 한도, TTL 값 등을 검증하고, `validateConfig()`가 공용 유틸리티를 호출하도록 교체해 모든 엔트리포인트가 동일한 검증 로직을 사용하게 했다.
  - [x] 3.3 환경별 Docker Compose 템플릿 통합
    - 템플릿: `docker-compose.base.yml`로 공통 서비스를 정의하고 dev/prod 구성은 `extends`로 공유하도록 개편해 포트·환경변수·볼륨 기본값을 중앙화했으며, 각 환경 파일은 필요한 항목만 override 하도록 정리했다.
  - [x] 3.4 설정 불일치 감지 및 경고 시스템
    - 경고: `configuration-validator`가 포트 이중 정의(`PORT` vs `MCP_SERVER_PORT`)나 프로덕션에서 지나치게 낮은 로그 레벨 등 설정 불일치를 감지해 경고 리스트와 로그로 남기도록 확장했다.
  - [x] 3.5 컨테이너 시작 시 설정 검증
    - 검증: `validateConfig()`가 테스트/스킵 플래그를 고려해 실행되며, 스타트업 경로(`index.ts`, `http-server.ts`)에 그대로 적용되어 잘못된 환경에서는 즉시 예외를 발생시켜 컨테이너가 종료되도록 보강함.

- [ ] 4.0 모델 가용성 및 폴백 시스템 강화
  - [x] 4.1 모델 가용성 체크 서비스 구현
    - 서비스: `model-availability-service`가 제공자별 헬스체크와 최근 상태 캐시를 관리하며, 헬스 샘플 호출로 실시간 가용성을 평가하도록 구현함.
  - [x] 4.2 우선순위 기반 폴백 로직 개선
    - 폴백: `EmbeddingProviderFactory`가 헬스 체크 결정을 고려해 `selectProviderWithHealthCheck`를 제공하고, `UnifiedEmbeddingService`가 해당 결정을 사용해 자동 폴백하도록 갱신함.
  - [x] 4.3 API 키 검증 및 대체 모델 안내
    - 안내: OpenAI/Gemini 서비스 초기화에서 키 누락 시 자동 폴백 경고와 설정 방법을 안내하고, 구성 검증 시에도 키 미설정 시 로컬 모델 사용 권고를 제안하도록 메시지를 보강했다.
  - [x] 4.4 모델 로딩 실패 시 자동 복구
    - 복구: `openai/gemini` 서비스가 실패 시 재초기화를 시도하고, `UnifiedEmbeddingService`가 장애 공급자를 즉시 재등록하여 다음 요청에서 건강한 공급자로 자동 전환되도록 했다.
  - [x] 4.5 제공자별 상태 모니터링
    - 모니터링: `ModelAvailabilityService`가 헬스 상태를 캐시하고 구독자에게 브로드캐스트하도록 구현되어, 실시간 가용성 변화에 대응할 수 있는 상태 모니터링 인프라를 마련함.

- [ ] 5.0 통합 검색 및 모니터링 시스템
  - [x] 5.1 다중 모델 검색 통합 인터페이스 구현
    - 인터페이스: `VectorSearchService`가 `providerHybridSearch`로 제공자별 검색/하이브리드 결과와 지연 시간을 집계하고, 파사드가 이를 노출해 다중 모델 검색을 한 번에 실행할 수 있게 했다.
  - [x] 5.2 검색 결과 정규화 시스템
    - 정규화: `vector-search-result-normalizer`가 제공자별 점수를 0~1 범위로 정규화하고 중복 메모리를 통합하여 통합 순위를 반환하며, `unifiedSearch`가 제공자 결과와 함께 정규화된 결과를 제공하도록 확장됨.
  - [x] 5.3 성능 메트릭 수집 및 분석
    - 분석: `PerformanceMonitor`가 CPU/메모리/DB/검색 메트릭을 히스토리에 저장하고 `getMetricsAnalytics`로 평균·피크·증가율을 계산해 리포트에 포함하며, 단위 테스트로 집계 정확성을 검증했다.
  - [x] 5.4 로깅 시스템 개선
    - 로깅: 공용 `logger`를 도입해 퍼포먼스 모니터와 핵심 서비스의 경고/에러 로그를 구조화하고, 알림·DB 최적화·모니터링 루프에서 메타 데이터를 포함한 로그를 남기도록 정비했다.
  - [x] 5.5 알림 및 경고 시스템 구현
    - 알림: `alert-notification-service`가 퍼포먼스 경고와 모델 가용성 변화를 수집·구독할 수 있도록 하고, `PerformanceMonitor`와 `ModelAvailabilityService`가 상태 변화 시 통합 알림을 발행하도록 연동했다.
