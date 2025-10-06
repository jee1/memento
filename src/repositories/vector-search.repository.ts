/**
 * 벡터 검색 리포지토리 구현
 * 데이터베이스 접근 로직 분리
 */

import Database from 'better-sqlite3';
import type { 
  VectorSearchQuery, 
  VectorSearchResult, 
  VectorIndexStatus,
  HybridSearchResult 
} from '../types/vector-search.types';
import type { VectorSearchRepository } from '../interfaces/database.interface';
import { VECTOR_SEARCH_CONFIG } from '../config/vector-search.config';

export class VectorSearchRepositoryImpl implements VectorSearchRepository {
  private db: Database.Database | null = null;
  private isVecAvailable = false;

  constructor(db: Database.Database) {
    this.db = db;
    this.checkVecAvailability();
  }

  /**
   * VEC 사용 가능 여부 확인
   */
  checkVecAvailability(): boolean {
    if (!this.db) {
      this.isVecAvailable = false;
      return false;
    }

    try {
      // 제공자별 vec0 테이블 중 하나라도 존재하는지 확인
      const tableCheck = this.db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name IN (
          'memory_item_vec_tfidf',
          'memory_item_vec_minilm', 
          'memory_item_vec_openai',
          'memory_item_vec_gemini'
        )
      `).all();

      if (tableCheck.length === 0) {
        console.log('⚠️ VEC 테이블이 없습니다. 벡터 검색이 비활성화됩니다.');
        this.isVecAvailable = false;
        return false;
      }

      // VEC 함수 사용 가능 여부 확인
      try {
        const testTable = (tableCheck[0] as any).name;
        this.db.prepare(`
          SELECT distance FROM ${testTable} 
          WHERE embedding MATCH ? 
          LIMIT 0
        `).get(JSON.stringify(new Array(VECTOR_SEARCH_CONFIG.defaultDimensions).fill(0)));
        
        this.isVecAvailable = true;
        console.log('✅ VEC (Vector Search) 사용 가능');
        return true;
      } catch (vecError) {
        console.warn('⚠️ VEC 함수를 사용할 수 없습니다:', vecError);
        this.isVecAvailable = false;
        return false;
      }
    } catch (error) {
      console.error('❌ VEC 가용성 확인 실패:', error);
      this.isVecAvailable = false;
      return false;
    }
  }

  /**
   * 벡터 검색 실행
   */
  async search(query: VectorSearchQuery): Promise<VectorSearchResult[]> {
    if (!this.db || !this.isVecAvailable) {
      console.warn('⚠️ VEC를 사용할 수 없습니다. 빈 결과를 반환합니다.');
      return [];
    }

    const { queryVector, options, provider } = query;
    const { limit = VECTOR_SEARCH_CONFIG.defaultLimit, threshold = VECTOR_SEARCH_CONFIG.defaultThreshold, type } = options;

    // 벡터 차원 검증
    if (queryVector.length !== VECTOR_SEARCH_CONFIG.defaultDimensions) {
      console.error(`❌ 벡터 차원 불일치: 예상 ${VECTOR_SEARCH_CONFIG.defaultDimensions}, 실제 ${queryVector.length}`);
      return [];
    }

    try {
      const tableName = this.getTableName(provider);
      
      const vecQuery = `
        SELECT 
          vec.rowid as memory_id,
          vec.distance as similarity,
          mi.content,
          mi.type,
          mi.importance,
          mi.created_at,
          mi.last_accessed,
          mi.pinned,
          mi.tags
        FROM ${tableName} vec
        JOIN memory_item mi ON vec.rowid = mi.id
        WHERE vec.embedding MATCH ?
        ${type ? 'AND mi.type = ?' : ''}
        ORDER BY vec.distance ASC
        LIMIT ?
      `;

      const params = [JSON.stringify(queryVector), ...(type ? [type] : []), limit];
      const results = this.db.prepare(vecQuery).all(...params) as any[];

      // 유사도를 0-1 범위로 정규화
      const normalizedResults = results
        .map(result => ({
          ...result,
          similarity: Math.max(0, 1 - result.similarity),
          tags: result.tags ? JSON.parse(result.tags) : undefined
        }))
        .filter(result => result.similarity >= threshold)
        .map(result => ({
          memory_id: result.memory_id,
          similarity: result.similarity,
          content: options.includeContent ? result.content : '',
          type: result.type,
          importance: result.importance,
          created_at: result.created_at,
          last_accessed: options.includeMetadata ? result.last_accessed : undefined,
          pinned: options.includeMetadata ? Boolean(result.pinned) : false,
          tags: options.includeMetadata ? result.tags : undefined
        }));

      console.log(`🔍 벡터 검색 완료: ${normalizedResults.length}개 결과 (임계값: ${threshold})`);
      return normalizedResults;

    } catch (error) {
      console.error('❌ 벡터 검색 실패:', error);
      return [];
    }
  }

  /**
   * 하이브리드 검색 실행
   */
  async hybridSearch(query: VectorSearchQuery): Promise<VectorSearchResult[]> {
    if (!this.db || !this.isVecAvailable) {
      console.warn('⚠️ VEC를 사용할 수 없습니다. 빈 결과를 반환합니다.');
      return [];
    }

    const { queryVector, textQuery, options, provider } = query;
    const { limit = VECTOR_SEARCH_CONFIG.defaultLimit, threshold = VECTOR_SEARCH_CONFIG.defaultThreshold, type } = options;

    // 벡터 차원 검증
    if (queryVector.length !== VECTOR_SEARCH_CONFIG.defaultDimensions) {
      console.error(`❌ 벡터 차원 불일치: 예상 ${VECTOR_SEARCH_CONFIG.defaultDimensions}, 실제 ${queryVector.length}`);
      return [];
    }

    try {
      const tableName = this.getTableName(provider);
      
      const hybridQuery = `
        WITH vector_search AS (
          SELECT 
            vec.rowid as memory_id,
            vec.distance as vector_distance,
            mi.content,
            mi.type,
            mi.importance,
            mi.created_at,
            mi.last_accessed,
            mi.pinned,
            mi.tags
          FROM ${tableName} vec
          JOIN memory_item mi ON vec.rowid = mi.id
          WHERE vec.embedding MATCH ?
          ${type ? 'AND mi.type = ?' : ''}
        ),
        text_search AS (
          SELECT 
            mi.id as memory_id,
            mi.content,
            mi.type,
            mi.importance,
            mi.created_at,
            mi.last_accessed,
            mi.pinned,
            mi.tags,
            fts.rank as text_rank
          FROM memory_item_fts fts
          JOIN memory_item mi ON fts.rowid = mi.rowid
          WHERE memory_item_fts MATCH ?
          ${type ? 'AND mi.type = ?' : ''}
        )
        SELECT 
          COALESCE(vs.memory_id, ts.memory_id) as memory_id,
          COALESCE(1 - vs.vector_distance, 0) as vector_similarity,
          COALESCE(ts.text_rank, 0) as text_similarity,
          COALESCE(vs.content, ts.content) as content,
          COALESCE(vs.type, ts.type) as type,
          COALESCE(vs.importance, ts.importance) as importance,
          COALESCE(vs.created_at, ts.created_at) as created_at,
          COALESCE(vs.last_accessed, ts.last_accessed) as last_accessed,
          COALESCE(vs.pinned, ts.pinned) as pinned,
          COALESCE(vs.tags, ts.tags) as tags
        FROM vector_search vs
        LEFT JOIN text_search ts ON vs.memory_id = ts.memory_id
        WHERE vs.memory_id IS NOT NULL
        UNION
        SELECT 
          ts.memory_id,
          0 as vector_similarity,
          ts.text_rank as text_similarity,
          ts.content,
          ts.type,
          ts.importance,
          ts.created_at,
          ts.last_accessed,
          ts.pinned,
          ts.tags
        FROM text_search ts
        LEFT JOIN vector_search vs ON ts.memory_id = vs.memory_id
        WHERE vs.memory_id IS NULL
        ORDER BY (vector_similarity * 0.6 + text_similarity * 0.4) DESC
        LIMIT ?
      `;

      const params = [
        JSON.stringify(queryVector),
        ...(type ? [type] : []),
        textQuery || '',
        ...(type ? [type] : []),
        limit
      ];

      const results = this.db.prepare(hybridQuery).all(...params) as any[];

      // 결과 정규화
      const normalizedResults = results
        .map(result => ({
          memory_id: result.memory_id,
          similarity: result.vector_similarity * 0.6 + result.text_similarity * 0.4, // similarity로 통일
          content: options.includeContent ? result.content : '',
          type: result.type,
          importance: result.importance,
          created_at: result.created_at,
          last_accessed: options.includeMetadata ? result.last_accessed : undefined,
          pinned: options.includeMetadata ? Boolean(result.pinned) : false,
          tags: options.includeMetadata && result.tags ? JSON.parse(result.tags) : undefined
        }))
        .filter(result => result.similarity >= threshold);

      console.log(`🔍 하이브리드 검색 완료: ${normalizedResults.length}개 결과`);
      return normalizedResults;

    } catch (error) {
      console.error('❌ 하이브리드 검색 실패:', error);
      return [];
    }
  }

  /**
   * 인덱스 상태 확인
   */
  getIndexStatus(): VectorIndexStatus {
    if (!this.db) {
      return { 
        available: false, 
        tableExists: false, 
        recordCount: 0, 
        dimensions: VECTOR_SEARCH_CONFIG.defaultDimensions,
        vecExtensionLoaded: false
      };
    }

    try {
      const tableExists = this.isVecAvailable;
      let recordCount = 0;

      if (tableExists) {
        // 모든 제공자별 테이블의 레코드 수 합계
        const providers = ['tfidf', 'minilm', 'openai', 'gemini'];
        for (const provider of providers) {
          const tableName = this.getTableName(provider);
          try {
            const result = this.db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get() as { count: number };
            recordCount += result.count;
          } catch (error) {
            // 테이블이 존재하지 않는 경우 무시
          }
        }
      }

      return {
        available: this.isVecAvailable,
        tableExists,
        recordCount,
        dimensions: VECTOR_SEARCH_CONFIG.defaultDimensions,
        vecExtensionLoaded: this.isVecAvailable
      };
    } catch (error) {
      console.error('❌ 인덱스 상태 확인 실패:', error);
      return { 
        available: false, 
        tableExists: false, 
        recordCount: 0, 
        dimensions: VECTOR_SEARCH_CONFIG.defaultDimensions,
        vecExtensionLoaded: false
      };
    }
  }

  /**
   * 인덱스 재구성
   */
  async rebuildIndex(): Promise<boolean> {
    if (!this.db || !this.isVecAvailable) {
      console.warn('⚠️ VEC를 사용할 수 없습니다.');
      return false;
    }

    try {
      console.log('🔄 벡터 인덱스 재구성 시작...');
      // VEC 인덱스 재구성 (sqlite-vec는 자동으로 인덱스를 관리)
      console.log('✅ 벡터 인덱스 재구성 완료 (sqlite-vec는 자동 인덱스 관리)');
      return true;
    } catch (error) {
      console.error('❌ 벡터 인덱스 재구성 실패:', error);
      return false;
    }
  }

  /**
   * 테이블명 반환
   */
  getTableName(provider: string): string {
    const tableName = VECTOR_SEARCH_CONFIG.tableNames[provider as keyof typeof VECTOR_SEARCH_CONFIG.tableNames];
    return (tableName ?? VECTOR_SEARCH_CONFIG.tableNames.tfidf) as string;
  }

  /**
   * VEC 사용 가능 여부 확인 (VectorIndexRepository 인터페이스 구현)
   */
  checkAvailability(): boolean {
    return this.checkVecAvailability();
  }
}
