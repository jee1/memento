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
export { MementoClient } from './memento-client.js';
export { MemoryManager } from './memory-manager.js';
export { ContextInjector } from './context-injector.js';
export type { MementoClientOptions, MemoryItem, CreateMemoryParams, UpdateMemoryParams, MemoryType, PrivacyScope, SearchFilters, SearchResult, MemorySearchResult, HybridSearchParams, HybridSearchResult, HybridSearchItem, RememberResult, PinResult, ForgetResult, LinkResult, ExportResult, FeedbackResult, ContextInjectionParams, ContextInjectionResult, MementoError, ConnectionError, AuthenticationError, ValidationError, NotFoundError, MementoClientEvents, PaginationParams, PaginatedResult, HealthCheck } from './types.js';
export type { ContextInjectionOptions } from './context-injector.js';
export * from './utils.js';
//# sourceMappingURL=index.d.ts.map