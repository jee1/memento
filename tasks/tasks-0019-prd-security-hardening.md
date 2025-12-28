# 작업 목록: 보안 강화 (Phase 1)

이 문서는 `0019-prd-security-hardening.md` PRD를 기반으로 생성된 상세 작업 목록입니다.

## 사전 확인 사항

다음 항목들은 이미 확인되었으며 추가 작업이 필요하지 않습니다:
- ✅ `tsx` devDependency: `package.json`에 `^4.6.0` 포함 확인
- ✅ `setupTestDatabase()` 및 `cleanupTestDatabase()`: `src/test/helpers/test-database.ts`에 존재 확인
- ✅ 기본 디렉토리 존재 확인: `data/`, `logs/` 존재 확인 (운영 경로와 일치), `backup/`은 없으면 자동 생성
- ✅ 검색 엔진 테스트 경로 확인: `src/domains/search/algorithms/__tests__/search-engine.spec.ts`, `src/domains/search/algorithms/vector-search-engine.spec.ts` 존재 확인
- ✅ 검색 엔진 테스트 DB 격리 확인: 기존 테스트는 `MockDatabase` 또는 `:memory:` DB 사용, 파일 기반 DB 사용하지 않음

## Relevant Files

- `src/domains/search/algorithms/search-engine.ts` - 동적 SQL 쿼리 생성 로직 포함
- `src/domains/search/algorithms/vector-search-engine.ts` - 벡터 검색 쿼리 생성 (동적 테이블명 사용)
- `src/domains/search/repositories/vector-search.repository.ts` - 벡터 검색 리포지토리 (동적 테이블명 사용)
- `src/domains/memory/services/memory-embedding-service.ts` - 임베딩 서비스 (동적 테이블명 사용)
- `src/shared/utils/logger.ts` - 일반 로거 (PII 마스킹 미적용)
- `src/shared/utils/pii-masker.ts` - PII 마스킹 유틸리티 (기존 구현)
- `src/infrastructure/logging/triple-extraction-logger.ts` - Triple 추출 로거 (PII 마스킹 적용 중)
- `src/infrastructure/scheduler/file-logger.ts` - 파일 로거 (경로 검증 없음)
- `src/domains/monitoring/services/error-logging-service.ts` - 오류 로깅 서비스
- `src/shared/utils/path-validator.ts` - 경로 검증 유틸리티 (신규 생성 필요)
- `scripts/backup-daily.bat` - 일일 백업 스크립트 (경로 검증 없음)
- `scripts/backup-embeddings.js` - 임베딩 백업 스크립트 (경로 검증 없음)
- `src/shared/utils/logger.spec.ts` - 로거 PII 마스킹 테스트 (기존 파일 수정)
- `src/shared/utils/path-validator.spec.ts` - 경로 검증 유틸리티 테스트 (신규 생성 필요)
- `src/test/test-security-sql-injection.ts` - SQL Injection E2E 테스트 (신규 생성 필요)
- `src/test/test-security-path-traversal.ts` - Path Traversal E2E 테스트 (신규 생성 필요)
- `scripts/check-sql-injection.ts` - SQL Injection 검사 스크립트 (신규 생성 필요)
- `scripts/check-pii-masking.ts` - PII 마스킹 검사 스크립트 (신규 생성 필요)
- `scripts/check-path-traversal.ts` - Path Traversal 검사 스크립트 (신규 생성 필요)

### Notes

- **테스트 프레임워크**: 이 프로젝트는 **Vitest**를 사용합니다.
- **테스트 파일 명명 규칙**:
  - 단위 테스트: `*.spec.ts` (테스트 대상 파일과 동일 디렉터리)
  - E2E/시나리오 테스트: `src/test/test-*.ts` (tsx로 실행)
- **테스트 실행**:
  - 단위 테스트: `npm test -- [optional/path/to/test/file]` 또는 `vitest [path]`
  - E2E 테스트: `tsx src/test/test-*.ts` (tsx는 이미 devDependency에 포함됨: `^4.6.0`, `package.json` 확인 완료)
  - 전체 테스트: `npm test` (Vitest 실행)
