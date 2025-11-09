# 0005-prd-server-service-synchronization.md

## Introduction/Overview

서버 서비스 초기화 동기화 기능은 Memento MCP 서버의 **HTTP 서버(`http-server.ts`)와 MCP stdio 서버(`index.ts`) 간의 서비스 초기화 로직을 통일**하여 기능 불일치 문제를 해결하는 기능입니다.

현재 Memento는 두 개의 진입점(HTTP/WebSocket 서버와 MCP stdio 서버)을 제공하지만, 각 서버가 서로 다른 서비스 집합을 초기화하고 있어 다음과 같은 문제가 발생합니다:

- **기능 불일치**: HTTP 서버에서 일부 서비스(forgettingPolicyService, performanceMonitor, databaseOptimizer, errorLoggingService, performanceAlertService)가 초기화되지 않아 해당 서비스에 의존하는 도구들이 실패하거나 기능을 수행하지 못함
- **코드 중복**: 두 서버에서 유사한 초기화 로직이 중복되어 유지보수 어려움
- **DB 초기화 누락**: PerformanceMonitor가 HTTP 서버에서 DB 참조 없이 동작하여 데이터베이스 지표 수집 및 알림 관리가 동작하지 않음
- **Prompts 핸들러 불일치**: MCP stdio 서버는 Prompts 핸들러가 없고, HTTP 서버는 수동으로 구현하여 표준화되지 않음

**핵심 문제**: HTTP 서버와 MCP 서버가 서로 다른 서비스를 초기화하여 기능 불일치가 발생하고, 코드 중복으로 인한 유지보수 어려움이 있습니다.

**목표**: 공용 부트스트랩 함수를 추출하여 두 서버가 동일한 서비스 집합을 초기화하도록 통일하고, 코드 중복을 제거하여 유지보수성을 향상시킵니다.

## Goals

1. **서비스 초기화 통일**: HTTP 서버와 MCP 서버가 동일한 서비스 집합을 초기화하도록 보장
2. **코드 중복 제거**: 공용 부트스트랩 함수를 추출하여 DRY 원칙 준수
3. **누락된 서비스 추가**: HTTP 서버에 누락된 모든 서비스(forgettingPolicyService, performanceMonitor, databaseOptimizer, errorLoggingService, performanceAlertService) 초기화 추가
4. **DB 초기화 보장**: PerformanceMonitor가 두 서버 모두에서 데이터베이스 참조를 올바르게 초기화
5. **ToolContext 일관성**: 두 서버의 ToolContext가 동일한 서비스 집합을 포함하도록 보장
6. **기능 동등성**: 두 서버에서 모든 도구가 동일하게 동작하도록 보장
7. **테스트 커버리지**: 두 서버 모두에 대한 통합 테스트 작성 및 통과

## User Stories

### 개발자 관점
- **US-001**: 개발자로서 HTTP 서버와 MCP 서버가 동일한 서비스를 초기화하여 기능 불일치 문제를 해결하고 싶다
- **US-002**: 개발자로서 코드 중복을 제거하여 유지보수성을 향상시키고 싶다
- **US-003**: 개발자로서 새로운 서비스를 추가할 때 두 서버 모두에 일관되게 적용하고 싶다

### 시스템 관리자 관점
- **US-004**: 시스템 관리자로서 HTTP 서버에서도 성능 모니터링, 에러 로깅, 망각 정책 등 모든 기능이 정상 동작하기를 원한다
- **US-005**: 시스템 관리자로서 두 서버 모두에서 동일한 관리 API를 통해 시스템 상태를 모니터링하고 싶다

### AI Agent 관점
- **US-006**: AI Agent로서 HTTP 서버와 MCP 서버 중 어느 것을 사용하더라도 동일한 기능과 성능을 기대하고 싶다
- **US-007**: AI Agent로서 HTTP 서버에서도 망각 정책, 성능 모니터링 등 모든 고급 기능을 활용하고 싶다

## Functional Requirements

### 1. 공용 부트스트랩 함수 생성

1.1. `src/server/bootstrap.ts` 파일 생성

1.2. `initializeServices()` 함수 구현:
   - 입력: `Database.Database` 인스턴스
   - 출력: `ServerServices` 인터페이스 타입의 서비스 집합 객체
   - 모든 서비스 인스턴스 생성 및 초기화 수행

