/**
 * 개선된 검색 엔진 구현
 * FTS5 + 랭킹 알고리즘 + 필터링 결합
 */

import { SearchRanking } from './search-ranking.js';
import type { MemorySearchFilters } from '../types/index.js';
import { getStopWords } from '../utils/stopwords.js';

export interface SearchQuery {
  query: string;
  filters?: MemorySearchFilters | undefined;
  limit?: number | undefined;
}

export interface SearchResult {
  id: string;
  content: string;
  type: string;
  importance: number;
  created_at: string;
  last_accessed?: string;
  pinned: boolean;
  tags?: string[];
  score: number;
  recall_reason: string;
}

export class SearchEngine {
  private ranking: SearchRanking;

  constructor() {
    this.ranking = new SearchRanking();
  }

  /**
   * 개선된 검색 구현 - FTS5 최적화
   */
  async search(
    db: any,
    query: SearchQuery
  ): Promise<{ items: SearchResult[], total_count: number, query_time: number }> {
    const startTime = process.hrtime.bigint();
    const { query: searchQuery, filters, limit = 10 } = query;
    
    // 1. ID 필터가 있으면 내용 검색 조건을 건너뛰기
    const hasIdFilter = filters?.id && filters.id.length > 0;
    
    let sql: string;
    const params: any[] = [];
    
    // 2. FTS5 검색 사용 (ID 필터가 없고 검색어가 있을 때)
    if (!hasIdFilter && searchQuery.trim().length > 0) {
      // FTS5 사용 가능 여부 확인
      const ftsAvailable = await this.checkFTS5Availability(db);
      
      if (ftsAvailable) {
        const ftsQuery = this.buildFTSQuery(searchQuery);
        sql = `
          SELECT 
            m.id, m.content, m.type, m.importance, m.created_at, 
            m.last_accessed, m.pinned, m.tags, m.source,
            memory_item_fts.rank as fts_rank
          FROM memory_item_fts
          JOIN memory_item m ON memory_item_fts.rowid = m.rowid
          WHERE memory_item_fts MATCH ?
        `;
        params.push(ftsQuery);
      } else {
        // FTS5가 없으면 기본 LIKE 검색 사용
        const likeQuery = `%${searchQuery}%`;
        sql = `
          SELECT 
            m.id, m.content, m.type, m.importance, m.created_at, 
            m.last_accessed, m.pinned, m.tags, m.source,
            0 as fts_rank
          FROM memory_item m
          WHERE m.content LIKE ? OR m.tags LIKE ? OR m.source LIKE ?
        `;
        params.push(likeQuery, likeQuery, likeQuery);
      }
    } else {
      // 3. 기본 SQL 쿼리 구성 (ID 필터가 있거나 검색어가 없을 때)
      sql = `
        SELECT 
          m.id, m.content, m.type, m.importance, m.created_at, 
          m.last_accessed, m.pinned, m.tags, m.source,
          0 as fts_rank
        FROM memory_item m
      `;
      
      // 내용 검색 조건 (검색어가 있을 때만)
      if (!hasIdFilter && searchQuery.trim().length > 0) {
        const likeQuery = `%${searchQuery}%`;
        sql += ` WHERE m.content LIKE ?`;
        params.push(likeQuery);
      }
    }
    
    // 4. 필터 조건 추가
    const conditions: string[] = [];
    
    if (filters?.id && filters.id.length > 0) {
      conditions.push(`m.id IN (${filters.id.map(() => '?').join(',')})`);
      params.push(...filters.id);
    }
    
    if (filters?.type && filters.type.length > 0) {
      conditions.push(`m.type IN (${filters.type.map(() => '?').join(',')})`);
      params.push(...filters.type);
    }
    
    if (filters?.privacy_scope && filters.privacy_scope.length > 0) {
      conditions.push(`m.privacy_scope IN (${filters.privacy_scope.map(() => '?').join(',')})`);
      params.push(...filters.privacy_scope);
    }
    
    if (filters?.pinned !== undefined) {
      conditions.push(`m.pinned = ?`);
      params.push(filters.pinned ? 1 : 0); // boolean을 숫자로 변환
    }
    
    if (filters?.time_from) {
      conditions.push(`m.created_at >= ?`);
      params.push(filters.time_from);
    }
    
    if (filters?.time_to) {
      conditions.push(`m.created_at <= ?`);
      params.push(filters.time_to);
    }
    
    // WHERE 절 추가
    if (conditions.length > 0) {
      const whereClause = sql.includes('WHERE') ? ' AND ' : ' WHERE ';
      sql += whereClause + conditions.join(' AND ');
    }
    
    // 5. 결과 제한 및 정렬 최적화
    sql += ` ORDER BY fts_rank DESC, m.created_at DESC LIMIT ?`;
    params.push(limit * 3); // FTS5 랭킹을 고려하여 더 많은 후보 가져오기
    
    // 6. 데이터베이스 쿼리 실행
    console.log('🔍 검색 쿼리:', sql);
    console.log('🔍 검색 파라미터:', params);
    const results = await this.executeQuery(db, sql, params);
    console.log('🔍 검색 결과 개수:', results.length);
    
    // 7. 랭킹 알고리즘 적용 (FTS5 랭킹 활용)
    const rankedResults = this.applyRanking(results, searchQuery);
    
    // 8. 최종 결과 반환 (limit 적용)
    const finalResults = rankedResults.slice(0, limit);
    
    // 9. 쿼리 시간 측정
    const endTime = process.hrtime.bigint();
    const queryTime = Number(endTime - startTime) / 1_000_000; // 밀리초로 변환
    
    return {
      items: finalResults,
      total_count: finalResults.length,
      query_time: queryTime
    };
  }

