# tasks-0005-prd-server-service-synchronization.md

## Relevant Files

- `src/server/bootstrap.ts` - 공용 부트스트랩 함수 (신규 생성). 모든 서비스를 초기화하는 중앙 집중식 함수
- `src/server/bootstrap.spec.ts` - 부트스트랩 함수 단위 테스트
- `src/server/index.ts` - MCP stdio 서버 (리팩토링). 부트스트랩 함수를 사용하도록 수정
- `src/server/http-server.ts` - HTTP/WebSocket 서버 (리팩토링). 부트스트랩 함수를 사용하고 누락된 서비스 추가
- `src/tools/types.ts` - ToolContext 타입 정의 확인 및 필요시 수정
- `src/test/test-bootstrap.ts` - 부트스트랩 함수 통합 테스트
- `src/test/test-server-synchronization.ts` - 두 서버의 서비스 초기화 일관성 검증 테스트

### Notes

- 단위 테스트는 `src/server/bootstrap.spec.ts`에 작성
- 통합 테스트는 `src/test/` 디렉토리에 작성
- `npm test`로 모든 테스트 실행 가능
- 기존 테스트가 모두 통과하는지 확인 필수

## Tasks

- [x] 1.0 공용 부트스트랩 함수 생성
  - [x] 1.1 `src/server/bootstrap.ts` 파일 생성 및 기본 구조 작성
  - [x] 1.2 `ServerServices` 인터페이스 정의 (필수 서비스 및 선택적 서비스 포함)
  - [x] 1.3 기본 서비스 초기화 로직 구현 (searchEngine, hybridSearchEngine, embeddingService)
  - [x] 1.4 고급 서비스 초기화 로직 구현 (forgettingPolicyService, databaseOptimizer, errorLoggingService, performanceAlertService)
  - [x] 1.5 PerformanceMonitor 싱글톤 처리 (`getPerformanceMonitor()` 사용 및 `initialize(db)` 호출)
  - [x] 1.6 선택적 서비스 초기화 로직 구현 (consolidationScoreService, writeCoalescingManager - 기능 플래그 확인)
  - [x] 1.7 `initializeServices()` 함수 완성 (서비스 초기화 순서 보장 및 에러 처리)
  - [x] 1.8 필요한 import 문 추가 및 타입 정의 확인

- [x] 2.0 MCP 서버 리팩토링
  - [x] 2.1 `src/server/index.ts`에 부트스트랩 함수 import 추가
  - [x] 2.2 기존 서비스 초기화 코드 제거 (137-212줄 부근)
  - [x] 2.3 `initializeServices(db)` 호출로 대체 및 전역 변수에 서비스 할당
  - [x] 2.4 PerformanceMonitor 초기화 변경 (`new PerformanceMonitor()` → `getPerformanceMonitor()` 사용)
  - [x] 2.5 ToolContext 생성 로직 수정 (모든 서비스를 `services` 객체에서 참조)
  - [x] 2.6 기존 기능 유지 확인 (MCP SDK 통합, Resources 핸들러, 로깅 방식)
  - [x] 2.7 불필요한 import 제거 및 코드 정리

- [x] 3.0 HTTP 서버 리팩토링
  - [x] 3.1 `src/server/http-server.ts`에 부트스트랩 함수 import 추가
  - [x] 3.2 기존 서비스 초기화 코드 제거 (917-988줄 부근)
  - [x] 3.3 `initializeServices(db)` 호출로 대체 및 전역 변수에 서비스 할당
  - [x] 3.4 누락된 서비스 확인 및 추가 (forgettingPolicyService, performanceMonitor, databaseOptimizer, errorLoggingService, performanceAlertService)
  - [x] 3.5 `/tools/:name` 엔드포인트의 ToolContext 수정 (모든 서비스 포함)
  - [x] 3.6 `/messages` 엔드포인트의 ToolContext 수정 (MCP tools/call)
  - [x] 3.7 WebSocket 핸들러의 ToolContext 수정
  - [x] 3.8 `/admin/performance/*` 엔드포인트에서 PerformanceMonitor 정상 동작 확인
  - [x] 3.9 기존 기능 유지 확인 (HTTP/WebSocket/SSE 엔드포인트, 관리자 API, 배치 스케줄러)
  - [x] 3.10 불필요한 import 제거 및 코드 정리

- [x] 4.0 ToolContext 타입 일관성 확인 및 수정
  - [x] 4.1 `src/tools/types.ts`의 ToolContext 인터페이스 확인
  - [x] 4.2 모든 서비스가 optional로 정의되어 있는지 확인
  - [x] 4.3 누락된 서비스 타입이 있다면 추가 (현재 모든 서비스 포함 확인됨)
  - [x] 4.4 두 서버의 ToolContext 생성 로직 비교 및 일관성 확인
  - [x] 4.5 타입 정의 문서화 (주석 추가)

- [ ] 5.0 테스트 작성 및 검증
  - [x] 5.1 `src/server/bootstrap.spec.ts` 생성 (부트스트랩 함수 단위 테스트)
  - [x] 5.2 모든 서비스가 올바르게 초기화되는지 검증하는 테스트 작성
  - [x] 5.3 PerformanceMonitor 싱글톤 및 DB 초기화 검증 테스트 작성
  - [x] 5.4 선택적 서비스(consolidationScoreService) 초기화 검증 테스트 작성
  - [x] 5.5 `src/test/test-bootstrap.ts` 생성 (부트스트랩 함수 통합 테스트)
  - [x] 5.6 `src/test/test-server-synchronization.ts` 생성 (두 서버 동기화 검증)
  - [x] 5.7 HTTP 서버와 MCP 서버가 동일한 서비스를 초기화하는지 검증
  - [x] 5.8 두 서버에서 동일한 도구가 동일하게 동작하는지 검증
  - [x] 5.9 기존 테스트 실행 및 통과 확인 (`npm test`)
  - [x] 5.10 회귀 테스트 수행 (기존 기능이 정상 동작하는지 확인)

