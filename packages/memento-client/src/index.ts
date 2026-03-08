/**
 * @memento/client - Memento MCP Server 클라이언트 라이브러리
 * 
 * AI Agent의 기억을 관리하고 컨텍스트를 주입하는 TypeScript 라이브러리입니다.
 * 
 * @example
 * ```typescript
 * import { MementoClient, MemoryManager, ContextInjector } from '@memento/client';
 * 
 * // 클라이언트 생성 및 연결
 * const client = new MementoClient({
 *   serverUrl: 'http://localhost:8080',
 *   apiKey: 'your-api-key'
 * });
 * 
 * await client.connect();
 * 
 * // 기억 관리
 * const manager = new MemoryManager(client);
 * const memory = await manager.create({
 *   content: 'React Hook에 대해 학습했다',
 *   type: 'episodic',
 *   importance: 0.8
 * });
 * 
 * // 컨텍스트 주입
 * const injector = new ContextInjector(client);
 * const context = await injector.inject('React Hook 질문', {
 *   tokenBudget: 1000
 * });
 * ```
 * 
 * @packageDocumentation
 */

// 메인 클래스들
export { MementoClient } from './memento-client.js';
export { MemoryManager } from './memory-manager.js';
export { ContextInjector } from './context-injector.js';

// 에러 클래스들
export {
  MementoError,
  ConnectionError,
  AuthenticationError,
  ValidationError,
  NotFoundError
} from './types.js';

// 타입들
export type {
  // 클라이언트 설정
  MementoClientOptions,
  
  // 기억 관련
  MemoryItem,
  CreateMemoryParams,
  UpdateMemoryParams,
  MemoryType,
  PrivacyScope,
  
  // 검색 관련
  SearchFilters,
  SearchResult,
  MemorySearchResult,
  HybridSearchParams,
  HybridSearchResult,
  HybridSearchItem,
  
  // MCP Tools 응답
  RememberResult,
  PinResult,
  ForgetResult,
  LinkResult,
  ExportResult,
  FeedbackResult,
  
  // 컨텍스트 주입
  ContextInjectionParams,
  ContextInjectionResult,
  
  
  // 이벤트 타입들
  MementoClientEvents,
  
  // 유틸리티 타입들
  PaginationParams,
  PaginatedResult,
  HealthCheck
} from './types.js';

// ContextInjector 옵션 타입
export type { ContextInjectionOptions } from './context-injector.js';

// 편의 함수들
export * from './utils.js';