  /**
   * FTS5 검색 쿼리 구성
   * 아키텍처 문서에 따른 쿼리 전처리 구현
   */
  private buildFTSQuery(query: string): string {
    console.log('🔍 원본 쿼리:', `"${query}"`);
    
    // 1. 쿼리 전처리
    const preprocessedQuery = this.preprocessQuery(query);
    console.log('🔍 전처리 후:', `"${preprocessedQuery}"`);
    
    if (preprocessedQuery.length === 0) {
      console.log('🔍 빈 쿼리, 모든 문서 검색');
      return '*'; // 빈 쿼리인 경우 모든 문서 검색
    }
    
    // 2. FTS5 안전 쿼리 생성
    const safeQuery = this.makeFTSSafe(preprocessedQuery);
    console.log('🔍 FTS5 안전 쿼리:', `"${safeQuery}"`);
    
    if (safeQuery.length === 0) {
      console.log('🔍 안전 쿼리 빈 문자열, 모든 문서 검색');
      return '*';
    }
    
    return safeQuery;
  }

  /**
   * 쿼리 전처리 - 아키텍처 문서의 전처리 과정 구현
   */
  private preprocessQuery(query: string): string {
    // 1. 공백 정규화
    let processed = query.trim().replace(/\s+/g, ' ');
    
    // 2. 한글과 영문, 숫자, 공백만 유지 (특수문자 제거)
    processed = processed.replace(/[^a-zA-Z0-9가-힣\s]/g, ' ');
    
    // 3. 연속된 공백 제거
    processed = processed.replace(/\s+/g, ' ');
    
    // 4. 불용어 제거 (한국어/영어 불용어)
    const stopWords = getStopWords();
    const words = processed.split(' ').filter(word => 
      word.length > 0 && !stopWords.has(word.toLowerCase())
    );
    
    // 5. FTS5를 위한 공백으로 구분된 쿼리 반환
    return words.join(' ');
  }

