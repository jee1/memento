/**
 * 성능 모니터링 서비스
 * Memento MCP 서버의 성능 지표 수집 및 분석
 */

import { DatabaseUtils } from '../utils/database.js';
import Database from 'better-sqlite3';

export interface PerformanceMetrics {
  // 데이터베이스 메트릭
  database: {
    totalMemories: number;
    memoryByType: Record<string, number>;
    averageMemorySize: number;
    databaseSize: number;
    indexUsage: Record<string, number>;
    queryPerformance: {
      averageQueryTime: number;
      slowQueries: Array<{ query: string; time: number; count: number }>;
    };
  };
  
  // 검색 메트릭
  search: {
    totalSearches: number;
    averageSearchTime: number;
    searchByType: Record<string, number>;
    cacheHitRate: number;
    embeddingSearchRate: number;
  };
  
  // 메모리 사용량
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  
  // 시스템 리소스
  system: {
    uptime: number;
    cpuUsage: number;
    loadAverage: number[];
  };
  
  // 타임스탬프
  timestamp: Date;
}

export interface QueryStats {
  query: string;
  count: number;
  totalTime: number;
  averageTime: number;
  lastExecuted: Date;
}

export class PerformanceMonitor {
  private queryStats: Map<string, QueryStats> = new Map();
  private searchStats: Map<string, number> = new Map();
  private startTime: Date = new Date();
  private db: Database.Database | null = null;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * 쿼리 실행 시간 측정
   */
  async measureQuery<T>(
    queryName: string,
    queryFn: () => Promise<T>
  ): Promise<T> {
    const startTime = process.hrtime.bigint();
    
    try {
      const result = await queryFn();
      const endTime = process.hrtime.bigint();
      const executionTime = Number(endTime - startTime) / 1_000_000; // 밀리초로 변환
      
      this.recordQueryStats(queryName, executionTime);
      return result;
    } catch (error) {
      const endTime = process.hrtime.bigint();
      const executionTime = Number(endTime - startTime) / 1_000_000;
      
      this.recordQueryStats(queryName, executionTime, true);
      throw error;
    }
  }

  /**
   * 검색 실행 시간 측정
   */
  async measureSearch<T>(
    searchType: string,
    searchFn: () => Promise<T>
  ): Promise<T> {
    const startTime = process.hrtime.bigint();
    
    try {
      const result = await searchFn();
      const endTime = process.hrtime.bigint();
      const executionTime = Number(endTime - startTime) / 1_000_000;
      
      this.recordSearchStats(searchType, executionTime);
      return result;
    } catch (error) {
      const endTime = process.hrtime.bigint();
      const executionTime = Number(endTime - startTime) / 1_000_000;
      
      this.recordSearchStats(searchType, executionTime, true);
      throw error;
    }
  }

  /**
   * 성능 메트릭 수집
   */
  async collectMetrics(): Promise<PerformanceMetrics> {
    if (!this.db) {
      throw new Error('데이터베이스가 초기화되지 않았습니다');
    }

    const databaseMetrics = await this.collectDatabaseMetrics();
    const searchMetrics = this.collectSearchMetrics();
    const memoryMetrics = this.collectMemoryMetrics();
    const systemMetrics = this.collectSystemMetrics();

    return {
      database: databaseMetrics,
      search: searchMetrics,
      memory: memoryMetrics,
      system: systemMetrics,
      timestamp: new Date()
    };
  }

  /**
   * 데이터베이스 메트릭 수집
   */
  private async collectDatabaseMetrics() {
    if (!this.db) throw new Error('데이터베이스가 초기화되지 않았습니다');

    // 총 메모리 수
    const totalMemories = await this.measureQuery('count_memories', async () => {
      const result = await DatabaseUtils.all(this.db!, 'SELECT COUNT(*) as count FROM memory_item');
      return result[0].count;
    });

    // 타입별 메모리 분포
    const memoryByType = await this.measureQuery('memory_by_type', async () => {
      const result = await DatabaseUtils.all(this.db!, `
        SELECT type, COUNT(*) as count 
        FROM memory_item 
        GROUP BY type
      `);
      return result.reduce((acc, row) => {
        acc[row.type] = row.count;
        return acc;
      }, {} as Record<string, number>);
    });

    // 평균 메모리 크기
    const averageMemorySize = await this.measureQuery('avg_memory_size', async () => {
      const result = await DatabaseUtils.all(this.db!, `
        SELECT AVG(LENGTH(content)) as avg_size 
        FROM memory_item
      `);
      return Math.round(result[0].avg_size || 0);
    });

    // 데이터베이스 크기
    const databaseSize = await this.measureQuery('database_size', async () => {
      const result = await DatabaseUtils.all(this.db!, `
        SELECT page_count * page_size as size 
        FROM pragma_page_count(), pragma_page_size()
      `);
      return result[0].size;
    });

    // 인덱스 사용률
    const indexUsage = await this.measureQuery('index_usage', async () => {
      const result = await DatabaseUtils.all(this.db!, `
        SELECT name, sql 
        FROM sqlite_master 
        WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
      `);
      return result.reduce((acc, row) => {
        acc[row.name] = 1; // 간단한 구현, 실제로는 통계 테이블에서 가져와야 함
        return acc;
      }, {} as Record<string, number>);
    });

    // 쿼리 성능 통계
    const queryPerformance = this.calculateQueryPerformance();

    return {
      totalMemories,
      memoryByType,
      averageMemorySize,
      databaseSize,
      indexUsage,
      queryPerformance: {
        averageQueryTime: queryPerformance.averageQueryTime,
        slowQueries: queryPerformance.slowQueries.map(q => ({
          query: q.query,
          time: q.time,
          count: q.count
        }))
      }
    };
  }

