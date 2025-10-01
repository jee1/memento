/**
 * Forgetting Stats Tool - 망각 통계 도구
 */
import { z } from 'zod';
import { BaseTool } from './base-tool.js';
const ForgettingStatsSchema = z.object({});
export class ForgettingStatsTool extends BaseTool {
    constructor() {
        super('forgetting_stats', '망각 통계를 조회합니다', {
            type: 'object',
            properties: {}
        });
    }
    async handle(params, context) {
        // 데이터베이스 연결 확인
        this.validateDatabase(context);
        // 망각 정책 서비스 확인
        this.validateService(context.services.forgettingPolicyService, '망각 정책 서비스');
        try {
            const stats = await context.services.forgettingPolicyService.generateForgettingStats(context.db);
            return this.createSuccessResult({
                stats: {
                    totalMemories: stats.totalMemories,
                    forgetCandidates: stats.forgetCandidates,
                    reviewCandidates: stats.reviewCandidates,
                    averageForgetScore: stats.averageForgetScore,
                    memoryDistribution: stats.memoryDistribution
                },
                message: '망각 통계 조회 완료'
            });
        }
        catch (error) {
            throw new Error(`망각 통계 조회 실패: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}
//# sourceMappingURL=forgetting-stats-tool.js.map