/**
 * Google Gemini API를 사용한 임베딩 서비스
 * 텍스트를 벡터로 변환하고 유사도 검색 제공
 * OpenAI와 동일한 인터페이스를 제공하여 교체 가능
 */
export interface GeminiEmbeddingResult {
    embedding: number[];
    model: string;
    usage: {
        prompt_tokens: number;
        total_tokens: number;
    };
}
export interface GeminiSimilarityResult {
    id: string;
    content: string;
    similarity: number;
    score: number;
}
export declare class GeminiEmbeddingService {
    private genAI;
    private lightweightService;
    private readonly model;
    private readonly maxTokens;
    private embeddingCache;
    private batchQueue;
    private batchTimeout;
    constructor();
    /**
     * Gemini 클라이언트 초기화
     */
    private initializeGemini;
    /**
     * 텍스트를 임베딩으로 변환 - 캐시 최적화
     */
    generateEmbedding(text: string): Promise<GeminiEmbeddingResult | null>;
    /**
     * 쿼리와 유사한 임베딩 검색
     */
    searchSimilar(query: string, embeddings: Array<{
        id: string;
        content: string;
        embedding: number[];
    }>, limit?: number, threshold?: number): Promise<GeminiSimilarityResult[]>;
    /**
     * 코사인 유사도 계산
     */
    private cosineSimilarity;
    /**
     * 캐시 키 생성
     */
    private generateCacheKey;
    /**
     * 텍스트 해시 생성
     */
    private hashText;
    /**
     * 캐시 정리
     */
    private cleanupCache;
    /**
     * 텍스트를 토큰 제한에 맞게 자르기
     */
    private truncateText;
    /**
     * 토큰 수 추정
     */
    private estimateTokens;
    /**
     * 서비스 사용 가능 여부 확인
     */
    isAvailable(): boolean;
    /**
     * 모델 정보 반환
     */
    getModelInfo(): {
        model: string;
        dimensions: number;
        maxTokens: number;
    };
}
//# sourceMappingURL=gemini-embedding-service.d.ts.map