- **데이터 격리 규칙**:
  - 모든 테스트는 `src/test/helpers/test-database.ts`의 `setupTestDatabase()` 사용 (존재 확인 완료)
  - SQLite in-memory 데이터베이스 사용 (`:memory:`)
  - 테스트 종료 시 `cleanupTestDatabase(db)` 호출 필수 (존재 확인 완료)
  - 실제 `data/` 디렉토리나 프로덕션 DB를 건드리지 않음
  - E2E 테스트도 동일한 격리 규칙 적용
- **검사 스크립트 vs ESLint 비교**:
  - **ESLint (`eslint-plugin-security`)**:
    - 정적 분석으로 코드 패턴 감지 (컴파일 타임)
    - SQL Injection 패턴, `eval()` 사용, `dangerous` 함수 호출 등 감지
    - 빠른 실행 속도, CI/CD 통합 용이
    - **한계**: 런타임 동작 검증 불가, 동적 쿼리 생성 패턴 일부 누락 가능
  - **검사 스크립트 (`check-*.ts`)**:
    - 런타임 동작 검증 (실제 쿼리 실행, 로그 출력, 파일 경로 처리)
    - 동적 테이블명 사용 패턴, 실제 파라미터 바인딩 여부 확인
    - 로그 파일에서 실제 PII 마스킹 여부 확인
    - 파일 경로 처리 코드의 실제 검증 로직 적용 여부 확인
    - **장점**: 실제 동작 검증, ESLint로 감지 불가능한 패턴 발견
    - **비용**: 실행 시간 추가 (약 20초), 유지보수 필요
  - **결론**: 두 가지를 병행하여 정적 분석(ESLint)과 런타임 검증(스크립트)을 모두 수행합니다.

## Definition of Done

각 대단원별 완료 기준은 다음 표와 같습니다:

| 대단원 | 완료 기준 | 검증 방법 |
|--------|----------|----------|
| **1.0 SQL Injection 방지** | - 모든 동적 쿼리가 파라미터 바인딩으로 전환됨<br>- SQL Injection E2E 테스트 100% 통과<br>- `scripts/check-sql-injection.ts` 실행 시 경고 0개<br>- ESLint 보안 규칙 통과 (경고/에러 0개) | `tsx src/test/test-security-sql-injection.ts`<br>`tsx scripts/check-sql-injection.ts`<br>`npm run lint` |
| **2.0 PII 마스킹 강화** | - 모든 로거에서 PII 마스킹 자동 적용<br>- PII 마스킹 단위 테스트 100% 통과<br>- 실제 로그 파일에서 PII가 마스킹되었는지 확인<br>- `scripts/check-pii-masking.ts` 실행 시 경고 0개 | `npm test -- src/shared/utils/logger.spec.ts`<br>`tsx scripts/check-pii-masking.ts`<br>샘플 로그 파일 검증 |
| **3.0 Path Traversal 방지** | - 모든 파일 경로 처리 유틸리티에서 검증 로직 적용<br>- Path Traversal E2E 테스트 100% 통과<br>- `scripts/check-path-traversal.ts` 실행 시 경고 0개 | `tsx src/test/test-security-path-traversal.ts`<br>`npm test -- src/shared/utils/path-validator.spec.ts`<br>`tsx scripts/check-path-traversal.ts` |
| **4.0 정적 분석 도구 통합** | - ESLint 보안 규칙 통과 (경고/에러 0개)<br>- CI/CD 파이프라인에서 보안 검사 자동 실행<br>- PR 생성 시 보안 검사 자동 통과 | `npm run lint`<br>GitHub Actions 워크플로우 실행 확인 |

### 전체 완료 기준

- [ ] 모든 대단원(1.0~4.0)의 완료 기준 충족
- [ ] 코드 리뷰 통과
- [ ] Lint/Type-check/Test 통과 (`npm run lint && npm run type-check && npm test`)
- [ ] CI/CD 파이프라인에서 모든 보안 검사 통과
- [ ] 신규 정적 분석 경고 0개
- [ ] 실제 공격 패턴으로 재현 시도 시 모두 차단되는지 확인

## Tasks

