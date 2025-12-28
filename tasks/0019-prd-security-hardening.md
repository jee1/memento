# PRD: 보안 강화 (Phase 1)

## 1. Introduction/Overview

Memento 프로젝트는 MCP(Model Context Protocol) 서버로서 사용자의 기억(Memory) 데이터를 관리하는 시스템입니다. 현재 코드베이스에서 보안 취약점이 발견되었으며, 이를 체계적으로 해결하여 데이터 보안과 시스템 안정성을 강화해야 합니다.

**발견된 주요 보안 취약점:**
1. **SQL Injection 가능성**: 동적 쿼리 생성 시 파라미터 바인딩 미사용
2. **PII(개인정보) 유출 위험**: 로그 및 오류 메시지에 민감 정보가 평문으로 기록될 수 있음
3. **Path Traversal 취약점**: 파일 경로 처리 시 외부 입력값 검증 부족

**목표**: 모든 동적 쿼리를 파라미터 바인딩으로 전환하고, 모든 로그에 PII 마스킹을 적용하며, 파일 경로 유틸리티에 검증 로직을 추가하여 보안을 강화합니다.

## 2. Goals

1. **SQL Injection 방지**: 모든 동적 SQL 쿼리를 파라미터 바인딩으로 전환하여 SQL Injection 공격을 차단
2. **PII 보호**: 모든 로그 출력과 오류 메시지에 PII 마스킹을 자동 적용하여 민감 정보 유출 방지
3. **Path Traversal 방지**: 파일 경로 처리 유틸리티에 허용 문자 검증을 추가하여 경로 조작 공격 차단
4. **보안 테스트 강화**: SQL Injection 및 Path Traversal 공격 시나리오에 대한 테스트 케이스 추가
5. **정적 분석 통합**: 보안 취약점을 자동으로 감지하는 정적 분석 도구 통합

## 3. User Stories

### 3.1 보안 담당자 관점

**As a** 보안 담당자  
**I want** 모든 사용자 입력이 파라미터 바인딩을 통해 처리됨  
**So that** SQL Injection 공격으로부터 시스템을 보호할 수 있습니다.

**As a** 보안 담당자  
**I want** 모든 로그에 PII 마스킹이 자동 적용됨  
**So that** 로그 파일에 민감 정보가 유출되지 않습니다.

**As a** 보안 담당자  
**I want** 파일 경로 처리가 검증됨  
**So that** Path Traversal 공격을 방지할 수 있습니다.

### 3.2 개발자 관점

**As a** 백엔드 개발자  
**I want** SQL 쿼리 작성 시 파라미터 바인딩을 강제함  
**So that** 실수로 인한 보안 취약점을 방지할 수 있습니다.

**As a** 개발자  
**I want** 로깅 시 PII 마스킹이 자동으로 적용됨  
**So that** 로그 작성 시 별도로 마스킹을 신경 쓸 필요가 없습니다.

**As a** 개발자  
**I want** 파일 경로 유틸리티가 안전하게 검증됨  
**So that** 파일 시스템 접근 시 보안 위험을 줄일 수 있습니다.

### 3.3 시스템 관점

**As a** 시스템  
**I want** 모든 외부 입력이 검증되고 안전하게 처리됨  
**So that** 악의적인 공격으로부터 보호받을 수 있습니다.

**As a** 시스템  
**I want** 로그에 민감 정보가 기록되지 않음  
**So that** 데이터 유출 위험을 최소화할 수 있습니다.

## 4. Functional Requirements

### 4.1 SQL Injection 방지

**FR-1.1**: 모든 동적 SQL 쿼리를 파라미터 바인딩으로 전환
- 현재 상태: `src/domains/search/algorithms/search-engine.ts`, `src/domains/search/repositories/vector-search.repository.ts` 등에서 동적 쿼리 생성 확인
- 대상 파일:
  - `src/domains/search/algorithms/search-engine.ts`
  - `src/domains/search/algorithms/vector-search-engine.ts`
  - `src/domains/search/repositories/vector-search.repository.ts`
  - `src/domains/memory/services/memory-embedding-service.ts`
  - 기타 동적 쿼리를 생성하는 모든 파일
- 요구사항:
  - 문자열 연결(`+` 또는 템플릿 리터럴)을 통한 SQL 쿼리 생성 금지
  - 모든 사용자 입력값은 `?` 또는 `@param` 형식의 파라미터 바인딩 사용
  - `better-sqlite3`의 `prepare()` 메서드와 파라미터 배열 사용

