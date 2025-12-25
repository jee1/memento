# Phase 5: 로깅 일원화 - 베이스라인

## 측정 일시
2025-01-25

## 표준 로거 모듈 확인

### 로거 인터페이스
- 파일: `src/shared/utils/logger.ts`
- 메서드:
  - `logger.debug(message: string, meta?: Record<string, unknown>): void`
  - `logger.info(message: string, meta?: Record<string, unknown>): void`
  - `logger.warn(message: string, meta?: Record<string, unknown>): void`
  - `logger.error(message: string, meta?: Record<string, unknown>): void`

### 로깅 형식
- 형식: `{ISO_TIMESTAMP} | {LEVEL} | {MESSAGE} | {META_JSON}`
- 예시: `2025-01-25T11:55:00.000Z | INFO | Service initialized | {"service":"anchor"}`

## 현재 console.* 사용 현황

### 전체 통계
- 전체 console.* 개수: 305개
- 핵심 모듈 console.* 개수: 48개
- 목표: 전체 200개 이하, 핵심 모듈 0개 이하

### 메서드별 통계
- console.log: 130개
- console.error: 93개
- console.warn: 77개
- console.debug: 3개
- console.info: 2개

### 파일별 console.* 개수 (상위 10개)
1. `src/domains/search/algorithms/vector-search-engine.ts`: 32개
2. `src/server/http-server.ts`: 31개 🔴 (핵심 모듈)
3. `src/infrastructure/database/database/migration/migration-runner.ts`: 21개
4. `src/domains/memory/services/memory-embedding-service.ts`: 16개
5. `src/infrastructure/database/database/migrate.ts`: 15개
6. `src/server/simple-mcp-server.ts`: 14개 🔴 (핵심 모듈)
7. `src/infrastructure/database/database/migration/backup-manager.ts`: 10개
8. `src/domains/memory/services/memory-neighbor-service.ts`: 9개

### anchor 도메인 console.* 사용
- `src/domains/anchor/services/anchor/`: 0개 ✅ (이미 logger 사용 중)

## 로깅 교체 우선순위

### 높음 (핵심 모듈)
1. `src/server/http-server.ts`: 31개
2. `src/server/simple-mcp-server.ts`: 14개
3. `src/server/index.ts`: 확인 필요

### 중간 (도메인 서비스)
1. `src/domains/memory/services/memory-embedding-service.ts`: 16개
2. `src/domains/memory/services/memory-neighbor-service.ts`: 9개

### 낮음 (인프라)
1. `src/infrastructure/database/database/migration/migration-runner.ts`: 21개
2. `src/infrastructure/database/database/migrate.ts`: 15개

## 다음 단계

1. 로깅 필드 스키마 문서화
2. ESLint `no-console` 규칙 확인 (이미 error로 설정됨)
3. 핵심 모듈부터 console.* 교체 시작

