/**
 * 망각 정책 서비스
 * 망각 알고리즘과 간격 반복을 통합하여 메모리 관리
 */
export interface ForgettingPolicyConfig {
    forgetThreshold: number;
    softDeleteThreshold: number;
    hardDeleteThreshold: number;
    ttlSoft: {
        working: number;
        episodic: number;
        semantic: number;
        procedural: number;
    };
    ttlHard: {
        working: number;
        episodic: number;
        semantic: number;
        procedural: number;
    };
    reviewThreshold: number;
    maxInterval: number;
    minInterval: number;
}
export interface MemoryCleanupResult {
    softDeleted: string[];
    hardDeleted: string[];
    reviewed: string[];
    totalProcessed: number;
    summary: {
        forgetCandidates: number;
        reviewCandidates: number;
        actualSoftDeletes: number;
        actualHardDeletes: number;
        actualReviews: number;
    };
}
export declare class ForgettingPolicyService {
    private forgettingAlgorithm;
    private spacedRepetition;
    private config;
    constructor(config?: Partial<ForgettingPolicyConfig>);
    /**
     * 메모리 정리 실행 (망각 + 간격 반복)
     */
    executeMemoryCleanup(db: any): Promise<MemoryCleanupResult>;
    /**
     * 모든 메모리 가져오기
     */
    private getAllMemories;
    /**
     * 리뷰 후보 분석
     */
    private analyzeReviewCandidates;
    /**
     * 사용성 점수 계산
     */
    private calculateUsageScore;
    /**
     * 소프트 삭제 후보 확인
     */
    private isSoftDeleteCandidate;
    /**
     * 하드 삭제 후보 확인
     */
    private isHardDeleteCandidate;
    /**
     * 소프트 삭제 실행
     */
    private softDeleteMemory;
    /**
     * 하드 삭제 실행
     */
    private hardDeleteMemory;
    /**
     * 리뷰 스케줄 업데이트
     */
    private updateReviewSchedule;
    /**
     * 나이 계산 (일 단위)
     */
    private getAgeInDays;
    /**
     * 망각 통계 생성
     */
    generateForgettingStats(db: any): Promise<{
        totalMemories: number;
        forgetCandidates: number;
        reviewCandidates: number;
        averageForgetScore: number;
        memoryDistribution: Record<string, number>;
    }>;
}
//# sourceMappingURL=forgetting-policy-service.d.ts.map