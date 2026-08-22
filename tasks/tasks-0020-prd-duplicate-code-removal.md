# 작업 목록: 중복 코드 제거 (Phase 2)

이 문서는 PRD `0020-prd-duplicate-code-removal.md`를 기반으로 생성된 상세 작업 목록입니다.

## Relevant Files

### 서버 진입점 관련
- `src/server/index.ts` - 현재 메인 진입점 (Stdio 방식)
- `src/server/http-server.ts` - HTTP/SSE 방식 서버
- `src/server/simple-mcp-server.ts` - 간단한 SSE 서버 구현
- `src/server/index-refactored.ts` - 리팩토링 중인 파일 (제거 대상)
- `src/server/server-factory.ts` - 새로 생성할 서버 팩토리 (존재하지 않음)
- `src/server/server-factory.spec.ts` - 서버 팩토리 테스트 파일 (새로 생성)
- `src/server/bootstrap.ts` - 공통 서비스 초기화 모듈
- `start-dev.sh` - 개발 환경 시작 스크립트
- `start-prod.sh` - 프로덕션 환경 시작 스크립트

### 검색 엔진 관련
- `src/domains/search/algorithms/vector-search-engine.ts` - 기존 벡터 검색 엔진
- `src/domains/search/algorithms/vector-search-engine-refactored.ts` - 리팩토링된 벡터 검색 엔진 (제거 대상)
- `src/domains/search/algorithms/vector-search-engine.spec.ts` - 기존 벡터 검색 엔진 테스트
- `src/domains/search/algorithms/vector-search-engine-refactored.spec.ts` - 리팩토링된 벡터 검색 엔진 테스트 (통합 대상)
- 참고: `src/domains/search/algorithms/vector-search-engine-migration.ts` - 마이그레이션 가이드 (작업 범위 외, 참고용)

### 데이터베이스 연결 관련
- `src/infrastructure/database/sqlite/init.ts` - 공통 DB 연결 모듈 (initializeDatabase 함수)
- `scripts/check-db-integrity.js` - DB 무결성 검사 스크립트 (리팩토링 대상 예상)
- `scripts/fix-migration.js` - 마이그레이션 수정 스크립트 (리팩토링 대상 예상)
- `scripts/migrate-embedding-data.js` - 임베딩 데이터 마이그레이션 스크립트 (리팩토링 대상 예상)
- `scripts/regenerate-embeddings.js` - 임베딩 재생성 스크립트 (리팩토링 대상 예상)
- `scripts/backup-embeddings.js` - 임베딩 백업 스크립트 (리팩토링 대상 예상)
- `scripts/debug-embeddings.js` - 임베딩 디버그 스크립트 (리팩토링 대상 예상)
- `scripts/fix-vector-dimensions.js` - 벡터 차원 수정 스크립트 (리팩토링 대상 예상)
- `scripts/safe-migration.js` - 안전한 마이그레이션 스크립트 (리팩토링 대상 예상)
- `scripts/run-migration.js` - 마이그레이션 실행 스크립트 (리팩토링 대상 예상)
- `scripts/simple-migrate.js` - 간단한 마이그레이션 스크립트 (리팩토링 대상 예상)
- `scripts/simple-update.js` - 간단한 업데이트 스크립트 (리팩토링 대상 예상)
- `scripts/save-work-memory.ts` - 작업 메모리 저장 스크립트 (리팩토링 대상 예상)
- 참고/제외: `scripts/quality-thresholds.ts` - 이미 공통 모듈(initializeDatabase) 사용 중
- 참고/제외: `scripts/quality-report.ts` - 이미 공통 모듈(initializeDatabase) 사용 중
- 참고/제외: `scripts/generate-ground-truth.ts` - 이미 공통 모듈(initializeDatabase) 사용 중
- 참고/제외: `scripts/generate-relation-report.ts` - 메모리 DB만 사용 (실제 DB 연결 아님)
- 참고/제외: `scripts/weekly-relation-validation.ts` - 메모리 DB만 사용 (실제 DB 연결 아님)

### Notes

- 모든 테스트는 TDD 방법론(RED-GREEN-REFACTOR)을 따라야 합니다.
- 테스트 코드는 `given/when/then` 구조를 따라야 하며, 메서드명 또는 JSDoc에도 `given/when/then`을 표시해야 합니다.
- 테스트는 구현 코드와 함께 같은 디렉토리에 배치합니다.
- **TypeScript/TS 파일 테스트**: `npm test` 또는 `npx vitest`를 사용하여 테스트를 실행합니다.
- **JavaScript 스크립트 테스트**: 
  - 단위 테스트가 가능한 경우: Vitest 래퍼 또는 통합 테스트 형태로 작성
  - 단위 테스트가 어려운 경우: 샘플 DB 파일을 사용한 통합 실행 테스트 또는 수동 검증 계획 수립
  - 스크립트 실행 검증: `tsx scripts/[script-name].js` 또는 `node scripts/[script-name].js`로 직접 실행하여 동작 확인

