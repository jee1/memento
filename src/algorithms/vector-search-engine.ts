/**
 * 벡터 검색 엔진
 * sqlite-vec를 사용한 벡터 유사도 검색
 * Memento MCP Server의 핵심 벡터 검색 컴포넌트
 */

import Database from 'better-sqlite3';

export interface VectorSearchResult {
  memory_id: string;
  similarity: number;
  content: string;
  type: string;
  importance: number;
  created_at: string;
  last_accessed?: string;
  pinned: boolean;
  tags?: string[];
}

export interface VectorSearchOptions {
  limit?: number;
  threshold?: number;  // 최소 유사도 임계값
  type?: string;       // 메모리 타입 필터 (단일 타입)
  includeContent?: boolean;
  includeMetadata?: boolean; // 메타데이터 포함 여부
}

export interface VectorIndexStatus {
  available: boolean;
  tableExists: boolean;
  recordCount: number;
  dimensions: number;
  vecExtensionLoaded: boolean;
}

export class VectorSearchEngine {
  private db: Database.Database | null = null;
  private isVecAvailable = false;
  private vecExtensionLoaded = false;
  private readonly defaultDimensions = 1536;
  private readonly defaultThreshold = 0.7;
  private readonly defaultLimit = 10;

  constructor() {
    // VEC 사용 가능 여부는 데이터베이스 연결 시 확인
  }

  /**
   * 데이터베이스 초기화
   */
  initialize(db: Database.Database): void {
    this.db = db;
    this.checkVecAvailability();
  }

