# PRD: 중복 코드 제거 (Phase 2)

## 1. Introduction/Overview

Memento 프로젝트는 MCP(Model Context Protocol) 서버로서 복잡한 메모리 관리 시스템을 구현하고 있습니다. 현재 코드베이스에서 리팩토링 과정의 흔적으로 인한 중복 구현이 발견되었으며, 이를 정리하여 유지보수성을 향상시키고 기술 부채를 줄여야 합니다.

**발견된 주요 중복 구현:**
1. **서버 엔트리 포인트 중복**: `index.ts`, `simple-mcp-server.ts`, `http-server.ts`, `index-refactored.ts` 등 여러 진입점이 공존
2. **검색 엔진 중복**: `vector-search-engine.ts`와 `vector-search-engine-refactored.ts`가 공존
3. **데이터베이스 연결 로직 중복**: `scripts/` 폴더의 스크립트들이 `src/infrastructure/database/`의 공통 모듈을 재사용하지 않고 별도로 DB 연결 로직을 구현

**목표**: 단일 진입점으로 통일하고, 리팩토링 파일들을 정리하며, 모든 스크립트가 공통 DB 연결 모듈을 사용하도록 통일하여 코드 중복을 제거하고 유지보수성을 향상시킵니다.

## 2. Goals

1. **서버 진입점 통일**: `index.ts`를 단일 진입점으로 통일하고, 환경 변수에 따라 적절한 서버 인스턴스 생성
2. **리팩토링 파일 정리**: `*-refactored.ts` 파일들을 검증 후 기존 파일로 대체하고 리팩토링 파일 제거
3. **DB 연결 로직 통일**: 모든 스크립트가 `src/infrastructure/database/`의 공통 모듈을 사용하도록 통일
4. **빌드 및 테스트 통과**: 단일 진입점으로 빌드 및 테스트가 정상적으로 통과하는지 확인
5. **기능 호환성 유지**: 기존 기능이 모두 정상적으로 동작하는지 확인

## 3. User Stories

### 3.1 개발자 관점

**As a** 백엔드 개발자  
**I want** 서버를 시작할 때 단일 진입점을 사용함  
**So that** 어떤 파일을 실행해야 하는지 혼동하지 않습니다.

**As a** 개발자  
**I want** 리팩토링 파일이 정리됨  
**So that** 어떤 파일이 실제 운영 코드인지 명확하게 알 수 있습니다.

**As a** 개발자  
**I want** 모든 스크립트가 공통 DB 연결 모듈을 사용함  
**So that** DB 연결 로직 변경 시 한 곳만 수정하면 됩니다.

### 3.2 유지보수 담당자 관점

**As a** 유지보수 담당자  
**I want** 중복 코드가 제거됨  
**So that** 버그 수정 시 여러 곳을 수정할 필요가 없습니다.

**As a** 유지보수 담당자  
**I want** 명확한 진입점이 있음  
**So that** 시스템을 이해하고 수정하기 쉬워집니다.

### 3.3 시스템 관점

**As a** 시스템  
**I want** 단일 진입점을 통해 시작됨  
**So that** 초기화 과정이 명확하고 예측 가능합니다.

**As a** 빌드 시스템  
**I want** 중복 파일이 없음  
**So that** 빌드 시간과 번들 크기를 최적화할 수 있습니다.

## 4. Functional Requirements

### 4.1 서버 진입점 통일

**FR-1.1**: `index.ts`를 단일 진입점으로 통일
- 현재 상태:
  - `src/server/index.ts`: 메인 진입점 (존재)
  - `src/server/simple-mcp-server.ts`: 표준 입출력(Stdio) 방식 서버
  - `src/server/http-server.ts`: SSE(Server-Sent Events) 방식 서버
  - `src/server/index-refactored.ts`: 리팩토링 중인 파일 (존재 여부 확인 필요)
- 요구사항:
  - `src/server/index.ts`를 단일 진입점으로 사용
  - 환경 변수(`TRANSPORT_TYPE=stdio|sse`)에 따라 팩토리 패턴으로 적절한 서버 인스턴스 생성
  - `simple-mcp-server.ts`와 `http-server.ts`는 내부 모듈로 유지 (직접 실행 불가)
  - `index-refactored.ts`가 존재한다면 검증 후 제거

**FR-1.2**: 서버 팩토리 패턴 구현
- `src/server/server-factory.ts` 생성
- `createServer(transportType: 'stdio' | 'sse'): Server` 메서드 제공
- 환경 변수 기반 자동 선택 로직 구현

**FR-1.3**: 시작 스크립트 업데이트
- `start-dev.sh`, `start-prod.sh` 스크립트가 `index.ts`를 단일 진입점으로 사용하도록 업데이트
- 환경 변수 설정 확인

