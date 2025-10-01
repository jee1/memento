/**
 * Cleanup Memory Tool - 메모리 정리 도구
 */
import { z } from 'zod';
import { BaseTool } from './base-tool.js';
import { CommonSchemas } from './types.js';
const CleanupMemorySchema = z.object({
    dry_run: CommonSchemas.DryRun,
});
export class CleanupMemoryTool extends BaseTool {
    constructor() {
        super('cleanup_memory', '망각 정책에 따라 메모리를 정리합니다', {
            type: 'object',
            properties: {
                dry_run: {
                    type: 'boolean',
                    description: '드라이런 모드 (실제 삭제 없이 분석만)',
                    default: false
                }
            }
        });
    }
    async handle(params, context) {
        const { dry_run } = CleanupMemorySchema.parse(params);
        // 데이터베이스 연결 확인
        this.validateDatabase(context);
        // 망각 정책 서비스 확인
        this.validateService(context.services.forgettingPolicyService, '망각 정책 서비스');
        try {
            if (dry_run) {
                // 드라이런 모드: 실제 삭제 없이 분석만 수행
                const stats = await context.services.forgettingPolicyService.generateForgettingStats(context.db);
                return this.createSuccessResult({
                    mode: 'dry_run',
                    stats: {
                        totalMemories: stats.totalMemories,
                        forgetCandidates: stats.forgetCandidates,
                        reviewCandidates: stats.reviewCandidates,
                        averageForgetScore: stats.averageForgetScore,
                        memoryDistribution: stats.memoryDistribution
                    },
                    message: '망각 후보 분석 완료 (실제 삭제 없음)'
                });
            }
            else {
                // 실제 정리 실행
                const result = await context.services.forgettingPolicyService.executeMemoryCleanup(context.db);
                return this.createSuccessResult({
                    mode: 'execution',
                    result: {
                        softDeleted: result.softDeleted,
                        hardDeleted: result.hardDeleted,
                        reviewed: result.reviewed,
                        totalProcessed: result.totalProcessed,
                        summary: result.summary
                    },
                    message: `메모리 정리 완료: 소프트 삭제 ${result.summary.actualSoftDeletes}개, 하드 삭제 ${result.summary.actualHardDeletes}개, 리뷰 ${result.summary.actualReviews}개`
                });
            }
        }
        catch (error) {
            throw new Error(`메모리 정리 실패: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}
//# sourceMappingURL=cleanup-memory-tool.js.map