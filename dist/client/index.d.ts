/**
 * Memento MCP Client
 * MCP 서버와 통신하는 클라이언트 라이브러리
 */
import type { RememberParams, RecallParams, ForgetParams, PinParams, UnpinParams, MemorySearchResult } from '../types/index.js';
export declare class MementoClient {
    private client;
    private connected;
    constructor();
    /**
     * MCP 서버에 연결
     */
    connect(): Promise<void>;
    /**
     * 연결 해제
     */
    disconnect(): Promise<void>;
    /**
     * 기억 저장
     */
    remember(params: RememberParams): Promise<string>;
    /**
     * 기억 검색
     */
    recall(params: RecallParams): Promise<MemorySearchResult[]>;
    /**
     * 기억 삭제
     */
    forget(params: ForgetParams): Promise<string>;
    /**
     * 기억 고정
     */
    pin(params: PinParams): Promise<string>;
    /**
     * 기억 고정 해제
     */
    unpin(params: UnpinParams): Promise<string>;
    /**
     * 연결 상태 확인
     */
    private ensureConnected;
    /**
     * 연결 상태 반환
     */
    isConnected(): boolean;
    /**
     * 일반적인 도구 호출
     */
    callTool(name: string, args?: Record<string, any>): Promise<any>;
}
/**
 * 간편한 사용을 위한 팩토리 함수
 */
export declare function createMementoClient(): MementoClient;
//# sourceMappingURL=index.d.ts.map