## Tasks

### 1.0 서버 진입점 통일 및 팩토리 패턴 구현 ✅

- [ ] 1.1 서버 팩토리 인터페이스 및 타입 정의
  - [x] 1.1.1 Given: 서버 타입 정의 (stdio, sse) 및 서버 인터페이스 생성, When: server-factory.ts 파일 생성 및 타입 정의, Then: TypeScript 컴파일 통과 및 타입 검증 테스트 통과
  - [x] 1.1.2 Given: 서버 타입 정의 완료, When: 서버 팩토리 인터페이스 작성, Then: 인터페이스 타입 검증 테스트 통과

- [x] 1.2 서버 팩토리 구현 (TDD)
  - [x] 1.2.1 Given: 서버 팩토리 인터페이스 정의 완료, When: stdio 서버 생성 테스트 작성 (RED), Then: 테스트 실패 확인
  - [x] 1.2.2 Given: 실패하는 테스트 존재, When: stdio 서버 생성 로직 구현 (GREEN), Then: 테스트 통과
  - [x] 1.2.3 Given: stdio 서버 생성 테스트 통과, When: SSE 서버 생성 테스트 작성 (RED), Then: 테스트 실패 확인
  - [x] 1.2.4 Given: 실패하는 SSE 서버 테스트 존재, When: SSE 서버 생성 로직 구현 (GREEN), Then: 테스트 통과
  - [x] 1.2.5 Given: 모든 서버 생성 테스트 통과, When: 환경 변수 기반 서버 선택 로직 테스트 작성 (RED), Then: 테스트 실패 확인
  - [x] 1.2.6 Given: 실패하는 환경 변수 테스트 존재, When: 환경 변수 기반 서버 선택 로직 구현 (GREEN), Then: 테스트 통과
  - [x] 1.2.7 Given: 환경 변수 기반 서버 선택 테스트 통과, When: TRANSPORT_TYPE 미설정 시 기본값 stdio 동작 테스트 작성 (RED), Then: 테스트 실패 확인
  - [x] 1.2.8 Given: 실패하는 기본값 테스트 존재, When: TRANSPORT_TYPE 미설정 시 기본값 stdio 반환 로직 구현 (GREEN), Then: 테스트 통과
  - [x] 1.2.9 Given: 모든 테스트 통과, When: 코드 리팩토링 (REFACTOR), Then: 테스트 계속 통과 및 코드 품질 개선

- [x] 1.3 index.ts를 팩토리 패턴으로 리팩토링
  - [x] 1.3.1 Given: 서버 팩토리 구현 완료, When: index.ts에서 팩토리 사용하도록 수정, Then: 기존 기능 동작 확인 테스트 통과
  - [x] 1.3.2 Given: index.ts 리팩토링 완료, When: 환경 변수 기반 서버 선택 로직 추가, Then: 환경 변수 테스트 통과
  - [x] 1.3.3 Given: index.ts 리팩토링 완료, When: TRANSPORT_TYPE 미설정 시 기본값 stdio 동작 검증 테스트 작성 및 실행, Then: 기본값 stdio로 서버 시작 확인

- [x] 1.4 http-server.ts와 simple-mcp-server.ts를 내부 모듈로 변경
  - [x] 1.4.1 Given: 서버 팩토리 구현 완료, When: http-server.ts에서 직접 실행 코드 제거 및 export만 유지, Then: 팩토리를 통한 서버 생성 테스트 통과
  - [x] 1.4.2 Given: http-server.ts 리팩토링 완료, When: simple-mcp-server.ts에서 직접 실행 코드 제거 및 export만 유지, Then: 팩토리를 통한 서버 생성 테스트 통과

- [x] 1.5 index-refactored.ts 제거
  - [x] 1.5.1 Given: index.ts가 팩토리 패턴으로 리팩토링 완료, When: index-refactored.ts 파일 삭제, Then: 빌드 및 테스트 통과
  - [x] 1.5.2 Given: index-refactored.ts 제거 완료, When: Git에서 파일 삭제 확인, Then: Git 히스토리 보존 확인

