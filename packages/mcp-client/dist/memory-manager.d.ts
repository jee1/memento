/**
 * MemoryManager - 기억 관리를 위한 고수준 API
 * MementoClient를 래핑하여 더 편리한 기억 관리 기능을 제공합니다.
 *
 * @example
 * ```typescript
 * import { MemoryManager } from '@memento/client';
 *
 * const manager = new MemoryManager(client);
 *
 * // 기억 저장
 * const memory = await manager.create({
 *   content: 'React Hook 학습',
 *   type: 'episodic',
 *   tags: ['react', 'frontend']
 * });
 *
 * // 기억 검색
 * const results = await manager.search('React Hook');
 * ```
 */
import { MementoClient } from './memento-client.js';
import type { MemoryItem, CreateMemoryParams, UpdateMemoryParams, SearchFilters, SearchResult, MemoryType, PrivacyScope } from './types.js';
export declare class MemoryManager {
    private client;
    constructor(client: MementoClient);
    /**
     * 기억 생성
     */
    create(params: CreateMemoryParams): Promise<MemoryItem>;
    /**
     * 기억 조회
     */
    get(id: string): Promise<MemoryItem | null>;
    /**
     * 기억 업데이트
     */
    update(id: string, params: UpdateMemoryParams): Promise<MemoryItem>;
    /**
     * 기억 삭제
     */
    delete(id: string, hard?: boolean): Promise<boolean>;
    /**
     * 기억 검색
     */
    search(query: string, options?: {
        filters?: SearchFilters;
        limit?: number;
        useHybrid?: boolean;
    }): Promise<SearchResult>;
    /**
     * 태그로 기억 검색
     */
    searchByTags(tags: string[], limit?: number): Promise<SearchResult>;
    /**
     * 타입별 기억 검색
     */
    searchByType(type: MemoryType, limit?: number): Promise<SearchResult>;
    /**
     * 프로젝트별 기억 검색
     */
    searchByProject(projectId: string, limit?: number): Promise<SearchResult>;
    /**
     * 최근 기억 검색
     */
    searchRecent(days?: number, limit?: number): Promise<SearchResult>;
    /**
     * 고정된 기억 검색
     */
    searchPinned(limit?: number): Promise<SearchResult>;
    /**
     * 의미적 유사 기억 검색
     */
    findSimilar(memoryId: string, limit?: number): Promise<SearchResult>;
    /**
     * 관련 기억 검색 (태그 기반)
     */
    findRelated(memoryId: string, limit?: number): Promise<SearchResult>;
    /**
     * 기억 고정
     */
    pin(id: string): Promise<boolean>;
    /**
     * 기억 고정 해제
     */
    unpin(id: string): Promise<boolean>;
    /**
     * 기억 중요도 설정
     */
    setImportance(id: string, importance: number): Promise<MemoryItem>;
    /**
     * 기억 태그 추가
     */
    addTags(id: string, tags: string[]): Promise<MemoryItem>;
    /**
     * 기억 태그 제거
     */
    removeTags(id: string, tags: string[]): Promise<MemoryItem>;
    /**
     * 기억 태그 업데이트
     */
    setTags(id: string, tags: string[]): Promise<MemoryItem>;
    /**
     * 기억 공개 범위 설정
     */
    setPrivacyScope(id: string, privacyScope: PrivacyScope): Promise<MemoryItem>;
    /**
     * 여러 기억 일괄 생성
     */
    createBatch(params: CreateMemoryParams[]): Promise<MemoryItem[]>;
    /**
     * 여러 기억 일괄 삭제
     */
    deleteBatch(ids: string[], hard?: boolean): Promise<number>;
    /**
     * 여러 기억 일괄 고정/해제
     */
    pinBatch(ids: string[], pin?: boolean): Promise<number>;
    /**
     * 기억 통계 조회
     */
    getStats(): Promise<{
        total: number;
        byType: Record<MemoryType, number>;
        byPrivacyScope: Record<PrivacyScope, number>;
        pinned: number;
        recent: number;
    }>;
    /**
     * 인기 태그 조회
     */
    getPopularTags(limit?: number): Promise<Array<{
        tag: string;
        count: number;
    }>>;
}
//# sourceMappingURL=memory-manager.d.ts.map