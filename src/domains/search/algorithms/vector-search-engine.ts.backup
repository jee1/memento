/**
 * 의미적 유사성을 기반으로 한 고성능 벡터 검색을 제공합니다.
 * sqlite-vec를 사용하여 대용량 벡터 데이터에서도 빠른 유사도 검색을 수행합니다.
 * Memento MCP Server의 핵심 벡터 검색 컴포넌트로서 의미 기반 검색 기능을 제공합니다.
 */

import Database from 'better-sqlite3';
import { VECTOR_SEARCH_CONFIG } from '../../../shared/config/vector-search.config.js';
import { validateTableName, getVectorTableName as getValidatedVectorTableName } from '../../../shared/utils/sql-security-validator.js';
import { PIIMasker } from '../../../shared/utils/pii-masker.js';

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
  threshold?: number;  // 관련성이 낮은 결과를 필터링하여 검색 품질을 향상시키기 위한 최소 유사도 임계값
  types?: string[];    // 특정 메모리 타입만 검색하여 정확한 결과를 제공하기 위한 다중 메모리 타입 필터
  includeContent?: boolean;
  includeMetadata?: boolean; // 상세한 분석을 위해 메타데이터 포함 여부를 제어합니다.
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
    tfidf: 512, // LightweightEmbeddingService는 512차원을 생성
    minilm: 384,
    openai: 1536,
    gemini: 768
  };
  private readonly defaultThreshold = 0.7;
  private readonly defaultLimit = 10;

  constructor() {
    // VEC 사용 가능 여부는 데이터베이스 연결 시 확인하여 런타임에 동적으로 판단합니다.
  }

  /**
   * 각 임베딩 provider별로 다른 벡터 테이블을 사용하여 차원 불일치를 방지합니다.
   * provider에 따라 적절한 테이블명을 반환하여 정확한 검색을 보장합니다.
   * SQL Injection 방지를 위해 화이트리스트 기반 검증을 수행합니다.
   */
  private getVectorTableName(provider: string): string {
    return getValidatedVectorTableName(provider);
  }

  /**
   * 데이터베이스 연결을 설정하고 벡터 검색 기능의 사용 가능 여부를 확인합니다.
   * provider별 차원 정보를 갱신하여 정확한 검색을 보장합니다.
   */
  initialize(db: Database.Database): void {
    this.db = db;
    this.checkVecAvailability();
    this.refreshProviderDimensions();
  }

  /**
   * 벡터 검색 기능이 실제로 사용 가능한지 확인하여 안전한 검색을 보장합니다.
   * sqlite-vec 확장 로드 여부와 테이블 존재를 모두 확인하여 런타임 오류를 방지합니다.
   */
  private checkVecAvailability(): void {
    if (!this.db) {
      this.isVecAvailable = false;
      this.vecExtensionLoaded = false;
      return;
    }

    try {
      // 벡터 검색을 수행할 수 있는 테이블이 존재하는지 확인하여 기능 사용 가능 여부를 판단합니다.
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

      // VEC 함수가 실제로 동작하는지 테스트하여 런타임 오류를 사전에 방지합니다.
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
        const maskedVecError = vecError instanceof Error ? PIIMasker.maskError(vecError) : { message: String(vecError), name: 'Error' };
        console.warn('⚠️ VEC 함수를 사용할 수 없습니다:', maskedVecError.message);
        this.vecExtensionLoaded = false;
        this.isVecAvailable = false;
      }
    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      console.error('❌ VEC 가용성 확인 실패:', maskedError.message);
      this.isVecAvailable = false;
      this.vecExtensionLoaded = false;
    }
  }

  /**
   * 데이터베이스에 저장된 실제 임베딩 차원을 조회하여 정확한 벡터 검색을 보장합니다.
   * provider별로 다른 차원을 사용할 수 있으므로 메타데이터에서 차원 정보를 갱신합니다.
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
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      console.warn('⚠️ 임베딩 차원 정보를 불러오지 못했습니다:', maskedError.message);
    }
  }

  /**
   * 특정 provider의 실제 저장된 임베딩 차원을 조회하여 벡터 검색 시 차원 불일치를 방지합니다.
   */
  private async getActualStoredDimensions(provider: string): Promise<number | null> {
    if (!this.db) {
      return null;
    }

    try {
      const result = this.db.prepare(`
        SELECT dimensions
        FROM memory_embedding
        WHERE embedding_provider = ?
          AND dimensions IS NOT NULL
        LIMIT 1
      `).get(provider) as { dimensions: number } | undefined;

      return result?.dimensions ?? null;
    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      console.warn(`⚠️ 저장된 임베딩 차원 조회 실패 (${provider}):`, maskedError.message);
      return null;
    }
  }

  /**
   * 쿼리 벡터와 유사한 메모리를 검색하여 의미적으로 관련된 결과를 제공합니다.
   * sqlite-vec의 고성능 벡터 검색 기능을 활용하여 빠르고 정확한 검색을 수행합니다.
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

    // 쿼리 벡터의 차원이 저장된 임베딩과 일치하는지 검증하여 검색 오류를 방지합니다.
    let adjustedQueryVector = queryVector;
    if (queryVector.length !== expectedDimensions) {
      // 데이터베이스에 저장된 실제 임베딩 차원을 확인하여 차원 불일치를 처리합니다.
      const actualDimensions = await this.getActualStoredDimensions(normalizedProvider);
      
      if (actualDimensions && queryVector.length === actualDimensions) {
        // 쿼리 벡터가 저장된 임베딩의 실제 차원과 일치하면 사용하여 정확한 검색을 수행합니다.
        console.log(`ℹ️ 벡터 차원 조정: 제공자 ${normalizedProvider}, 예상 ${expectedDimensions}, 실제 저장된 차원 ${actualDimensions}, 쿼리 ${queryVector.length}`);
        // 실제 차원이 일치하므로 검증을 통과하여 정상적인 검색을 진행합니다.
      } else if (actualDimensions && queryVector.length !== actualDimensions) {
        // 차원 불일치로 인한 검색 오류를 방지하기 위해 빈 결과를 반환합니다.
        console.error(`❌ 벡터 차원 불일치: 제공자 ${normalizedProvider}, 예상 ${expectedDimensions}, 저장된 차원 ${actualDimensions}, 쿼리 ${queryVector.length}`);
        console.error(`💡 해결 방법: 저장된 임베딩과 동일한 provider로 쿼리 임베딩을 생성해야 합니다.`);
        return [];
      } else {
        // 차원 정보를 확인할 수 없는 경우 안전하게 빈 결과를 반환하여 오류를 방지합니다.
        console.warn(`⚠️ 벡터 차원 불일치: 제공자 ${normalizedProvider}, 예상 ${expectedDimensions}, 실제 ${queryVector.length}`);
        console.warn(`⚠️ 저장된 임베딩 정보를 확인할 수 없어 차원 불일치를 처리할 수 없습니다. 빈 결과를 반환합니다.`);
        return [];
      }
    }

    try {
      // 제공자별 테이블명 결정
      const tableName = this.getVectorTableName(normalizedProvider);
      
      // 타입 필터링으로 인해 결과가 줄어들 수 있으므로 충분한 후보를 확보합니다.
      const prefetchLimit = typeFilters.length > 0 ? limit * 5 : limit;

      // VEC 검색 쿼리를 구성하여 벡터 유사도 검색을 수행합니다.
      // JOIN 전에 서브쿼리로 벡터 검색을 먼저 수행하여 성능을 최적화하고 LIMIT을 적용합니다.
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
        JSON.stringify(adjustedQueryVector),
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

      // distance를 similarity로 변환하여 0-1 범위로 정규화하고 직관적인 점수 체계를 제공합니다.
      const normalizedResults = results
        .map(result => ({
          ...result,
          similarity: Math.max(0, 1 - result.similarity), // distance를 similarity로 변환
          tags: this.safeParseTags(result.tags)
        }));

      // 검색 품질을 모니터링하고 디버깅을 위해 임계값 적용 전 상위 결과를 로깅합니다.
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
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      console.error('❌ 벡터 검색 실패:', maskedError.message);
      return [];
    }
  }

  /**
   * 벡터 검색과 메타데이터 검색을 결합하여 검색 정확도와 포괄성을 동시에 확보합니다.
   * SQLite 호환성을 위해 LEFT JOIN을 사용하여 안정적인 검색을 보장합니다.
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

    // 쿼리 벡터의 차원이 저장된 임베딩과 일치하는지 검증하여 검색 오류를 방지합니다.
    if (queryVector.length !== expectedDimensions) {
      console.error(`❌ 벡터 차원 불일치: 제공자 ${normalizedProvider}, 예상 ${expectedDimensions}, 실제 ${queryVector.length}`);
      return [];
    }

    try {
      // 제공자별 테이블명 결정
      const tableName = this.getVectorTableName(normalizedProvider);
      
      // 벡터 검색과 텍스트 검색을 결합하여 검색 정확도와 포괄성을 동시에 확보합니다.
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

      // 벡터 유사도와 텍스트 유사도를 가중 평균하여 종합적인 유사도 점수를 계산합니다.
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
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      console.error('❌ 하이브리드 검색 실패:', maskedError.message);
      return [];
    }
  }

  /**
   * 벡터 검색 기능의 현재 상태를 확인하여 사용 가능 여부와 인덱스 정보를 제공합니다.
   * 시스템 모니터링과 디버깅을 위해 인덱스 상태를 조회합니다.
   */
  getIndexStatus(): VectorIndexStatus {
    if (!this.db) {
      return { 
        available: false, 
        tableExists: false, 
        recordCount: 0, 
        dimensions: this.getExpectedDimensions('tfidf'), // TF-IDF 기본 차원 사용
        vecExtensionLoaded: false
      };
    }

    try {
      const tableExists = this.isVecAvailable;
      let recordCount = 0;

      if (tableExists) {
        // 모든 provider별 테이블의 레코드 수를 합산하여 전체 벡터 데이터 규모를 파악합니다.
        const providers = ['tfidf', 'minilm', 'openai', 'gemini'];
        for (const provider of providers) {
          const tableName = this.getVectorTableName(provider);
          try {
            const result = this.db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`).get() as { count: number };
            recordCount += result.count;
          } catch (error) {
            // 테이블이 존재하지 않는 경우 무시하여 일부 provider가 없어도 안정적으로 동작합니다.
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
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      console.error('❌ 인덱스 상태 확인 실패:', maskedError.message);
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
   * 벡터 인덱스를 재구성하여 검색 성능을 최적화합니다.
   * sqlite-vec는 자동으로 인덱스를 관리하므로 수동 재구성이 필요 없는 경우를 처리합니다.
   */
  async rebuildIndex(): Promise<boolean> {
    if (!this.db || !this.isVecAvailable) {
      console.warn('⚠️ VEC를 사용할 수 없습니다.');
      return false;
    }

    try {
      console.log('🔄 벡터 인덱스 재구성 시작...');
      
      // sqlite-vec는 자동으로 인덱스를 관리하므로 수동 재구성이 필요 없지만 호환성을 위해 메서드를 제공합니다.
      console.log('✅ 벡터 인덱스 재구성 완료 (sqlite-vec는 자동 인덱스 관리)');
      return true;
    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      console.error('❌ 벡터 인덱스 재구성 실패:', maskedError.message);
      return false;
    }
  }

  /**
   * 벡터 검색의 성능을 측정하여 최적화 지점을 파악합니다.
   * 반복 실행을 통해 평균, 최소, 최대 응답 시간과 성공률을 계산합니다.
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
        const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
        console.warn(`⚠️ 성능 테스트 ${i + 1}회차 실패:`, maskedError.message);
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
   * 특정 provider의 벡터 차원을 조회하여 벡터 검색 시 차원 정보를 제공합니다.
   */
  getDimensions(provider: string = 'tfidf'): number {
    return this.getExpectedDimensions(provider.toLowerCase());
  }

  /**
   * 벡터 검색 기능이 사용 가능한지 확인하여 호출자가 적절한 처리를 할 수 있도록 합니다.
   */
  isAvailable(): boolean {
    return this.isVecAvailable;
  }

  /**
   * 데이터베이스 연결 상태를 확인하여 검색 실행 전 안전성을 보장합니다.
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
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      console.warn('⚠️ 태그 JSON 파싱 실패, 빈 배열로 대체합니다.', maskedError.message);
      return [];
    }
  }

  private getExpectedDimensions(provider: string): number {
    return this.providerDimensions[provider] ?? this.defaultDimensions;
  }
}

// 전역에서 단일 인스턴스를 공유하여 메모리 사용을 최적화하고 일관된 상태를 유지합니다.
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