1.3. `ServerServices` 인터페이스 정의:
   - `searchEngine: SearchEngine`
   - `hybridSearchEngine: HybridSearchEngine`
   - `embeddingService: MemoryEmbeddingService`
   - `forgettingPolicyService: ForgettingPolicyService`
   - `performanceMonitor: PerformanceMonitor` (싱글톤 인스턴스)
   - `databaseOptimizer: DatabaseOptimizer`
   - `errorLoggingService: ErrorLoggingService`
   - `performanceAlertService: PerformanceAlertService`
   - `consolidationScoreService?: ConsolidationScoreService` (선택적)
   - `writeCoalescingManager?: WriteCoalescingManager` (선택적)
   
   **참고**: `SearchCacheService`는 현재 ToolContext에 포함되지 않으며 도구에서도 사용되지 않습니다. 향후 검색 결과 캐싱 기능이 필요할 경우 별도 작업으로 추가 예정입니다.

1.4. 각 서비스 초기화 순서 보장:
   - 데이터베이스 의존성이 있는 서비스는 DB 초기화 후 생성
   - **PerformanceMonitor 싱글톤 처리**: `getPerformanceMonitor()` 함수를 사용하여 싱글톤 인스턴스를 가져오고, `initialize(db)` 메서드를 호출하여 DB 참조 설정
     - **주의**: `new PerformanceMonitor()`를 사용하지 않음. 싱글톤 패턴을 유지하여 두 서버가 동일한 인스턴스를 공유

### 2. MCP 서버(`index.ts`) 리팩토링

2.1. `initializeServer()` 함수에서 공용 부트스트랩 함수 사용:
   - `import { initializeServices } from './bootstrap.js'` 추가
   - 기존 서비스 초기화 코드를 `const services = await initializeServices(db)`로 대체
   - 전역 변수에 서비스 할당
   - **PerformanceMonitor 변경**: `new PerformanceMonitor()` → `getPerformanceMonitor()` 사용

2.2. ToolContext 생성 시 공용 서비스 사용:
   - `services` 객체에서 모든 서비스를 참조하도록 수정
   - 서비스가 optional이더라도 모든 서비스를 제공하여 일관성 보장

2.3. 기존 기능 유지:
   - MCP SDK 통합 유지
   - Resources 핸들러 유지
   - 기존 로깅 방식 유지 (stderr 사용)

### 3. HTTP 서버(`http-server.ts`) 리팩토링

3.1. `initializeServer()` 함수에서 공용 부트스트랩 함수 사용:
   - `import { initializeServices } from './bootstrap.js'` 추가
   - 기존 서비스 초기화 코드를 `const services = await initializeServices(db)`로 대체
   - 전역 변수에 서비스 할당

3.2. 누락된 서비스 초기화 추가:
   - `forgettingPolicyService` 초기화
   - `performanceMonitor` 초기화 (부트스트랩에서 이미 `initialize(db)` 호출됨)
   - `databaseOptimizer` 초기화
   - `errorLoggingService` 초기화
   - `performanceAlertService` 초기화

3.3. ToolContext 생성 시 모든 서비스 포함:
   - `/tools/:name` 엔드포인트
   - `/messages` 엔드포인트 (MCP tools/call)
   - WebSocket 핸들러
   
   **참고**: PerformanceMonitor는 부트스트랩 함수에서 이미 `initialize(db)`가 호출되므로, HTTP 서버에서는 추가 초기화 불필요. `/admin/performance/*` 엔드포인트에서 정상 동작 보장.

3.5. 기존 기능 유지:
   - HTTP/WebSocket/SSE 엔드포인트 유지
   - 관리자 API 엔드포인트 유지
   - 배치 스케줄러 통합 유지

### 4. ToolContext 타입 일관성

4.1. `src/tools/types.ts`의 `ToolContext` 인터페이스 확인:
   - **현재 상태**: 모든 서비스가 선택적(optional) 필드로 정의되어 있음
   - **유지 정책**: ToolContext의 서비스 필드는 optional을 유지
     - 이유: 다양한 도구가 서로 다른 서비스 집합을 필요로 하며, 테스트 헬퍼와 일부 도구가 일부 서비스만 전달하는 패턴을 사용
   - **공통 초기화 서비스**: 부트스트랩 함수에서 초기화하되, ToolContext에 주입할 때는 optional 유지
   - 누락된 서비스 타입이 있다면 추가

4.2. 두 서버의 ToolContext가 동일한 구조를 가지도록 보장:
   - 두 서버 모두 동일한 `ServerServices` 객체를 ToolContext에 주입
   - 서비스가 optional이더라도 두 서버에서 동일한 서비스 집합을 제공하여 일관성 보장

### 5. 테스트 작성

5.1. 부트스트랩 함수 단위 테스트:
   - 모든 서비스가 올바르게 초기화되는지 검증
   - DB 초기화가 올바르게 수행되는지 검증