**FR-1.4**: 리팩토링 파일 제거
- `index-refactored.ts`가 존재한다면 검증 후 제거
- Git 히스토리 보존 (삭제만 수행)

### 4.2 검색 엔진 중복 제거

**FR-2.1**: 리팩토링된 벡터 검색 엔진 검증
- 현재 상태:
  - `src/domains/search/algorithms/vector-search-engine.ts`: 기존 파일
  - `src/domains/search/algorithms/vector-search-engine-refactored.ts`: 리팩토링된 파일
- 요구사항:
  - `vector-search-engine-refactored.ts`의 안정성 검증
  - 기존 테스트 케이스로 리팩토링된 엔진 테스트
  - 성능 및 기능 비교 테스트

**FR-2.2**: 리팩토링된 엔진으로 대체
- `vector-search-engine-refactored.ts`가 검증되면 기존 파일로 대체
- `vector-search-engine-refactored.ts` 파일 제거
- 모든 import 경로 업데이트

**FR-2.3**: 테스트 파일 정리
- `vector-search-engine-refactored.spec.ts`가 존재한다면 `vector-search-engine.spec.ts`로 통합
- 모든 테스트 통과 확인

### 4.3 데이터베이스 연결 로직 통일

**FR-3.1**: 공통 DB 연결 모듈 확인
- `src/infrastructure/database/` 디렉토리의 DB 연결 팩토리 확인
- 공통 모듈 인터페이스 문서화

**FR-3.2**: 스크립트 DB 연결 통일
- 대상 스크립트:
  - `scripts/check-db-integrity.js`
  - `scripts/fix-migration.js`
  - `scripts/migrate-embedding-data.js`
  - `scripts/regenerate-embeddings.js`
  - 기타 DB 연결을 사용하는 모든 스크립트
- 요구사항:
  - 모든 스크립트가 `src/infrastructure/database/`의 공통 모듈을 import하여 사용
  - 별도의 `sqlite3` 또는 `better-sqlite3` 직접 import 제거
  - DB 연결 로직 중복 제거

**FR-3.3**: 스크립트 테스트
- 각 스크립트가 공통 모듈을 사용하여 정상 동작하는지 확인
- DB 스키마 변경 시 스크립트 오류가 발생하지 않는지 확인

## 5. Non-Goals (Out of Scope)

1. **전체 코드베이스 중복 제거**: 이번 작업은 발견된 주요 중복에 집중하며, 다른 중복은 별도 작업으로 진행
2. **서버 아키텍처 재설계**: 기존 서버 구조는 유지하며 진입점만 통일
3. **검색 엔진 알고리즘 개선**: 리팩토링된 엔진이 검증되지 않으면 기존 엔진 유지
4. **스크립트 기능 확장**: 기존 스크립트 기능은 유지하며 DB 연결만 통일
5. **마이그레이션 시스템 재설계**: 기존 마이그레이션 시스템은 유지

## 6. Design Considerations

### 6.1 서버 팩토리 패턴

- **환경 변수 기반 선택**: `TRANSPORT_TYPE` 환경 변수로 서버 타입 선택
- **기본값**: 환경 변수가 없으면 `stdio` 방식 사용 (MCP 표준)
- **확장성**: 향후 새로운 전송 방식 추가 시 팩토리만 수정

### 6.2 리팩토링 파일 검증

- **테스트 기반 검증**: 기존 테스트 케이스로 리팩토링된 코드 검증
- **성능 비교**: 리팩토링 전후 성능 비교 (목표: ±5% 이내)
- **기능 호환성**: 모든 기존 기능이 정상 동작하는지 확인

### 6.3 DB 연결 통일

- **의존성 주입**: 스크립트에서 DB 연결을 주입받아 사용
- **에러 처리**: 공통 모듈의 에러 처리 로직 활용
- **설정 통일**: 환경 변수 기반 설정 통일

## 7. Technical Considerations

### 7.1 의존성

- 기존 TypeScript, Node.js 버전 유지
- 기존 라이브러리 의존성 유지

### 7.2 마이그레이션 전략

- **점진적 적용**: 파일별로 순차적으로 중복 제거
- **하위 호환성 유지**: 기존 API는 유지하며 내부 구현만 개선
- **테스트 우선**: 각 변경사항에 대한 테스트 케이스 먼저 작성

### 7.3 리스크 관리

- **기능 회귀 방지**: 모든 기존 테스트 통과 필수
- **단계별 검증**: 각 단계 완료 후 테스트 통과 확인
- **롤백 계획**: 문제 발생 시 즉시 롤백 가능하도록 Git 브랜치 관리

## 8. Success Metrics

### 8.1 서버 진입점 통일

#### 측정 방법
- **진입점 개수**: 서버를 시작할 수 있는 파일 개수 (목표: 1개)
- **환경 변수 테스트**: `TRANSPORT_TYPE`에 따라 올바른 서버가 시작되는지 확인
- **빌드 테스트**: 단일 진입점으로 빌드 및 실행 테스트