**FR-1.2**: SQL 쿼리 빌더 패턴 검증
- 쿼리 빌더를 사용하는 경우에도 파라미터 바인딩 사용 확인
- 동적 WHERE 절 생성 시 조건 문자열이 아닌 파라미터 배열로 전달

**FR-1.3**: SQL Injection 공격 테스트 케이스 추가
- 악의적인 SQL 패턴 주입 시도 테스트
- `'; DROP TABLE--`, `' OR '1'='1` 등 일반적인 SQL Injection 패턴 테스트
- 테스트 파일: `src/test/security/sql-injection.test.ts`

### 4.2 PII 마스킹 강화

**FR-2.1**: 모든 로그 출력에 PII 마스킹 자동 적용
- 현재 상태: `src/shared/utils/pii-masker.ts`가 존재하나, 모든 로그에 적용되지 않음
- 대상 로거:
  - `src/shared/utils/logger.ts`의 `logger` 객체
  - `src/infrastructure/logging/triple-extraction-logger.ts`
  - `src/infrastructure/scheduler/file-logger.ts`
  - `src/domains/monitoring/services/error-logging-service.ts`
  - 모든 `console.log`, `console.error`, `console.warn` 사용처
- 요구사항:
  - 로거의 모든 출력 메서드(`info`, `warn`, `error`, `debug`)에서 자동으로 PII 마스킹 적용
  - 마스킹 대상: 이메일, 전화번호, API 키, 비밀번호, 토큰, credential 정보
  - 기존 `PIIMasker.mask()` 메서드 활용

**FR-2.2**: 오류 메시지에 PII 마스킹 적용
- `catch` 블록에서 `error` 객체를 로깅할 때 PII 마스킹 적용
- `error.message`, `error.stack` 등에 포함된 민감 정보 마스킹
- API Key가 포함된 헤더 정보가 로그에 남지 않도록 처리

**FR-2.3**: 로거 래퍼 생성
- `src/shared/utils/logger.ts`를 수정하여 모든 로그 메시지에 자동으로 PII 마스킹 적용
- 기존 API 호환성 유지 (메서드 시그니처 변경 없음)
- 내부적으로 `PIIMasker.mask()` 호출

**FR-2.4**: 환경 변수 기반 PII 마스킹 제어
- `ENABLE_PII_MASKING` 환경 변수로 마스킹 활성화/비활성화 제어 (기본값: `true`)
- 개발 환경에서만 선택적으로 비활성화 가능

### 4.3 Path Traversal 방지

**FR-3.1**: 파일 경로 유틸리티에 검증 로직 추가
- 현재 상태: `src/infrastructure/scheduler/file-logger.ts`, 백업 스크립트 등에서 파일 경로 처리
- 대상 파일:
  - `src/infrastructure/scheduler/file-logger.ts`
  - `scripts/backup-daily.bat`
  - `scripts/backup-embeddings.js`
  - 기타 파일 경로를 다루는 모든 유틸리티
- 요구사항:
  - 파일명에 허용된 문자만 포함되었는지 검증 (영문, 숫자, 하이픈, 언더스코어, 점)
  - `../`, `..\\` 등 상위 디렉토리 참조 패턴 차단
  - 절대 경로 사용 시 허용된 디렉토리 내에 있는지 검증

**FR-3.2**: 경로 정규화 유틸리티 생성
- `src/shared/utils/path-validator.ts` 생성
- `validateFilePath(path: string, allowedDir?: string): boolean` 메서드 제공
- `sanitizeFileName(fileName: string): string` 메서드 제공 (위험한 문자 제거)

**FR-3.3**: Path Traversal 공격 테스트 케이스 추가
- `../../etc/passwd`, `..\\..\\windows\\system32` 등 경로 조작 시도 테스트
- 테스트 파일: `src/test/security/path-traversal.test.ts`

### 4.4 정적 분석 도구 통합

**FR-4.1**: ESLint 보안 규칙 추가
- `eslint-plugin-security` 플러그인 설치 및 설정
- `no-eval`, `no-implied-eval` 등 보안 관련 규칙 활성화
- SQL Injection 패턴 감지 규칙 추가

**FR-4.2**: CI/CD 파이프라인에 보안 검사 통합
- PR 생성 시 자동으로 보안 취약점 스캔 실행
- 보안 검사 실패 시 PR 병합 차단

## 5. Non-Goals (Out of Scope)

1. **인증/인가 시스템 개선**: 이번 작업은 데이터 처리 보안에 집중하며, 사용자 인증/인가는 별도 작업으로 진행
2. **암호화 강화**: 데이터베이스 암호화나 전송 암호화는 포함하지 않음 (기존 암호화 유지)
3. **DDoS 방어**: 네트워크 레벨 공격 방어는 포함하지 않음
4. **전체 코드베이스 감사**: 이번 작업은 발견된 취약점에 집중하며, 전체 보안 감사는 별도 작업으로 진행
5. **의존성 취약점 스캔**: npm audit 등 의존성 취약점 검사는 별도 작업으로 진행