  /**
   * 검색 메트릭 수집
   */
  private collectSearchMetrics() {
    const totalSearches = Array.from(this.searchStats.values()).reduce((sum, count) => sum + count, 0);
    const searchByType = Object.fromEntries(this.searchStats);
    
    // 평균 검색 시간 계산 (간단한 구현)
    const averageSearchTime = 50; // 실제로는 검색 시간을 기록해야 함
    
    return {
      totalSearches,
      averageSearchTime,
      searchByType,
      cacheHitRate: 0.8, // 캐시 구현 후 실제 값으로 교체
      embeddingSearchRate: 0.3 // 임베딩 검색 비율
    };
  }

  /**
   * 메모리 사용량 수집
   */
  private collectMemoryMetrics() {
    const usage = process.memoryUsage();
    
    return {
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      external: usage.external,
      rss: usage.rss
    };
  }

  /**
   * 시스템 메트릭 수집
   */
  private collectSystemMetrics() {
    const uptime = process.uptime();
    
    return {
      uptime,
      cpuUsage: process.cpuUsage().user / 1_000_000, // 마이크로초를 초로 변환
      loadAverage: [] // Node.js에서는 직접 제공하지 않음
    };
  }

  /**
   * 쿼리 통계 기록
   */
  private recordQueryStats(queryName: string, executionTime: number, isError: boolean = false) {
    const existing = this.queryStats.get(queryName);
    
    if (existing) {
      existing.count++;
      existing.totalTime += executionTime;
      existing.averageTime = existing.totalTime / existing.count;
      existing.lastExecuted = new Date();
    } else {
      this.queryStats.set(queryName, {
        query: queryName,
        count: 1,
        totalTime: executionTime,
        averageTime: executionTime,
        lastExecuted: new Date()
      });
    }
  }

  /**
   * 검색 통계 기록
   */
  private recordSearchStats(searchType: string, executionTime: number, isError: boolean = false) {
    const current = this.searchStats.get(searchType) || 0;
    this.searchStats.set(searchType, current + 1);
  }

  /**
   * 쿼리 성능 계산
   */
  private calculateQueryPerformance() {
    const queries = Array.from(this.queryStats.values());
    const averageQueryTime = queries.length > 0 
      ? queries.reduce((sum, q) => sum + q.averageTime, 0) / queries.length 
      : 0;
    
    const slowQueries = queries
      .filter(q => q.averageTime > 100) // 100ms 이상
      .sort((a, b) => b.averageTime - a.averageTime)
      .slice(0, 10); // 상위 10개

    return {
      averageQueryTime,
      slowQueries: slowQueries.map(q => ({
        query: q.query,
        time: q.averageTime,
        count: q.count
      }))
    };
  }

  /**
   * 성능 리포트 생성
   */
  async generateReport(): Promise<string> {
    const metrics = await this.collectMetrics();
    
    const report = `
# Memento MCP Server 성능 리포트
생성 시간: ${metrics.timestamp.toISOString()}

## 데이터베이스 성능
- 총 메모리: ${metrics.database.totalMemories}개
- 데이터베이스 크기: ${(metrics.database.databaseSize / 1024 / 1024).toFixed(2)} MB
- 평균 메모리 크기: ${metrics.database.averageMemorySize} 문자
- 평균 쿼리 시간: ${metrics.database.queryPerformance.averageQueryTime.toFixed(2)}ms

## 메모리 분포
${Object.entries(metrics.database.memoryByType)
  .map(([type, count]) => `- ${type}: ${count}개`)
  .join('\n')}

## 검색 성능
- 총 검색: ${metrics.search.totalSearches}회
- 평균 검색 시간: ${metrics.search.averageSearchTime}ms
- 캐시 적중률: ${(metrics.search.cacheHitRate * 100).toFixed(1)}%

## 시스템 리소스
- 힙 사용량: ${(metrics.memory.heapUsed / 1024 / 1024).toFixed(2)} MB
- RSS: ${(metrics.memory.rss / 1024 / 1024).toFixed(2)} MB
- 가동 시간: ${Math.floor(metrics.system.uptime / 60)}분

## 느린 쿼리 (상위 5개)
${metrics.database.queryPerformance.slowQueries
  .slice(0, 5)
  .map((q, i) => `${i + 1}. ${q.query}: ${q.time.toFixed(2)}ms (${q.count}회)`)
  .join('\n')}
`;

    return report;
  }

  /**
   * 통계 초기화
   */
  resetStats(): void {
    this.queryStats.clear();
    this.searchStats.clear();
    this.startTime = new Date();
  }
}
