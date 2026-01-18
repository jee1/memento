# Phase 8.1: 단순 throw만 하는 에러 발생 지점 분석

## 분석 목적
일부 코드에서 단순 throw만 하고 구조화된 에러 로깅 미적용 지점을 파악

## 분석 결과

### 전체 통계
- **전체 throw 개수**: 606개
- **ErrorLoggingService 사용**: 21개 (3.5%)
- **withErrorHandling 사용**: 2개 (0.3%)
- **단순 throw만 하는 경우**: 583개 (96.2%)

### 주요 발견 사항

#### 1. ErrorLoggingService 사용 현황
현재 ErrorLoggingService를 사용하는 파일은 매우 적습니다:
- `src/shared/utils/error-handling.ts` (withErrorHandling 함수 내부)
- `src/server/middleware/error-handler.middleware.ts` (HTTP 에러 핸들러)
- `src/server/index.ts` (일부)
- 기타 테스트 파일들

#### 2. 단순 throw 패턴 분류

##### 패턴 1: 검증 에러 (Validation Errors)
**특징**: 필수 파라미터 체크, 입력 검증 실패
**예시**:
- `src/domains/anchor/services/anchor/anchor-cache-service.ts`: Database instance required
- `src/domains/anchor/services/anchor/anchor-manager.ts`: Database is not set
- `src/domains/embedding/services/embedding-service.ts`: 텍스트가 비어있습니다

**개수**: 약 50-70개

##### 패턴 2: 초기화 에러 (Initialization Errors)
**특징**: 서비스 초기화 실패, 의존성 누락
**예시**:
- `src/domains/anchor/services/anchor/anchor-search-service.ts`: HybridSearchEngine is required
- `src/domains/anchor/services/anchor/fallback-search-service.ts`: Database instance is required

**개수**: 약 30-40개

##### 패턴 3: 비즈니스 로직 에러 (Business Logic Errors)
**특징**: 메모리 찾을 수 없음, 앵커 없음 등
**예시**:
- `src/domains/anchor/services/anchor/anchor-manager.ts`: MemoryNotFoundError
- `src/domains/anchor/tools/set-anchor-tool.ts`: 메모리를 찾을 수 없습니다
- `src/domains/embedding/services/embedding-migration-service.ts`: 임베딩 데이터가 배열 형식이 아닙니다

**개수**: 약 100-150개

##### 패턴 4: 시스템 에러 (System Errors)
**특징**: 데이터베이스 연결 실패, 벡터 차원 불일치 등
**예시**:
- `src/domains/anchor/services/anchor/query-filter-service.ts`: 벡터 차원이 일치하지 않습니다
- `src/domains/anchor/services/anchor/anchor-search-service.ts`: 벡터 차원이 일치하지 않습니다

**개수**: 약 50-70개

##### 패턴 5: 클라이언트 에러 (Client Errors)
**특징**: MCP 클라이언트 연결 실패, 응답 파싱 실패 등
**예시**:
- `src/client/index.ts`: 기억 저장에 실패했습니다
- `src/client/index.ts`: MCP 서버에 연결되지 않았습니다

**개수**: 약 10-20개

##### 패턴 6: 기타 에러 (Other Errors)
**특징**: 예상치 못한 에러, 일반적인 에러 처리
**개수**: 약 300-400개

### 주요 파일별 분석

#### 높은 우선순위 (에러 발생 빈도가 높은 파일)
1. **src/domains/anchor/services/anchor/anchor-manager.ts** (10개)
   - 앵커 관리 핵심 서비스
   - 메모리 찾기, 앵커 설정 등 주요 기능

2. **src/domains/anchor/services/anchor/anchor-search-service.ts** (10개)
   - 앵커 검색 핵심 서비스
   - 벡터 검색, 로컬 검색 등

3. **src/client/index.ts** (10개)
   - MCP 클라이언트 진입점
   - 모든 클라이언트 요청 처리

4. **src/domains/embedding/services/** (여러 파일)
   - 임베딩 서비스 관련
   - 임베딩 생성, 마이그레이션 등

#### 중간 우선순위
- `src/domains/anchor/services/anchor/*` (여러 파일)
- `src/domains/embedding/services/embedding-migration-service.ts`
- `src/services/triple-extraction/triple-extraction-service.ts`

### 개선 방향

#### 1. ErrorLoggingService 적용 전략
- **검증 에러**: LOW severity, VALIDATION category
- **초기화 에러**: MEDIUM severity, SYSTEM category
- **비즈니스 로직 에러**: MEDIUM severity, 적절한 category
- **시스템 에러**: HIGH severity, 적절한 category

#### 2. 커스텀 에러 클래스 활용
- 기존 커스텀 에러 클래스 활용: `MemoryNotFoundError`, `AnchorError` 등
- 새로운 커스텀 에러 클래스 추가 필요 시 추가

#### 3. 점진적 적용
- Phase 8.3에서 우선순위가 높은 파일부터 적용
- 각 파일별로 테스트 작성 후 적용

### 다음 단계
1. **8.2**: ErrorLoggingService를 통한 에러 로깅 테스트 작성
2. **8.3**: 모든 에러 발생 지점에 ErrorLoggingService 적용
3. **8.4**: 커스텀 에러 클래스 활용 및 리팩토링
