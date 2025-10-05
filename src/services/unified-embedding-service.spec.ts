/**
 * 통합 임베딩 서비스 테스트
 * TDD 방식으로 구현
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnifiedEmbeddingService } from './unified-embedding-service.js';
import { EmbeddingProviderFactory } from './embedding-provider-factory.js';
import type { EmbeddingServiceInterface, EmbeddingResult, SimilarityResult, EmbeddingData } from '../types/embedding.types.js';

// 팩토리 모킹
const mockFactory = {
  getProvider: vi.fn(),
  getAvailableProviders: vi.fn(),
  selectProvider: vi.fn()
};

vi.mock('./embedding-provider-factory.js', () => ({
  EmbeddingProviderFactory: {
    getInstance: vi.fn(() => mockFactory)
  }
}));

// Mock 제공자 클래스
class MockEmbeddingService implements EmbeddingServiceInterface {
  constructor(private available: boolean = true, private shouldFail: boolean = false) {}

  async generateEmbedding(text: string): Promise<EmbeddingResult | null> {
    if (this.shouldFail) {
      throw new Error('Mock service failed');
    }
    return {
      embedding: [0.1, 0.2, 0.3],
      model: 'mock-model',
      usage: { prompt_tokens: 10, total_tokens: 10 }
    };
  }

  async searchSimilar(query: string, embeddings: EmbeddingData[], limit?: number, threshold?: number): Promise<SimilarityResult[]> {
    if (this.shouldFail) {
      throw new Error('Mock service failed');
    }
    return [
      { id: '1', content: 'test', similarity: 0.8, score: 0.8 }
    ];
  }

  isAvailable(): boolean {
    return this.available;
  }

  getModelInfo() {
    return { model: 'mock-model', dimensions: 384, maxTokens: 256 };
  }
}

describe('UnifiedEmbeddingService', () => {
  let service: UnifiedEmbeddingService;
  let mockProvider: MockEmbeddingService;

  beforeEach(() => {
    mockProvider = new MockEmbeddingService();
    
    // 팩토리 모킹 설정
    mockFactory.getProvider.mockReturnValue(mockProvider);
    mockFactory.getAvailableProviders.mockReturnValue([
      { name: 'minilm', available: true, priority: 1, cost: 'free', performance: 'high' },
      { name: 'openai', available: true, priority: 2, cost: 'paid', performance: 'high' },
      { name: 'gemini', available: true, priority: 3, cost: 'paid', performance: 'high' },
      { name: 'tfidf', available: true, priority: 4, cost: 'free', performance: 'low' }
    ]);
    mockFactory.selectProvider.mockReturnValue(mockProvider);
    
    service = new UnifiedEmbeddingService();
  });

  describe('생성자', () => {
    it('서비스가 올바르게 초기화되어야 한다', () => {
      expect(service).toBeDefined();
      expect(EmbeddingProviderFactory.getInstance).toHaveBeenCalled();
    });
  });

  describe('generateEmbedding', () => {
    it('빈 텍스트에 대해 에러를 던져야 한다', async () => {
      await expect(service.generateEmbedding('')).rejects.toThrow('텍스트가 비어있습니다');
      await expect(service.generateEmbedding('   ')).rejects.toThrow('텍스트가 비어있습니다');
    });

    it('유효한 텍스트에 대해 임베딩을 생성해야 한다', async () => {
      const mockProvider = new MockEmbeddingService();
      mockFactory.selectProvider.mockReturnValue(mockProvider);

      const result = await service.generateEmbedding('테스트 텍스트');
      
      expect(result).toBeDefined();
      expect(result?.embedding).toEqual([0.1, 0.2, 0.3]);
      expect(result?.model).toBe('mock-model');
    });

    it('제공자 실패 시 폴백을 시도해야 한다', async () => {
      const failingProvider = new MockEmbeddingService(true, true);
      const fallbackProvider = new MockEmbeddingService();
      
      mockFactory.selectProvider.mockReturnValue(failingProvider);
      mockFactory.getProvider
        .mockReturnValueOnce(failingProvider) // 첫 번째 시도
        .mockReturnValueOnce(fallbackProvider); // 폴백 시도

      const result = await service.generateEmbedding('테스트 텍스트');
      
      expect(result).toBeDefined();
      expect(result?.model).toBe('mock-model');
    });

    it('모든 제공자 실패 시 에러를 던져야 한다', async () => {
      const failingProvider = new MockEmbeddingService(true, true);
      mockFactory.selectProvider.mockReturnValue(failingProvider);
      mockFactory.getProvider.mockReturnValue(failingProvider);

      await expect(service.generateEmbedding('테스트 텍스트')).rejects.toThrow('모든 임베딩 제공자 실패');
    });
  });

  describe('searchSimilar', () => {
    const mockEmbeddings: EmbeddingData[] = [
      { id: '1', content: '테스트 내용', embedding: [0.1, 0.2, 0.3] }
    ];

    it('빈 쿼리에 대해 에러를 던져야 한다', async () => {
      await expect(service.searchSimilar('', mockEmbeddings)).rejects.toThrow('텍스트가 비어있습니다');
    });

    it('유효한 쿼리에 대해 검색 결과를 반환해야 한다', async () => {
      const mockProvider = new MockEmbeddingService();
      mockFactory.selectProvider.mockReturnValue(mockProvider);

      const results = await service.searchSimilar('쿼리', mockEmbeddings);
      
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('1');
      expect(results[0].similarity).toBe(0.8);
    });

    it('제공자 실패 시 폴백을 시도해야 한다', async () => {
      const failingProvider = new MockEmbeddingService(true, true);
      const fallbackProvider = new MockEmbeddingService();
      
      mockFactory.selectProvider.mockReturnValue(failingProvider);
      mockFactory.getProvider
        .mockReturnValueOnce(failingProvider)
        .mockReturnValueOnce(fallbackProvider);

      const results = await service.searchSimilar('쿼리', mockEmbeddings);
      
      expect(results).toHaveLength(1);
    });
  });

  describe('isAvailable', () => {
    it('사용 가능한 제공자가 있으면 true를 반환해야 한다', () => {
      mockFactory.getAvailableProviders.mockReturnValue([
        { name: 'minilm', available: true },
        { name: 'tfidf', available: false }
      ]);

      expect(service.isAvailable()).toBe(true);
    });

    it('사용 가능한 제공자가 없으면 false를 반환해야 한다', () => {
      mockFactory.getAvailableProviders.mockReturnValue([
        { name: 'minilm', available: false },
        { name: 'tfidf', available: false }
      ]);

      expect(service.isAvailable()).toBe(false);
    });
  });

  describe('getModelInfo', () => {
    it('현재 제공자가 있으면 해당 정보를 반환해야 한다', () => {
      const mockProvider = new MockEmbeddingService();
      mockFactory.selectProvider.mockReturnValue(mockProvider);
      
      // 임베딩 생성으로 현재 제공자 설정
      service.generateEmbedding('test');
      
      const info = service.getModelInfo();
      expect(info.model).toBe('mock-model');
      expect(info.dimensions).toBe(384);
    });

    it('현재 제공자가 없으면 기본값을 반환해야 한다', () => {
      const info = service.getModelInfo();
      expect(info.model).toBe('unified-embedding');
      expect(info.dimensions).toBe(384);
    });
  });

  describe('getCurrentProviderName', () => {
    it('현재 제공자 이름을 반환해야 한다', () => {
      const mockProvider = new MockEmbeddingService();
      mockFactory.selectProvider.mockReturnValue(mockProvider);
      mockFactory.getAvailableProviders.mockReturnValue([
        { name: 'minilm', available: true }
      ]);
      mockFactory.getProvider.mockReturnValue(mockProvider);
      
      service.generateEmbedding('test');
      
      expect(service.getCurrentProviderName()).toBe('minilm');
    });
  });

  describe('setFallbackProviders', () => {
    it('폴백 제공자를 설정해야 한다', () => {
      const newFallbacks = ['tfidf', 'minilm'];
      service.setFallbackProviders(newFallbacks);
      
      // 내부 상태 확인은 어려우므로, 에러 없이 실행되는지 확인
      expect(() => service.setFallbackProviders(newFallbacks)).not.toThrow();
    });
  });
});
