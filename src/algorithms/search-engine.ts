/**
 * 개선된 검색 엔진 구현
 * FTS5 + 랭킹 알고리즘 + 필터링 결합
 */

import { SearchRanking } from './search-ranking.js';
import type { MemorySearchResult, MemorySearchFilters } from '../types/index.js';

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
   * 개선된 검색 구현
   */
  async search(
    db: any,
    query: SearchQuery
  ): Promise<SearchResult[]> {
    const { query: searchQuery, filters, limit = 10 } = query;
    
    // 1. FTS5 검색 쿼리 구성
    const ftsQuery = this.buildFTSQuery(searchQuery);
    
    // 2. 기본 SQL 쿼리 구성
    let sql = `
      SELECT 
        m.id, m.content, m.type, m.importance, m.created_at, 
        m.last_accessed, m.pinned, m.tags, m.source
      FROM memory_item_fts fts
      JOIN memory_item m ON fts.rowid = m.rowid
      WHERE memory_item_fts MATCH ?
    `;
    
    const conditions: string[] = [];
    const params: any[] = [ftsQuery];
    
    // 3. 필터 조건 추가
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
      params.push(filters.pinned);
    }
    
    if (filters?.time_from) {
      conditions.push(`m.created_at >= ?`);
      params.push(filters.time_from);
    }
    
    if (filters?.time_to) {
      conditions.push(`m.created_at <= ?`);
      params.push(filters.time_to);
    }
    
    if (conditions.length > 0) {
      sql += ` AND ${conditions.join(' AND ')}`;
    }
    
    // 4. 결과 제한
    sql += ` ORDER BY m.created_at DESC LIMIT ?`;
    params.push(limit * 2); // 더 많은 후보를 가져와서 랭킹 적용
    
    // 5. 데이터베이스 쿼리 실행
    const results = await this.executeQuery(db, sql, params);
    
    // 6. 랭킹 알고리즘 적용
    const rankedResults = this.applyRanking(results, searchQuery);
    
    // 7. 최종 결과 반환 (limit 적용)
    return rankedResults.slice(0, limit);
  }

  /**
   * FTS5 검색 쿼리 구성
   * 대소문자 구분 문제 해결
   */
  private buildFTSQuery(query: string): string {
    // FTS5 특수 문자 이스케이프
    const escapeFTS5 = (str: string): string => {
      return str.replace(/["'\\]/g, '\\$&');
    };
    
    // 공백으로 분리된 단어들을 OR로 연결
    const words = query.trim().split(/\s+/).filter(word => word.length > 0);
    
    if (words.length === 0) {
      return '*'; // 빈 쿼리인 경우 모든 문서 검색
    }
    
    if (words.length === 1) {
      // 단일 단어: 대소문자 구분 없이 검색
      const escapedWord = escapeFTS5(words[0]!);
      return `"${escapedWord}" OR ${escapedWord}`;
    } else {
      // 여러 단어: 각 단어를 OR로 연결하고 전체 구문도 포함
      const wordQueries = words.map(word => {
        const escapedWord = escapeFTS5(word);
        return `"${escapedWord}" OR ${escapedWord}`;
      });
      const phraseQuery = `"${escapeFTS5(query)}"`;
      
      return `${phraseQuery} OR ${wordQueries.join(' OR ')}`;
    }
  }

  /**
   * 데이터베이스 쿼리 실행
   */
  private async executeQuery(db: any, sql: string, params: any[]): Promise<any[]> {
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err: any, rows: any[]) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  /**
   * 랭킹 알고리즘 적용
   */
  private applyRanking(results: any[], query: string): SearchResult[] {
    const selectedContents: string[] = [];
    
    return results
      .map((row: any) => {
        // 관련성 계산
        const relevance = this.ranking.calculateRelevance(
          query,
          row.content,
          row.tags ? JSON.parse(row.tags) : []
        );
        
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
        
        // 사용성 계산
        const usage = this.ranking.calculateUsage(
          row.last_accessed ? new Date(row.last_accessed) : undefined
        );
        
        // 중복 패널티 계산
        const duplicationPenalty = this.ranking.calculateDuplicationPenalty(
          row.content,
          selectedContents
        );
        
        // 최종 점수 계산
        const finalScore = this.ranking.calculateFinalScore({
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
          recall_reason: this.generateRecallReason(relevance, recency, importance, finalScore)
        };
      })
      .sort((a, b) => b.score - a.score); // 점수 내림차순 정렬
  }

  /**
   * 검색 이유 생성
   */
  private generateRecallReason(
    relevance: number,
    recency: number,
    importance: number,
    finalScore: number
  ): string {
    const reasons: string[] = [];
    
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
