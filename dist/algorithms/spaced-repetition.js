/**
 * 간격 반복 알고리즘 구현
 * Memento-Goals.md의 간격 반복 공식 구현
 */
export class SpacedRepetitionAlgorithm {
    weights;
    recallThreshold = 0.7; // 리콜 임계값
    constructor(weights) {
        this.weights = {
            importance: 0.6, // A1: 중요도 가중치
            usage: 0.4, // A2: 사용성 가중치
            helpful_feedback: 0.5, // A3: 도움됨 피드백 가중치
            bad_feedback: 0.7, // A4: 나쁨 피드백 가중치
            ...weights
        };
    }
    /**
     * 다음 리뷰 간격 계산
     * interval = current_interval * (1 + A1*importance + A2*usage + A3*helpful - A4*bad)
     */
    calculateNextInterval(currentInterval, features) {
        const { importance, usage, helpful_feedback, bad_feedback } = features;
        const multiplier = 1 +
            this.weights.importance * importance +
            this.weights.usage * usage +
            this.weights.helpful_feedback * helpful_feedback -
            this.weights.bad_feedback * bad_feedback;
        return Math.ceil(currentInterval * multiplier);
    }
    /**
     * 리콜 확률 계산
     * P = exp(-time_since_last_review / interval)
     */
    calculateRecallProbability(timeSinceLastReview, // 일 단위
    interval) {
        return Math.exp(-timeSinceLastReview / interval);
    }
    /**
     * 리뷰 필요 여부 판단
     */
    needsReview(timeSinceLastReview, interval, threshold = this.recallThreshold) {
        const recallProb = this.calculateRecallProbability(timeSinceLastReview, interval);
        return recallProb <= threshold;
    }
    /**
     * 리뷰 스케줄 생성
     */
    createReviewSchedule(memoryId, currentInterval, lastReviewDate, features) {
        const nextInterval = this.calculateNextInterval(currentInterval, features);
        const nextReview = new Date(lastReviewDate.getTime() + nextInterval * 24 * 60 * 60 * 1000);
        const timeSinceLastReview = this.getDaysSince(lastReviewDate);
        const recallProb = this.calculateRecallProbability(timeSinceLastReview, nextInterval);
        const needsReview = this.needsReview(timeSinceLastReview, nextInterval);
        return {
            memory_id: memoryId,
            current_interval: nextInterval,
            next_review: nextReview,
            recall_probability: recallProb,
            needs_review: needsReview,
            multiplier: nextInterval / currentInterval
        };
    }
    /**
     * 배치 리뷰 스케줄 생성
     */
    createBatchReviewSchedules(memories) {
        return memories.map(memory => {
            const features = {
                importance: memory.importance,
                usage: memory.usage,
                helpful_feedback: memory.helpful_feedback,
                bad_feedback: memory.bad_feedback
            };
            return this.createReviewSchedule(memory.id, memory.current_interval, memory.last_review, features);
        });
    }
    /**
     * 리뷰 우선순위 계산
     */
    calculateReviewPriority(schedule) {
        // 리콜 확률이 낮을수록, 간격이 길수록 우선순위 높음
        const urgencyScore = 1 - schedule.recall_probability;
        const intervalScore = Math.log(schedule.current_interval + 1) / 10; // 정규화
        return urgencyScore + intervalScore;
    }
    /**
     * 리뷰 성과 분석
     */
    analyzeReviewPerformance(schedules, actualRecall // memory_id -> recall_success
    ) {
        const totalMemories = schedules.length;
        const reviewedMemories = schedules.filter(s => s.needs_review).length;
        let totalRecallRate = 0;
        let recallCount = 0;
        const performanceByInterval = new Map();
        for (const schedule of schedules) {
            if (actualRecall.has(schedule.memory_id)) {
                const recalled = actualRecall.get(schedule.memory_id);
                totalRecallRate += recalled ? 1 : 0;
                recallCount++;
                const interval = Math.floor(schedule.current_interval / 7) * 7; // 주 단위로 그룹화
                const current = performanceByInterval.get(interval) || { total: 0, successful: 0 };
                current.total++;
                if (recalled)
                    current.successful++;
                performanceByInterval.set(interval, current);
            }
        }
        const averageRecallRate = recallCount > 0 ? totalRecallRate / recallCount : 0;
        // 간격별 성과 계산
        const performanceByIntervalRate = new Map();
        for (const [interval, stats] of performanceByInterval) {
            performanceByIntervalRate.set(interval, stats.successful / stats.total);
        }
        return {
            totalMemories,
            reviewedMemories,
            averageRecallRate,
            performanceByInterval: performanceByIntervalRate
        };
    }
    /**
     * 최적 간격 추천
     */
    recommendOptimalInterval(currentInterval, recallHistory, // 최근 리콜 성공/실패 기록
    features) {
        if (recallHistory.length === 0) {
            return currentInterval;
        }
        // 최근 성과 기반 조정
        const recentPerformance = recallHistory.slice(-5); // 최근 5회
        const successRate = recentPerformance.filter(success => success).length / recentPerformance.length;
        // 성과에 따른 조정 계수
        let adjustmentFactor = 1.0;
        if (successRate > 0.8) {
            adjustmentFactor = 1.2; // 성과 좋으면 간격 늘림
        }
        else if (successRate < 0.6) {
            adjustmentFactor = 0.8; // 성과 나쁘면 간격 줄임
        }
        const baseInterval = this.calculateNextInterval(currentInterval, features);
        return Math.ceil(baseInterval * adjustmentFactor);
    }
    /**
     * 일수 계산
     */
    getDaysSince(date) {
        const now = new Date();
        const diffTime = now.getTime() - date.getTime();
        return diffTime / (1000 * 60 * 60 * 24);
    }
}
//# sourceMappingURL=spaced-repetition.js.map