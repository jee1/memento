/**
 * Remember Tool - 기억 저장 도구
 */

import { z } from 'zod';
import { BaseTool } from './base-tool.js';
import type { ToolContext, ToolResult } from './types.js';
import { CommonSchemas } from './types.js';
import { DatabaseUtils } from '../utils/database.js';

const RememberSchema = z.object({
  content: CommonSchemas.Content,
  type: CommonSchemas.MemoryType.default('episodic'),
  tags: CommonSchemas.Tags,
  importance: CommonSchemas.Importance.default(0.5),
  source: CommonSchemas.Source,
  privacy_scope: CommonSchemas.PrivacyScope.default('private'),
});

export class RememberTool extends BaseTool {
  constructor() {
    super(
      'remember',
      '새로운 기억을 저장합니다',
      {
        type: 'object',
        properties: {
          content: { type: 'string', description: '저장할 내용' },
          type: { 
            type: 'string', 
            enum: ['working', 'episodic', 'semantic', 'procedural'],
            description: '기억 타입',
            default: 'episodic'
          },
          tags: { 
            type: 'array', 
            items: { type: 'string' },
            description: '태그 목록'
          },
          importance: { 
            type: 'number', 
            minimum: 0, 
            maximum: 1,
            description: '중요도 (0-1)',
            default: 0.5
          },
          source: { type: 'string', description: '출처' },
          privacy_scope: { 
            type: 'string', 
            enum: ['private', 'team', 'public'],
            description: '프라이버시 범위',
            default: 'private'
          }
        },
        required: ['content']
      }
    );
  }

  async handle(params: any, context: ToolContext): Promise<ToolResult> {
    const { content, type, tags, importance, source, privacy_scope } = RememberSchema.parse(params);
    
    // 데이터베이스 연결 확인
    this.validateDatabase(context);

    // UUID 생성 (임시로 간단한 ID 사용)
    const id = `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      // 개선된 트랜잭션 재시도 로직 사용
      const result = await DatabaseUtils.runTransaction(context.db!, async () => {
        await DatabaseUtils.run(context.db!, `
          INSERT INTO memory_item (id, type, content, importance, privacy_scope, tags, source, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [id, type, content, importance, privacy_scope, 
            tags ? JSON.stringify(tags) : null, source]);
        
        return { id, type, content, importance, privacy_scope, tags, source };
      });
      
      // 임베딩 생성 (비동기, 실패해도 메모리 저장은 성공)
      if (context.services.embeddingService?.isAvailable()) {
        context.services.embeddingService.createAndStoreEmbedding(context.db, id, content, type)
        .then((result: any) => {
          if (result) {
            // 임베딩 생성 완료
          }
        })
        .catch((error: any) => {
          console.warn(`⚠️ 임베딩 생성 실패 (${id}):`, error.message);
        });
      }
      
      return this.createSuccessResult({
        memory_id: id,
        message: `기억이 저장되었습니다: ${id}`,
        embedding_created: context.services.embeddingService?.isAvailable() || false
      });
    } catch (error) {
      // 데이터베이스 락 문제인 경우 WAL 체크포인트 시도
      if ((error as any).code === 'SQLITE_BUSY') {
        try {
          await DatabaseUtils.checkpointWAL(context.db);
        } catch (checkpointError) {
          // WAL 체크포인트 실패
        }
      }
      throw error;
    }
  }
}
