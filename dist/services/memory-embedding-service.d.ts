/**
 * 메모리 임베딩 저장 및 검색 서비스
 * 데이터베이스와 임베딩 서비스를 연동
 */
import { type EmbeddingResult } from './embedding-service.js';
import type { MemoryType } from '../types/index.js';
export interface MemoryEmbedding {
    memory_id: string;
    embedding: number[];
    created_at: string;
}
export interface VectorSearchResult {
    id: string;
    content: string;
    type: string;
    importance: number;
    created_at: string;
    last_accessed?: string;
    pinned: boolean;
    tags?: string[];
    similarity: number;
    score: number;
}
export declare class MemoryEmbeddingService {
    private embeddingService;
    constructor();
    /**
     * 메모리에 임베딩 생성 및 저장
     */
    createAndStoreEmbedding(db: any, memoryId: string, content: string, type: MemoryType): Promise<EmbeddingResult | null>;
    /**
     * 벡터 유사도 검색
     */
    searchBySimilarity(db: any, query: string, filters?: {
        type?: MemoryType[];
        limit?: number;
        threshold?: number;
    }): Promise<VectorSearchResult[]>;
    /**
     * 모든 임베딩 가져오기
     */
    private getAllEmbeddings;
    /**
     * 메모리 ID로 메모리 정보 가져오기
     */
    private getMemoryById;
    /**
     * 임베딩 삭제
     */
    deleteEmbedding(db: any, memoryId: string): Promise<void>;
    /**
     * 임베딩 서비스 사용 가능 여부 확인
     */
    isAvailable(): boolean;
    /**
     * 임베딩 통계 정보
     */
    getEmbeddingStats(db: any): Promise<{
        totalEmbeddings: number;
        averageDimensions: number;
        model: string;
    }>;
}
//# sourceMappingURL=memory-embedding-service.d.ts.map