## 6. Design Considerations

### 6.1 PII 마스킹 전략

- **자동 마스킹**: 모든 로그 출력 시 자동으로 PII 마스킹 적용
- **성능 고려**: 마스킹은 정규식 기반이므로 대용량 로그 처리 시 성능 영향 최소화
- **개발 환경 예외**: 개발 환경에서만 선택적으로 마스킹 비활성화 가능

### 6.2 SQL 쿼리 빌더 패턴

- **파라미터 바인딩 강제**: 쿼리 빌더를 사용하더라도 파라미터 바인딩 사용
- **타입 안정성**: TypeScript 타입 시스템을 활용하여 파라미터 타입 검증

### 6.3 파일 경로 검증

- **화이트리스트 방식**: 허용된 문자만 사용하는 화이트리스트 방식 채택
- **경로 정규화**: 상대 경로를 절대 경로로 변환 후 검증
- **디렉토리 제한**: 특정 디렉토리 내에서만 파일 접근 허용

## 7. Technical Considerations

### 7.1 의존성

- 기존 `better-sqlite3` 라이브러리 유지
- `eslint-plugin-security` 플러그인 추가 설치 필요
- 기존 `PIIMasker` 클래스 활용

### 7.2 마이그레이션 전략

- **점진적 적용**: 파일별로 순차적으로 보안 강화 적용
- **하위 호환성 유지**: 기존 API는 유지하며 내부 구현만 개선
- **테스트 우선**: 각 변경사항에 대한 테스트 케이스 먼저 작성

### 7.3 성능 영향

- PII 마스킹은 정규식 기반이므로 로그 처리 시간이 약간 증가할 수 있음
- 파라미터 바인딩은 성능에 거의 영향 없음
- 파일 경로 검증은 파일 시스템 접근 전에 수행되므로 오버헤드 최소

## 8. Success Metrics

### 8.1 SQL Injection 방지

#### 측정 방법
- **동적 쿼리 검색**: `grep -r "sql.*\+" src/` 또는 템플릿 리터럴로 쿼리 생성하는 패턴 검색
- **파라미터 바인딩 사용률**: 모든 SQL 쿼리에서 파라미터 바인딩 사용 비율
- **자동화 스크립트**: `scripts/check-sql-injection.ts` 생성

#### 목표
- **동적 쿼리 0개**: 문자열 연결을 통한 SQL 쿼리 생성 0개
- **파라미터 바인딩 100%**: 모든 SQL 쿼리가 파라미터 바인딩 사용
- **테스트 통과**: SQL Injection 공격 시나리오 테스트 100% 통과

### 8.2 PII 마스킹

#### 측정 방법
- **로거 적용률**: 모든 로거에서 PII 마스킹 적용 확인
- **마스킹 테스트**: 샘플 PII 데이터를 로깅하여 마스킹 확인
- **자동화 스크립트**: `scripts/check-pii-masking.ts` 생성

#### 목표
- **로거 적용률 100%**: 모든 로거(`logger`, `console.*`)에서 PII 마스킹 적용
- **마스킹 테스트 통과**: 샘플 PII 데이터가 모두 마스킹되는지 확인
- **로그 파일 검증**: 실제 로그 파일에서 PII가 마스킹되었는지 확인

### 8.3 Path Traversal 방지

#### 측정 방법
- **경로 검증 적용률**: 파일 경로를 다루는 모든 유틸리티에서 검증 로직 적용 확인
- **공격 시나리오 테스트**: Path Traversal 공격 패턴 테스트
- **자동화 스크립트**: `scripts/check-path-traversal.ts` 생성

#### 목표
- **경로 검증 적용률 100%**: 모든 파일 경로 처리 유틸리티에서 검증 로직 적용
- **공격 테스트 통과**: Path Traversal 공격 시나리오 테스트 100% 통과
- **위험 패턴 차단**: `../`, `..\\` 등 위험 패턴이 모두 차단되는지 확인

### 8.4 정적 분석

#### 측정 방법
- **ESLint 보안 규칙 통과**: `npm run lint` 실행 시 보안 관련 경고/에러 0개
- **보안 스캔 통과**: `eslint-plugin-security` 플러그인 검사 통과

#### 목표
- **보안 경고 0개**: 정적 분석 도구에서 보안 관련 경고/에러 0개
- **CI/CD 통과**: PR 생성 시 보안 검사 자동 통과

