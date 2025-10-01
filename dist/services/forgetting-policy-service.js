/**
 * 망각 정책 서비스
 * 망각 알고리즘과 간격 반복을 통합하여 메모리 관리
 */
import { ForgettingAlgorithm } from '../algorithms/forgetting-algorithm.js';
import { SpacedRepetitionAlgorithm } from '../algorithms/spaced-repetition.js';
import { DatabaseUtils } from '../utils/database.js';
export class ForgettingPolicyService {
    forgettingAlgorithm;
    spacedRepetition;
    config;
    constructor(config) {
        this.forgettingAlgorithm = new ForgettingAlgorithm();
        this.spacedRepetition = new SpacedRepetitionAlgorithm();
        this.config = {
            forgetThreshold: 0.6,
            softDeleteThreshold: 0.6,
            hardDeleteThreshold: 0.8,
            ttlSoft: {
                working: 2,
                episodic: 30,
                semantic: 180,
                procedural: 90
            },
            ttlHard: {
                working: 7,
                episodic: 180,
                semantic: 365,
                procedural: 180
            },
            reviewThreshold: 0.7,
            maxInterval: 365,
            minInterval: 1,
            ...config
        };
    }
    /**
     * 메모리 정리 실행 (망각 + 간격 반복)
     */
    async executeMemoryCleanup(db) {
        const result = {
            softDeleted: [],
            hardDeleted: [],
            reviewed: [],
            totalProcessed: 0,
            summary: {
                forgetCandidates: 0,
                reviewCandidates: 0,
                actualSoftDeletes: 0,
                actualHardDeletes: 0,
                actualReviews: 0
            }
        };
        try {
            // 1. 모든 메모리 가져오기
            const memories = await this.getAllMemories(db);
            result.totalProcessed = memories.length;
            // 2. 망각 후보 분석
            const forgetResults = this.forgettingAlgorithm.analyzeForgetCandidates(memories);
            result.summary.forgetCandidates = forgetResults.filter(r => r.should_forget).length;
            // 3. 간격 반복 후보 분석
            const reviewSchedules = await this.analyzeReviewCandidates(db, memories);
            result.summary.reviewCandidates = reviewSchedules.filter(s => s.needs_review).length;
            // 4. 소프트 삭제 실행
            const softDeleteCandidates = forgetResults.filter(r => r.should_forget &&
                r.forget_score >= this.config.softDeleteThreshold &&
                !r.features.pinned);
            for (const candidate of softDeleteCandidates) {
                const memory = memories.find(m => m.id === candidate.memory_id);
                if (memory && this.isSoftDeleteCandidate(memory, candidate.forget_score)) {
                    await this.softDeleteMemory(db, candidate.memory_id);
                    result.softDeleted.push(candidate.memory_id);
                    result.summary.actualSoftDeletes++;
                }
            }
            // 5. 하드 삭제 실행
            const hardDeleteCandidates = forgetResults.filter(r => r.should_forget &&
                r.forget_score >= this.config.hardDeleteThreshold &&
                !r.features.pinned);
            for (const candidate of hardDeleteCandidates) {
                const memory = memories.find(m => m.id === candidate.memory_id);
                if (memory && this.isHardDeleteCandidate(memory, candidate.forget_score)) {
                    await this.hardDeleteMemory(db, candidate.memory_id);
                    result.hardDeleted.push(candidate.memory_id);
                    result.summary.actualHardDeletes++;
                }
            }
            // 6. 리뷰 스케줄 업데이트
            const reviewCandidates = reviewSchedules.filter(s => s.needs_review);
            for (const schedule of reviewCandidates) {
                await this.updateReviewSchedule(db, schedule);
                result.reviewed.push(schedule.memory_id);
                result.summary.actualReviews++;
            }
            return result;
        }
        catch (error) {
            console.error('❌ 메모리 정리 실행 실패:', error);
            throw error;
        }
    }
    /**
     * 모든 메모리 가져오기
     */
    async getAllMemories(db) {
        const rows = await DatabaseUtils.all(db, `
      SELECT 
        id, created_at, last_accessed, importance, pinned, type,
        COALESCE(view_count, 0) as view_count,
        COALESCE(cite_count, 0) as cite_count,
        COALESCE(edit_count, 0) as edit_count
      FROM memory_item
      WHERE pinned = FALSE
      ORDER BY created_at DESC
    `);
        return rows.map((row) => ({
            id: row.id,
            created_at: row.created_at,
            last_accessed: row.last_accessed,
            importance: row.importance,
            pinned: row.pinned,
            type: row.type,
            view_count: row.view_count,
            cite_count: row.cite_count,
            edit_count: row.edit_count
        }));
    }
    /**
     * 리뷰 후보 분석
     */
    async analyzeReviewCandidates(db, memories) {
        const schedules = [];
        for (const memory of memories) {
            // 간격 반복 테이블에서 정보 가져오기 (실제로는 별도 테이블 필요)
            const features = {
                importance: memory.importance,
                usage: this.calculateUsageScore(memory),
                helpful_feedback: 0.5, // 기본값
                bad_feedback: 0.1 // 기본값
            };
            const currentInterval = 7; // 기본 간격
            const lastReview = memory.last_accessed ? new Date(memory.last_accessed) : new Date(memory.created_at);
            const schedule = this.spacedRepetition.createReviewSchedule(memory.id, currentInterval, lastReview, features);
            schedules.push(schedule);
        }
        return schedules;
    }
    /**
     * 사용성 점수 계산
     */
    calculateUsageScore(memory) {
        const viewScore = Math.log(1 + (memory.view_count || 0));
        const citeScore = 2 * Math.log(1 + (memory.cite_count || 0));
        const editScore = 0.5 * Math.log(1 + (memory.edit_count || 0));
        return Math.min(1, (viewScore + citeScore + editScore) / 10);
    }
    /**
     * 소프트 삭제 후보 확인
     */
    isSoftDeleteCandidate(memory, forgetScore) {
        const ageDays = this.getAgeInDays(new Date(memory.created_at));
        const ttl = this.config.ttlSoft[memory.type];
        return forgetScore >= this.config.softDeleteThreshold &&
            ageDays >= ttl &&
            !memory.pinned;
    }
    /**
     * 하드 삭제 후보 확인
     */
    isHardDeleteCandidate(memory, forgetScore) {
        const ageDays = this.getAgeInDays(new Date(memory.created_at));
        const ttl = this.config.ttlHard[memory.type];
        return forgetScore >= this.config.hardDeleteThreshold &&
            ageDays >= ttl &&
            !memory.pinned;
    }
    /**
     * 소프트 삭제 실행
     */
    async softDeleteMemory(db, memoryId) {
        await DatabaseUtils.run(db, `
      UPDATE memory_item 
      SET pinned = FALSE, last_accessed = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [memoryId]);
    }
    /**
     * 하드 삭제 실행
     */
    async hardDeleteMemory(db, memoryId) {
        await DatabaseUtils.run(db, 'DELETE FROM memory_item WHERE id = ?', [memoryId]);
    }
    /**
     * 리뷰 스케줄 업데이트
     */
    async updateReviewSchedule(db, schedule) {
        // 실제로는 별도의 리뷰 스케줄 테이블에 저장
        await DatabaseUtils.run(db, `
      UPDATE memory_item 
      SET last_accessed = CURRENT_TIMESTAMP
      WHERE id = ?
    `, [schedule.memory_id]);
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
     * 망각 통계 생성
     */
    async generateForgettingStats(db) {
        const memories = await this.getAllMemories(db);
        const forgetResults = this.forgettingAlgorithm.analyzeForgetCandidates(memories);
        const forgetCandidates = forgetResults.filter(r => r.should_forget).length;
        const averageForgetScore = forgetResults.reduce((sum, r) => sum + r.forget_score, 0) / forgetResults.length;
        const memoryDistribution = memories.reduce((acc, memory) => {
            acc[memory.type] = (acc[memory.type] || 0) + 1;
            return acc;
        }, {});
        return {
            totalMemories: memories.length,
            forgetCandidates,
            reviewCandidates: 0, // 실제로는 리뷰 후보 계산
            averageForgetScore,
            memoryDistribution
        };
    }
}
//# sourceMappingURL=forgetting-policy-service.js.map