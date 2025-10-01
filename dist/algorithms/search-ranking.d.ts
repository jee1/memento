/**
 * 검색 랭킹 알고리즘 구현
 * Memento-Goals.md의 검색 랭킹 공식 구현
 */
export interface SearchFeatures {
    relevance: number;
    recency: number;
    importance: number;
    usage: number;
    duplication_penalty: number;
}
export interface EmbeddingSimilarity {
    queryEmbedding: number[];
    docEmbedding: number[];
}
export interface BM25Result {
    score: number;
    normalizedScore: number;
}
export interface UsageMetrics {
    viewCount: number;
    citeCount: number;
    editCount: number;
    lastAccessed?: Date | undefined;
}
export interface RelevanceInput {
    query: string;
    content: string;
    title?: string;
    tags: string[];
    embeddingSimilarity?: EmbeddingSimilarity | undefined;
    bm25Result?: BM25Result | undefined;
}
export interface SearchRankingWeights {
    relevance: number;
    recency: number;
    importance: number;
    usage: number;
    duplication_penalty: number;
}
export declare class SearchRanking {
    private readonly weights;
    constructor(weights?: Partial<SearchRankingWeights>);
    /**
     * 최종 검색 점수 계산
     * S = α * relevance + β * recency + γ * importance + δ * usage - ε * duplication_penalty
     */
    calculateFinalScore(features: SearchFeatures): number;
    /**
     * 관련성 점수 계산 (실제 구현)
     * 임베딩 유사도(60%) + BM25(30%) + 태그 매칭(5%) + 타이틀 히트(5%)
     */
    calculateRelevance(input: RelevanceInput): number;
    /**
     * 임베딩 유사도 계산 (코사인 유사도)
     */
    private calculateEmbeddingSimilarity;
    /**
     * BM25 점수 정규화
     */
    private normalizeBM25;
    /**
     * 간단한 BM25 구현 (실제 BM25가 없는 경우)
     */
    private calculateSimpleBM25;
    /**
     * 태그 매칭 (자카드 유사도)
     */
    private calculateTagMatch;
    /**
     * 타이틀 히트 계산
     */
    private calculateTitleHit;
    /**
     * N-gram 매치 확인
     */
    private hasNgramMatch;
    /**
     * N-gram 생성
     */
    private generateNgrams;
    /**
     * 벡터 내적 계산
     */
    private dotProduct;
    /**
     * 벡터 크기 계산
     */
    private magnitude;
    /**
     * 최근성 점수 계산
     * 반감기 기반 지수 감쇠
     */
    calculateRecency(createdAt: Date, type: string): number;
    /**
     * 중요도 점수 계산
     */
    calculateImportance(userImportance: number, isPinned: boolean, type: string): number;
    /**
     * 사용성 점수 계산 (실제 구현)
     * viewCount + citeCount(2배) + editCount(0.5배) 로그 스케일 집계
     */
    calculateUsage(metrics: UsageMetrics, batchMin?: number, batchMax?: number): number;
    /**
     * 배치 사용성 점수 계산 (여러 메모리에 대해)
     */
    calculateBatchUsage(metricsList: UsageMetrics[]): {
        normalized: number[];
        min: number;
        max: number;
    };
    /**
     * 정규화 함수
     */
    private normalize;
    /**
     * 중복 패널티 계산 (MMR 구현)
     */
    calculateDuplicationPenalty(candidateContent: string, selectedContents: string[]): number;
    /**
     * 텍스트 유사도 계산 (자카드 유사도)
     */
    private calculateTextSimilarity;
    /**
     * 하위 호환성을 위한 간단한 관련성 계산 (기존 API)
     */
    calculateRelevanceSimple(query: string, content: string, tags?: string[]): number;
    /**
     * 하위 호환성을 위한 간단한 사용성 계산 (기존 API)
     */
    calculateUsageSimple(lastAccessed?: Date): number;
    /**
     * 나이 계산 (일 단위)
     */
    private getAgeInDays;
    /**
     * 타입별 반감기 (일 단위)
     */
    private getHalfLife;
    /**
     * 타입별 부스트 점수
     */
    private getTypeBoost;
}
//# sourceMappingURL=search-ranking.d.ts.map