#### 목표
- **진입점 1개**: `src/server/index.ts`만 서버 시작 가능
- **환경 변수 동작**: `TRANSPORT_TYPE`에 따라 올바른 서버 시작
- **빌드 통과**: 단일 진입점으로 빌드 및 테스트 통과

### 8.2 리팩토링 파일 제거

#### 측정 방법
- **리팩토링 파일 개수**: `*-refactored.ts` 파일 개수 (목표: 0개)
- **테스트 통과**: 리팩토링된 코드로 모든 테스트 통과
- **성능 비교**: 리팩토링 전후 성능 비교 (±5% 이내)

#### 목표
- **리팩토링 파일 0개**: 모든 `*-refactored.ts` 파일 제거
- **테스트 통과**: 모든 기존 테스트 통과
- **성능 유지**: 리팩토링 전후 성능 차이 ±5% 이내

### 8.3 DB 연결 통일

#### 측정 방법
- **공통 모듈 사용률**: 스크립트에서 공통 모듈 사용 비율 (목표: 100%)
- **중복 코드 개수**: 스크립트에서 직접 DB 연결하는 코드 개수 (목표: 0개)
- **스크립트 테스트**: 각 스크립트가 정상 동작하는지 확인

#### 목표
- **공통 모듈 사용률 100%**: 모든 스크립트가 공통 모듈 사용
- **중복 코드 0개**: 스크립트에서 직접 DB 연결하는 코드 0개
- **스크립트 정상 동작**: 모든 스크립트가 정상적으로 실행됨

### 8.4 종합 성공 기준

- **중복 파일 제거**: 모든 중복 파일 제거 완료
- **단일 진입점**: `index.ts`만 서버 시작 가능
- **빌드 및 테스트 통과**: `npm run build && npm test` 통과
- **스크립트 정상 동작**: 모든 스크립트가 공통 모듈을 사용하여 정상 동작
- **코드 리뷰 통과**: 모든 변경사항에 대한 코드 리뷰 완료

## 9. Implementation Plan

### Phase 2.1: 서버 진입점 통일 (우선순위: 최고)

1. **현재 상태 분석**
   - `src/server/` 디렉토리의 모든 파일 확인
   - `index-refactored.ts` 존재 여부 확인
   - 각 파일의 역할 및 사용처 분석

2. **서버 팩토리 구현**
   - `src/server/server-factory.ts` 생성
   - `createServer()` 메서드 구현
   - 환경 변수 기반 서버 선택 로직 구현

3. **index.ts 업데이트**
   - `src/server/index.ts`를 팩토리를 사용하도록 수정
   - 환경 변수 기반 서버 생성 로직 추가

4. **리팩토링 파일 제거**
   - `index-refactored.ts`가 존재한다면 검증 후 제거
   - Git 히스토리 보존

5. **시작 스크립트 업데이트**
   - `start-dev.sh`, `start-prod.sh` 확인 및 업데이트
   - 환경 변수 설정 확인

**완료 조건**:
- `src/server/index.ts`만 서버 시작 가능
- `TRANSPORT_TYPE` 환경 변수에 따라 올바른 서버 시작
- 모든 기존 테스트 통과 (`npm test`)
- 빌드 및 실행 테스트 통과

### Phase 2.2: 검색 엔진 중복 제거 (우선순위: 높음)

1. **리팩토링된 엔진 검증**
   - `vector-search-engine-refactored.ts`의 안정성 검증
   - 기존 테스트 케이스로 리팩토링된 엔진 테스트
   - 성능 및 기능 비교 테스트

2. **엔진 대체**
   - 리팩토링된 엔진이 검증되면 기존 파일로 대체
   - `vector-search-engine-refactored.ts` 파일 제거
   - 모든 import 경로 업데이트

3. **테스트 파일 정리**
   - `vector-search-engine-refactored.spec.ts`가 존재한다면 `vector-search-engine.spec.ts`로 통합
   - 모든 테스트 통과 확인

**완료 조건**:
- `vector-search-engine-refactored.ts` 파일 제거
- 모든 import 경로가 업데이트됨
- 모든 기존 테스트 통과 (`npm test`)
- 성능 차이 ±5% 이내

### Phase 2.3: DB 연결 로직 통일 (우선순위: 높음)

1. **공통 모듈 확인**
   - `src/infrastructure/database/` 디렉토리의 DB 연결 팩토리 확인
   - 공통 모듈 인터페이스 문서화

2. **스크립트 분석**
   - `scripts/` 디렉토리의 모든 스크립트 확인
   - DB 연결을 사용하는 스크립트 목록 작성

3. **스크립트 업데이트**
   - 각 스크립트를 순차적으로 공통 모듈 사용하도록 수정
   - 별도의 DB 연결 로직 제거