5.2. 통합 테스트:
   - HTTP 서버와 MCP 서버가 동일한 서비스를 초기화하는지 검증
   - 두 서버에서 동일한 도구가 동일하게 동작하는지 검증

5.3. 기존 테스트 통과 확인:
   - 모든 기존 테스트가 통과하는지 확인
   - 회귀 테스트 수행

## Non-Goals (Out of Scope)

1. **Prompts 핸들러 통일**: 이번 작업에서는 Prompts 핸들러 통일을 포함하지 않음 (별도 작업으로 분리)
2. **성능 모니터링 통합 기능 개선**: 기존 기능 유지, 새로운 기능 추가는 제외
3. **에러 로깅 시스템 개선**: 기존 기능 유지, 새로운 기능 추가는 제외
4. **서비스 아키텍처 재설계**: 기존 서비스 구조 유지, 초기화 로직만 통일
5. **API 변경**: 기존 API 호환성 유지, 새로운 API 추가는 제외

## Design Considerations

### 아키텍처 패턴

- **Factory Pattern**: `initializeServices()` 함수는 서비스 팩토리 역할
- **Dependency Injection**: 서비스들이 데이터베이스 의존성을 주입받음
- **Singleton Pattern**: PerformanceMonitor는 싱글톤 패턴 사용
  - `getPerformanceMonitor()` 함수를 통해 싱글톤 인스턴스 획득
  - 두 서버가 동일한 인스턴스를 공유하여 전역 상태 일관성 유지
  - DB 초기화는 `initialize(db)` 메서드 호출로 수행

### 코드 구조

```
src/server/
├── bootstrap.ts          # 공용 부트스트랩 함수 (신규)
├── index.ts              # MCP stdio 서버 (리팩토링)
└── http-server.ts        # HTTP/WebSocket 서버 (리팩토링)
```

### 초기화 순서

1. 데이터베이스 초기화
2. 기본 서비스 초기화 (검색 엔진, 임베딩 서비스)
3. 고급 서비스 초기화 (성능 모니터, 에러 로깅, 알림)
4. 선택적 서비스 초기화 (Consolidation Score, Write Coalescing)
5. DB 의존성 초기화 (PerformanceMonitor.initialize(db))

## Technical Considerations

### 의존성 관리

- **데이터베이스**: 모든 서비스가 `Database.Database` 인스턴스를 공유
- **설정**: `mementoConfig`를 통해 기능 플래그 확인 (예: `consolidationScoreEnabled`)
- **로깅**: MCP 서버는 stderr, HTTP 서버는 console 사용

### 성능 고려사항

- 서비스 초기화는 서버 시작 시 한 번만 수행되므로 성능 영향 최소
- PerformanceMonitor는 싱글톤 패턴으로 메모리 사용량 최적화 및 전역 상태 일관성 유지
- 지연 초기화(lazy initialization)는 사용하지 않음 (명시적 초기화)

### 에러 처리

- 서비스 초기화 실패 시 서버 시작 실패
- 각 서비스 초기화 시 에러 로깅
- 부분 실패 방지 (all-or-nothing)

### 호환성

- 기존 API 호환성 유지
- 기존 클라이언트 코드 변경 불필요
- 기존 데이터베이스 스키마 변경 불필요

## Success Metrics

1. **기능 동등성**: HTTP 서버와 MCP 서버에서 동일한 도구가 동일하게 동작 (100% 일치)
2. **코드 중복 제거**: 서비스 초기화 로직 중복 제거 (DRY 원칙 준수)
3. **서비스 초기화 완료율**: 두 서버 모두에서 모든 필수 서비스 초기화 (100%)
4. **테스트 커버리지**: 부트스트랩 함수 및 두 서버에 대한 테스트 커버리지 80% 이상
5. **기존 테스트 통과율**: 모든 기존 테스트 통과 (100%)
6. **성능 영향**: 서버 시작 시간 증가 5% 이하
7. **에러 감소**: 서비스 누락으로 인한 도구 실행 실패 0건

## Open Questions

1. **Prompts 핸들러 통일**: MCP stdio 서버에 Prompts 핸들러를 추가할지, HTTP 서버의 수동 구현을 제거할지 결정 필요
2. **서비스 초기화 실패 처리**: 일부 서비스 초기화 실패 시 서버를 시작할지 중단할지 정책 결정 필요
3. **환경별 서비스 구성**: 개발/프로덕션 환경에 따라 다른 서비스 집합을 초기화할지 결정 필요
4. **서비스 라이프사이클 관리**: 서비스 종료 시 정리(cleanup) 로직을 부트스트랩 함수에 포함할지 결정 필요
5. **모니터링 통합**: PerformanceMonitoringIntegration 서비스의 초기화 여부 결정 필요 (현재 주석 처리됨)

