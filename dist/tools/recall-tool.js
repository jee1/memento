/**
 * Recall Tool - 기억 검색 도구
 */
import { z } from 'zod';
import { BaseTool } from './base-tool.js';
import { CommonSchemas } from './types.js';
const RecallSchema = z.object({
    query: CommonSchemas.Query,
    filters: z.object({
        type: z.array(CommonSchemas.MemoryType).optional(),
        tags: z.array(z.string()).optional(),
        privacy_scope: z.array(CommonSchemas.PrivacyScope).optional(),
        time_from: z.string().optional(),
        time_to: z.string().optional(),
        pinned: z.boolean().optional()
    }).optional(),
    limit: CommonSchemas.Limit,
});
export class RecallTool extends BaseTool {
    constructor() {
        super('recall', '관련 기억을 검색합니다', {
            type: 'object',
            properties: {
                query: { type: 'string', description: '검색 쿼리' },
                filters: {
                    type: 'object',
                    properties: {
                        type: {
                            type: 'array',
                            items: { type: 'string', enum: ['working', 'episodic', 'semantic', 'procedural'] }
                        },
                        tags: { type: 'array', items: { type: 'string' } },
                        privacy_scope: {
                            type: 'array',
                            items: { type: 'string', enum: ['private', 'team', 'public'] }
                        },
                        time_from: { type: 'string' },
                        time_to: { type: 'string' },
                        pinned: { type: 'boolean' }
                    }
                },
                limit: { type: 'number', minimum: 1, maximum: 50, default: 10 }
            },
            required: ['query']
        });
    }
    async handle(params, context) {
        console.log('🔍 Recall 도구 호출됨:', params);
        const { query, filters, limit } = RecallSchema.parse(params);
        console.log('🔍 파싱된 파라미터:', { query, filters, limit });
        // 데이터베이스 연결 확인
        this.validateDatabase(context);
        // 하이브리드 검색 엔진 확인
        this.validateService(context.services.hybridSearchEngine, '하이브리드 검색 엔진');
        try {
            // 하이브리드 검색 엔진 사용 (텍스트 + 벡터 검색)
            const searchResult = await context.services.hybridSearchEngine.search(context.db, {
                query,
                filters,
                limit,
                vectorWeight: 0.6, // 벡터 검색 60%
                textWeight: 0.4, // 텍스트 검색 40%
            });
            return this.createSuccessResult({
                ...searchResult,
                search_type: 'hybrid',
                vector_search_available: context.services.hybridSearchEngine.isEmbeddingAvailable()
            });
        }
        catch (error) {
            throw error;
        }
    }
}
//# sourceMappingURL=recall-tool.js.map