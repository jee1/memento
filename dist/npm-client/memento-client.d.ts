/**
 * MementoClient - Memento MCP Server와 통신하는 메인 클라이언트
 *
 * @example
 * ```typescript
 * import { MementoClient } from '@memento/client';
 *
 * const client = new MementoClient({
 *   serverUrl: 'http://localhost:8080',
 *   apiKey: 'your-api-key'
 * });
 *
 * await client.connect();
 *
 * const memory = await client.remember({
 *   content: 'React Hook에 대해 학습했다',
 *   type: 'episodic',
 *   importance: 0.8
 * });
 * ```
 */
import { EventEmitter } from 'events';
import type { MementoClientOptions, MemoryItem, CreateMemoryParams, UpdateMemoryParams, SearchFilters, SearchResult, HybridSearchParams, HybridSearchResult, RememberResult, PinResult, ForgetResult, LinkResult, ExportResult, FeedbackResult, ContextInjectionParams, ContextInjectionResult, HealthCheck } from './types.js';
export declare class MementoClient extends EventEmitter {
    private httpClient;
    private isConnected;
    private options;
    constructor(options?: MementoClientOptions);
    /**
     * HTTP 클라이언트 생성
     */
    private createHttpClient;
    /**
     * HTTP 에러를 MementoError로 변환
     */
    private handleHttpError;
    /**
     * 서버에 연결
     */
    connect(): Promise<void>;
    /**
     * 연결 해제
     */
    disconnect(): Promise<void>;
    /**
     * 연결 상태 확인
     */
    get connected(): boolean;
    /**
     * 서버 상태 확인
     */
    healthCheck(): Promise<HealthCheck>;
    /**
     * 기억 저장
     */
    remember(params: CreateMemoryParams): Promise<RememberResult>;
    /**
     * 기억 검색
     */
    recall(query: string, filters?: SearchFilters, limit?: number): Promise<SearchResult>;
    /**
     * 하이브리드 검색
     */
    hybridSearch(params: HybridSearchParams): Promise<HybridSearchResult>;
    /**
     * 기억 조회
     */
    getMemory(id: string): Promise<MemoryItem>;
    /**
     * 기억 업데이트
     */
    updateMemory(id: string, params: UpdateMemoryParams): Promise<MemoryItem>;
    /**
     * 기억 삭제
     */
    forget(memoryId: string, hard?: boolean): Promise<ForgetResult>;
    /**
     * 기억 고정
     */
    pin(memoryId: string): Promise<PinResult>;
    /**
     * 기억 고정 해제
     */
    unpin(memoryId: string): Promise<PinResult>;
    /**
     * 기억 간 관계 생성
     */
    link(sourceId: string, targetId: string, relationType: 'cause_of' | 'derived_from' | 'duplicates' | 'contradicts'): Promise<LinkResult>;
    /**
     * 기억 내보내기
     */
    export(format: 'json' | 'csv' | 'markdown', filters?: SearchFilters): Promise<ExportResult>;
    /**
     * 피드백 제공
     */
    feedback(memoryId: string, helpful: boolean, comment?: string, score?: number): Promise<FeedbackResult>;
    /**
     * 컨텍스트 주입
     */
    injectContext(params: ContextInjectionParams): Promise<ContextInjectionResult>;
    /**
     * 연결 상태 확인
     */
    private ensureConnected;
    /**
     * 클라이언트 설정 업데이트
     */
    updateOptions(newOptions: Partial<MementoClientOptions>): void;
    /**
     * 현재 설정 조회
     */
    getOptions(): Readonly<MementoClientOptions>;
}
//# sourceMappingURL=memento-client.d.ts.map