# 로깅 필드 스키마 문서

이 문서는 Memento 프로젝트의 표준 로거 모듈(`src/shared/utils/logger.ts`)의 로깅 필드 스키마를 설명합니다.

## 개요

Memento 프로젝트는 중앙화된 로깅 시스템을 사용하여 일관된 로깅을 제공합니다. 모든 로깅은 표준 로거(`logger`)를 통해 이루어지며, MCP 모드와 일반 모드를 자동으로 감지하여 적절한 로깅 방식을 사용합니다.

## Logger 인터페이스

표준 로거는 다음 메서드를 제공합니다:

```typescript
interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}
```

### 로그 레벨

- **debug**: 개발 및 디버깅 목적으로 사용됩니다.
- **info**: 일반적인 정보성 메시지에 사용됩니다.
- **warn**: 잠재적인 문제나 경고 상황에 사용됩니다.
- **error**: 오류나 예외 상황에 사용됩니다.

## LogMetadataSchema

로깅 메타데이터는 다음 필드를 포함할 수 있습니다:

```typescript
interface LogMetadataSchema {
  // 공통 컨텍스트 필드
  agentId?: string;        // 에이전트 ID
  slot?: 'A' | 'B' | 'C'; // 앵커 슬롯
  memoryId?: string;       // 메모리 ID
  traceId?: string;        // 추적 ID
  requestId?: string;      // 요청 ID
  
  // 추가 컨텍스트 정보
  [key: string]: unknown;
}
```

### 필드 설명

- **agentId**: 에이전트 식별자 (선택사항)
- **slot**: 앵커 슬롯 ('A', 'B', 'C' 중 하나, 선택사항)
- **memoryId**: 메모리 항목 ID (선택사항)
- **traceId**: 분산 추적을 위한 추적 ID (선택사항)
- **requestId**: 요청 식별자 (선택사항)
- **기타 필드**: 추가 컨텍스트 정보를 위한 확장 가능한 필드

## 사용 예시

### 기본 사용법

```typescript
import { logger } from './shared/utils/logger.js';

// 정보 로그
logger.info('Operation completed', { operationId: 'op123' });

// 경고 로그
logger.warn('Potential issue detected', { issue: 'low_memory' });

// 에러 로그
logger.error('Failed to process request', { error: 'timeout', requestId: 'req456' });

// 디버그 로그
logger.debug('Debug information', { step: 'validation', data: { /* ... */ } });
```

### 메타데이터 포함

```typescript
// 메모리 관련 로그
logger.info('Memory created', {
  memoryId: 'mem_123',
  agentId: 'agent_456',
  type: 'episodic'
});

// 앵커 관련 로그
logger.info('Anchor set', {
  memoryId: 'mem_123',
  slot: 'A',
  agentId: 'agent_456'
});

// 추적 가능한 로그
logger.info('Request processed', {
  traceId: 'trace_789',
  requestId: 'req_123',
  duration: 150
});
```

## MCP 모드 vs 일반 모드

### MCP 모드

- **감지 조건**: `process.stdin.isTTY === false && process.stdout.isTTY === false`
- **로깅 방식**: `mcpLogger.logServer()` 사용
- **출력 형식**: MCP 프로토콜의 `notifications/message` 형식
- **logger 이름**: 'server' (일관된 logger 이름)

### 일반 모드

- **감지 조건**: MCP 모드가 아닌 경우
- **로깅 방식**: `stderr.write()` 사용
- **출력 형식**: 구조화된 텍스트 형식
  - 형식: `[ISO 8601 타임스탬프] | [LEVEL] | [메시지] | [JSON 메타데이터]`
  - 예시: `2025-01-15T10:30:45.123Z | INFO | Operation completed | {"operationId":"op123"}`

## PII 마스킹 정책

모든 로그 메시지와 메타데이터에 PII(개인 식별 정보) 마스킹이 자동으로 적용됩니다.

- **메시지 마스킹**: `PIIMasker.mask()` 사용
- **메타데이터 마스킹**: `PIIMasker.maskObject()` 사용 (중첩 객체도 깊이 마스킹)
- **에러 마스킹**: `PIIMasker.maskError()` 사용

### 마스킹 대상

- 이메일 주소
- 전화번호
- 신용카드 번호
- IP 주소
- 기타 개인 식별 정보

## 로깅 정책

### console.* 사용 금지

비테스트 코드에서는 `console.log`, `console.error`, `console.warn`, `console.info`, `console.debug` 사용을 금지합니다.

**대신 사용:**
```typescript
// ❌ 잘못된 사용
console.log('Operation completed');
console.error('Error occurred', error);

// ✅ 올바른 사용
logger.info('Operation completed');
logger.error('Error occurred', { error: error.message });
```

### 예외 사항

- 테스트 코드: 테스트 코드에서는 console.* 사용 가능
- CLI 스크립트: CLI 스크립트에서는 console.* 사용 가능 (사용자 직접 실행)

## 로깅 메타데이터 검증

로깅 메타데이터는 `validateLogMetadata()` 함수를 통해 검증할 수 있습니다:

```typescript
import { validateLogMetadata } from './shared/utils/logger.js';

const meta = { slot: 'A', agentId: 'agent_123' };
const result = validateLogMetadata(meta);

if (!result.valid) {
  console.error('Invalid metadata:', result.errors);
}
```

## 참고 자료

- 표준 로거 모듈: `src/shared/utils/logger.ts`
- PII 마스킹: `src/shared/utils/pii-masker.ts`
- MCP 로거: `src/server/mcp-logger.ts`
- MCP 스펙: https://spec.modelcontextprotocol.io/specification/server/#logging
