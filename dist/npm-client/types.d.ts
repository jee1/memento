/**
 * @memento/client 타입 정의
 * Memento MCP Server와 통신하기 위한 클라이언트 라이브러리 타입들
 */
export type MemoryType = 'working' | 'episodic' | 'semantic' | 'procedural';
export type PrivacyScope = 'private' | 'team' | 'public';
export interface MementoClientOptions {
    /** MCP 서버 URL (기본값: http://localhost:8080) */
    serverUrl?: string;
    /** API 키 (M2+에서 사용) */
    apiKey?: string;
    /** 연결 타임아웃 (밀리초, 기본값: 10000) */
    timeout?: number;
    /** 재시도 횟수 (기본값: 3) */
    retryCount?: number;
    /** 로그 레벨 */
    logLevel?: 'debug' | 'info' | 'warn' | 'error' | 'silent';
}
export interface MemoryItem {
    id: string;
    content: string;
    type: MemoryType;
    importance: number;
    created_at: string;
    last_accessed?: string;
    pinned: boolean;
    source?: string;
    tags?: string[];
    privacy_scope: PrivacyScope;
    project_id?: string;
    user_id?: string;
    metadata?: Record<string, any>;
}
export interface CreateMemoryParams {
    content: string;
    type?: MemoryType;
    tags?: string[];
    importance?: number;
    source?: string;
    privacy_scope?: PrivacyScope;
    project_id?: string;
    metadata?: Record<string, any>;
}
export interface UpdateMemoryParams {
    content?: string;
    type?: MemoryType;
    tags?: string[];
    importance?: number;
    source?: string;
    privacy_scope?: PrivacyScope;
    project_id?: string;
    metadata?: Record<string, any>;
}
export interface SearchFilters {
    id?: string[];
    type?: MemoryType[];
    tags?: string[];
    project_id?: string;
    time_from?: string;
    time_to?: string;
    pinned?: boolean;
}
export interface SearchResult {
    items: MemorySearchResult[];
    total_count: number;
    query_time: number;
    search_type?: string;
    vector_search_available?: boolean;
}
export interface MemorySearchResult {
    id: string;
    content: string;
    type: MemoryType;
    importance: number;
    created_at: string;
    last_accessed?: string;
    pinned: boolean;
    tags?: string[];
    privacy_scope: PrivacyScope;
    score: number;
    recall_reason: string;
}
export interface HybridSearchParams {
    query: string;
    filters?: SearchFilters;
    limit?: number;
    vectorWeight?: number;
    textWeight?: number;
}
export interface HybridSearchResult {
    items: HybridSearchItem[];
    total_count: number;
    query_time: number;
    search_type: 'hybrid';
}
export interface HybridSearchItem {
    id: string;
    content: string;
    type: MemoryType;
    importance: number;
    created_at: string;
    last_accessed?: string;
    pinned: boolean;
    tags?: string[];
    privacy_scope: PrivacyScope;
    textScore: number;
    vectorScore: number;
    finalScore: number;
    score: number;
    recall_reason: string;
}
export interface RememberResult {
    memory_id: string;
    created_at: string;
    type: string;
    importance: number;
}
export interface PinResult {
    success: boolean;
    memory_id: string;
    pinned: boolean;
}
export interface ForgetResult {
    success: boolean;
    memory_id: string;
    deleted_at: string;
}
export interface LinkResult {
    success: boolean;
    link_id: string;
    source_id: string;
    target_id: string;
    relation_type: string;
    created_at: string;
}
export interface ExportResult {
    success: boolean;
    format: string;
    data: string;
    count: number;
    exported_at: string;
}
export interface FeedbackResult {
    success: boolean;
    memory_id: string;
    feedback_id: string;
    helpful: boolean;
    created_at: string;
}
export interface ContextInjectionParams {
    query: string;
    token_budget?: number;
    context_type?: 'conversation' | 'task' | 'general';
}
export interface ContextInjectionResult {
    role: 'system';
    content: string;
    metadata: {
        memories_used: number;
        token_count: number;
        search_time: number;
    };
}
export declare class MementoError extends Error {
    code: string;
    statusCode?: number | undefined;
    details?: any | undefined;
    constructor(message: string, code: string, statusCode?: number | undefined, details?: any | undefined);
}
export declare class ConnectionError extends MementoError {
    constructor(message: string, details?: any);
}
export declare class AuthenticationError extends MementoError {
    constructor(message: string, details?: any);
}
export declare class ValidationError extends MementoError {
    constructor(message: string, details?: any);
}
export declare class NotFoundError extends MementoError {
    constructor(message: string, details?: any);
}
export interface MementoClientEvents {
    'connected': () => void;
    'disconnected': () => void;
    'error': (error: MementoError) => void;
    'memory:created': (memory: MemoryItem) => void;
    'memory:updated': (memory: MemoryItem) => void;
    'memory:deleted': (memoryId: string) => void;
    'memory:pinned': (memoryId: string) => void;
    'memory:unpinned': (memoryId: string) => void;
}
export interface PaginationParams {
    limit?: number;
    offset?: number;
    cursor?: string;
}
export interface PaginatedResult<T> {
    items: T[];
    total_count: number;
    has_more: boolean;
    next_cursor?: string;
}
export interface HealthCheck {
    status: 'healthy' | 'unhealthy';
    version: string;
    uptime: number;
    database: {
        status: 'connected' | 'disconnected';
        latency?: number;
    };
    search: {
        status: 'available' | 'unavailable';
        embedding_available: boolean;
    };
}
//# sourceMappingURL=types.d.ts.map