## Resolved Questions (PRD 수정 시 해결됨)

1. **PerformanceMonitor 싱글톤 처리**: ✅ 해결
   - **결정**: `getPerformanceMonitor()` 싱글톤 함수 사용
   - **이유**: 두 서버가 동일한 인스턴스를 공유하여 전역 상태 일관성 유지
   - **구현**: 부트스트랩 함수에서 `getPerformanceMonitor()` 호출 후 `initialize(db)` 실행

2. **ToolContext 서비스 필드 필수/선택 여부**: ✅ 해결
   - **결정**: ToolContext의 서비스 필드는 optional 유지
   - **이유**: 다양한 도구가 서로 다른 서비스 집합을 필요로 하며, 기존 코드베이스와의 호환성 유지
   - **구현**: 부트스트랩에서 모든 서비스를 초기화하되, ToolContext에 주입할 때는 optional 타입 유지

## Implementation Notes

### 단계별 구현 계획

1. **Phase 1**: 공용 부트스트랩 함수 생성 및 테스트
2. **Phase 2**: MCP 서버 리팩토링 및 테스트
3. **Phase 3**: HTTP 서버 리팩토링 및 테스트
4. **Phase 4**: 통합 테스트 및 회귀 테스트
5. **Phase 5**: 문서화 및 코드 리뷰

### 주의사항

- 기존 코드 변경 시 주의 깊은 테스트 필요
- 서비스 초기화 순서가 중요하므로 순서 보장 필수
- **PerformanceMonitor 싱글톤 패턴 주의**:
  - `new PerformanceMonitor()` 대신 `getPerformanceMonitor()` 사용 필수
  - 두 서버가 동일한 싱글톤 인스턴스를 공유하도록 보장
  - DB 초기화는 `initialize(db)` 메서드 호출 필수
- **ToolContext 서비스 필드**: optional 유지 (기존 코드베이스와의 호환성)
- 두 서버의 로깅 방식 차이 유지 (MCP는 stderr, HTTP는 console)

### 구현 시 확인 필요 사항 (리스크 관리)

#### 1. 싱글톤 재초기화 처리

**문제**: `initializeServices()`가 여러 번 호출될 경우 싱글톤 인스턴스의 재초기화 처리 방법

**확인 사항**:
- `getPerformanceMonitor()`는 이미 생성된 인스턴스를 반환하므로, `initialize(db)`를 여러 번 호출해도 안전한지 확인
- 테스트 환경에서 `initializeServices()`를 여러 번 호출할 때 싱글톤 상태가 올바르게 유지되는지 검증
- 서버 재시작 시 싱글톤 인스턴스가 올바르게 재초기화되는지 확인

**권장 해결책**:
- `PerformanceMonitor.initialize(db)` 메서드가 멱등성(idempotent)을 보장하도록 구현 확인
- 부트스트랩 함수에서 싱글톤 서비스는 한 번만 초기화하도록 보장
- 테스트에서 싱글톤 상태 격리를 위한 정리 로직 고려

#### 2. ToolContext에 새 서비스 추가 시 영향 분석

**문제**: 부트스트랩에서 초기화된 새 서비스가 ToolContext에 추가될 때, 기존 도구와 테스트가 이를 어떻게 소비하는지

**확인 사항**:
- **기존 도구**: 새 서비스가 optional이므로 기존 도구는 영향 없음 (하위 호환성 유지)
- **테스트 헬퍼**: 테스트가 필요한 서비스만 선택적으로 전달하는 패턴 유지
  - 예: `test-memory-neighbors.ts`는 `embeddingService`만 전달
  - 예: `test-http-server-v2.ts`는 `setTestDependencies()`로 선택적 주입
- **새 도구**: 새 서비스를 필요로 하는 도구는 optional 체크 후 사용

**권장 해결책**:
- 새 서비스 추가 시 모든 도구가 이를 사용할 필요 없음 (optional 유지)
- 테스트는 필요한 서비스만 주입하는 패턴 유지
- 새 서비스를 사용하는 도구는 `context.services.newService?.method()` 패턴 사용
- 부트스트랩 함수에서 모든 서비스를 초기화하되, ToolContext에 주입할 때는 optional 유지

**테스트 전략**:
- 부트스트랩 함수 단위 테스트: 모든 서비스가 올바르게 초기화되는지 검증
- 통합 테스트: 두 서버가 동일한 서비스 집합을 제공하는지 검증
- 회귀 테스트: 기존 도구와 테스트가 새 서비스 추가 후에도 정상 동작하는지 확인

