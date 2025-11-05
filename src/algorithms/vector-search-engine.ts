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
  types?: string[];    // 다중 메모리 타입 필터
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
  private readonly defaultDimensions = 384;
  private providerDimensions: Record<string, number> = {
    tfidf: 384,
    minilm: 384,
    openai: 1536,
    gemini: 768
  };
  private readonly defaultThreshold = 0.7;
  private readonly defaultLimit = 10;

  constructor() {
    // VEC 사용 가능 여부는 데이터베이스 연결 시 확인
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
   * 데이터베이스 초기화
   */
  initialize(db: Database.Database): void {
    this.db = db;
    this.checkVecAvailability();
    this.refreshProviderDimensions();
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
      // 1. 제공자별 vec0 테이블 중 하나라도 존재하는지 확인
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
      const tableCheck = Array.isArray(tableRows) 
        ? (tableRows as Array<{ name: string; type: string }>)
        : [];

      if (tableCheck.length === 0) {
        console.log('⚠️ VEC 테이블이 없습니다. 벡터 검색이 비활성화됩니다.');
        this.isVecAvailable = false;
        this.vecExtensionLoaded = false;
        return;
      }

      // 2. VEC 함수 사용 가능 여부 확인 (첫 번째 테이블로 테스트)
      try {
        const testTableEntry = tableCheck.find((table): table is { name: string; type: string } => 
          typeof table === 'object' && table !== null && typeof (table as any).name === 'string'
        );
        const testTable = testTableEntry?.name ?? 'memory_item_vec_tfidf';
        const testStatement = this.db.prepare(`
          SELECT distance FROM ${testTable} 
          WHERE embedding MATCH ? 
          LIMIT 0
        `);

        if (typeof testStatement.get !== 'function') {
          console.warn('⚠️ VEC 테스트 쿼리를 실행할 수 없습니다: get() 메서드가 없습니다.');
          this.vecExtensionLoaded = false;
          this.isVecAvailable = false;
          return;
        }

        testStatement.get(JSON.stringify(new Array(this.defaultDimensions).fill(0)));
        
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
   * provider별 임베딩 차원을 메타데이터에서 갱신
   */
  private refreshProviderDimensions(): void {
    if (!this.db) {
      return;
    }

    try {
      const dimensionStatement = this.db.prepare(`
        SELECT embedding_provider as provider, MAX(dimensions) as dimensions
        FROM memory_embedding
        WHERE embedding_provider IS NOT NULL
          AND embedding_provider != ''
          AND dimensions IS NOT NULL
        GROUP BY embedding_provider
      `);
      const dimensionRows = typeof dimensionStatement.all === 'function'
        ? dimensionStatement.all()
        : [];
      const rows = Array.isArray(dimensionRows)
        ? dimensionRows as Array<{ provider: string; dimensions: number | null }>
        : [];

      for (const row of rows) {
        const provider = (row.provider || '').toLowerCase();
        const dimensions = row.dimensions ?? 0;
        if (provider && dimensions > 0) {
          this.providerDimensions[provider] = dimensions;
        }
      }
    } catch (error) {
      console.warn('⚠️ 임베딩 차원 정보를 불러오지 못했습니다:', error);
    }
  }

  /**
   * 벡터 검색 실행
   */
  async search(
    queryVector: number[], 
    options: VectorSearchOptions = {},
    provider: string = 'tfidf'
  ): Promise<VectorSearchResult[]> {
    if (!this.db) {
      console.warn('⚠️ 데이터베이스 연결이 없어 벡터 검색을 진행할 수 없습니다.');
      return [];
    }

    if (!this.isVecAvailable) {
      console.warn('⚠️ VEC를 사용할 수 없습니다. 빈 결과를 반환합니다.');
      return [];
    }

    const {
      limit = this.defaultLimit,
      threshold = this.defaultThreshold,
      types,
      includeContent = true,
      includeMetadata = false
    } = options;
    const normalizedProvider = provider.toLowerCase();
    const expectedDimensions = this.getExpectedDimensions(normalizedProvider);
    const typeFilters = Array.isArray(types) ? types.filter(Boolean) : [];
    const typeClause = typeFilters.length > 0
      ? `AND mi.type IN (${typeFilters.map(() => '?').join(',')})`
      : '';

    // 벡터 차원 검증
    if (queryVector.length !== expectedDimensions) {
      console.error(`❌ 벡터 차원 불일치: 제공자 ${normalizedProvider}, 예상 ${expectedDimensions}, 실제 ${queryVector.length}`);
      return [];
    }

    try {
      // 제공자별 테이블명 결정
      const tableName = this.getVectorTableName(normalizedProvider);
      
      // 타입 필터가 있는 경우 더 많은 결과를 가져와서 필터링 후 최종 limit을 적용
      const prefetchLimit = typeFilters.length > 0 ? limit * 5 : limit;

      // VEC 검색 쿼리 (제공자별 vec0 테이블 사용)
      // JOIN 전에 서브쿼리로 vec 검색을 먼저 수행하여 LIMIT을 적용해야 함
      const vecQuery = `
        SELECT 
          me.memory_id as memory_id,
          t.distance as similarity,
          mi.content,
          mi.type,
          mi.importance,
          mi.created_at,
          mi.last_accessed,
          mi.pinned,
          mi.tags
        FROM (
          SELECT rowid, distance 
          FROM ${tableName}
          WHERE embedding MATCH ?
          ORDER BY distance ASC
          LIMIT ?
        ) t
        JOIN memory_embedding me ON t.rowid = me.id
        JOIN memory_item mi ON mi.id = me.memory_id
        WHERE 1=1
        ${typeClause}
        ORDER BY t.distance ASC
        LIMIT ?
      `;

      const params = [
        JSON.stringify(queryVector),
        prefetchLimit,
        ...typeFilters,
        limit
      ];
      const queryStatement = this.db.prepare(vecQuery);
      if (typeof queryStatement.all !== 'function') {
        console.warn('⚠️ 벡터 검색 쿼리를 실행할 수 없습니다: all() 메서드가 없습니다.');
        return [];
      }
      const rawResults = queryStatement.all(...params);
      const results = Array.isArray(rawResults) ? rawResults as any[] : [];

      // 유사도를 0-1 범위로 정규화 (distance는 작을수록 유사함)
      const normalizedResults = results
        .map(result => ({
          ...result,
          similarity: Math.max(0, 1 - result.similarity), // distance를 similarity로 변환
          tags: this.safeParseTags(result.tags)
        }));

      // 디버깅: 임계값 적용 전 상위 5개 결과의 유사도 점수 로깅
      console.log('🔍 [Debug] Top 5 results before threshold filtering:');
      normalizedResults.slice(0, 5).forEach(r => {
        console.log(`  - Memory ID: ${r.memory_id}, Similarity: ${r.similarity.toFixed(4)}`);
      });
      
      const finalResults = normalizedResults
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

      return finalResults;

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
    options: VectorSearchOptions = {},
    provider: string = 'tfidf'
  ): Promise<VectorSearchResult[]> {
    if (!this.db) {
      console.warn('⚠️ 데이터베이스 연결이 없어 하이브리드 검색을 진행할 수 없습니다.');
      return [];
    }

    if (!this.isVecAvailable) {
      console.warn('⚠️ VEC를 사용할 수 없습니다. 빈 결과를 반환합니다.');
      return [];
    }

    const {
      limit = this.defaultLimit,
      threshold = this.defaultThreshold,
      types,
      includeContent = true,
      includeMetadata = true
    } = options;
    const normalizedProvider = provider.toLowerCase();
    const expectedDimensions = this.getExpectedDimensions(normalizedProvider);
    const typeFilters = Array.isArray(types) ? types.filter(Boolean) : [];
    const typeClause = typeFilters.length > 0
      ? `AND mi.type IN (${typeFilters.map(() => '?').join(',')})`
      : '';

    // 벡터 차원 검증
    if (queryVector.length !== expectedDimensions) {
      console.error(`❌ 벡터 차원 불일치: 제공자 ${normalizedProvider}, 예상 ${expectedDimensions}, 실제 ${queryVector.length}`);
      return [];
    }

    try {
      // 제공자별 테이블명 결정
      const tableName = this.getVectorTableName(normalizedProvider);
      
      // 벡터 검색과 텍스트 검색을 결합한 하이브리드 쿼리 (SQLite 호환)
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
          ${typeClause}
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
          ${typeClause}
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
        ...typeFilters,
        textQuery,
        ...typeFilters,
        limit
      ];

      const hybridStatement = this.db.prepare(hybridQuery);
      if (typeof hybridStatement.all !== 'function') {
        console.warn('⚠️ 하이브리드 검색 쿼리를 실행할 수 없습니다: all() 메서드가 없습니다.');
        return [];
      }
      const hybridResults = hybridStatement.all(...params);
      const results = Array.isArray(hybridResults) ? hybridResults as any[] : [];

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
        // 모든 제공자별 테이블의 레코드 수 합계
        const providers = ['tfidf', 'minilm', 'openai', 'gemini'];
        for (const provider of providers) {
          const tableName = this.getVectorTableName(provider);
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
        dimensions: this.getExpectedDimensions('tfidf'),
        vecExtensionLoaded: this.vecExtensionLoaded
      };
    } catch (error) {
      console.error('❌ 인덱스 상태 확인 실패:', error);
      return { 
        available: false, 
        tableExists: false, 
        recordCount: 0, 
        dimensions: this.getExpectedDimensions('tfidf'),
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
  getDimensions(provider: string = 'tfidf'): number {
    return this.getExpectedDimensions(provider.toLowerCase());
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

  private getExpectedDimensions(provider: string): number {
    return this.providerDimensions[provider] ?? this.defaultDimensions;
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
