/**
 * 데이터베이스 성능 최적화 서비스
 * 인덱스 최적화, 쿼리 분석, 성능 튜닝
 */

import { DatabaseUtils } from '../utils/database.js';
import sqlite3 from 'sqlite3';

export interface IndexRecommendation {
  table: string;
  columns: string[];
  type: 'btree' | 'fts' | 'partial';
  priority: 'high' | 'medium' | 'low';
  reason: string;
  estimatedImprovement: string;
}

export interface QueryAnalysis {
  query: string;
  executionTime: number;
  explainPlan: any[];
  recommendations: string[];
  complexity: 'simple' | 'medium' | 'complex';
}

export interface DatabaseStats {
  tableStats: Record<string, {
    rowCount: number;
    size: number;
    indexCount: number;
    lastAnalyzed: Date;
  }>;
  indexStats: Record<string, {
    name: string;
    table: string;
    columns: string[];
    size: number;
    usage: number;
  }>;
  queryStats: {
    totalQueries: number;
    averageTime: number;
    slowQueries: QueryAnalysis[];
  };
}

export class DatabaseOptimizer {
  private db: sqlite3.Database;
  private queryHistory: Map<string, { count: number; totalTime: number; lastUsed: Date }> = new Map();

  constructor(db: sqlite3.Database) {
    this.db = db;
  }

  /**
   * 데이터베이스 성능 분석
   */
  async analyzePerformance(): Promise<DatabaseStats> {
    const tableStats = await this.analyzeTables();
    const indexStats = await this.analyzeIndexes();
    const queryStats = await this.analyzeQueries();

    return {
      tableStats,
      indexStats,
      queryStats
    };
  }

  /**
   * 테이블 분석
   */
  private async analyzeTables(): Promise<Record<string, any>> {
    const tables = await DatabaseUtils.all(this.db, `
      SELECT name FROM sqlite_master 
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    `);

    const stats: Record<string, any> = {};

    for (const table of tables) {
      const tableName = table.name;
      
      // 행 수
      const rowCount = await DatabaseUtils.all(this.db, `SELECT COUNT(*) as count FROM ${tableName}`);
      
      // 테이블 크기
      const size = await DatabaseUtils.all(this.db, `
        SELECT page_count * page_size as size 
        FROM pragma_page_count('${tableName}'), pragma_page_size('${tableName}')
      `);
      
      // 인덱스 수
      const indexCount = await DatabaseUtils.all(this.db, `
        SELECT COUNT(*) as count 
        FROM sqlite_master 
        WHERE type = 'index' AND tbl_name = '${tableName}' AND name NOT LIKE 'sqlite_%'
      `);

      stats[tableName] = {
        rowCount: rowCount[0].count,
        size: size[0].size,
        indexCount: indexCount[0].count,
        lastAnalyzed: new Date()
      };
    }

    return stats;
  }

  /**
   * 인덱스 분석
   */
  private async analyzeIndexes(): Promise<Record<string, any>> {
    const indexes = await DatabaseUtils.all(this.db, `
      SELECT name, tbl_name, sql 
      FROM sqlite_master 
      WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
    `);

    const stats: Record<string, any> = {};

    for (const index of indexes) {
      // 인덱스 크기
      const size = await DatabaseUtils.all(this.db, `
        SELECT page_count * page_size as size 
        FROM pragma_page_count('${index.name}'), pragma_page_size('${index.name}')
      `);

      // 컬럼 추출 (간단한 파싱)
      const columns = this.extractColumnsFromIndexSQL(index.sql);

      stats[index.name] = {
        name: index.name,
        table: index.tbl_name,
        columns,
        size: size[0].size,
        usage: 0 // 실제로는 SQLite 통계에서 가져와야 함
      };
    }

    return stats;
  }

  /**
   * 쿼리 분석
   */
  private async analyzeQueries(): Promise<any> {
    const totalQueries = Array.from(this.queryHistory.values())
      .reduce((sum, q) => sum + q.count, 0);
    
    const averageTime = Array.from(this.queryHistory.values())
      .reduce((sum, q) => sum + q.totalTime, 0) / totalQueries || 0;

    const slowQueries = Array.from(this.queryHistory.entries())
      .map(([query, stats]) => ({
        query,
        executionTime: stats.totalTime / stats.count,
        explainPlan: [], // 실제로는 EXPLAIN QUERY PLAN 실행
        recommendations: this.generateQueryRecommendations(query),
        complexity: this.assessQueryComplexity(query)
      }))
      .filter(q => q.executionTime > 50) // 50ms 이상
      .sort((a, b) => b.executionTime - a.executionTime)
      .slice(0, 10);

    return {
      totalQueries,
      averageTime,
      slowQueries
    };
  }

