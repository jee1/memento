/**
 * 망각 알고리즘 구현
 * Memento-Goals.md의 망각 공식 구현
 */
export interface ForgettingFeatures {
    recency: number;
    usage: number;
    duplication_ratio: number;
    importance: number;
    pinned: boolean;
}
export interface ForgettingWeights {
    recency: number;
    usage: number;
    duplication: number;
    importance: number;
    pinned: number;
}
export interface ForgettingResult {
    memory_id: string;
    forget_score: number;
    should_forget: boolean;
    reason: string;
    features: ForgettingFeatures;
}
export declare class ForgettingAlgorithm {
    private readonly weights;
    constructor(weights?: Partial<ForgettingWeights>);
    /**
     * 망각 점수 계산
     * F = U1 * (1 - recency) + U2 * (1 - usage) + U3 * dupRatio - U4 * importance - U5 * pinned
     */
    calculateForgetScore(features: ForgettingFeatures): number;
    /**
     * 망각 후보 선정
     */
    shouldForget(forgetScore: number, threshold?: number): boolean;
    /**
     * 망각 이유 생성
     */
    generateForgetReason(features: ForgettingFeatures, forgetScore: number): string;
    /**
     * 메모리 특징 계산
     */
    calculateFeatures(memory: {
        created_at: string;
        last_accessed?: string;
        importance: number;
        pinned: boolean;
        type: string;
        view_count?: number;
        cite_count?: number;
        edit_count?: number;
    }, duplicates?: number, totalMemories?: number): ForgettingFeatures;
    /**
     * 최근성 계산 (반감기 기반)
     */
    private calculateRecency;
    /**
     * 사용성 계산
     */
    private calculateUsage;
    /**
     * 접근 점수 계산
     */
    private calculateAccessScore;
    /**
     * 나이 계산 (일 단위)
     */
    private getAgeInDays;
    /**
     * 타입별 반감기 (일 단위)
     */
    private getHalfLife;
    /**
     * 망각 후보들 분석
     */
    analyzeForgetCandidates(memories: Array<{
        id: string;
        created_at: string;
        last_accessed?: string;
        importance: number;
        pinned: boolean;
        type: string;
        view_count?: number;
        cite_count?: number;
        edit_count?: number;
    }>): ForgettingResult[];
}
//# sourceMappingURL=forgetting-algorithm.d.ts.map