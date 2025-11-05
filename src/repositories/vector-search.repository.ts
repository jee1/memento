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
      const tableStatement = this.db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name IN (
          'memory_item_vec_tfidf',
          'memory_item_vec_minilm', 
          'memory_item_vec_openai',
          'memory_item_vec_gemini'
        )
      `);
      const tableRows = typeof tableStatement.all === 'function'
        ? tableStatement.all()
        : [];
      const tableCheck = Array.isArray(tableRows) ? tableRows : [];

      if (tableCheck.length === 0) {
        console.log('⚠️ VEC 테이블이 없습니다. 벡터 검색이 비활성화됩니다.');
        this.isVecAvailable = false;
        return false;
      }

      // VEC 함수 사용 가능 여부 확인
      try {
        const testTableEntry = tableCheck.find((table: any) => typeof table?.name === 'string');
        const testTable = testTableEntry?.name ?? 'memory_item_vec_tfidf';
        const testStatement = this.db.prepare(`
          SELECT distance FROM ${testTable} 
          WHERE embedding MATCH ? 
          LIMIT 0
        `);

        if (typeof testStatement.get !== 'function') {
          console.warn('⚠️ VEC 테스트 쿼리를 실행할 수 없습니다: get() 메서드가 없습니다.');
          this.isVecAvailable = false;
          return false;
        }

        testStatement.get(JSON.stringify(new Array(VECTOR_SEARCH_CONFIG.defaultDimensions).fill(0)));
        
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
    const normalizedOptions = options ?? {};
    const {
      limit = VECTOR_SEARCH_CONFIG.defaultLimit,
      threshold = VECTOR_SEARCH_CONFIG.defaultThreshold,
      type,
      includeContent = true,
      includeMetadata = false
    } = normalizedOptions;
    const expectedDimensions = this.getExpectedDimensions(provider);

    // 벡터 차원 검증
    if (queryVector.length !== expectedDimensions) {
      console.error(`❌ 벡터 차원 불일치: 예상 ${expectedDimensions}, 실제 ${queryVector.length}`);
      return [];
    }

    try {
      const tableName = this.getTableName(provider ?? 'tfidf');
      
      const vecQuery = `
        SELECT 
          me.memory_id as memory_id,
          vec.distance as similarity,
          mi.content,
          mi.type,
          mi.importance,
          mi.created_at,
          mi.last_accessed,
          mi.pinned,
          mi.tags
        FROM ${tableName} vec
        JOIN memory_embedding me ON vec.rowid = me.id
        JOIN memory_item mi ON mi.id = me.memory_id
        WHERE vec.embedding MATCH ?
        ${type ? 'AND mi.type = ?' : ''}
        ORDER BY vec.distance ASC
        LIMIT ?
      `;

      const params = [JSON.stringify(queryVector), ...(type ? [type] : []), limit];
      const statement = this.db.prepare(vecQuery);
      if (typeof statement.all !== 'function') {
        console.warn('⚠️ 벡터 검색 쿼리를 실행할 수 없습니다: all() 메서드가 없습니다.');
        return [];
      }
      const rawResults = statement.all(...params);
      const results = Array.isArray(rawResults) ? rawResults as any[] : [];

      // 유사도를 0-1 범위로 정규화
      const normalizedResults = results
        .map(result => ({
          ...result,
          similarity: Math.max(0, 1 - result.similarity),
          tags: includeMetadata ? this.safeParseTags(result.tags) : undefined
        }))
        .filter(result => result.similarity >= threshold)
        .map(result => ({
          memory_id: result.memory_id,
          similarity: result.similarity,
          content: includeContent ? result.content : '',
          type: result.type,
          importance: result.importance,
          created_at: result.created_at,
          last_accessed: includeMetadata ? result.last_accessed : undefined,
          pinned: includeMetadata ? Boolean(result.pinned) : false,
          tags: includeMetadata ? result.tags : undefined
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
    const normalizedOptions = options ?? {};
    const {
      limit = VECTOR_SEARCH_CONFIG.defaultLimit,
      threshold = VECTOR_SEARCH_CONFIG.defaultThreshold,
      type,
      includeContent = true,
      includeMetadata = false
    } = normalizedOptions;
    const expectedDimensions = this.getExpectedDimensions(provider);

    // 벡터 차원 검증
    if (queryVector.length !== expectedDimensions) {
      console.error(`❌ 벡터 차원 불일치: 예상 ${expectedDimensions}, 실제 ${queryVector.length}`);
      return [];
    }

    try {
      const tableName = this.getTableName(provider ?? 'tfidf');
      
      const hybridQuery = `
        WITH vector_search AS (
          SELECT 
            me.memory_id as memory_id,
            vec.distance as vector_distance,
            mi.content,
            mi.type,
            mi.importance,
            mi.created_at,
            mi.last_accessed,
            mi.pinned,
            mi.tags
          FROM ${tableName} vec
          JOIN memory_embedding me ON vec.rowid = me.id
          JOIN memory_item mi ON mi.id = me.memory_id
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

      const statement = this.db.prepare(hybridQuery);
      if (typeof statement.all !== 'function') {
        console.warn('⚠️ 하이브리드 검색 쿼리를 실행할 수 없습니다: all() 메서드가 없습니다.');
        return [];
      }
      const rawResults = statement.all(...params);
      const results = Array.isArray(rawResults) ? rawResults as any[] : [];

      // 결과 정규화
      const normalizedResults = results
        .map(result => ({
          memory_id: result.memory_id,
          similarity: result.vector_similarity * 0.6 + result.text_similarity * 0.4, // similarity로 통일
          content: includeContent ? result.content : '',
          type: result.type,
          importance: result.importance,
          created_at: result.created_at,
          last_accessed: includeMetadata ? result.last_accessed : undefined,
          pinned: includeMetadata ? Boolean(result.pinned) : false,
          tags: includeMetadata ? this.safeParseTags(result.tags) : undefined
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
            const statement = this.db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`);
            if (typeof statement.get !== 'function') {
              continue;
            }
            const result = statement.get() as { count: number } | undefined;
            if (result && typeof result.count === 'number') {
              recordCount += result.count;
            }
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
    const normalized = (provider ?? 'tfidf').toLowerCase() as keyof typeof VECTOR_SEARCH_CONFIG.tableNames;
    const tableName = VECTOR_SEARCH_CONFIG.tableNames[normalized];
    return (tableName ?? VECTOR_SEARCH_CONFIG.tableNames.tfidf) as string;
  }

  /**
   * VEC 사용 가능 여부 확인 (VectorIndexRepository 인터페이스 구현)
   */
  checkAvailability(): boolean {
    return this.checkVecAvailability();
  }

  private getExpectedDimensions(provider?: string): number {
    if (!provider) {
      return VECTOR_SEARCH_CONFIG.defaultDimensions;
    }
    return VECTOR_SEARCH_CONFIG.providerDimensions[provider] ?? VECTOR_SEARCH_CONFIG.defaultDimensions;
  }

  private safeParseTags(raw: string | null | undefined): string[] {
    if (!raw) {
      return [];
    }
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
      console.warn('⚠️ 태그 JSON 파싱 실패, 빈 배열로 대체합니다.', error);
      return [];
    }
  }
}
