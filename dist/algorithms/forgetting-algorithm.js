/**
 * 망각 알고리즘 구현
 * Memento-Goals.md의 망각 공식 구현
 */
export class ForgettingAlgorithm {
    weights;
    constructor(weights) {
        this.weights = {
            recency: 0.35, // U1: 최근성 가중치
            usage: 0.25, // U2: 사용성 가중치
            duplication: 0.20, // U3: 중복 가중치
            importance: 0.15, // U4: 중요도 가중치
            pinned: 0.30, // U5: 고정 가중치
            ...weights
        };
    }
    /**
     * 망각 점수 계산
     * F = U1 * (1 - recency) + U2 * (1 - usage) + U3 * dupRatio - U4 * importance - U5 * pinned
     */
    calculateForgetScore(features) {
        const { recency, usage, duplication_ratio, importance, pinned } = features;
        const recencyScore = this.weights.recency * (1 - recency);
        const usageScore = this.weights.usage * (1 - usage);
        const duplicationScore = this.weights.duplication * duplication_ratio;
        const importanceScore = this.weights.importance * importance;
        const pinnedScore = this.weights.pinned * (pinned ? 1 : 0);
        return recencyScore + usageScore + duplicationScore - importanceScore - pinnedScore;
    }
    /**
     * 망각 후보 선정
     */
    shouldForget(forgetScore, threshold = 0.6) {
        return forgetScore >= threshold;
    }
    /**
     * 망각 이유 생성
     */
    generateForgetReason(features, forgetScore) {
        const reasons = [];
        if (features.recency < 0.3) {
            reasons.push('오래된 기억');
        }
        if (features.usage < 0.2) {
            reasons.push('사용되지 않음');
        }
        if (features.duplication_ratio > 0.7) {
            reasons.push('중복도 높음');
        }
        if (features.importance < 0.3) {
            reasons.push('중요도 낮음');
        }
        if (!features.pinned) {
            reasons.push('고정되지 않음');
        }
        if (reasons.length === 0) {
            return `망각 점수 높음 (${forgetScore.toFixed(3)})`;
        }
        return reasons.join(', ');
    }
    /**
     * 메모리 특징 계산
     */
    calculateFeatures(memory, duplicates = 0, totalMemories = 1) {
        // 최근성 계산 (반감기 기반)
        const recency = this.calculateRecency(new Date(memory.created_at), memory.type);
        // 사용성 계산
        const usage = this.calculateUsage(memory.last_accessed ? new Date(memory.last_accessed) : undefined, memory.view_count || 0, memory.cite_count || 0, memory.edit_count || 0);
        // 중복 비율 계산
        const duplication_ratio = totalMemories > 0 ? duplicates / totalMemories : 0;
        // 중요도 (사용자 설정값)
        const importance = memory.importance;
        return {
            recency,
            usage,
            duplication_ratio,
            importance,
            pinned: memory.pinned
        };
    }
    /**
     * 최근성 계산 (반감기 기반)
     */
    calculateRecency(createdAt, type) {
        const ageDays = this.getAgeInDays(createdAt);
        const halfLife = this.getHalfLife(type);
        return Math.exp(-Math.log(2) * ageDays / halfLife);
    }
    /**
     * 사용성 계산
     */
    calculateUsage(lastAccessed, viewCount = 0, citeCount = 0, editCount = 0) {
        // 접근 빈도 기반 점수
        const accessScore = lastAccessed ? this.calculateAccessScore(lastAccessed) : 0;
        // 사용 빈도 기반 점수
        const usageScore = Math.log(1 + viewCount) +
            2 * Math.log(1 + citeCount) +
            0.5 * Math.log(1 + editCount);
        // 정규화 (0-1 범위)
        const normalizedUsage = Math.min(1, usageScore / 10); // 10은 경험적 최대값
        return Math.max(accessScore, normalizedUsage);
    }
    /**
     * 접근 점수 계산
     */
    calculateAccessScore(lastAccessed) {
        const daysSinceAccess = this.getAgeInDays(lastAccessed);
        // 30일 반감기
        return Math.exp(-daysSinceAccess / 30);
    }
    /**
     * 나이 계산 (일 단위)
     */
    getAgeInDays(date) {
        const now = new Date();
        const diffTime = now.getTime() - date.getTime();
        return diffTime / (1000 * 60 * 60 * 24);
    }
    /**
     * 타입별 반감기 (일 단위)
     */
    getHalfLife(type) {
        switch (type) {
            case 'working': return 2; // 2일
            case 'episodic': return 30; // 30일
            case 'semantic': return 180; // 180일
            case 'procedural': return 90; // 90일
            default: return 30;
        }
    }
    /**
     * 망각 후보들 분석
     */
    analyzeForgetCandidates(memories) {
        const results = [];
        const totalMemories = memories.length;
        // 중복 계산을 위한 간단한 구현
        const contentMap = new Map();
        memories.forEach(memory => {
            const key = memory.type; // 실제로는 내용 유사도로 계산해야 함
            contentMap.set(key, (contentMap.get(key) || 0) + 1);
        });
        for (const memory of memories) {
            const duplicates = (contentMap.get(memory.type) || 1) - 1;
            const features = this.calculateFeatures(memory, duplicates, totalMemories);
            const forgetScore = this.calculateForgetScore(features);
            const shouldForget = this.shouldForget(forgetScore);
            const reason = this.generateForgetReason(features, forgetScore);
            results.push({
                memory_id: memory.id,
                forget_score: forgetScore,
                should_forget: shouldForget,
                reason,
                features
            });
        }
        return results.sort((a, b) => b.forget_score - a.forget_score);
    }
}
//# sourceMappingURL=forgetting-algorithm.js.map