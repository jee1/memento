/**
 * 메모리 임베딩 저장 및 검색 서비스
 * 데이터베이스와 임베딩 서비스를 연동
 */

import { UnifiedEmbeddingService } from './unified-embedding-service.js';
import type { EmbeddingResult } from '../types/embedding.types.js';
import { DatabaseUtils } from '../utils/database.js';
import type { MemoryType } from '../types/index.js';

export interface MemoryEmbedding {
  memory_id: string;
  embedding: number[];
  created_at: string;
}

export interface VectorSearchResult {
  id: string;
  content: string;
  type: string;
  importance: number;
  created_at: string;
  last_accessed?: string;
  pinned: boolean;
  tags?: string[];
  similarity: number;
  score: number;
}

export class MemoryEmbeddingService {
  private embeddingService: UnifiedEmbeddingService;

  constructor() {
    this.embeddingService = new UnifiedEmbeddingService();
  }

  /**
   * sqlite-vec 확장 로드
   */
  private loadVecExtension(db: any): void {
    try {
      db.loadExtension('/usr/lib/vec0');
    } catch (error) {
      console.warn('⚠️ sqlite-vec 확장 로드 실패:', error);
    }
  }

  /**
   * 메모리에 임베딩 생성 및 저장
   */
  async createAndStoreEmbedding(
    db: any,
    memoryId: string,
    content: string,
    type: MemoryType
  ): Promise<EmbeddingResult | null> {
    if (!this.embeddingService.isAvailable()) {
      console.warn('⚠️ 임베딩 서비스가 사용 불가능합니다. 임베딩을 건너뜁니다.');
      return null;
    }

    try {
      // sqlite-vec 확장 로드
      this.loadVecExtension(db);
      
      // 임베딩 생성
      const embeddingResult = await this.embeddingService.generateEmbedding(content);
      if (!embeddingResult) {
        return null;
      }

      // 제공자별 테이블명 결정
      const tableName = this.getVectorTableName(embeddingResult.provider || 'tfidf');
      
      // memory_embedding 테이블에 저장
      await DatabaseUtils.run(db, `
        INSERT OR REPLACE INTO memory_embedding (memory_id, embedding, dim, model, embedding_provider, dimensions, created_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        memoryId,
        JSON.stringify(embeddingResult.embedding),
        embeddingResult.embedding.length,
        embeddingResult.model,
        embeddingResult.provider,
        embeddingResult.embedding.length,
      ]);

      // vec0 테이블에 저장
      await DatabaseUtils.run(db, `
        INSERT OR REPLACE INTO ${tableName} (rowid, embedding)
        VALUES ((SELECT rowid FROM memory_embedding WHERE memory_id = ?), ?)
      `, [
        memoryId,
        JSON.stringify(embeddingResult.embedding)
      ]);

      console.log(`✅ 임베딩 저장 완료: ${memoryId} (${embeddingResult.embedding.length}차원, ${embeddingResult.provider})`);
      return embeddingResult;

    } catch (error) {
      console.error(`❌ 임베딩 저장 실패 (${memoryId}):`, error);
      return null;
    }
  }

  /**
   * 제공자별 vec0 테이블명 반환
   */
  private getVectorTableName(provider: string): string {
    switch (provider) {
      case 'tfidf':
        return 'memory_item_vec_tfidf';
      case 'minilm':
        return 'memory_item_vec_minilm';
      case 'openai':
        return 'memory_item_vec_openai';
      case 'gemini':
        return 'memory_item_vec_gemini';
      default:
        return 'memory_item_vec_tfidf'; // 기본값
    }
  }

  /**
   * 벡터 유사도 검색
   */
  async searchBySimilarity(
    db: any,
    query: string,
    filters?: {
      type?: MemoryType[];
      limit?: number;
      threshold?: number;
    }
  ): Promise<VectorSearchResult[]> {
    if (!this.embeddingService.isAvailable()) {
      console.warn('⚠️ 임베딩 서비스가 사용 불가능합니다.');
      return [];
    }

    try {
      // 쿼리 임베딩 생성
      const queryEmbedding = await this.embeddingService.generateEmbedding(query);
      if (!queryEmbedding) {
        return [];
      }

      // 제공자별 테이블에서 검색
      const tableName = this.getVectorTableName(queryEmbedding.provider || 'tfidf');
      
      // vec0 테이블에서 유사도 검색
      const similarities = await DatabaseUtils.all(db, `
        SELECT 
          m.id,
          m.content,
          m.type,
          m.importance,
          m.created_at,
          m.last_accessed,
          m.pinned,
          m.tags,
          v.distance as similarity,
          (1 - v.distance) as score
        FROM memory_item m
        JOIN memory_embedding me ON m.id = me.memory_id
        JOIN ${tableName} v ON me.rowid = v.rowid
        WHERE me.embedding_provider = ?
        ${filters?.type ? `AND m.type IN (${filters.type.map(() => '?').join(',')})` : ''}
        ORDER BY v.distance ASC
        LIMIT ?
      `, [
        queryEmbedding.provider,
        ...(filters?.type || []),
        filters?.limit || 10
      ]);

      // 결과를 VectorSearchResult 형태로 변환
      const results: VectorSearchResult[] = similarities.map((row: any) => ({
        id: row.id,
        content: row.content,
        type: row.type,
        importance: row.importance,
        created_at: row.created_at,
        last_accessed: row.last_accessed,
        pinned: row.pinned,
        tags: row.tags ? JSON.parse(row.tags) : [],
        similarity: row.similarity,
        score: row.score,
      }));

      return results;

    } catch (error) {
      console.error('❌ 벡터 검색 실패:', error);
      return [];
    }
  }


  /**
   * 임베딩 삭제
   */
  async deleteEmbedding(db: any, memoryId: string): Promise<void> {
    try {
      // 제공자 정보 가져오기
      const embeddingInfo = await DatabaseUtils.get(db, `
        SELECT embedding_provider FROM memory_embedding WHERE memory_id = ?
      `, [memoryId]);

      if (embeddingInfo) {
        // 해당 제공자의 vec0 테이블에서 삭제
        const tableName = this.getVectorTableName(embeddingInfo.embedding_provider);
        await DatabaseUtils.run(db, `
          DELETE FROM ${tableName} 
          WHERE rowid = (SELECT rowid FROM memory_embedding WHERE memory_id = ?)
        `, [memoryId]);
      }

      // memory_embedding 테이블에서 삭제
      await DatabaseUtils.run(db, 'DELETE FROM memory_embedding WHERE memory_id = ?', [memoryId]);
      console.log(`✅ 임베딩 삭제 완료: ${memoryId}`);
    } catch (error) {
      console.error(`❌ 임베딩 삭제 실패 (${memoryId}):`, error);
    }
  }

  /**
   * 임베딩 서비스 사용 가능 여부 확인
   */
  isAvailable(): boolean {
    return this.embeddingService.isAvailable();
  }

  /**
   * 임베딩 통계 정보
   */
  async getEmbeddingStats(db: any): Promise<{
    totalEmbeddings: number;
    averageDimensions: number;
    model: string;
    providerStats: Array<{
      provider: string;
      count: number;
      dimensions: number;
    }>;
  }> {
    try {
      // 전체 통계
      const stats = await DatabaseUtils.all(db, `
        SELECT 
          COUNT(*) as total_embeddings,
          AVG(dimensions) as avg_dimensions
        FROM memory_embedding
      `);

      // 제공자별 통계
      const providerStats = await DatabaseUtils.all(db, `
        SELECT 
          embedding_provider as provider,
          COUNT(*) as count,
          AVG(dimensions) as dimensions
        FROM memory_embedding
        GROUP BY embedding_provider
        ORDER BY count DESC
      `);

      const stat = stats[0];
      
      return {
        totalEmbeddings: stat.total_embeddings || 0,
        averageDimensions: stat.avg_dimensions || 0,
        model: this.embeddingService.getModelInfo().model,
        providerStats: providerStats.map((row: any) => ({
          provider: row.provider,
          count: row.count,
          dimensions: Math.round(row.dimensions),
        })),
      };
    } catch (error) {
      console.error('❌ 임베딩 통계 조회 실패:', error);
      return {
        totalEmbeddings: 0,
        averageDimensions: 0,
        model: 'unknown',
        providerStats: [],
      };
    }
  }
}
