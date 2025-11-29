/**
 * 벡터 성능 테스트 리포지토리 구현
 * 성능 테스트 데이터베이스 접근 로직 분리
 */

import Database from 'better-sqlite3';
import type { PerformanceTestResult } from '../shared/types/vector-search.types';
import type { VectorPerformanceRepository } from '../shared/interfaces/database.interface';
import { VECTOR_SEARCH_CONFIG } from '../shared/config/vector-search.config';

export class VectorPerformanceRepositoryImpl implements VectorPerformanceRepository {
  private db: Database.Database | null = null;
  private isVecAvailable = false;

  constructor(db: Database.Database) {
    this.db = db;
    this.checkVecAvailability();
  }

  /**
   * VEC 사용 가능 여부 확인
   */
  private checkVecAvailability(): void {
    if (!this.db) {
      this.isVecAvailable = false;
      return;
    }

    try {
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
        this.isVecAvailable = false;
        return;
      }

      // VEC 함수 사용 가능 여부 확인
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
          this.isVecAvailable = false;
          return;
        }

        testStatement.get(JSON.stringify(new Array(VECTOR_SEARCH_CONFIG.defaultDimensions).fill(0)));
        
        this.isVecAvailable = true;
      } catch (vecError) {
        this.isVecAvailable = false;
      }
    } catch (error) {
      this.isVecAvailable = false;
    }
  }

  /**
   * 성능 테스트 실행
   */
  async runPerformanceTest(
    queryVector: number[], 
    iterations: number
  ): Promise<PerformanceTestResult> {
    if (!this.db || !this.isVecAvailable) {
      return { averageTime: 0, minTime: 0, maxTime: 0, results: 0, successRate: 0 };
    }

    const times: number[] = [];
    let resultCount = 0;
    let successCount = 0;

    for (let i = 0; i < iterations; i++) {
      try {
        const startTime = Date.now();
        const results = await this.executeSearch(queryVector);
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
   * 실제 검색 실행 (성능 테스트용)
   */
  private async executeSearch(queryVector: number[]): Promise<any[]> {
    if (!this.db) return [];

    try {
      const tableName = VECTOR_SEARCH_CONFIG.tableNames.tfidf;
      
      const query = `
        SELECT 
          vec.rowid as memory_id,
          vec.distance as similarity
        FROM ${tableName} vec
        WHERE vec.embedding MATCH ?
        ORDER BY vec.distance ASC
        LIMIT 10
      `;

      const statement = this.db.prepare(query);
      if (typeof statement.all !== 'function') {
        console.warn('⚠️ 성능 테스트 검색을 실행할 수 없습니다: all() 메서드가 없습니다.');
        return [];
      }
      const rawResults = statement.all(JSON.stringify(queryVector));
      return Array.isArray(rawResults) ? rawResults : [];
    } catch (error) {
      throw new Error(`검색 실행 실패: ${error}`);
    }
  }
}
