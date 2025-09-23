/**
 * 메모리 임베딩 저장 및 검색 서비스
 * 데이터베이스와 임베딩 서비스를 연동
 */

import { EmbeddingService, type EmbeddingResult } from './embedding-service.js';
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
  private embeddingService: EmbeddingService;

  constructor() {
    this.embeddingService = new EmbeddingService();
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
      // 임베딩 생성
      const embeddingResult = await this.embeddingService.generateEmbedding(content);
      if (!embeddingResult) {
        return null;
      }

      // 데이터베이스에 저장
      await DatabaseUtils.run(db, `
        INSERT OR REPLACE INTO memory_embedding (memory_id, embedding, dim, created_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `, [
        memoryId,
        JSON.stringify(embeddingResult.embedding),
        embeddingResult.embedding.length,
      ]);

      console.log(`✅ 임베딩 저장 완료: ${memoryId} (${embeddingResult.embedding.length}차원)`);
      return embeddingResult;

    } catch (error) {
      console.error(`❌ 임베딩 저장 실패 (${memoryId}):`, error);
      return null;
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

      // 모든 임베딩 가져오기
      const embeddings = await this.getAllEmbeddings(db, filters?.type);
      if (embeddings.length === 0) {
        return [];
      }

      // 유사도 검색
      const similarities = await this.embeddingService.searchSimilar(
        query,
        embeddings,
        filters?.limit || 10,
        filters?.threshold || 0.7
      );

      // 결과를 VectorSearchResult 형태로 변환
      const results: VectorSearchResult[] = [];
      
      for (const similarity of similarities) {
        const memory = await this.getMemoryById(db, similarity.id);
        if (memory) {
          results.push({
            id: memory.id,
            content: memory.content,
            type: memory.type,
            importance: memory.importance,
            created_at: memory.created_at,
            last_accessed: memory.last_accessed,
            pinned: memory.pinned,
            tags: memory.tags ? JSON.parse(memory.tags) : [],
            similarity: similarity.similarity,
            score: similarity.score,
          });
        }
      }

      return results;

    } catch (error) {
      console.error('❌ 벡터 검색 실패:', error);
      return [];
    }
  }

  /**
   * 모든 임베딩 가져오기
   */
  private async getAllEmbeddings(
    db: any,
    typeFilter?: MemoryType[]
  ): Promise<Array<{ id: string; content: string; embedding: number[] }>> {
    let sql = `
      SELECT me.memory_id, mi.content, me.embedding
      FROM memory_embedding me
      JOIN memory_item mi ON me.memory_id = mi.id
    `;
    
    const params: any[] = [];
    
    if (typeFilter && typeFilter.length > 0) {
      sql += ` WHERE mi.type IN (${typeFilter.map(() => '?').join(',')})`;
      params.push(...typeFilter);
    }

    const rows = await DatabaseUtils.all(db, sql, params);
    
    return rows.map((row: any) => ({
      id: row.memory_id,
      content: row.content,
      embedding: JSON.parse(row.embedding),
    }));
  }

  /**
   * 메모리 ID로 메모리 정보 가져오기
   */
  private async getMemoryById(db: any, memoryId: string): Promise<any | null> {
    const rows = await DatabaseUtils.all(db, `
      SELECT id, content, type, importance, created_at, last_accessed, pinned, tags
      FROM memory_item
      WHERE id = ?
    `, [memoryId]);

    return rows.length > 0 ? rows[0] : null;
  }

  /**
   * 임베딩 삭제
   */
  async deleteEmbedding(db: any, memoryId: string): Promise<void> {
    try {
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
  }> {
    try {
      const stats = await DatabaseUtils.all(db, `
        SELECT 
          COUNT(*) as total_embeddings,
          AVG(dim) as avg_dimensions
        FROM memory_embedding
      `);

      const stat = stats[0];
      
      return {
        totalEmbeddings: stat.total_embeddings || 0,
        averageDimensions: stat.avg_dimensions || 0,
        model: this.embeddingService.getModelInfo().model,
      };
    } catch (error) {
      console.error('❌ 임베딩 통계 조회 실패:', error);
      return {
        totalEmbeddings: 0,
        averageDimensions: 0,
        model: 'unknown',
      };
    }
  }
}