  /**
   * 인덱스 추천 생성
   */
  async generateIndexRecommendations(): Promise<IndexRecommendation[]> {
    const recommendations: IndexRecommendation[] = [];
    
    // 자주 사용되는 쿼리 패턴 분석
    const commonPatterns = this.analyzeQueryPatterns();
    
    for (const pattern of commonPatterns) {
      if (pattern.type === 'filter' && pattern.frequency > 10) {
        recommendations.push({
          table: pattern.table,
          columns: pattern.columns,
          type: 'btree',
          priority: pattern.frequency > 50 ? 'high' : 'medium',
          reason: `자주 사용되는 필터 조건 (${pattern.frequency}회)`,
          estimatedImprovement: '50-80% 쿼리 성능 향상 예상'
        });
      }
    }

    // 복합 쿼리 최적화
    const complexQueries = Array.from(this.queryHistory.entries())
      .filter(([, stats]) => stats.totalTime > 1000)
      .map(([query]) => query);

    for (const query of complexQueries) {
      const columns = this.extractColumnsFromQuery(query);
      if (columns.length > 1) {
        recommendations.push({
          table: 'memory_item',
          columns,
          type: 'btree',
          priority: 'high',
          reason: '복합 쿼리 최적화',
          estimatedImprovement: '30-60% 쿼리 성능 향상 예상'
        });
      }
    }

    return recommendations;
  }