  /**
   * VEC 사용 가능 여부 확인
   * sqlite-vec 확장 로드 여부와 테이블 존재를 모두 확인
   */
  private checkVecAvailability(): void {
    if (!this.db) {
      this.isVecAvailable = false;
      this.vecExtensionLoaded = false;
      return;
    }

    try {
      // 1. sqlite-vec 확장 로드 여부 확인
      const extensionCheck = this.db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='memory_item_vec'
      `).get();

      if (!extensionCheck) {
        console.log('⚠️ VEC 테이블이 없습니다. 벡터 검색이 비활성화됩니다.');
        this.isVecAvailable = false;
        this.vecExtensionLoaded = false;
        return;
      }

      // 2. VEC 함수 사용 가능 여부 확인
      try {
        // vec_search 함수가 사용 가능한지 테스트
        this.db.prepare(`
          SELECT distance FROM memory_item_vec 
          WHERE embedding MATCH ? 
          LIMIT 0
        `).get(JSON.stringify(new Array(this.defaultDimensions).fill(0)));
        
        this.vecExtensionLoaded = true;
        this.isVecAvailable = true;
        console.log('✅ VEC (Vector Search) 사용 가능');
      } catch (vecError) {
        console.warn('⚠️ VEC 함수를 사용할 수 없습니다:', vecError);
        this.vecExtensionLoaded = false;
        this.isVecAvailable = false;
      }
    } catch (error) {
      console.error('❌ VEC 가용성 확인 실패:', error);
      this.isVecAvailable = false;
      this.vecExtensionLoaded = false;
    }
  }

  /**
   * 벡터 검색 실행
   */
  async search(
    queryVector: number[], 
    options: VectorSearchOptions = {}
  ): Promise<VectorSearchResult[]> {
    if (!this.db || !this.isVecAvailable) {
      console.warn('⚠️ VEC를 사용할 수 없습니다. 빈 결과를 반환합니다.');
      return [];
    }

    const {
      limit = this.defaultLimit,
      threshold = this.defaultThreshold,
      type,
      includeContent = true,
      includeMetadata = false
    } = options;

    // 벡터 차원 검증
    if (queryVector.length !== this.defaultDimensions) {
      console.error(`❌ 벡터 차원 불일치: 예상 ${this.defaultDimensions}, 실제 ${queryVector.length}`);
      return [];
    }

    try {
      // VEC 검색 쿼리 (sqlite-vec의 vec0 테이블 사용)
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
        FROM memory_item_vec vec
        JOIN memory_item mi ON vec.rowid = mi.id
        WHERE vec.embedding MATCH ?
        ${type ? 'AND mi.type = ?' : ''}
        ORDER BY vec.distance ASC
        LIMIT ?
      `;

      const params = [JSON.stringify(queryVector), ...(type ? [type] : []), limit];
      const results = this.db.prepare(vecQuery).all(...params) as any[];

      // 유사도를 0-1 범위로 정규화 (distance는 작을수록 유사함)
      const normalizedResults = results
        .map(result => ({
          ...result,
          similarity: Math.max(0, 1 - result.similarity), // distance를 similarity로 변환
          tags: result.tags ? JSON.parse(result.tags) : undefined
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
   * 하이브리드 검색 (벡터 + 메타데이터)
   * SQLite 호환성을 위해 LEFT JOIN 사용
   */
  async hybridSearch(
    queryVector: number[],
    textQuery: string,
    options: VectorSearchOptions = {}
  ): Promise<VectorSearchResult[]> {
    if (!this.db || !this.isVecAvailable) {
      console.warn('⚠️ VEC를 사용할 수 없습니다. 빈 결과를 반환합니다.');
      return [];
    }

    const {
      limit = this.defaultLimit,
      threshold = this.defaultThreshold,
      type,
      includeContent = true,
      includeMetadata = true
    } = options;

    // 벡터 차원 검증
    if (queryVector.length !== this.defaultDimensions) {
      console.error(`❌ 벡터 차원 불일치: 예상 ${this.defaultDimensions}, 실제 ${queryVector.length}`);
      return [];
    }

    try {
      // 벡터 검색과 텍스트 검색을 결합한 하이브리드 쿼리 (SQLite 호환)
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
          FROM memory_item_vec vec
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
        textQuery,
        ...(type ? [type] : []),
        limit
      ];

      const results = this.db.prepare(hybridQuery).all(...params) as any[];

      // 결과 정규화
      const normalizedResults = results
        .map(result => ({
          memory_id: result.memory_id,
          similarity: result.vector_similarity * 0.6 + result.text_similarity * 0.4,
          content: includeContent ? result.content : '',
          type: result.type,
          importance: result.importance,
          created_at: result.created_at,
          last_accessed: includeMetadata ? result.last_accessed : undefined,
          pinned: includeMetadata ? Boolean(result.pinned) : false,
          tags: includeMetadata && result.tags ? JSON.parse(result.tags) : undefined
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
   * 벡터 인덱스 상태 확인
   */
  getIndexStatus(): VectorIndexStatus {
    if (!this.db) {
      return { 
        available: false, 
        tableExists: false, 
        recordCount: 0, 
        dimensions: this.defaultDimensions,
        vecExtensionLoaded: false
      };
    }

    try {
      const tableExists = this.isVecAvailable;
      let recordCount = 0;

      if (tableExists) {
        const result = this.db.prepare('SELECT COUNT(*) as count FROM memory_item_vec').get() as { count: number };
        recordCount = result.count;
      }

      return {
        available: this.isVecAvailable,
        tableExists,
        recordCount,
        dimensions: this.defaultDimensions,
        vecExtensionLoaded: this.vecExtensionLoaded
      };
    } catch (error) {
      console.error('❌ 인덱스 상태 확인 실패:', error);
      return { 
        available: false, 
        tableExists: false, 
        recordCount: 0, 
        dimensions: this.defaultDimensions,
        vecExtensionLoaded: false
      };
    }
  }

  /**
   * 벡터 인덱스 재구성
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
   * 벡터 검색 성능 테스트
   */
  async performanceTest(queryVector: number[], iterations: number = 10): Promise<{
    averageTime: number;
    minTime: number;
    maxTime: number;
    results: number;
    successRate: number;
  }> {
    if (!this.db || !this.isVecAvailable) {
      return { averageTime: 0, minTime: 0, maxTime: 0, results: 0, successRate: 0 };
    }

    const times: number[] = [];
    let resultCount = 0;
    let successCount = 0;

    for (let i = 0; i < iterations; i++) {
      try {
        const startTime = Date.now();
        const results = await this.search(queryVector, { limit: 10 });
        const endTime = Date.now();
        
        times.push(endTime - startTime);
        if (i === 0) resultCount = results.length;
        successCount++;
      } catch (error) {
        console.warn(`⚠️ 성능 테스트 ${i + 1}회차 실패:`, error);
        times.push(0);
      }
    }

    const averageTime = times.reduce((a, b) => a + b, 0) / times.length;
    const minTime = Math.min(...times.filter(t => t > 0));
    const maxTime = Math.max(...times);
    const successRate = successCount / iterations;

    console.log(`🔍 벡터 검색 성능 테스트: 평균 ${averageTime.toFixed(2)}ms (${iterations}회, 성공률: ${(successRate * 100).toFixed(1)}%)`);

    return {
      averageTime,
      minTime: minTime || 0,
      maxTime,
      results: resultCount,
      successRate
    };
  }

  /**
   * 벡터 차원 확인
   */
  getDimensions(): number {
    return this.defaultDimensions;
  }

  /**
   * VEC 사용 가능 여부 확인
   */
  isAvailable(): boolean {
    return this.isVecAvailable;
  }

  /**
   * 데이터베이스 연결 상태 확인
   */
  isConnected(): boolean {
    return this.db !== null;
  }
}

// 싱글톤 인스턴스
let vectorSearchEngineInstance: VectorSearchEngine | null = null;

export function getVectorSearchEngine(): VectorSearchEngine {
  if (!vectorSearchEngineInstance) {
    vectorSearchEngineInstance = new VectorSearchEngine();
  }
  return vectorSearchEngineInstance;
}

export function createVectorSearchEngine(): VectorSearchEngine {
  return new VectorSearchEngine();
}

export function resetVectorSearchEngine(): void {
  vectorSearchEngineInstance = null;
}