- [x] 1.0 SQL Injection 방지 구현 ✅
  - [x] 1.1 `scripts/check-sql-injection.ts` 스크립트 생성 (동적 쿼리 검색 및 분석)
    - **Given**: PRD 요구사항과 코드베이스의 동적 쿼리 패턴이 주어졌을 때
    - **When**: `scripts/check-sql-injection.ts` 스크립트를 실행하면
    - **Then**: 모든 동적 쿼리 생성 패턴을 검색하고 경고를 출력해야 함
    - **구현 요구사항**:
      - 문자열 연결(`+` 또는 템플릿 리터럴)을 통한 SQL 쿼리 생성 패턴 검색
      - `FROM ${tableName}`, `JOIN ${tableName}` 등 동적 테이블명 사용 패턴 검색
      - 파라미터 바인딩 미사용 쿼리 패턴 검색
      - 검색 결과를 파일별로 정리하여 출력
      - 경고 수를 반환하여 CI/CD에서 사용 가능하도록 구현
  - [x] 1.2 `src/test/test-security-sql-injection.ts` E2E 테스트 파일 생성 (RED 단계)
    - **Given**: SQL Injection 공격 시나리오가 주어졌을 때
    - **When**: 악의적인 SQL 패턴을 주입하면
    - **Then**: 시스템이 안전하게 처리하고 데이터베이스가 손상되지 않아야 함
    - **구현 요구사항**:
      - `'; DROP TABLE--` 패턴 테스트
      - `' OR '1'='1` 패턴 테스트
      - `UNION SELECT` 패턴 테스트
      - 주석(`--`, `/* */`) 주입 패턴 테스트
      - 각 테스트는 given/when/then 구조로 작성
      - 테스트는 실패해야 함 (RED 단계)
      - **데이터 격리**: `setupTestDatabase()` 사용하여 in-memory DB 생성, 테스트 종료 시 `cleanupTestDatabase(db)` 호출
  - [x] 1.3 `src/domains/search/algorithms/search-engine.ts` 파라미터 바인딩 전환 (GREEN 단계)
    - **Given**: 기존 동적 쿼리 생성 로직이 주어졌을 때
    - **When**: 모든 사용자 입력값을 파라미터 바인딩으로 전환하면
    - **Then**: SQL Injection 테스트가 통과하고 기존 기능이 정상 동작해야 함
    - **구현 요구사항**:
      - 문자열 연결을 통한 쿼리 생성 제거
      - 모든 사용자 입력값을 `?` 플레이스홀더로 전환
      - `better-sqlite3`의 `prepare()` 메서드와 파라미터 배열 사용
      - 기존 테스트 통과 확인
  - [x] 1.4 `src/domains/search/algorithms/vector-search-engine.ts` 동적 테이블명 검증 강화 (GREEN 단계)
    - **Given**: 동적 테이블명을 사용하는 쿼리가 주어졌을 때
    - **When**: `getVectorTableName()` 메서드가 화이트리스트 기반 검증을 수행하면
    - **Then**: 허용되지 않은 테이블명은 거부되고 SQL Injection이 방지되어야 함
    - **구현 요구사항**:
      - `getVectorTableName()` 메서드에 화이트리스트 검증 로직 추가
      - **화이트리스트 기준**: `VECTOR_SEARCH_CONFIG.tableNames`에 정의된 테이블명만 허용
        - 허용 테이블명: `memory_item_vec_tfidf`, `memory_item_vec_minilm`, `memory_item_vec_openai`, `memory_item_vec_gemini`
        - 테이블명 패턴: `[a-z0-9_]+` (소문자, 숫자, 언더스코어만 허용)
        - SQL 키워드 포함 시 거부
      - 허용되지 않은 테이블명 입력 시 에러 발생
      - 기존 테스트 통과 확인
  - [x] 1.5 `src/domains/search/repositories/vector-search.repository.ts` 파라미터 바인딩 전환 (GREEN 단계)
    - **Given**: 벡터 검색 리포지토리의 동적 쿼리가 주어졌을 때
    - **When**: 모든 쿼리를 파라미터 바인딩으로 전환하면
    - **Then**: SQL Injection 테스트가 통과하고 벡터 검색 기능이 정상 동작해야 함
    - **구현 요구사항**:
      - 동적 테이블명은 화이트리스트 검증 후 사용
      - 사용자 입력값은 모두 파라미터 바인딩 사용
      - 기존 테스트 통과 확인
  - [x] 1.6 `src/domains/memory/services/memory-embedding-service.ts` 파라미터 바인딩 전환 (GREEN 단계)
    - **Given**: 임베딩 서비스의 동적 쿼리가 주어졌을 때
    - **When**: 모든 쿼리를 파라미터 바인딩으로 전환하면
    - **Then**: SQL Injection 테스트가 통과하고 임베딩 기능이 정상 동작해야 함
    - **구현 요구사항**:
      - 동적 테이블명은 화이트리스트 검증 후 사용
      - 사용자 입력값은 모두 파라미터 바인딩 사용
      - 기존 테스트 통과 확인
  - [x] 1.7 기타 동적 쿼리 파일 파라미터 바인딩 전환 (GREEN 단계)
    - **Given**: `scripts/check-sql-injection.ts`가 발견한 모든 동적 쿼리가 주어졌을 때
    - **When**: 각 파일별로 순차적으로 파라미터 바인딩으로 전환하면
    - **Then**: 모든 SQL Injection 테스트가 통과하고 기존 기능이 정상 동작해야 함
    - **구현 요구사항**:
      - `check-sql-injection.ts` 실행 결과를 기반으로 대상 파일 목록 작성
      - 각 파일별로 순차적으로 전환
      - 변경 후 테스트 통과 확인
  - [x] 1.8 SQL Injection 테스트 통과 확인 및 리팩토링 (REFACTOR 단계)
    - **Given**: 모든 파라미터 바인딩 전환이 완료되었을 때
    - **When**: SQL Injection 테스트를 실행하면
    - **Then**: 모든 테스트가 통과하고 코드 품질이 개선되어야 함
    - **구현 요구사항**:
      - `tsx src/test/test-security-sql-injection.ts` 실행하여 모든 테스트 통과 확인
      - 중복 코드 제거 및 공통 유틸리티 함수 추출
      - 코드 가독성 개선
      - `scripts/check-sql-injection.ts` 실행 시 경고 0개 확인