- [x] 1.6 시작 스크립트 업데이트
  - [x] 1.6.1 Given: index.ts가 단일 진입점으로 통일 완료, When: start-dev.sh가 index.ts를 사용하도록 수정, Then: 개발 환경 시작 테스트 통과
  - [x] 1.6.2 Given: start-dev.sh 업데이트 완료, When: start-prod.sh가 index.ts를 사용하도록 수정, Then: 프로덕션 환경 시작 테스트 통과
  - [x] 1.6.3 Given: 시작 스크립트 업데이트 완료, When: TRANSPORT_TYPE 환경 변수 설정 확인, Then: 환경 변수에 따라 올바른 서버 시작 확인

- [x] 1.7 통합 테스트 및 검증
  - [x] 1.7.1 Given: 모든 변경사항 완료, When: 전체 서버 시작 통합 테스트 실행, Then: 모든 테스트 통과
  - [x] 1.7.2 Given: 통합 테스트 통과, When: 빌드 및 실행 테스트 수행, Then: 빌드 성공 및 서버 정상 시작 확인

### 2.0 검색 엔진 중복 제거 및 리팩토링 파일 정리

- [x] 2.1 리팩토링된 벡터 검색 엔진 검증 (TDD)
  - [x] 2.1.1 Given: vector-search-engine-refactored.ts 존재, When: 기존 vector-search-engine.spec.ts 테스트를 refactored 버전으로 실행하는 테스트 작성 (RED), Then: 테스트 실패 또는 통과 확인
  - [x] 2.1.2 Given: 기존 테스트 케이스 확인 완료, When: 리팩토링된 엔진의 기능 호환성 테스트 작성 (RED), Then: 테스트 실패 또는 통과 확인
  - [x] 2.1.3 Given: 호환성 테스트 작성 완료, When: 리팩토링된 엔진으로 테스트 실행 (GREEN), Then: 모든 테스트 통과 또는 실패 원인 분석
  - [x] 2.1.4 Given: 테스트 결과 확인 완료, When: 성능 비교 테스트 작성 및 실행, Then: 성능 차이 ±5% 이내 확인 또는 개선 필요 사항 문서화

- [x] 2.2 리팩토링된 엔진으로 대체 (검증 완료 시)
  - [x] 2.2.1 Given: 리팩토링된 엔진 검증 완료, When: vector-search-engine.ts를 refactored 버전으로 대체, Then: 기존 테스트 통과
  - [x] 2.2.2 Given: 엔진 대체 완료, When: vector-search-engine-refactored.ts 파일 삭제, Then: 빌드 및 테스트 통과
  - [x] 2.2.3 Given: 파일 삭제 완료, When: 모든 import 경로에서 refactored 참조 제거 확인, Then: grep 검색으로 refactored 참조 0개 확인

- [x] 2.3 테스트 파일 정리
  - [x] 2.3.1 Given: 엔진 대체 완료, When: vector-search-engine-compatibility.spec.ts 파일 검토 및 정리 (리팩토링 완료로 더 이상 필요 없음), Then: 파일 삭제 완료
  - [x] 2.3.2 Given: 테스트 파일 정리 완료, When: 중복 테스트 케이스 확인, Then: 빌드 및 테스트 통과

- [x] 2.4 리팩토링된 엔진 검증 실패 시 처리 (검증 성공으로 불필요)
  - [ ] 2.4.1 Given: 리팩토링된 엔진 검증 실패, When: 실패 원인 분석 및 문서화, Then: 실패 원인 문서 작성 완료
  - [ ] 2.4.2 Given: 실패 원인 문서화 완료, When: 기존 엔진 유지 결정 및 refactored 파일 별도 브랜치 보관, Then: 기존 엔진 정상 동작 확인

### 3.0 데이터베이스 연결 로직 통일

- [x] 3.1 scripts/ 디렉토리 DB 연결 사용 스크립트 인벤토리
  - [x] 3.1.1 Given: scripts 폴더의 모든 스크립트 존재, When: `grep -E "new Database|sqlite3|better-sqlite3|initializeDatabase" scripts/**/*.{js,ts}` 패턴 검색, Then: DB 연결을 사용하는 스크립트 목록 작성 완료 (tasks/scripts-db-connection-inventory.md)
  - [x] 3.1.2 Given: 스크립트 목록 완료, When: 각 스크립트의 DB 연결 방식 분석 (직접 연결 vs 공통 모듈 사용), Then: 리팩토링 대상 스크립트 목록 작성 완료 (11개 스크립트 확인)
  - [x] 3.1.3 Given: 리팩토링 대상 목록 완료, When: 이미 공통 모듈을 사용하는 스크립트 제외, Then: 최종 리팩토링 대상 스크립트 목록 확정 (11개: 높은 우선순위 6개, 중간 우선순위 5개)

