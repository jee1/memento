/**
 * 경량 하이브리드 임베딩 서비스
 * TF-IDF + 키워드 매칭 기반 벡터화
 * OpenAI가 없을 때 사용하는 fallback 솔루션
 */
export interface LightweightEmbeddingResult {
    embedding: number[];
    model: string;
    usage: {
        prompt_tokens: number;
        total_tokens: number;
    };
}
export interface LightweightSimilarityResult {
    id: string;
    content: string;
    similarity: number;
    score: number;
}
export declare class LightweightEmbeddingService {
    private readonly model;
    private readonly dimensions;
    private vocabulary;
    private documentFrequencies;
    private totalDocuments;
    private readonly stopWords;
    constructor();
    /**
     * 텍스트를 경량 임베딩으로 변환
     */
    generateEmbedding(text: string): Promise<LightweightEmbeddingResult | null>;
    /**
     * 쿼리와 유사한 임베딩 검색
     */
    searchSimilar(query: string, embeddings: Array<{
        id: string;
        content: string;
        embedding: number[];
    }>, limit?: number, threshold?: number): Promise<LightweightSimilarityResult[]>;
    /**
     * 텍스트 전처리
     */
    private preprocessText;
    /**
     * TF-IDF 벡터 생성
     */
    private createTFIDFVector;
    /**
     * IDF 계산 (간단한 휴리스틱)
     */
    private calculateIDF;
    /**
     * 키워드 가중치 적용
     */
    private applyKeywordWeights;
    /**
     * 기술 용어 판별
     */
    private isTechnicalTerm;
    /**
     * 벡터 정규화
     */
    private normalizeVector;
    /**
     * 차원 조정
     */
    private adjustDimensions;
    /**
     * 해시 기반 인덱스 생성
     */
    private hashToIndex;
    /**
     * 코사인 유사도 계산
     */
    private cosineSimilarity;
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
//# sourceMappingURL=lightweight-embedding-service.d.ts.map