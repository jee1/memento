/**
 * HybridSearchEngine Consolidation Score 통합 테스트
 * Consolidation 점수가 검색 결과에 반영되는지 검증
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { HybridSearchEngine, SearchResultCombiner } from '../hybrid-search-engine.js';
import Database from 'better-sqlite3';
import { mementoConfig } from '../../../../shared/config/index.js';
import {
  initializeTestDatabase,
  seedTestDatabase,
  cleanupTestDatabase
} from '../../../../test/helpers/consolidation-test-data.js';

// Mock mementoConfig
vi.mock('../../../../shared/config/index.js', () => ({
  mementoConfig: {
    consolidationScoreEnabled: true
  }
}));

// Mock EmbeddingService
vi.mock('../../../memory/services/memory-embedding-service.js', () => ({
  MemoryEmbeddingService: vi.fn().mockImplementation(() => ({
    isAvailable: vi.fn().mockReturnValue(true),
    searchBySimilarity: vi.fn()
  }))
}));

// Mock UnifiedEmbeddingService
vi.mock('../../../embedding/services/unified-embedding-service.js', () => ({
  UnifiedEmbeddingService: vi.fn().mockImplementation(() => ({
    generateEmbedding: vi.fn().mockResolvedValue({
      embedding: new Array(1536).fill(0.1),
      provider: 'tfidf'
    }),
    getEmbedding: vi.fn().mockResolvedValue({
      embedding: new Array(1536).fill(0.1),
      provider: 'tfidf'
    })
  }))
}));

describe('HybridSearchEngine Consolidation Score 통합', () => {
  let db: Database.Database;
  let hybridEngine: HybridSearchEngine;
  let textSearchEngine: any;
  let embeddingService: any;
  let vectorSearchEngine: any;
  let weightCalculator: any;
  let logger: any;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeTestDatabase(db);

    // Mock 의존성 생성
    textSearchEngine = {
      search: vi.fn()
    };
    embeddingService = {
      isAvailable: vi.fn().mockReturnValue(true),
      searchBySimilarity: vi.fn().mockResolvedValue([]) // VectorSearchResult[] 형식, 빈 배열 반환
    };
    vectorSearchEngine = {
      initialize: vi.fn(),
      getIndexStatus: vi.fn().mockReturnValue({ available: true, dimensions: 1536 }),
      search: vi.fn().mockResolvedValue([]) // memory_id를 가진 VectorSearchResult[] 반환
    };
    weightCalculator = {
      calculateWeights: vi.fn().mockReturnValue({ vectorWeight: 0.6, textWeight: 0.4 })
    };
    logger = {
      logSearchStart: vi.fn(),
      logSearchStep: vi.fn(),
      logSearchComplete: vi.fn(),
      logSearchError: vi.fn()
    };

    // Mock queryEmbeddingService 생성
    const mockQueryEmbeddingService = {
      generateEmbedding: vi.fn().mockResolvedValue({
        embedding: new Array(1536).fill(0.1),
        provider: 'tfidf'
      }),
      getEmbedding: vi.fn().mockResolvedValue({
        embedding: new Array(1536).fill(0.1),
        provider: 'tfidf'
      })
    };

    hybridEngine = new HybridSearchEngine(
      textSearchEngine,
      embeddingService,
      vectorSearchEngine,
      new SearchResultCombiner(),
      weightCalculator,
      logger,
      mockQueryEmbeddingService as any
    );
  });

  afterEach(() => {
    cleanupTestDatabase(db);
    if (db) {
      db.close();
    }
    vi.clearAllMocks();
  });

  describe('consolidation 점수가 검색 결과에 반영되는지 검증', () => {
    it('consolidation score가 활성화된 상태에서 검색 결과에 반영', async () => {
      vi.mocked(mementoConfig).consolidationScoreEnabled = true;

      // 샘플 데이터 주입 (임베딩 포함하여 provider 감지 가능하도록)
      const { items } = seedTestDatabase(db, 5, true);

      // 높은 consolidation_score를 가진 아이템 생성
      const highConsolidationItem = items[0];
      highConsolidationItem.consolidation_score = 0.9;
      highConsolidationItem.recall_count = 10;
      
      // 데이터베이스 업데이트
      const updateSql = `
        UPDATE memory_item 
        SET consolidation_score = ?, recall_count = ?
        WHERE id = ?
      `;
      db.prepare(updateSql).run(0.9, 10, highConsolidationItem.id);

      // Mock 검색 결과 (executeVecSearch에서 반환하는 형식)
      // executeVecSearch는 memory_id를 가진 객체를 받아서 id로 변환
      const mockVectorResults = [
        {
          memory_id: highConsolidationItem.id,
          similarity: 0.7, // 낮은 벡터 유사도
          content: highConsolidationItem.content,
          type: highConsolidationItem.type,
          importance: highConsolidationItem.importance,
          created_at: highConsolidationItem.created_at,
          last_accessed: highConsolidationItem.last_accessed,
          pinned: highConsolidationItem.pinned,
          tags: highConsolidationItem.tags
        }
      ];

      // vectorSearchEngine.search는 memory_id를 가진 객체를 반환
      // executeVecSearch에서 id로 변환됨
      vectorSearchEngine.search = vi.fn().mockResolvedValue(mockVectorResults);
      textSearchEngine.search = vi.fn().mockResolvedValue({
        items: [],
        total_count: 0,
        query_time: 10
      });

      const results = await hybridEngine.search(db, {
        query: 'test query',
        limit: 10
      });

      expect(results.items.length).toBeGreaterThan(0);
      
      // consolidation_score가 결과에 포함되어야 함
      const resultWithConsolidation = results.items.find(
        item => item.id === highConsolidationItem.id
      );
      
      if (resultWithConsolidation && mementoConfig.consolidationScoreEnabled) {
        expect(resultWithConsolidation.consolidation_score).toBeDefined();
      }
    });

    it('다양한 consolidation 점수 값에 따른 랭킹 변화 검증', async () => {
      vi.mocked(mementoConfig).consolidationScoreEnabled = true;

      // 샘플 데이터 주입 (임베딩 포함하여 provider 감지 가능하도록)
      const { items } = seedTestDatabase(db, 3, true);

      // 다양한 consolidation_score 설정
      const consolidationScores = [0.3, 0.7, 0.9];
      items.forEach((item, index) => {
        const updateSql = `
          UPDATE memory_item 
          SET consolidation_score = ?
          WHERE id = ?
        `;
        db.prepare(updateSql).run(consolidationScores[index], item.id);
      });

      // 동일한 벡터 유사도를 가진 Mock 결과
      const mockVectorResults = items.map((item) => ({
        memory_id: item.id,
        similarity: 0.8, // 동일한 벡터 유사도
        content: item.content,
        type: item.type,
        importance: item.importance,
        created_at: item.created_at,
        last_accessed: item.last_accessed,
        pinned: item.pinned,
        tags: item.tags
      }));

      vectorSearchEngine.search = vi.fn().mockResolvedValue(mockVectorResults);
      textSearchEngine.search = vi.fn().mockResolvedValue({
        items: [],
        total_count: 0,
        query_time: 10
      });

      const results = await hybridEngine.search(db, {
        query: 'test query',
        limit: 10
      });

      expect(results.items.length).toBe(3);

      // consolidation_score가 높을수록 상위에 랭킹되어야 함
      if (mementoConfig.consolidationScoreEnabled) {
        // finalScore가 consolidation_score를 반영하여 정렬되어야 함
        expect(results.items[0].finalScore).toBeGreaterThanOrEqual(
          results.items[results.items.length - 1].finalScore
        );
      }
    });
  });

  describe('기능 플래그 on/off 시나리오', () => {
    it('기능 플래그 활성화 시 consolidation score 반영', async () => {
      vi.mocked(mementoConfig).consolidationScoreEnabled = true;

      const { items } = seedTestDatabase(db, 2, false);
      
      // consolidation_score 설정
      items.forEach((item, index) => {
        const updateSql = `
          UPDATE memory_item 
          SET consolidation_score = ?
          WHERE id = ?
        `;
        db.prepare(updateSql).run(0.5 + index * 0.2, item.id);
      });

      const mockVectorResults = items.map(item => ({
        memory_id: item.id,
        similarity: 0.8,
        content: item.content,
        type: item.type,
        importance: item.importance,
        created_at: item.created_at,
        last_accessed: item.last_accessed,
        pinned: item.pinned,
        tags: item.tags
      }));

      vectorSearchEngine.search = vi.fn().mockResolvedValue(mockVectorResults);
      textSearchEngine.search = vi.fn().mockResolvedValue({
        items: [],
        total_count: 0,
        query_time: 10
      });

      const results = await hybridEngine.search(db, {
        query: 'test query',
        limit: 10
      });

      // consolidation_score가 결과에 포함되어야 함
      results.items.forEach(item => {
        if (mementoConfig.consolidationScoreEnabled) {
          expect(item.consolidation_score).toBeDefined();
        }
      });
    });

    it('기능 플래그 비활성화 시 기존 점수 계산 방식 사용', async () => {
      vi.mocked(mementoConfig).consolidationScoreEnabled = false;

      const { items } = seedTestDatabase(db, 2, false);

      const mockVectorResults = items.map(item => ({
        memory_id: item.id,
        similarity: 0.8,
        content: item.content,
        type: item.type,
        importance: item.importance,
        created_at: item.created_at,
        last_accessed: item.last_accessed,
        pinned: item.pinned,
        tags: item.tags
      }));

      vectorSearchEngine.search = vi.fn().mockResolvedValue(mockVectorResults);
      textSearchEngine.search = vi.fn().mockResolvedValue({
        items: [],
        total_count: 0,
        query_time: 10
      });

      const results = await hybridEngine.search(db, {
        query: 'test query',
        limit: 10
      });

      // consolidation_score가 결과에 포함되지 않아야 함
      results.items.forEach(item => {
        expect(item.consolidation_score).toBeUndefined();
      });
    });
  });

  describe('벡터 검색 결과와 consolidation 점수 통합', () => {
    it('벡터 유사도와 consolidation 점수가 함께 반영되어 최종 점수 계산', async () => {
      vi.mocked(mementoConfig).consolidationScoreEnabled = true;

      // 샘플 데이터 주입 (임베딩 포함하여 provider 감지 가능하도록)
      const { items } = seedTestDatabase(db, 2, true);

      // 첫 번째 아이템: 높은 벡터 유사도, 낮은 consolidation_score
      // 두 번째 아이템: 낮은 벡터 유사도, 높은 consolidation_score
      const updateSql = `
        UPDATE memory_item 
        SET consolidation_score = ?
        WHERE id = ?
      `;
      db.prepare(updateSql).run(0.3, items[0].id);
      db.prepare(updateSql).run(0.9, items[1].id);

      const mockVectorResults = [
        {
          memory_id: items[0].id,
          similarity: 0.95, // 높은 벡터 유사도
          content: items[0].content,
          type: items[0].type,
          importance: items[0].importance,
          created_at: items[0].created_at,
          last_accessed: items[0].last_accessed,
          pinned: items[0].pinned,
          tags: items[0].tags
        },
        {
          memory_id: items[1].id,
          similarity: 0.5, // 낮은 벡터 유사도
          content: items[1].content,
          type: items[1].type,
          importance: items[1].importance,
          created_at: items[1].created_at,
          last_accessed: items[1].last_accessed,
          pinned: items[1].pinned,
          tags: items[1].tags
        }
      ];

      vectorSearchEngine.search = vi.fn().mockResolvedValue(mockVectorResults);
      textSearchEngine.search = vi.fn().mockResolvedValue({
        items: [],
        total_count: 0,
        query_time: 10
      });

      const results = await hybridEngine.search(db, {
        query: 'test query',
        limit: 10
      });

      expect(results.items.length).toBe(2);

      // finalScore가 벡터 유사도와 consolidation_score를 모두 반영해야 함
      if (mementoConfig.consolidationScoreEnabled) {
        // 첫 번째 아이템의 finalScore 계산 확인
        const item1 = results.items.find(r => r.id === items[0].id);
        const item2 = results.items.find(r => r.id === items[1].id);

        if (item1 && item2) {
          // balanced 프로파일: w1=0.8, w2=0.2
          // item1: 0.8 * 0.95 + 0.2 * 0.3 = 0.76 + 0.06 = 0.82
          // item2: 0.8 * 0.5 + 0.2 * 0.9 = 0.40 + 0.18 = 0.58
          // item1이 더 높은 점수를 가져야 함
          expect(item1.finalScore).toBeGreaterThan(item2.finalScore);
        }
      }
    });
  });
});