4. **스크립트 테스트**
   - 각 스크립트가 정상 동작하는지 확인
   - DB 스키마 변경 시 스크립트 오류가 발생하지 않는지 확인

**완료 조건**:
- 모든 스크립트가 공통 모듈 사용
- 스크립트에서 직접 DB 연결하는 코드 0개
- 모든 스크립트가 정상적으로 실행됨
- DB 스키마 변경 시 스크립트 오류 없음

## 10. Open Questions

1. **리팩토링된 엔진 검증**: `vector-search-engine-refactored.ts`가 검증되지 않으면 어떻게 처리할 것인가?
   - **해결 방안**: 검증되지 않으면 기존 엔진 유지, 리팩토링 파일은 별도 브랜치에 보관

2. **환경 변수 기본값**: `TRANSPORT_TYPE`이 설정되지 않았을 때 기본값은 무엇인가?
   - **해결 방안**: MCP 표준에 따라 `stdio`를 기본값으로 사용

3. **스크립트 호환성**: 공통 모듈을 사용하도록 변경 시 기존 스크립트 호환성이 깨질 수 있는가?
   - **해결 방안**: 공통 모듈이 기존 인터페이스를 유지하도록 설계, 필요 시 래퍼 함수 제공

4. **레거시 스크립트**: 사용되지 않는 레거시 스크립트는 어떻게 처리할 것인가?
   - **해결 방안**: 사용 여부 확인 후 사용되지 않으면 제거, 사용 중이면 공통 모듈 적용

## 11. Risks and Mitigation

### 11.1 리스크

1. **기능 회귀**: 중복 제거 과정에서 기존 기능이 깨질 수 있음
2. **성능 저하**: 리팩토링된 코드로 인한 성능 저하 가능
3. **호환성 문제**: 스크립트 변경으로 인한 호환성 문제

### 11.2 완화 전략

1. **기능 회귀 방지**:
   - 모든 기존 테스트 통과 필수
   - 단계별 검증
   - 통합 테스트 강화

2. **성능 저하 방지**:
   - 리팩토링 전후 성능 벤치마크
   - 성능 차이 ±5% 이내 목표
   - 필요 시 최적화

3. **호환성 문제 방지**:
   - 공통 모듈이 기존 인터페이스 유지
   - 점진적 마이그레이션
   - 롤백 계획 수립

## 12. Dependencies

### 12.1 기술 스택

- 기존 TypeScript 컴파일러 및 타입 시스템
- 기존 `better-sqlite3` 라이브러리
- 기존 빌드 시스템

### 12.2 측정 도구

- **중복 파일 검색**: `find src/ -name "*-refactored.ts"` 또는 `grep -r "refactored" src/`
- **진입점 검색**: `grep -r "server.*start\|createServer" src/server/`
- **DB 연결 검색**: `grep -r "new Database\|sqlite3" scripts/`

## 13. Acceptance Criteria

### Phase 2.1 완료 기준

- [ ] `src/server/index.ts`만 서버 시작 가능
- [ ] `src/server/server-factory.ts` 생성 및 구현 완료
- [ ] `TRANSPORT_TYPE` 환경 변수에 따라 올바른 서버 시작
- [ ] `index-refactored.ts` 파일 제거 (존재하는 경우)
- [ ] 시작 스크립트(`start-dev.sh`, `start-prod.sh`) 업데이트 완료
- [ ] 모든 기존 테스트 통과 (`npm test`)
- [ ] 빌드 및 실행 테스트 통과

### Phase 2.2 완료 기준

- [ ] `vector-search-engine-refactored.ts` 검증 완료
- [ ] 리팩토링된 엔진으로 대체 완료
- [ ] `vector-search-engine-refactored.ts` 파일 제거
- [ ] 모든 import 경로 업데이트 완료
- [ ] 테스트 파일 정리 완료
- [ ] 모든 기존 테스트 통과 (`npm test`)
- [ ] 성능 차이 ±5% 이내

### Phase 2.3 완료 기준

- [ ] 공통 DB 연결 모듈 확인 및 문서화 완료
- [ ] 모든 스크립트가 공통 모듈 사용하도록 수정 완료
- [ ] 스크립트에서 직접 DB 연결하는 코드 0개
- [ ] 모든 스크립트가 정상적으로 실행됨
- [ ] DB 스키마 변경 시 스크립트 오류 없음

### 전체 완료 기준

- [ ] 모든 Phase 완료
- [ ] 중복 파일 제거 완료 (`*-refactored.ts` 파일 0개)
- [ ] 단일 진입점으로 빌드 및 테스트 통과 (`npm run build && npm test`)
- [ ] 모든 스크립트가 공통 모듈을 사용하여 정상 동작
- [ ] 코드 리뷰 통과
- [ ] 문서화 완료

