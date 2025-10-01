/**
 * Database Optimize Tool - 데이터베이스 최적화 도구
 */
import { z } from 'zod';
import { BaseTool } from './base-tool.js';
import { CommonSchemas } from './types.js';
const DatabaseOptimizeSchema = z.object({
    analyze: CommonSchemas.Analyze,
    create_indexes: CommonSchemas.CreateIndexes,
});
export class DatabaseOptimizeTool extends BaseTool {
    constructor() {
        super('database_optimize', '데이터베이스 최적화를 수행합니다', {
            type: 'object',
            properties: {
                analyze: {
                    type: 'boolean',
                    description: '데이터베이스 분석 실행',
                    default: false
                },
                create_indexes: {
                    type: 'boolean',
                    description: '추천 인덱스 생성',
                    default: false
                }
            }
        });
    }
    async handle(params, context) {
        const { analyze, create_indexes } = DatabaseOptimizeSchema.parse(params);
        // 데이터베이스 연결 확인
        this.validateDatabase(context);
        // 데이터베이스 최적화기 확인
        this.validateService(context.services.databaseOptimizer, '데이터베이스 최적화기');
        try {
            const results = {
                message: '데이터베이스 최적화 완료',
                operations: []
            };
            if (analyze) {
                await context.services.databaseOptimizer.analyzeDatabase();
                results.operations.push('데이터베이스 분석 완료');
            }
            if (create_indexes) {
                const recommendations = await context.services.databaseOptimizer.generateIndexRecommendations();
                const highPriorityRecs = recommendations.filter((r) => r.priority === 'high');
                for (const rec of highPriorityRecs) {
                    const indexName = `idx_${rec.table}_${rec.columns.join('_')}`;
                    await context.services.databaseOptimizer.createIndex(indexName, rec.table, rec.columns);
                    results.operations.push(`인덱스 생성: ${indexName}`);
                }
            }
            const report = await context.services.databaseOptimizer.generateOptimizationReport();
            return this.createSuccessResult({
                ...results,
                report: report
            });
        }
        catch (error) {
            throw new Error(`데이터베이스 최적화 실패: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
}
//# sourceMappingURL=database-optimize-tool.js.map