- [ ] 2.0 PII 마스킹 강화 구현
  - [x] 2.1 `src/shared/utils/logger.spec.ts` PII 마스킹 자동 적용 테스트 작성 (RED 단계)
    - **Given**: PII가 포함된 로그 메시지가 주어졌을 때
    - **When**: `logger.info()`, `logger.error()` 등을 호출하면
    - **Then**: 로그 출력에 PII가 마스킹되어야 함
    - **구현 요구사항**:
      - 이메일, 전화번호, API 키 등 PII 포함 로그 테스트
      - 각 로그 레벨(`debug`, `info`, `warn`, `error`)별 테스트
      - 환경 변수 `ENABLE_PII_MASKING` 기반 제어 테스트
      - 테스트는 실패해야 함 (RED 단계)
      - **테스트 위치**: `src/shared/utils/logger.spec.ts` (단위 테스트, Vitest 실행)
  - [x] 2.2 `src/shared/utils/logger.ts` PII 마스킹 자동 적용 구현 (GREEN 단계)
    - **Given**: 기존 로거와 PIIMasker 클래스가 주어졌을 때
    - **When**: 모든 로그 메서드에서 자동으로 PII 마스킹을 적용하면
    - **Then**: PII 마스킹 테스트가 통과하고 기존 API 호환성이 유지되어야 함
    - **구현 요구사항**:
      - `PIIMasker.mask()` 메서드 활용
      - 모든 로그 메서드(`debug`, `info`, `warn`, `error`)에서 자동 마스킹 적용
      - 기존 API 시그니처 유지 (메서드 시그니처 변경 없음)
      - 환경 변수 `ENABLE_PII_MASKING` 기반 제어
      - **PII 마스킹 기본값 전략**:
        - **프로덕션**: 기본값 `true` (보안 우선, 변경 불가)
        - **스테이징**: 기본값 `true` (보안 우선, `ENABLE_PII_MASKING=false`로 선택적 비활성화 가능)
        - **로컬/개발**: 기본값 `true` (보안 우선, `ENABLE_PII_MASKING=false`로 선택적 비활성화 가능)
        - 기존 로그 포맷 호환성 유지 (필드명 변경 없음)
        - 마스킹 규칙은 기존 `PIIMasker.mask()` 메서드와 동일하게 유지
      - **롤아웃 절차**:
        1. 스테이징 환경에서 샘플 로그 비교 (마스킹 전후)
        2. 메트릭 영향 확인 (로그 처리 시간, 메모리 사용량)
        3. 프로덕션 배포 전 검증 완료
        4. 배포 후 모니터링 (로그 샘플링으로 마스킹 정상 동작 확인)
      - **호환성 검증**: 기존 로그 샘플을 사용하여 마스킹 전후 비교 테스트
      - `meta` 객체의 값도 마스킹 적용
  - [x] 2.3 `src/infrastructure/scheduler/file-logger.ts` PII 마스킹 적용 (GREEN 단계)
    - **Given**: 파일 로거가 주어졌을 때
    - **When**: 로그 엔트리를 저장할 때 PII 마스킹을 적용하면
    - **Then**: 파일에 저장되는 로그에 PII가 마스킹되어야 함
    - **구현 요구사항**:
      - `log()`, `logWarn()`, `logError()` 메서드에서 PII 마스킹 적용
      - `sanitizeData()` 메서드에서도 PII 마스킹 적용
      - 기존 테스트 통과 확인
  - [x] 2.4 `src/domains/monitoring/services/error-logging-service.ts` 오류 메시지 PII 마스킹 적용 (GREEN 단계)
    - **Given**: 오류 로깅 서비스가 주어졌을 때
    - **When**: 오류를 로깅할 때 `error.message`와 `error.stack`에 PII 마스킹을 적용하면
    - **Then**: 오류 로그에 PII가 마스킹되어야 함
    - **구현 요구사항**:
      - `logError()` 메서드에서 `error.message` 마스킹
      - `error.stack` 마스킹
      - `context` 및 `metadata` 객체의 값도 마스킹
      - API Key가 포함된 헤더 정보 마스킹
      - 기존 테스트 통과 확인
  - [x] 2.5 모든 `catch` 블록에서 오류 로깅 시 PII 마스킹 적용 (GREEN 단계)
    - **Given**: 코드베이스의 모든 `catch` 블록이 주어졌을 때
    - **When**: `error` 객체를 로깅할 때 PII 마스킹을 적용하면
    - **Then**: 모든 오류 로그에 PII가 마스킹되어야 함
    - **구현 요구사항**:
      - `grep -r "catch.*error" src/`로 모든 catch 블록 검색
      - `console.error`, `logger.error` 호출 시 PII 마스킹 적용
      - `error.message`, `error.stack` 마스킹
      - 기존 테스트 통과 확인
  - [x] 2.6 `scripts/check-pii-masking.ts` 검사 스크립트 생성
    - **Given**: 모든 로거에 PII 마스킹이 적용되었을 때
    - **When**: `scripts/check-pii-masking.ts` 스크립트를 실행하면
    - **Then**: 모든 로거에서 PII 마스킹 적용 여부를 확인하고 리포트를 생성해야 함
    - **구현 요구사항**:
      - 모든 로거 파일 검색 (`logger.ts`, `file-logger.ts`, `error-logging-service.ts` 등)
      - PII 마스킹 적용 여부 확인
      - 미적용 로거 목록 출력
      - CI/CD에서 사용 가능하도록 경고 수 반환
  - [x] 2.7 PII 마스킹 테스트 통과 확인 및 리팩토링 (REFACTOR 단계)
    - **Given**: 모든 PII 마스킹 적용이 완료되었을 때
    - **When**: PII 마스킹 테스트를 실행하면
    - **Then**: 모든 테스트가 통과하고 코드 품질이 개선되어야 함
    - **구현 요구사항**:
      - 샘플 PII 데이터를 로깅하여 마스킹 확인
      - 실제 로그 파일에서 PII가 마스킹되었는지 검증
      - 중복 코드 제거 및 공통 유틸리티 함수 추출
      - 성능 영향 측정 (필요 시 비동기 마스킹 고려)
  - [x] 2.8 PII 마스킹 환경 변수 제어 구현
    - **Given**: 환경 변수 `ENABLE_PII_MASKING`이 설정되었을 때
    - **When**: PII 마스킹을 수행하면
    - **Then**: 환경 변수 값에 따라 마스킹이 활성화/비활성화되어야 함
    - **구현 요구사항**:
      - `ENABLE_PII_MASKING` 환경 변수로 마스킹 제어 (기본값: `true`)
      - `PIIMasker.mask()`, `PIIMasker.maskObject()`, `PIIMasker.maskError()` 모두 환경 변수 적용
      - 환경 변수 값: `true`, `1`, `yes` → 마스킹 활성화, 그 외 → 마스킹 비활성화
      - 대소문자 무시, 공백 제거 처리
      - `env.example`에 환경 변수 추가
      - 환경 변수 제어 테스트 작성