- [x] 3.2 공통 DB 연결 모듈 인터페이스 확인 및 문서화
  - [x] 3.2.1 Given: src/infrastructure/database/sqlite/init.ts 존재, When: initializeDatabase 함수 인터페이스 분석, Then: 인터페이스 문서 작성 완료 (tasks/database-init-interface-documentation.md)
  - [x] 3.2.2 Given: 인터페이스 문서 작성 완료, When: 공통 모듈 사용 예제 코드 작성, Then: 예제 코드 검증 완료 (문서에 포함)

- [x] 3.3 check-db-integrity.js 리팩토링
  - [x] 3.3.1 Given: 공통 모듈 인터페이스 확인 완료 및 리팩토링 대상 목록에 포함, When: 공통 모듈을 사용하는 통합 테스트 작성 (샘플 DB 파일 사용) 또는 수동 검증 계획 수립, Then: 테스트 실패 확인 또는 검증 계획 문서화 (scripts/__tests__/check-db-integrity.integration.spec.ts)
  - [x] 3.3.2 Given: 실패하는 테스트 존재 또는 검증 계획 완료, When: check-db-integrity.js를 공통 모듈 사용하도록 수정, Then: 테스트 통과 또는 수동 검증 완료 (ES modules로 변환, initializeDatabase 사용)
  - [x] 3.3.3 Given: 테스트 통과 또는 수동 검증 완료, When: 코드 리팩토링 (REFACTOR), Then: 테스트 계속 통과 또는 수동 검증 재확인 (async/await 패턴 적용, 에러 처리 개선)
  - [x] 3.3.4 Given: 리팩토링 완료, When: 스크립트 실행 테스트 (`npx tsx scripts/check-db-integrity.js`), Then: 스크립트 정상 동작 확인 (실행 성공, 무결성 검사 통과)

- [x] 3.4 fix-migration.js 리팩토링
  - [x] 3.4.1 Given: 공통 모듈 인터페이스 확인 완료 및 리팩토링 대상 목록에 포함, When: 공통 모듈을 사용하는 통합 테스트 작성 (샘플 DB 파일 사용) 또는 수동 검증 계획 수립, Then: 테스트 실패 확인 또는 검증 계획 문서화 (scripts/__tests__/fix-migration.integration.spec.ts)
  - [x] 3.4.2 Given: 실패하는 테스트 존재 또는 검증 계획 완료, When: fix-migration.js를 공통 모듈 사용하도록 수정, Then: 테스트 통과 또는 수동 검증 완료 (initializeDatabase 사용, async/await 패턴 적용)
  - [x] 3.4.3 Given: 테스트 통과 또는 수동 검증 완료, When: 코드 리팩토링 (REFACTOR), Then: 테스트 계속 통과 또는 수동 검증 재확인 (에러 처리 개선, finally 블록 추가)
  - [x] 3.4.4 Given: 리팩토링 완료, When: 스크립트 실행 테스트 (`npx tsx scripts/fix-migration.js`), Then: 스크립트 정상 동작 확인 (실행 성공, 데이터 업데이트 및 인덱스 생성 완료)

- [x] 3.5 migrate-embedding-data.js 리팩토링
  - [x] 3.5.1 Given: 공통 모듈 인터페이스 확인 완료 및 리팩토링 대상 목록에 포함, When: 공통 모듈을 사용하는 통합 테스트 작성 (샘플 DB 파일 사용) 또는 수동 검증 계획 수립, Then: 테스트 실패 확인 또는 검증 계획 문서화 (scripts/__tests__/migrate-embedding-data.integration.spec.ts)
  - [x] 3.5.2 Given: 실패하는 테스트 존재 또는 검증 계획 완료, When: migrate-embedding-data.js를 공통 모듈 사용하도록 수정, Then: 테스트 통과 또는 수동 검증 완료 (connect() 메서드를 async로 변경, initializeDatabase 사용)
  - [x] 3.5.3 Given: 테스트 통과 또는 수동 검증 완료, When: 코드 리팩토링 (REFACTOR), Then: 테스트 계속 통과 또는 수동 검증 재확인 (에러 처리 개선, closeDatabase 사용, TypeScript 타입 제거)
  - [x] 3.5.4 Given: 리팩토링 완료, When: 스크립트 실행 테스트 (`npx tsx scripts/migrate-embedding-data.js analyze`), Then: 스크립트 정상 동작 확인 (실행 성공, 데이터 분석 완료)