### 8.5 종합 성공 기준

- **코드 리뷰 통과**: 모든 변경사항에 대한 코드 리뷰 완료
- **Lint/Type-check/Test 통과**: `npm run lint && npm run type-check && npm test` 통과
- **신규 정적 분석 경고 0개**: 보안 관련 정적 분석 경고 0개
- **공격 시나리오 테스트 통과**: SQL Injection, Path Traversal 공격 시나리오 테스트 100% 통과
- **샘플 공격 재현 불가**: 실제 공격 패턴으로 재현 시도 시 모두 차단되는지 확인

## 9. Implementation Plan

### Phase 1.1: SQL Injection 방지 (우선순위: 최고)

1. **동적 쿼리 검색 및 분석**
   - `scripts/check-sql-injection.ts` 스크립트 생성
   - 모든 동적 쿼리 생성 패턴 검색
   - 대상 파일 목록 작성

2. **파라미터 바인딩 전환**
   - `src/domains/search/algorithms/search-engine.ts`부터 시작
   - 각 파일별로 순차적으로 파라미터 바인딩 전환
   - 변경 후 테스트 통과 확인

3. **SQL Injection 테스트 케이스 추가**
   - `src/test/security/sql-injection.test.ts` 생성
   - 일반적인 SQL Injection 패턴 테스트
   - 모든 테스트 통과 확인

**완료 조건**:
- 모든 동적 쿼리가 파라미터 바인딩으로 전환됨
- SQL Injection 테스트 케이스 100% 통과
- `scripts/check-sql-injection.ts` 실행 시 경고 0개

### Phase 1.2: PII 마스킹 강화 (우선순위: 높음)

1. **로거 래퍼 수정**
   - `src/shared/utils/logger.ts` 수정하여 자동 PII 마스킹 적용
   - 기존 API 호환성 유지
   - 환경 변수 기반 제어 추가

2. **특수 로거 업데이트**
   - `src/infrastructure/logging/triple-extraction-logger.ts` 확인 및 수정
   - `src/infrastructure/scheduler/file-logger.ts` 확인 및 수정
   - `src/domains/monitoring/services/error-logging-service.ts` 확인 및 수정

3. **오류 메시지 마스킹**
   - 모든 `catch` 블록에서 `error` 객체 로깅 시 PII 마스킹 적용
   - API Key가 포함된 헤더 정보 마스킹

4. **PII 마스킹 테스트**
   - 샘플 PII 데이터를 로깅하여 마스킹 확인
   - 실제 로그 파일에서 PII가 마스킹되었는지 검증

**완료 조건**:
- 모든 로거에서 PII 마스킹 자동 적용
- PII 마스킹 테스트 100% 통과
- 실제 로그 파일에서 PII가 마스킹되었는지 확인

### Phase 1.3: Path Traversal 방지 (우선순위: 높음)

1. **경로 검증 유틸리티 생성**
   - `src/shared/utils/path-validator.ts` 생성
   - `validateFilePath()`, `sanitizeFileName()` 메서드 구현

2. **파일 경로 처리 유틸리티 업데이트**
   - `src/infrastructure/scheduler/file-logger.ts`에 검증 로직 추가
   - 백업 스크립트에 검증 로직 추가
   - 기타 파일 경로를 다루는 모든 유틸리티 업데이트

3. **Path Traversal 테스트 케이스 추가**
   - `src/test/security/path-traversal.test.ts` 생성
   - 일반적인 Path Traversal 공격 패턴 테스트
   - 모든 테스트 통과 확인

**완료 조건**:
- 모든 파일 경로 처리 유틸리티에서 검증 로직 적용
- Path Traversal 테스트 케이스 100% 통과
- 위험 패턴이 모두 차단되는지 확인

### Phase 1.4: 정적 분석 도구 통합 (우선순위: 중간)

1. **ESLint 보안 플러그인 설치**
   - `eslint-plugin-security` 설치 및 설정
   - 보안 관련 규칙 활성화

2. **CI/CD 파이프라인 업데이트**
   - PR 생성 시 자동 보안 검사 실행
   - 보안 검사 실패 시 PR 병합 차단

**완료 조건**:
- ESLint 보안 규칙 통과 (경고/에러 0개)
- CI/CD 파이프라인에서 보안 검사 자동 실행

## 10. Open Questions

1. **PII 마스킹 성능**: 대용량 로그 처리 시 성능 영향이 어느 정도인가?
   - **해결 방안**: 벤치마크 테스트를 통해 성능 영향 측정, 필요 시 비동기 마스킹 고려

