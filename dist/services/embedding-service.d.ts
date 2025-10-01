/**
 * 통합 임베딩 서비스
 * OpenAI, Gemini, 경량 하이브리드 서비스 중 선택하여 사용
 * 설정에 따라 자동으로 적절한 제공자 선택
 */
export interface EmbeddingResult {
    embedding: number[];
    model: string;
    usage: {
        prompt_tokens: number;
        total_tokens: number;
    };
}
export interface SimilarityResult {
    id: string;
    content: string;
    similarity: number;
    score: number;
}
export declare class EmbeddingService {
    private openai;
    private geminiService;
    private lightweightService;
    private readonly model;
    private readonly maxTokens;
    private embeddingCache;
    private batchQueue;
    private batchTimeout;
    constructor();
    /**
     * OpenAI 클라이언트 초기화
     */
    private initializeOpenAI;
    /**
     * 텍스트를 임베딩으로 변환 - 캐시 최적화
     */
    generateEmbedding(text: string): Promise<EmbeddingResult | null>;
    /**
     * OpenAI 임베딩 생성
     */
    private generateOpenAIEmbedding;
    /**
     * Gemini 임베딩 생성
     */
    private generateGeminiEmbedding;
    /**
     * 경량 임베딩 생성
     */
    private generateLightweightEmbedding;
    /**
     * 쿼리와 유사한 임베딩 검색
     */
    searchSimilar(query: string, embeddings: Array<{
        id: string;
        content: string;
        embedding: number[];
    }>, limit?: number, threshold?: number): Promise<SimilarityResult[]>;
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
//# sourceMappingURL=embedding-service.d.ts.map