- [x] 3.6 regenerate-embeddings.js 리팩토링
  - [x] 3.6.1 Given: 공통 모듈 인터페이스 확인 완료 및 리팩토링 대상 목록에 포함, When: 공통 모듈을 사용하는 통합 테스트 작성 (샘플 DB 파일 사용) 또는 수동 검증 계획 수립, Then: 테스트 실패 확인 또는 검증 계획 문서화 (scripts/__tests__/regenerate-embeddings.integration.spec.ts)
  - [x] 3.6.2 Given: 실패하는 테스트 존재 또는 검증 계획 완료, When: regenerate-embeddings.js를 공통 모듈 사용하도록 수정, Then: 테스트 통과 또는 수동 검증 완료 (initializeDatabase 사용, 직접 DB 연결 제거)
  - [x] 3.6.3 Given: 테스트 통과 또는 수동 검증 완료, When: 코드 리팩토링 (REFACTOR), Then: 테스트 계속 통과 또는 수동 검증 재확인 (에러 처리 개선, closeDatabase 사용, 불필요한 import 제거)
  - [x] 3.6.4 Given: 리팩토링 완료, When: 스크립트 실행 테스트 (`npx tsx scripts/regenerate-embeddings.js`), Then: 스크립트 정상 동작 확인 (실행 성공, 임베딩 재생성 시작 확인)

- [x] 3.7 리팩토링 대상 목록의 나머지 스크립트들 리팩토링
  - [x] 3.7.1 Given: 3.1 인벤토리 결과에 따라 리팩토링 대상 스크립트 목록 확정, When: 각 스크립트별로 리팩토링 수행 (통합 테스트 또는 수동 검증), Then: 모든 대상 스크립트가 공통 모듈 사용하도록 변경 완료 (debug-embeddings.js, backup-embeddings.js, fix-vector-dimensions.js, simple-migrate.js, simple-update.js, save-work-memory.ts, safe-migration.js, run-migration.js)
  - 참고: 리팩토링 대상은 3.1 인벤토리 결과에 따라 결정되며, 다음 스크립트들이 포함될 수 있음 (인벤토리 결과에 따라 확정):
    - backup-embeddings.js (DB 연결 사용 예상)
    - debug-embeddings.js (DB 연결 사용 예상)
    - fix-vector-dimensions.js (DB 연결 사용 예상)
    - safe-migration.js (DB 연결 사용 예상)
    - run-migration.js (DB 연결 사용 예상)
    - simple-migrate.js (DB 연결 사용 예상)
    - simple-update.js (DB 연결 사용 예상)
    - save-work-memory.ts (DB 연결 사용 예상)
    - 기타 3.1 인벤토리에서 확인된 스크립트
  - 참고: 다음 스크립트들은 제외 예정 (이미 공통 모듈 사용 또는 메모리 DB만 사용):
    - quality-thresholds.ts (이미 initializeDatabase 사용)
    - quality-report.ts (이미 initializeDatabase 사용)
    - generate-ground-truth.ts (이미 initializeDatabase 사용)
    - weekly-relation-validation.ts (메모리 DB만 사용, 실제 DB 연결 아님)
    - generate-relation-report.ts (메모리 DB만 사용, 실제 DB 연결 아님)

- [x] 3.8 중복 코드 제거 검증
  - [x] 3.8.1 Given: 모든 스크립트 리팩토링 완료, When: scripts 폴더에서 직접 DB 연결 코드 검색 (grep), Then: 직접 DB 연결 코드 0개 확인 (임시 DB 제외, tasks/db-connection-refactoring-verification.md)
  - [x] 3.8.2 Given: 직접 DB 연결 코드 제거 확인, When: 공통 모듈 사용률 확인, Then: 모든 스크립트가 공통 모듈 사용 확인 (15개 스크립트, 100% 사용률)

- [x] 3.9 통합 테스트 및 검증
  - [x] 3.9.1 Given: 모든 스크립트 리팩토링 완료, When: 각 스크립트 실행 테스트 수행, Then: 모든 스크립트 정상 동작 확인 (simple-migrate.js, debug-embeddings.js, check-db-integrity.js 등 테스트 완료)
  - [x] 3.9.2 Given: 스크립트 실행 테스트 통과, When: DB 스키마 변경 시 스크립트 오류 테스트, Then: 스크립트 오류 없음 확인 (initializeDatabase가 자동으로 스키마 초기화 및 마이그레이션 처리)

