/**
 * 개선된 Mock 데이터베이스
 * better-sqlite3의 실제 인터페이스를 완전히 구현
 */

import { vi } from 'vitest';

type MockRow = Record<string, unknown>;

export class MockPreparedStatement {
  private mockData: MockRow[] = [];
  private mockError: Error | null = null;

  constructor(mockData: MockRow[] = [], mockError: Error | null = null) {
    this.mockData = mockData;
    this.mockError = mockError;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
  all(..._params: unknown[]): MockRow[] {
    if (this.mockError) throw this.mockError;
    return this.mockData;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
  get(..._params: unknown[]): MockRow | null {
    if (this.mockError) throw this.mockError;
    return this.mockData[0] || null;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
  run(..._params: unknown[]): { changes: number; lastInsertRowid: number } {
    if (this.mockError) throw this.mockError;
    return { changes: 1, lastInsertRowid: 1 };
  }
}

export class MockDatabase {
  private mockData: Map<string, MockRow[]> = new Map();
  private mockError: Error | null = null;
  private _isOpen = true;

  constructor() {
    this.setupDefaultData();
  }

  private setupDefaultData() {
    // VEC 테이블 Mock 데이터
    this.mockData.set('memory_item_vec_tfidf', [
      { rowid: 'mem1', distance: 0.3, embedding: JSON.stringify(new Array(1536).fill(0.1)) },
      { rowid: 'mem2', distance: 0.5, embedding: JSON.stringify(new Array(1536).fill(0.2)) },
      { rowid: 'mem3', distance: 0.7, embedding: JSON.stringify(new Array(1536).fill(0.3)) }
    ]);

    this.mockData.set('memory_item_vec_minilm', [
      { rowid: 'mem1', distance: 0.2, embedding: JSON.stringify(new Array(1536).fill(0.1)) },
      { rowid: 'mem2', distance: 0.4, embedding: JSON.stringify(new Array(1536).fill(0.2)) }
    ]);

    this.mockData.set('memory_item_vec_openai', [
      { rowid: 'mem1', distance: 0.1, embedding: JSON.stringify(new Array(1536).fill(0.1)) },
      { rowid: 'mem2', distance: 0.3, embedding: JSON.stringify(new Array(1536).fill(0.2)) }
    ]);

    this.mockData.set('memory_item_vec_gemini', [
      { rowid: 'mem1', distance: 0.15, embedding: JSON.stringify(new Array(1536).fill(0.1)) },
      { rowid: 'mem2', distance: 0.35, embedding: JSON.stringify(new Array(1536).fill(0.2)) }
    ]);

    // memory_item 테이블 Mock 데이터
    this.mockData.set('memory_item', [
      {
        id: 'mem1',
        content: 'Test content 1',
        type: 'semantic',
        importance: 0.8,
        created_at: '2024-01-01T00:00:00Z',
        last_accessed: '2024-01-02T00:00:00Z',
        pinned: false,
        tags: JSON.stringify(['test', 'example'])
      },
      {
        id: 'mem2', 
        content: 'Test content 2',
        type: 'episodic',
        importance: 0.6,
        created_at: '2024-01-01T00:00:00Z',
        last_accessed: '2024-01-02T00:00:00Z',
        pinned: true,
        tags: JSON.stringify(['test', 'memory'])
      }
    ]);

    // FTS5 테이블 Mock 데이터
    this.mockData.set('memory_item_fts', [
      { rowid: 1, rank: 0.8 },
      { rowid: 2, rank: 0.6 }
    ]);
  }

  prepare(sql: string): MockPreparedStatement {
    if (this.mockError) {
      return new MockPreparedStatement([], this.mockError);
    }

    // SQL 쿼리 분석하여 적절한 Mock 데이터 반환
    const mockData = this.analyzeQuery(sql);
    return new MockPreparedStatement(mockData);
  }

  private analyzeQuery(sql: string): MockRow[] {
    const lowerSql = sql.toLowerCase();
    
    // VEC 검색 쿼리
    if (lowerSql.includes('vec.embedding match')) {
      const tableName = this.extractTableName(sql);
      const tableData = this.mockData.get(tableName) || [];
      
      // JOIN 쿼리인 경우 memory_item과 조인
      if (lowerSql.includes('join memory_item')) {
        return tableData.map((vecItem) => {
          const memoryItem = this.mockData.get('memory_item')?.find((item) => item.id === vecItem.rowid);
          return {
            memory_id: vecItem.rowid,
            similarity: 1 - vecItem.distance,
            distance: vecItem.distance,
            content: memoryItem?.content || '',
            type: memoryItem?.type || 'semantic',
            importance: memoryItem?.importance || 0.5,
            created_at: memoryItem?.created_at || '2024-01-01T00:00:00Z',
            last_accessed: memoryItem?.last_accessed,
            pinned: memoryItem?.pinned || false,
            tags: memoryItem?.tags
          };
        });
      }
      
      return tableData;
    }

    // 테이블 존재 확인 쿼리
    if (lowerSql.includes('sqlite_master')) {
      // memory_item_fts 테이블 존재 확인 쿼리
      if (lowerSql.includes("name='memory_item_fts'")) {
        return [{ name: 'memory_item_fts' }];
      }
      
      return [
        { name: 'memory_item_vec_tfidf' },
        { name: 'memory_item_vec_minilm' },
        { name: 'memory_item_vec_openai' },
        { name: 'memory_item_vec_gemini' },
        { name: 'memory_item_fts' }
      ];
    }

    // COUNT 쿼리
    if (lowerSql.includes('count(*)')) {
      const tableName = this.extractTableName(sql);
      const tableData = this.mockData.get(tableName) || [];
      return [{ count: tableData.length }];
    }

    // FTS5 검색 쿼리
    if (lowerSql.includes('memory_item_fts')) {
      return this.mockData.get('memory_item_fts') || [];
    }

    return [];
  }

  private extractTableName(sql: string): string {
    const match = sql.match(/from\s+(\w+)/i);
    return match?.[1] || '';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
  exec(sql: string): void {
    if (this.mockError) throw this.mockError;
    // Mock exec - 아무것도 하지 않음
  }

  close(): void {
    this._isOpen = false;
  }

  isOpen(): boolean {
    return this._isOpen;
  }

  // 테스트용 메서드들
  setMockError(error: Error | null): void {
    this.mockError = error;
  }

  addMockData(tableName: string, data: MockRow[]): void {
    this.mockData.set(tableName, data);
  }

  clearMockData(): void {
    this.mockData.clear();
    this.setupDefaultData();
  }
}

// Mock Database 팩토리
export function createMockDatabase(): MockDatabase {
  return new MockDatabase();
}

// VEC 함수들 Mock
export const mockVecFunctions = {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
  vss_search: vi.fn().mockImplementation((embedding: string) => {
    // Mock VEC 검색 결과
    return [
      { rowid: 'mem1', distance: 0.3 },
      { rowid: 'mem2', distance: 0.5 }
    ];
  }),
  
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, no-unused-vars
  distance: vi.fn().mockImplementation((embedding1: string, embedding2: string) => {
    // Mock 거리 계산
    return 0.3;
  })
};