2. **개발 환경 마스킹**: 개발 환경에서도 PII 마스킹을 적용할 것인가?
   - **해결 방안**: 기본적으로 마스킹 적용, `ENABLE_PII_MASKING=false`로 선택적 비활성화 가능

3. **레거시 로그 파일**: 기존 로그 파일에 이미 PII가 포함되어 있다면 어떻게 처리할 것인가?
   - **해결 방안**: 기존 로그 파일은 그대로 유지, 향후 로그부터 마스킹 적용

4. **파일 경로 허용 디렉토리**: 특정 디렉토리만 허용할 것인가, 아니면 상대 경로만 허용할 것인가?
   - **해결 방안**: 작업 디렉토리 기준 상대 경로만 허용, 절대 경로는 환경 변수로 지정된 디렉토리만 허용

## 11. Risks and Mitigation

### 11.1 리스크

1. **기능 회귀**: 보안 강화 과정에서 기존 기능이 깨질 수 있음
2. **성능 저하**: PII 마스킹으로 인한 로그 처리 시간 증가
3. **호환성 문제**: 기존 로거 API 변경으로 인한 호환성 문제

### 11.2 완화 전략

1. **기능 회귀 방지**:
   - 모든 기존 테스트 통과 필수
   - 단계별 검증
   - 통합 테스트 강화

2. **성능 저하 방지**:
   - 벤치마크 테스트를 통한 성능 영향 측정
   - 필요 시 비동기 마스킹 고려
   - 로그 레벨에 따른 선택적 마스킹

3. **호환성 문제 방지**:
   - 기존 API 시그니처 유지
   - 내부 구현만 변경
   - 점진적 마이그레이션

## 12. Dependencies

### 12.1 기술 스택

- 기존 `better-sqlite3` 라이브러리
- 기존 `PIIMasker` 클래스 (`src/shared/utils/pii-masker.ts`)
- `eslint-plugin-security` 플러그인 (신규 설치 필요)

### 12.2 측정 도구

- **SQL Injection 검사**: `scripts/check-sql-injection.ts` (신규 생성)
- **PII 마스킹 검사**: `scripts/check-pii-masking.ts` (신규 생성)
- **Path Traversal 검사**: `scripts/check-path-traversal.ts` (신규 생성)
- **ESLint 보안 플러그인**: `eslint-plugin-security`

## 13. Acceptance Criteria

### Phase 1.1 완료 기준

- [ ] 모든 동적 SQL 쿼리가 파라미터 바인딩으로 전환됨
- [ ] `scripts/check-sql-injection.ts` 실행 시 경고 0개
- [ ] SQL Injection 테스트 케이스 100% 통과
- [ ] 모든 기존 테스트 통과 (`npm test`)
- [ ] Lint 및 타입 체크 통과 (`npm run lint && npm run type-check`)

### Phase 1.2 완료 기준

- [ ] 모든 로거에서 PII 마스킹 자동 적용
- [ ] `src/shared/utils/logger.ts`가 자동으로 PII 마스킹 적용
- [ ] 오류 메시지에 PII 마스킹 적용
- [ ] PII 마스킹 테스트 100% 통과
- [ ] 실제 로그 파일에서 PII가 마스킹되었는지 확인
- [ ] 모든 기존 테스트 통과 (`npm test`)

### Phase 1.3 완료 기준

- [ ] `src/shared/utils/path-validator.ts` 생성 및 구현 완료
- [ ] 모든 파일 경로 처리 유틸리티에서 검증 로직 적용
- [ ] Path Traversal 테스트 케이스 100% 통과
- [ ] 위험 패턴(`../`, `..\\` 등)이 모두 차단되는지 확인
- [ ] 모든 기존 테스트 통과 (`npm test`)

### Phase 1.4 완료 기준

- [ ] `eslint-plugin-security` 설치 및 설정 완료
- [ ] ESLint 보안 규칙 통과 (경고/에러 0개)
- [ ] CI/CD 파이프라인에서 보안 검사 자동 실행
- [ ] PR 생성 시 보안 검사 자동 통과

### 전체 완료 기준

- [ ] 모든 Phase 완료
- [ ] 코드 리뷰 통과
- [ ] Lint/Type-check/Test 통과 (`npm run lint && npm run type-check && npm test`)
- [ ] 신규 정적 분석 경고 0개
- [ ] SQL Injection 공격 시나리오 테스트 100% 통과
- [ ] Path Traversal 공격 시나리오 테스트 100% 통과
- [ ] 샘플 공격 재현 불가 (실제 공격 패턴으로 재현 시도 시 모두 차단)
- [ ] 문서화 완료

