/**
 * 데이터베이스 성능 최적화 서비스
 * 인덱스 최적화, 쿼리 분석, 성능 튜닝
 */
import { DatabaseUtils } from '../utils/database.js';
import Database from 'better-sqlite3';
export class DatabaseOptimizer {
    db;
    queryHistory = new Map();
    constructor(db) {
        this.db = db;
    }
    /**
     * 데이터베이스 성능 분석
     */
    async analyzePerformance() {
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
    async analyzeTables() {
        const tables = await DatabaseUtils.all(this.db, `
      SELECT name FROM sqlite_master 
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    `);
        const stats = {};
        for (const table of tables) {
            const tableName = table.name;
            // 행 수
            const rowCount = await DatabaseUtils.all(this.db, `SELECT COUNT(*) as count FROM ${tableName}`);
            // 테이블 크기 (간단한 추정)
            const size = await DatabaseUtils.all(this.db, `
        SELECT page_count * page_size as size 
        FROM pragma_page_count(), pragma_page_size()
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
    async analyzeIndexes() {
        const indexes = await DatabaseUtils.all(this.db, `
      SELECT name, tbl_name, sql 
      FROM sqlite_master 
      WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
    `);
        const stats = {};
        for (const index of indexes) {
            // 인덱스 크기 (간단한 추정 - 인덱스는 테이블이 아니므로 페이지 정보를 직접 가져올 수 없음)
            const size = await DatabaseUtils.all(this.db, `
        SELECT page_count * page_size as size 
        FROM pragma_page_count(), pragma_page_size()
      `);
            // 컬럼 추출 (간단한 파싱)
            const columns = this.extractColumnsFromIndexSQL(index.sql);
            stats[index.name] = {
                name: index.name,
                table: index.tbl_name,
                columns,
                size: size[0].size, // 전체 데이터베이스 크기로 추정
                usage: 0 // 실제로는 SQLite 통계에서 가져와야 함
            };
        }
        return stats;
    }
    /**
     * 쿼리 분석
     */
    async analyzeQueries() {
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
    async generateIndexRecommendations() {
        const recommendations = [];
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
            const tableMatch = query.match(/FROM\s+(\w+)/i);
            if (!tableMatch || !tableMatch[1])
                continue;
            const tableName = tableMatch[1];
            const columns = this.extractColumnsFromQuery(query);
            if (columns.length > 1) {
                recommendations.push({
                    table: tableName,
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
    analyzeQueryPatterns() {
        const patterns = [];
        for (const [query, stats] of this.queryHistory) {
            // 쿼리에서 테이블명 추출
            const tableMatch = query.match(/FROM\s+(\w+)/i);
            if (!tableMatch || !tableMatch[1])
                continue;
            const tableName = tableMatch[1];
            if (query.includes('WHERE')) {
                const whereClause = query.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+GROUP|\s+LIMIT|$)/i);
                if (whereClause && whereClause[1]) {
                    const conditions = whereClause[1].split('AND').map(c => c.trim());
                    for (const condition of conditions) {
                        const column = this.extractColumnFromCondition(condition);
                        if (column) {
                            const existing = patterns.find(p => p.table === tableName && p.columns.includes(column));
                            if (existing) {
                                existing.frequency += stats.count;
                            }
                            else {
                                patterns.push({
                                    type: 'filter',
                                    table: tableName,
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
    generateQueryRecommendations(query) {
        const recommendations = [];
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
    assessQueryComplexity(query) {
        let complexity = 0;
        if (query.includes('JOIN'))
            complexity += 2;
        if (query.includes('GROUP BY'))
            complexity += 1;
        if (query.includes('ORDER BY'))
            complexity += 1;
        if (query.includes('HAVING'))
            complexity += 1;
        if (query.includes('UNION'))
            complexity += 2;
        if (query.includes('SELECT') && (query.match(/SELECT/g) || []).length > 1)
            complexity += 2;
        if (complexity <= 1)
            return 'simple';
        if (complexity <= 3)
            return 'medium';
        return 'complex';
    }
    /**
     * 쿼리 실행 통계 기록
     */
    recordQuery(query, executionTime) {
        const existing = this.queryHistory.get(query);
        if (existing) {
            existing.count++;
            existing.totalTime += executionTime;
            existing.lastUsed = new Date();
        }
        else {
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
    async createIndex(name, table, columns, unique = false) {
        const uniqueKeyword = unique ? 'UNIQUE' : '';
        const columnsStr = columns.join(', ');
        const sql = `CREATE ${uniqueKeyword} INDEX IF NOT EXISTS ${name} ON ${table} (${columnsStr})`;
        await DatabaseUtils.run(this.db, sql);
    }
    /**
     * 인덱스 삭제
     */
    async dropIndex(name) {
        await DatabaseUtils.run(this.db, `DROP INDEX IF EXISTS ${name}`);
    }
    /**
     * 데이터베이스 분석 실행
     */
    async analyzeDatabase() {
        await DatabaseUtils.run(this.db, 'ANALYZE');
    }
    /**
     * 쿼리에서 컬럼 추출
     */
    extractColumnsFromQuery(query) {
        const columns = [];
        // WHERE 절에서 컬럼 추출
        const whereMatch = query.match(/WHERE\s+(.+?)(?:\s+ORDER|\s+GROUP|\s+LIMIT|$)/i);
        if (whereMatch && whereMatch[1]) {
            const conditions = whereMatch[1].split(/AND|OR/).map(c => c.trim());
            for (const condition of conditions) {
                const column = this.extractColumnFromCondition(condition);
                if (column)
                    columns.push(column);
            }
        }
        // ORDER BY 절에서 컬럼 추출
        const orderMatch = query.match(/ORDER BY\s+(.+?)(?:\s+LIMIT|$)/i);
        if (orderMatch && orderMatch[1]) {
            const orderColumns = orderMatch[1].split(',').map(c => c.trim().split(' ')[0]).filter((c) => Boolean(c));
            columns.push(...orderColumns);
        }
        return [...new Set(columns)]; // 중복 제거
    }
    /**
     * 조건에서 컬럼 추출
     */
    extractColumnFromCondition(condition) {
        const match = condition.match(/(\w+)\s*[=<>!]/);
        return match && match[1] ? match[1] : null;
    }
    /**
     * 인덱스 SQL에서 컬럼 추출
     */
    extractColumnsFromIndexSQL(sql) {
        const match = sql.match(/\((.+?)\)/);
        if (match && match[1]) {
            return match[1].split(',').map(c => c.trim());
        }
        return [];
    }
    /**
     * 성능 최적화 리포트 생성
     */
    async generateOptimizationReport() {
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
//# sourceMappingURL=database-optimizer.js.map