  /**
   * FTS5 안전 쿼리 생성
   */
  private makeFTSSafe(query: string): string {
    // FTS5에서 특수문자 이스케이프
    return query
      .replace(/"/g, '""')  // 따옴표 이스케이프
      .replace(/'/g, "''")  // 작은따옴표 이스케이프
      .replace(/[\[\]{}()]/g, ' ') // 대괄호, 중괄호, 소괄호 제거
      .replace(/\s+/g, ' ') // 연속 공백 정리
      .trim();
  }

  /**
   * 데이터베이스 쿼리 실행
   */
  private async executeQuery(db: any, sql: string, params: any[]): Promise<any[]> {
    // better-sqlite3는 동기적이므로 직접 실행
    try {
      return db.prepare(sql).all(params);
    } catch (error) {
      throw error;
    }
  }

  /**
   * 랭킹 알고리즘 적용 - FTS5 랭킹 활용
   */
  private applyRanking(results: any[], query: string): SearchResult[] {
    const selectedContents: string[] = [];
    
    return results
      .map((row: any) => {
        // FTS5 랭킹이 있으면 활용, 없으면 기본 관련성 계산
        const ftsRank = row.fts_rank || 0;
        const relevance = ftsRank > 0 ? 
          Math.min(ftsRank / 100, 1.0) : // FTS5 랭킹을 0-1 범위로 정규화
          this.ranking.calculateRelevance({
            query,
            content: row.content,
            tags: row.tags ? JSON.parse(row.tags) : []
          });
        
        // 최근성 계산
        const recency = this.ranking.calculateRecency(
          new Date(row.created_at),
          row.type
        );
        
        // 중요도 계산
        const importance = this.ranking.calculateImportance(
          row.importance,
          row.pinned,
          row.type
        );
        
        // 사용성 계산 (기본 메트릭 사용)
        const usage = this.ranking.calculateUsage({
          viewCount: 1, // 기본값
          citeCount: 0,
          editCount: 0
        });
        
        // 중복 패널티 계산
        const duplicationPenalty = this.ranking.calculateDuplicationPenalty(
          row.content,
          selectedContents
        );
        
        // 최종 점수 계산 (FTS5 랭킹 가중치 적용)
        const finalScore = ftsRank > 0 ? 
          ftsRank * 0.7 + this.ranking.calculateFinalScore({
            relevance: 0.3,
            recency,
            importance,
            usage,
            duplication_penalty: duplicationPenalty
          }) * 0.3 :
          this.ranking.calculateFinalScore({
            relevance,
            recency,
            importance,
            usage,
            duplication_penalty: duplicationPenalty
          });
        
        // 선택된 콘텐츠에 추가 (다양성 확보)
        selectedContents.push(row.content);
        
        return {
          id: row.id,
          content: row.content,
          type: row.type,
          importance: row.importance,
          created_at: row.created_at,
          last_accessed: row.last_accessed,
          pinned: row.pinned,
          tags: row.tags ? JSON.parse(row.tags) : [],
          score: finalScore,
          recall_reason: this.generateRecallReason(relevance, recency, importance, finalScore, ftsRank > 0)
        };
      })
      .sort((a, b) => b.score - a.score); // 점수 내림차순 정렬
  }

  /**
   * FTS5 사용 가능 여부 확인
   */
  private async checkFTS5Availability(db: any): Promise<boolean> {
    try {
      // FTS5 테이블 존재 여부 확인
      const result = db.prepare(`
        SELECT name FROM sqlite_master 
        WHERE type='table' AND name='memory_item_fts'
      `).get();
      
      if (!result) {
        console.log('⚠️  FTS5 테이블이 존재하지 않음, 기본 검색으로 전환');
        return false;
      }
      
      // FTS5 테이블에 데이터가 있는지 확인
      const count = db.prepare('SELECT COUNT(*) as count FROM memory_item_fts').get();
      const hasData = count && count.count > 0;
      
      if (!hasData) {
        console.log('⚠️  FTS5 테이블에 데이터가 없음, 기본 검색으로 전환');
        return false;
      }
      
      // FTS5 쿼리 테스트
      try {
        db.prepare('SELECT * FROM memory_item_fts LIMIT 1').get();
        console.log('✅ FTS5 사용 가능');
        return true;
      } catch (ftsError) {
        console.log('⚠️  FTS5 쿼리 실패, 기본 검색으로 전환:', ftsError);
        return false;
      }
    } catch (error) {
      console.log('⚠️  FTS5 사용 불가능, 기본 검색으로 전환:', error);
      return false;
    }
  }

  /**
   * 검색 이유 생성
   */
  private generateRecallReason(
    relevance: number,
    recency: number,
    importance: number,
    finalScore: number,
    isFTS: boolean = false
  ): string {
    const reasons: string[] = [];
    
    if (isFTS) {
      reasons.push('FTS5 전문 검색');
    }
    if (relevance > 0.7) {
      reasons.push('높은 관련성');
    }
    if (recency > 0.8) {
      reasons.push('최근 생성');
    }
    if (importance > 0.8) {
      reasons.push('높은 중요도');
    }
    if (finalScore > 0.9) {
      reasons.push('종합 점수 우수');
    }
    
    return reasons.length > 0 ? reasons.join(', ') : '일반 검색 결과';
  }
}
