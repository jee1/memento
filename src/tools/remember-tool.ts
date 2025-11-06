/**
 * Remember Tool - 기억 저장 도구
 */

import { z } from 'zod';
import { BaseTool } from './base-tool.js';
import type { ToolContext, ToolResult } from './types.js';
import { CommonSchemas } from './types.js';
import { DatabaseUtils } from '../utils/database.js';
import { MemoryNeighborService } from '../services/memory-neighbor-service.js';
import { getVectorSearchEngine } from '../algorithms/vector-search-engine.js';
import { MemoryEmbeddingService } from '../services/memory-embedding-service.js';

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
      // 메모리 저장 (트랜잭션 사용)
      await DatabaseUtils.runTransaction(context.db!, async () => {
        await DatabaseUtils.run(context.db!, `
          INSERT INTO memory_item (id, type, content, importance, privacy_scope, tags, source, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [id, type, content, importance, privacy_scope, 
            tags ? JSON.stringify(tags) : null, source]);
      });
      
      // 메모리 저장 완료 후 임베딩 생성 및 인접 기억 갱신 (비동기, 실패해도 메모리 저장은 성공)
      // 데이터베이스 참조를 미리 저장하여 비동기 콜백에서 안전하게 사용
      const dbRef = context.db;
      const embeddingServiceRef = context.services.embeddingService;
      
      if (embeddingServiceRef?.isAvailable() && dbRef) {
        // 비동기 작업을 별도로 실행 (fire-and-forget 패턴)
        // 메모리 저장 응답은 즉시 반환하고, 임베딩/인접 기억 갱신은 백그라운드에서 처리
        (async () => {
          try {
            // 트랜잭션이 완전히 커밋되도록 짧은 지연
            await new Promise(resolve => setTimeout(resolve, 100));
            
            // 데이터베이스 연결이 여전히 유효한지 확인 (간단한 쿼리로 테스트)
            try {
              DatabaseUtils.get(dbRef, 'SELECT 1');
            } catch (dbError) {
              this.logWarning('데이터베이스 연결이 유효하지 않아 임베딩 생성을 건너뜁니다', { 
                memory_id: id,
                error: dbError instanceof Error ? dbError.message : String(dbError)
              });
              return;
            }
            
            // 임베딩 생성
            const embeddingResult = await embeddingServiceRef.createAndStoreEmbedding(dbRef, id, content, type);
            
            if (embeddingResult) {
              // PRD 3.1-3.3: 인접 기억 갱신
              try {
                // 데이터베이스 연결 재확인
                try {
                  DatabaseUtils.get(dbRef, 'SELECT 1');
                } catch (dbError) {
                  this.logWarning('데이터베이스 연결이 유효하지 않아 인접 기억 갱신을 건너뜁니다', { 
                    memory_id: id,
                    error: dbError instanceof Error ? dbError.message : String(dbError)
                  });
                  return;
                }
                
                const vectorSearchEngine = getVectorSearchEngine();
                const neighborService = new MemoryNeighborService(
                  vectorSearchEngine,
                  embeddingServiceRef
                );
                
                neighborService.setDatabase(dbRef);
                
                // 인접 기억 갱신 (기본 유사도 임계값: 0.8)
                const neighborIds = await neighborService.updateNeighborsForNewMemory(id, 0.8);
                
                if (neighborIds.length > 0) {
                  this.logInfo('인접 기억 갱신 완료', {
                    memory_id: id,
                    neighbor_count: neighborIds.length
                  });
                }
              } catch (error) {
                // 인접 기억 갱신 실패해도 메모리 저장은 성공했으므로 경고만 출력
                this.logWarning(`인접 기억 갱신 실패 (${id})`, {
                  error: error instanceof Error ? error.message : String(error)
                });
              }
            }
          } catch (error) {
            // 임베딩 생성 실패해도 메모리 저장은 성공했으므로 경고만 출력
            this.logWarning(`임베딩 생성 실패 (${id})`, {
              error: error instanceof Error ? error.message : String(error)
            });
          }
        })().catch((error) => {
          // 예상치 못한 에러 처리
          this.logWarning(`백그라운드 작업 실패 (${id})`, {
            error: error instanceof Error ? error.message : String(error)
          });
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
