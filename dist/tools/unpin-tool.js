/**
 * Unpin Tool - 기억 고정 해제 도구
 */
import { z } from 'zod';
import { BaseTool } from './base-tool.js';
import { CommonSchemas } from './types.js';
import { DatabaseUtils } from '../utils/database.js';
const UnpinSchema = z.object({
    id: CommonSchemas.MemoryId,
});
export class UnpinTool extends BaseTool {
    constructor() {
        super('unpin', '기억 고정을 해제합니다', {
            type: 'object',
            properties: {
                id: { type: 'string', description: '고정 해제할 기억의 ID' }
            },
            required: ['id']
        });
    }
    async handle(params, context) {
        const { id } = UnpinSchema.parse(params);
        // 데이터베이스 연결 확인
        this.validateDatabase(context);
        try {
            // 개선된 트랜잭션 재시도 로직 사용
            await DatabaseUtils.runTransaction(context.db, async () => {
                const result = await DatabaseUtils.run(context.db, 'UPDATE memory_item SET pinned = FALSE WHERE id = ?', [id]);
                if (result.changes === 0) {
                    throw new Error(`Memory with ID ${id} not found`);
                }
                return result;
            });
            return this.createSuccessResult({
                memory_id: id,
                message: `기억 고정이 해제되었습니다: ${id}`
            });
        }
        catch (error) {
            // 데이터베이스 락 문제인 경우 WAL 체크포인트 시도
            if (error.code === 'SQLITE_BUSY') {
                try {
                    await DatabaseUtils.checkpointWAL(context.db);
                }
                catch (checkpointError) {
                    // WAL 체크포인트 실패
                }
            }
            throw error;
        }
    }
}
//# sourceMappingURL=unpin-tool.js.map