  /**
   * 쿼리 패턴 분석
   */
  private analyzeQueryPatterns(): Array<{ type: string; table: string; columns: string[]; frequency: number }> {
    const patterns: Array<{ type: string; table: string; columns: string[]; frequency: number }> = [];
    
    for (const [query, stats] of this.queryHistory) {
      if (query.includes('WHERE')) {
        const whereClause = query.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+GROUP|\s+LIMIT|$)/i);
      if (whereClause && whereClause[1]) {
        const conditions = whereClause[1].split('AND').map(c => c.trim());
          for (const condition of conditions) {
            const column = this.extractColumnFromCondition(condition);
            if (column) {
              const existing = patterns.find(p => p.table === 'memory_item' && p.columns.includes(column));
              if (existing) {
                existing.frequency += stats.count;
              } else {
                patterns.push({
                  type: 'filter',
                  table: 'memory_item',
                  columns: [column],
                  frequency: stats.count
                });
              }
            }
          }
        }
      }
    }

    return patterns;
  }

  /**
   * 쿼리 추천 생성
   */
  private generateQueryRecommendations(query: string): string[] {
    const recommendations: string[] = [];

    // SELECT * 사용 검사
    if (query.includes('SELECT *')) {
      recommendations.push('SELECT * 대신 필요한 컬럼만 명시하세요');
    }

    // 인덱스 힌트 검사
    if (query.includes('ORDER BY') && !query.includes('INDEXED BY')) {
      recommendations.push('ORDER BY 절에 인덱스 힌트를 추가하세요');
    }

    // LIKE 패턴 검사
    if (query.includes('LIKE \'%')) {
      recommendations.push('LIKE \'%...\' 패턴은 인덱스를 사용할 수 없습니다. FTS5를 고려하세요');
    }

    // 서브쿼리 검사
    if (query.includes('SELECT') && (query.match(/SELECT/g) || []).length > 1) {
      recommendations.push('서브쿼리를 JOIN으로 변경하는 것을 고려하세요');
    }

    return recommendations;
  }

  /**
   * 쿼리 복잡도 평가
   */
  private assessQueryComplexity(query: string): 'simple' | 'medium' | 'complex' {
    let complexity = 0;
    
    if (query.includes('JOIN')) complexity += 2;
    if (query.includes('GROUP BY')) complexity += 1;
    if (query.includes('ORDER BY')) complexity += 1;
    if (query.includes('HAVING')) complexity += 1;
    if (query.includes('UNION')) complexity += 2;
    if (query.includes('SELECT') && (query.match(/SELECT/g) || []).length > 1) complexity += 2;
    
    if (complexity <= 1) return 'simple';
    if (complexity <= 3) return 'medium';
    return 'complex';
  }

  /**
   * 쿼리 실행 통계 기록
   */
  recordQuery(query: string, executionTime: number): void {
    const existing = this.queryHistory.get(query);
    if (existing) {
      existing.count++;
      existing.totalTime += executionTime;
      existing.lastUsed = new Date();
    } else {
      this.queryHistory.set(query, {
        count: 1,
        totalTime: executionTime,
        lastUsed: new Date()
      });
    }
  }

  /**
   * 인덱스 생성
   */
  async createIndex(name: string, table: string, columns: string[], unique: boolean = false): Promise<void> {
    const uniqueKeyword = unique ? 'UNIQUE' : '';
    const columnsStr = columns.join(', ');
    const sql = `CREATE ${uniqueKeyword} INDEX IF NOT EXISTS ${name} ON ${table} (${columnsStr})`;
    
    await DatabaseUtils.run(this.db, sql);
  }

  /**
   * 인덱스 삭제
   */
  async dropIndex(name: string): Promise<void> {
    await DatabaseUtils.run(this.db, `DROP INDEX IF EXISTS ${name}`);
  }

  /**
   * 데이터베이스 분석 실행
   */
  async analyzeDatabase(): Promise<void> {
    await DatabaseUtils.run(this.db, 'ANALYZE');
  }

  /**
   * 쿼리에서 컬럼 추출
   */
  private extractColumnsFromQuery(query: string): string[] {
    const columns: string[] = [];
    
    // WHERE 절에서 컬럼 추출
    const whereMatch = query.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+GROUP|\s+LIMIT|$)/i);
    if (whereMatch && whereMatch[1]) {
      const conditions = whereMatch[1].split(/AND|OR/).map(c => c.trim());
      for (const condition of conditions) {
        const column = this.extractColumnFromCondition(condition);
        if (column) columns.push(column);
      }
    }

    // ORDER BY 절에서 컬럼 추출
    const orderMatch = query.match(/ORDER BY\s+(.+?)(?:\s+LIMIT|$)/i);
    if (orderMatch && orderMatch[1]) {
      const orderColumns = orderMatch[1].split(',').map(c => c.trim().split(' ')[0]).filter((c): c is string => Boolean(c));
      columns.push(...orderColumns);
    }

    return [...new Set(columns)]; // 중복 제거
  }

  /**
   * 조건에서 컬럼 추출
   */
  private extractColumnFromCondition(condition: string): string | null {
    const match = condition.match(/(\w+)\s*[=<>!]/);
    return match && match[1] ? match[1] : null;
  }

  /**
   * 인덱스 SQL에서 컬럼 추출
   */
  private extractColumnsFromIndexSQL(sql: string): string[] {
    const match = sql.match(/\((.+?)\)/);
    if (match && match[1]) {
      return match[1].split(',').map(c => c.trim());
    }
    return [];
  }

  /**
   * 성능 최적화 리포트 생성
   */
  async generateOptimizationReport(): Promise<string> {
    const stats = await this.analyzePerformance();
    const recommendations = await this.generateIndexRecommendations();

    const report = `
# 데이터베이스 성능 최적화 리포트
생성 시간: ${new Date().toISOString()}

## 테이블 통계
${Object.entries(stats.tableStats)
  .map(([table, stat]) => `
### ${table}
- 행 수: ${stat.rowCount.toLocaleString()}
- 크기: ${(stat.size / 1024 / 1024).toFixed(2)} MB
- 인덱스 수: ${stat.indexCount}개
`).join('')}

## 인덱스 통계
${Object.entries(stats.indexStats)
  .map(([name, stat]) => `
### ${name}
- 테이블: ${stat.table}
- 컬럼: ${stat.columns.join(', ')}
- 크기: ${(stat.size / 1024).toFixed(2)} KB
`).join('')}

## 쿼리 성능
- 총 쿼리: ${stats.queryStats.totalQueries}회
- 평균 실행 시간: ${stats.queryStats.averageTime.toFixed(2)}ms

## 느린 쿼리 (상위 5개)
${stats.queryStats.slowQueries.slice(0, 5)
  .map((q, i) => `
${i + 1}. **${q.complexity.toUpperCase()}** (${q.executionTime.toFixed(2)}ms)
   \`\`\`sql
   ${q.query}
   \`\`\`
   **추천사항:**
   ${q.recommendations.map(r => `- ${r}`).join('\n   ')}
`).join('')}

## 인덱스 추천
${recommendations.map((rec, i) => `
${i + 1}. **${rec.priority.toUpperCase()}** - ${rec.table}.${rec.columns.join(', ')}
   - 이유: ${rec.reason}
   - 예상 개선: ${rec.estimatedImprovement}
`).join('')}
`;

    return report;
  }
}