- [x] 3.0 Path Traversal 방지 구현 ✅
  - [x] 3.1 `src/shared/utils/path-validator.spec.ts` 경로 검증 유틸리티 테스트 작성 (RED 단계)
    - **Given**: 다양한 파일 경로 입력이 주어졌을 때
    - **When**: `validateFilePath()` 및 `sanitizeFileName()` 메서드를 호출하면
    - **Then**: Path Traversal 공격 패턴을 차단하고 안전한 경로만 허용해야 함
    - **구현 요구사항**:
      - `../../etc/passwd` 패턴 차단 테스트
      - `..\\..\\windows\\system32` 패턴 차단 테스트
      - 절대 경로 검증 테스트
      - 허용된 문자만 포함된 파일명 검증 테스트
      - 각 테스트는 given/when/then 구조로 작성
      - 테스트는 실패해야 함 (RED 단계)
      - **테스트 위치**: `src/shared/utils/path-validator.spec.ts` (단위 테스트, Vitest 실행)
  - [x] 3.2 `src/shared/utils/path-validator.ts` 경로 검증 유틸리티 구현 (GREEN 단계)
    - **Given**: Path Traversal 테스트가 주어졌을 때
    - **When**: `validateFilePath()` 및 `sanitizeFileName()` 메서드를 구현하면
    - **Then**: 모든 Path Traversal 테스트가 통과해야 함
    - **구현 요구사항**:
      - `validateFilePath(path: string, allowedDir?: string): boolean` 메서드 구현
        - **파일명 허용 문자**: `[a-zA-Z0-9._-]+` (영문, 숫자, 점, 하이픈, 언더스코어만 허용)
        - **상대 경로 패턴 차단**: `../`, `..\\`, `./`, `.\\` 등 차단
        - **절대 경로 제한**: 
          - `allowedDir` 미지정 시: 작업 디렉토리(`process.cwd()`) 기준 상대 경로만 허용
          - `allowedDir` 지정 시: 해당 디렉토리 내에 있는 경로만 허용
          - 환경 변수 `ALLOWED_FILE_DIRS`로 허용 디렉토리 목록 지정 가능 (콤마 구분)
        - **기본 허용 디렉토리** (환경 변수 미지정 시, 우선순위: 환경 변수 > 기본값):
          - `data/` (데이터베이스 파일, 실제 존재 확인 완료, 운영 경로와 일치)
          - `logs/` (로그 파일, 실제 존재 확인 완료, 운영 경로와 일치)
          - `backup/` (백업 파일, 없으면 자동 생성, `scripts/backup-daily.bat`, `scripts/backup-embeddings.js`에서 사용)
          - 작업 디렉토리(`process.cwd()`) 기준 상대 경로
        - **환경 변수 `ALLOWED_FILE_DIRS` 해석 규칙**:
          - **우선순위**: 환경 변수가 지정되면 기본 디렉토리 목록을 대체 (병합하지 않음)
          - 콤마(`,`)로 구분된 디렉토리 목록
          - 각 디렉토리 경로는 앞뒤 공백 제거 (trim)
          - 상대 경로는 `process.cwd()` 기준으로 해석
          - 절대 경로는 그대로 사용
          - 빈 문자열이나 공백만 있는 항목은 무시
          - 환경 변수가 비어있거나 지정되지 않은 경우 기본 디렉토리 목록 사용
          - 예: `ALLOWED_FILE_DIRS="data/, logs/, /absolute/path"` → `["data/", "logs/", "/absolute/path"]`
      - `sanitizeFileName(fileName: string): string` 메서드 구현
        - 위험한 문자 제거 또는 대체
        - 경로 구분자(`/`, `\`) 제거
        - 상대 경로 패턴 제거
        - 최대 파일명 길이 제한 (255자)
  - [x] 3.3 `src/test/test-security-path-traversal.ts` Path Traversal E2E 테스트 작성 (GREEN 단계)
    - **Given**: Path Traversal 공격 시나리오가 주어졌을 때
    - **When**: 악의적인 경로 패턴을 입력하면
    - **Then**: 시스템이 안전하게 처리하고 파일 시스템 접근이 차단되어야 함
    - **구현 요구사항**:
      - `../../etc/passwd` 패턴 테스트
      - `..\\..\\windows\\system32` 패턴 테스트
      - 절대 경로 우회 시도 테스트
      - 특수문자 포함 파일명 테스트
      - 각 테스트는 given/when/then 구조로 작성
      - 모든 테스트 통과 확인
      - **테스트 위치**: `src/test/test-security-path-traversal.ts` (E2E 테스트, tsx로 실행)
      - **데이터 격리**: `setupTestDatabase()` 사용하여 in-memory DB 생성, 테스트 종료 시 `cleanupTestDatabase(db)` 호출
      - **파일 시스템 격리**: 임시 디렉토리(`os.tmpdir()`) 사용, 테스트 종료 시 정리
  - [x] 3.4 `src/infrastructure/scheduler/file-logger.ts` 경로 검증 적용 (GREEN 단계)
    - **Given**: 파일 로거가 주어졌을 때
    - **When**: 로그 파일 경로를 설정할 때 `validateFilePath()`를 사용하면
    - **Then**: Path Traversal 공격이 차단되고 안전한 경로만 사용되어야 함
    - **구현 요구사항**:
      - `logFilePath` 설정 시 `validateFilePath()` 호출
      - 검증 실패 시 에러 발생
      - 기존 테스트 통과 확인
  - [x] 3.5 `scripts/backup-daily.bat` 경로 검증 적용 (GREEN 단계)
    - **Given**: 백업 스크립트가 주어졌을 때
    - **When**: 백업 파일 경로를 설정할 때 경로 검증을 적용하면
    - **Then**: Path Traversal 공격이 차단되고 안전한 경로만 사용되어야 함
    - **구현 요구사항**:
      - 백업 디렉토리(`backup/`) 생성 확인 (없으면 생성: `if not exist "backup" mkdir backup`)
      - 백업 파일명에 `sanitizeFileName()` 적용
      - 백업 디렉토리 경로 검증 (`validateFilePath()` 사용)
      - 기존 기능 정상 동작 확인
  - [x] 3.6 `scripts/backup-embeddings.js` 경로 검증 적용 (GREEN 단계)
    - **Given**: 임베딩 백업 스크립트가 주어졌을 때
    - **When**: 백업 파일 경로를 설정할 때 경로 검증을 적용하면
    - **Then**: Path Traversal 공격이 차단되고 안전한 경로만 사용되어야 함
    - **구현 요구사항**:
      - 백업 디렉토리(`backup/`) 생성 확인 (없으면 생성: `fs.mkdirSync(backupDir, { recursive: true })`)
      - 백업 파일명에 `sanitizeFileName()` 적용
      - 백업 디렉토리 경로 검증 (`validateFilePath()` 사용)
      - `path-validator.ts` 모듈 import 및 사용
      - 기존 기능 정상 동작 확인
  - [x] 3.7 기타 파일 경로 처리 유틸리티 경로 검증 적용 (GREEN 단계)
    - **Given**: `grep -r "path\.join\|fs\.(read|write)" src/`로 검색한 모든 파일 경로 처리 코드가 주어졌을 때
    - **When**: 각 파일에서 경로 검증을 적용하면
    - **Then**: 모든 Path Traversal 테스트가 통과하고 기존 기능이 정상 동작해야 함
    - **구현 요구사항**:
      - 파일 경로를 다루는 모든 유틸리티에서 검증 로직 적용
      - 외부 입력값을 받는 경로 처리 코드에 우선 적용
      - 기존 테스트 통과 확인
  - [x] 3.8 `scripts/check-path-traversal.ts` 검사 스크립트 생성
    - **Given**: 모든 파일 경로 처리 유틸리티에 경로 검증이 적용되었을 때
    - **When**: `scripts/check-path-traversal.ts` 스크립트를 실행하면
    - **Then**: 모든 파일 경로 처리 코드에서 검증 로직 적용 여부를 확인하고 리포트를 생성해야 함
    - **구현 요구사항**:
      - 파일 경로를 다루는 모든 코드 검색
      - 경로 검증 적용 여부 확인
      - 미적용 코드 목록 출력
      - CI/CD에서 사용 가능하도록 경고 수 반환
  - [x] 3.9 Path Traversal 테스트 통과 확인 및 리팩토링 (REFACTOR 단계)
    - **Given**: 모든 경로 검증 적용이 완료되었을 때
    - **When**: Path Traversal 테스트를 실행하면
    - **Then**: 모든 테스트가 통과하고 코드 품질이 개선되어야 함
    - **구현 요구사항**:
      - `tsx src/test/test-security-path-traversal.ts` 실행하여 모든 테스트 통과 확인
      - 위험 패턴(`../`, `..\\` 등)이 모두 차단되는지 확인
      - 중복 코드 제거 및 공통 유틸리티 함수 추출
      - 코드 가독성 개선

- [x] 4.0 정적 분석 도구 통합 ✅
  - [x] 4.1 `eslint-plugin-security` 플러그인 설치 및 설정
    - **Given**: 프로젝트에 ESLint가 설정되어 있을 때
    - **When**: `eslint-plugin-security` 플러그인을 설치하고 설정하면
    - **Then**: 보안 관련 ESLint 규칙이 활성화되어야 함
    - **구현 요구사항**:
      - `npm install --save-dev eslint-plugin-security` 실행
      - `.eslintrc.js` 또는 `eslint.config.js`에 플러그인 추가
      - 보안 관련 규칙 활성화 (`no-eval`, `no-implied-eval` 등)
      - SQL Injection 패턴 감지 규칙 추가
  - [x] 4.2 ESLint 보안 규칙 통과 확인
    - **Given**: `eslint-plugin-security` 플러그인이 설정되었을 때
    - **When**: `npm run lint`를 실행하면
    - **Then**: 보안 관련 경고/에러가 0개여야 함
    - **구현 요구사항**:
      - 기존 코드에서 보안 관련 경고 수정
      - 모든 보안 규칙 통과 확인
      - CI/CD 파이프라인에서 자동 검사 가능하도록 설정
  - [x] 4.3 CI/CD 파이프라인에 보안 검사 통합
    - **Given**: CI/CD 파이프라인이 설정되어 있을 때
    - **When**: PR 생성 시 자동으로 보안 검사를 실행하면
    - **Then**: 보안 검사 실패 시 PR 병합이 차단되어야 함
    - **구현 요구사항**:
      - **GitHub Actions 워크플로우**: `.github/workflows/security-check.yml` 생성 또는 수정
      - **워크플로우 단계**:
        1. Node.js 환경 설정 (캐시 활용: `actions/cache@v3`로 `node_modules` 캐시)
        2. 의존성 설치: `npm ci`
        3. 타입 체크: `npm run type-check` (실행 시간: ~20초)
        4. ESLint 보안 검사: `npm run lint` (실행 시간: ~30초)
        5. SQL Injection 검사: `tsx scripts/check-sql-injection.ts` (실행 시간: ~10초)
        6. PII 마스킹 검사: `tsx scripts/check-pii-masking.ts` (실행 시간: ~5초)
        7. Path Traversal 검사: `tsx scripts/check-path-traversal.ts` (실행 시간: ~5초)
        8. 보안 테스트 실행: 
           - 단위 테스트: `npm test -- src/shared/utils/logger.spec.ts src/shared/utils/path-validator.spec.ts` (실행 시간: ~10초)
           - 검색 엔진 보안 관련 테스트: `npm test -- src/domains/search/algorithms/__tests__/search-engine.spec.ts src/domains/search/algorithms/vector-search-engine.spec.ts` (실행 시간: ~10초, 경로 확인 완료)
           - 전체 실행 시간: ~20초
      - **실패 처리**: 각 단계 실패 시 워크플로우 실패, PR 병합 차단
      - **캐시 전략**: `node_modules` 캐시로 설치 시간 단축 (예상 절감: ~30초)
      - **전체 실행 시간**: 약 1-2분 (캐시 히트 시)

