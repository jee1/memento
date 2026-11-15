/**
 * 벡터 검색 서비스 테스트
 * 클린코드 원칙에 따른 테스트 가능한 구조 검증
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { VectorSearchService } from './vector-search.service';
import type { VectorSearchRepository } from '../../../../shared/interfaces/database.interface.js';
import type { VectorSearchQuery, VectorSearchResult } from '../../../../shared/types/vector-search.types.js';

// Mock @huggingface/transformers to prevent onnxruntime-node loading
vi.mock('@huggingface/transformers', () => {
  return {
    pipeline: vi.fn().mockResolvedValue({
      __call: vi.fn().mockResolvedValue([0.1, 0.2, 0.3])
    }),
    env: {
      useBrowserCache: false,
      useCustomCache: false
    }
  };
});

// Mock 리포지토리 생성
const createMockRepository = (): any => ({
  search: vi.fn(),
  hybridSearch: vi.fn(),
  getIndexStatus: vi.fn(),
  rebuildIndex: vi.fn(),
  getTableName: vi.fn(),
  checkVecAvailability: vi.fn()
});

describe('VectorSearchService', () => {
  let service: VectorSearchService;
  let mockRepository: any;

  beforeEach(() => {
    mockRepository = createMockRepository();
    service = new VectorSearchService(mockRepository);
  });

  afterEach(() => {
    // Mock 정리
    vi.clearAllMocks();
    // 서비스 인스턴스 정리
    service = null as any;
    mockRepository = null;
  });

  describe('search', () => {
    it('should search vectors successfully', async () => {
      // Given
      const query: VectorSearchQuery = {
        queryVector: new Array(512).fill(0.1),
        options: { limit: 10 },
        provider: 'tfidf'
      };
      
      const expectedResults: VectorSearchResult[] = [
        {
          memory_id: 'test-1',
          similarity: 0.8,
          content: 'Test content',
          type: 'semantic',
          importance: 0.7,
          created_at: '2024-01-01T00:00:00Z',
          pinned: false
        }
      ];

      mockRepository.search.mockResolvedValue(expectedResults);

      // When
      const results = await service.search(query);

      // Then
      expect(results).toEqual(expectedResults);
      expect(mockRepository.search).toHaveBeenCalledWith(query);
    });

    it('should throw error for invalid vector dimensions', async () => {
      // Given
      const query: VectorSearchQuery = {
        queryVector: new Array(1000).fill(0.1), // 잘못된 차원
        options: { limit: 10 },
        provider: 'tfidf'
      };

      // When & Then
      await expect(service.search(query)).rejects.toThrow('벡터 차원 불일치');
    });

    it('should throw error for invalid limit', async () => {
      // Given
      const query: VectorSearchQuery = {
        queryVector: new Array(512).fill(0.1),
        options: { limit: 150 }, // 잘못된 제한
        provider: 'tfidf'
      };

      // When & Then
      await expect(service.search(query)).rejects.toThrow('검색 제한은 1-100 사이여야 합니다');
    });

    it('should handle repository errors', async () => {
      // Given
      const query: VectorSearchQuery = {
        queryVector: new Array(512).fill(0.1),
        options: { limit: 10 },
        provider: 'tfidf'
      };

      mockRepository.search.mockRejectedValue(new Error('Database error'));

      // When & Then
      await expect(service.search(query)).rejects.toThrow('벡터 검색 실패: Error: Database error');
    });
  });

  describe('hybridSearch', () => {
    it('should perform hybrid search successfully', async () => {
      // Given
      const query: VectorSearchQuery = {
        queryVector: new Array(512).fill(0.1),
        textQuery: 'test query',
        options: { limit: 10 },
        provider: 'tfidf'
      };

      const expectedResults: VectorSearchResult[] = [
        {
          memory_id: 'test-1',
          similarity: 0.9,
          content: 'Test content',
          type: 'semantic',
          importance: 0.8,
          created_at: '2024-01-01T00:00:00Z',
          pinned: false
        }
      ];

      mockRepository.hybridSearch.mockResolvedValue(expectedResults);

      // When
      const results = await service.hybridSearch(query);

      // Then
      expect(results).toEqual(expectedResults);
      expect(mockRepository.hybridSearch).toHaveBeenCalledWith(query);
    });
  });

  describe('applyDefaultOptions', () => {
    it('should apply default options correctly', () => {
      // Given
      const options = { limit: 5 };

      // When
      const result = service.applyDefaultOptions(options);

      // Then
      expect(result).toEqual({
        limit: 5,
        threshold: 0.7,
        includeContent: true,
      });
    });

    it('should override defaults with provided options', () => {
      // Given
      const options = { 
        limit: 20, 
        threshold: 0.8, 
        includeContent: false, 
      };

      // When
      const result = service.applyDefaultOptions(options);

      // Then
      expect(result).toEqual(options);
    });
  });
});
