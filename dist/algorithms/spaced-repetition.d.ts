/**
 * 간격 반복 알고리즘 구현
 * Memento-Goals.md의 간격 반복 공식 구현
 */
export interface SpacedRepetitionFeatures {
    importance: number;
    usage: number;
    helpful_feedback: number;
    bad_feedback: number;
}
export interface SpacedRepetitionWeights {
    importance: number;
    usage: number;
    helpful_feedback: number;
    bad_feedback: number;
}
export interface ReviewSchedule {
    memory_id: string;
    current_interval: number;
    next_review: Date;
    recall_probability: number;
    needs_review: boolean;
    multiplier: number;
}
export declare class SpacedRepetitionAlgorithm {
    private readonly weights;
    private readonly recallThreshold;
    constructor(weights?: Partial<SpacedRepetitionWeights>);
    /**
     * 다음 리뷰 간격 계산
     * interval = current_interval * (1 + A1*importance + A2*usage + A3*helpful - A4*bad)
     */
    calculateNextInterval(currentInterval: number, features: SpacedRepetitionFeatures): number;
    /**
     * 리콜 확률 계산
     * P = exp(-time_since_last_review / interval)
     */
    calculateRecallProbability(timeSinceLastReview: number, // 일 단위
    interval: number): number;
    /**
     * 리뷰 필요 여부 판단
     */
    needsReview(timeSinceLastReview: number, interval: number, threshold?: number): boolean;
    /**
     * 리뷰 스케줄 생성
     */
    createReviewSchedule(memoryId: string, currentInterval: number, lastReviewDate: Date, features: SpacedRepetitionFeatures): ReviewSchedule;
    /**
     * 배치 리뷰 스케줄 생성
     */
    createBatchReviewSchedules(memories: Array<{
        id: string;
        current_interval: number;
        last_review: Date;
        importance: number;
        usage: number;
        helpful_feedback: number;
        bad_feedback: number;
    }>): ReviewSchedule[];
    /**
     * 리뷰 우선순위 계산
     */
    calculateReviewPriority(schedule: ReviewSchedule): number;
    /**
     * 리뷰 성과 분석
     */
    analyzeReviewPerformance(schedules: ReviewSchedule[], actualRecall: Map<string, boolean>): {
        totalMemories: number;
        reviewedMemories: number;
        averageRecallRate: number;
        performanceByInterval: Map<number, number>;
    };
    /**
     * 최적 간격 추천
     */
    recommendOptimalInterval(currentInterval: number, recallHistory: boolean[], // 최근 리콜 성공/실패 기록
    features: SpacedRepetitionFeatures): number;
    /**
     * 일수 계산
     */
    private getDaysSince;
}
//# sourceMappingURL=spaced-repetition.d.ts.map