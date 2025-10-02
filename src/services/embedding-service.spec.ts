import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { EmbeddingService } from './embedding-service.js';
import { mementoConfig } from '../config/index.js';

// Mock dependencies
vi.mock('../config/index.js', () => ({
  mementoConfig: {
    openaiApiKey: 'test-key',
    embeddingProvider: 'openai'
  }
}));

vi.mock('./gemini-embedding-service.js', () => ({
  GeminiEmbeddingService: vi.fn().mockImplementation(() => ({
    generateEmbedding: vi.fn().mockResolvedValue({
      embedding: [0.1, 0.2, 0.3],
      model: 'gemini-model',
      usage: { prompt_tokens: 10, total_tokens: 10 }
    }),
    isAvailable: vi.fn().mockReturnValue(true),
    getModelInfo: vi.fn().mockReturnValue({
      model: 'gemini-model',
      dimensions: 768,
      maxTokens: 1000
    })
  }))
}));

vi.mock('./lightweight-embedding-service.js', () => ({
  LightweightEmbeddingService: vi.fn().mockImplementation(() => ({
    generateEmbedding: vi.fn().mockResolvedValue({
      embedding: [0.4, 0.5, 0.6],
      model: 'lightweight-model',
      usage: { prompt_tokens: 5, total_tokens: 5 }
    }),
    isAvailable: vi.fn().mockReturnValue(true),
    getModelInfo: vi.fn().mockReturnValue({
      model: 'lightweight-model',
      dimensions: 512,
      maxTokens: 2000
    })
  }))
}));

// Mock OpenAI
const mockOpenAI = {
  embeddings: {
    create: vi.fn()
  }
};

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => mockOpenAI)
}));

describe('EmbeddingService', () => {
  let embeddingService: EmbeddingService;

  beforeEach(() => {
    vi.clearAllMocks();
    embeddingService = new EmbeddingService();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('생성자', () => {
    it('서비스가 올바르게 초기화되어야 함', () => {
      expect(embeddingService).toBeInstanceOf(EmbeddingService);
    });

    it('OpenAI API 키가 없으면 경고를 출력해야 함', () => {
      const consoleSpy = vi.spyOn(console, 'warn');
      vi.mocked(mementoConfig).openaiApiKey = undefined;
      
      new EmbeddingService();
      
      expect(consoleSpy).toHaveBeenCalledWith('⚠️ OpenAI API 키가 설정되지 않았습니다. 임베딩 기능이 비활성화됩니다.');
    });
  });

  describe('generateEmbedding', () => {
    it('빈 텍스트에 대해 에러를 던져야 함', async () => {
      await expect(embeddingService.generateEmbedding('')).rejects.toThrow('텍스트가 비어있습니다');
      await expect(embeddingService.generateEmbedding('   ')).rejects.toThrow('텍스트가 비어있습니다');
    });

    it('OpenAI 임베딩을 성공적으로 생성해야 함', async () => {
      const mockResponse = {
        data: [{ embedding: [0.1, 0.2, 0.3] }],
        usage: { prompt_tokens: 10, total_tokens: 10 }
      };
      
      mockOpenAI.embeddings.create.mockResolvedValue(mockResponse);

      const result = await embeddingService.generateEmbedding('test text');

      expect(result).toEqual({
        embedding: [0.1, 0.2, 0.3],
        model: 'text-embedding-3-small',
        usage: { prompt_tokens: 10, total_tokens: 10 }
      });
    });

    it('Gemini 임베딩을 성공적으로 생성해야 함', async () => {
      vi.mocked(mementoConfig).embeddingProvider = 'gemini';

      const result = await embeddingService.generateEmbedding('test text');

      expect(result).toEqual({
        embedding: [0.1, 0.2, 0.3],
        model: 'gemini-model',
        usage: { prompt_tokens: 10, total_tokens: 10 }
      });
    });

    it('경량 임베딩을 성공적으로 생성해야 함', async () => {
      vi.mocked(mementoConfig).embeddingProvider = 'lightweight';

      const result = await embeddingService.generateEmbedding('test text');

      expect(result).toEqual({
        embedding: [0.4, 0.5, 0.6],
        model: 'lightweight-model',
        usage: { prompt_tokens: 5, total_tokens: 5 }
      });
    });

    it('알 수 없는 제공자에 대해 경량 서비스로 fallback해야 함', async () => {
      const consoleSpy = vi.spyOn(console, 'warn');
      vi.mocked(mementoConfig).embeddingProvider = 'unknown' as any;

      const result = await embeddingService.generateEmbedding('test text');

      expect(consoleSpy).toHaveBeenCalledWith('⚠️ 알 수 없는 임베딩 제공자: unknown, 경량 서비스로 fallback');
      expect(result).toEqual({
        embedding: [0.4, 0.5, 0.6],
        model: 'lightweight-model',
        usage: { prompt_tokens: 5, total_tokens: 5 }
      });
    });

    it('OpenAI 실패 시 경량 서비스로 fallback해야 함', async () => {
      const consoleSpy = vi.spyOn(console, 'warn');
      mockOpenAI.embeddings.create.mockRejectedValue(new Error('OpenAI API error'));

      const result = await embeddingService.generateEmbedding('test text');

      expect(consoleSpy).toHaveBeenCalledWith('⚠️ openai 임베딩 실패, 경량 서비스로 fallback:', expect.any(Error));
      expect(result).toEqual({
        embedding: [0.4, 0.5, 0.6],
        model: 'lightweight-model',
        usage: { prompt_tokens: 5, total_tokens: 5 }
      });
    });

    it('캐시에서 결과를 반환해야 함', async () => {
      const mockResponse = {
        data: [{ embedding: [0.1, 0.2, 0.3] }],
        usage: { prompt_tokens: 10, total_tokens: 10 }
      };
      
      mockOpenAI.embeddings.create.mockResolvedValue(mockResponse);

      // 첫 번째 호출
      const result1 = await embeddingService.generateEmbedding('test text');
      // 두 번째 호출 (캐시에서 반환)
      const result2 = await embeddingService.generateEmbedding('test text');

      expect(mockOpenAI.embeddings.create).toHaveBeenCalledTimes(1);
      expect(result1).toEqual(result2);
    });
  });

  describe('searchSimilar', () => {
    beforeEach(async () => {
      const mockResponse = {
        data: [{ embedding: [0.1, 0.2, 0.3] }],
        usage: { prompt_tokens: 10, total_tokens: 10 }
      };
      mockOpenAI.embeddings.create.mockResolvedValue(mockResponse);
    });

    it('유사한 임베딩을 검색해야 함', async () => {
      const embeddings = [
        { id: '1', content: 'test content 1', embedding: [0.1, 0.2, 0.3] },
        { id: '2', content: 'test content 2', embedding: [0.9, 0.8, 0.7] },
        { id: '3', content: 'test content 3', embedding: [0.2, 0.3, 0.4] }
      ];

      const results = await embeddingService.searchSimilar('test query', embeddings, 2, 0.5);

      expect(results).toHaveLength(2);
      expect(results[0].similarity).toBeGreaterThanOrEqual(results[1].similarity);
    });

    it('임계값보다 낮은 유사도는 필터링해야 함', async () => {
      const embeddings = [
        { id: '1', content: 'test content 1', embedding: [0.1, 0.2, 0.3] },
        { id: '2', content: 'test content 2', embedding: [0.9, 0.8, 0.7] }
      ];

      const results = await embeddingService.searchSimilar('test query', embeddings, 10, 0.9);

      expect(results).toHaveLength(0);
    });

    it('쿼리 임베딩 생성 실패 시 빈 배열을 반환해야 함', async () => {
      mockOpenAI.embeddings.create.mockRejectedValue(new Error('API error'));

      const embeddings = [
        { id: '1', content: 'test content 1', embedding: [0.1, 0.2, 0.3] }
      ];

      const results = await embeddingService.searchSimilar('test query', embeddings);

      expect(results).toEqual([]);
    });
  });

  describe('cosineSimilarity', () => {
    it('동일한 벡터의 유사도는 1이어야 함', () => {
      const vector = [1, 2, 3];
      const result = (embeddingService as any).cosineSimilarity(vector, vector);
      expect(result).toBeCloseTo(1, 5);
    });

    it('직교하는 벡터의 유사도는 0이어야 함', () => {
      const vector1 = [1, 0, 0];
      const vector2 = [0, 1, 0];
      const result = (embeddingService as any).cosineSimilarity(vector1, vector2);
      expect(result).toBeCloseTo(0, 5);
    });

    it('다른 차원의 벡터에 대해 에러를 던져야 함', () => {
      const vector1 = [1, 2];
      const vector2 = [1, 2, 3];
      
      expect(() => {
        (embeddingService as any).cosineSimilarity(vector1, vector2);
      }).toThrow('벡터 차원이 일치하지 않습니다');
    });

    it('영벡터에 대해 0을 반환해야 함', () => {
      const vector1 = [0, 0, 0];
      const vector2 = [1, 2, 3];
      const result = (embeddingService as any).cosineSimilarity(vector1, vector2);
      expect(result).toBe(0);
    });
  });

  describe('isAvailable', () => {
    it('OpenAI 제공자가 사용 가능해야 함', () => {
      vi.mocked(mementoConfig).embeddingProvider = 'openai';
      expect(embeddingService.isAvailable()).toBe(true);
    });

    it('Gemini 제공자가 사용 가능해야 함', () => {
      vi.mocked(mementoConfig).embeddingProvider = 'gemini';
      expect(embeddingService.isAvailable()).toBe(true);
    });

    it('경량 제공자가 사용 가능해야 함', () => {
      vi.mocked(mementoConfig).embeddingProvider = 'lightweight';
      expect(embeddingService.isAvailable()).toBe(true);
    });
  });

  describe('getModelInfo', () => {
    it('OpenAI 모델 정보를 반환해야 함', () => {
      vi.mocked(mementoConfig).embeddingProvider = 'openai';
      
      const info = embeddingService.getModelInfo();
      
      expect(info).toEqual({
        model: 'text-embedding-3-small',
        dimensions: 1536,
        maxTokens: 8191
      });
    });

    it('Gemini 모델 정보를 반환해야 함', () => {
      vi.mocked(mementoConfig).embeddingProvider = 'gemini';
      
      const info = embeddingService.getModelInfo();
      
      expect(info).toEqual({
        model: 'gemini-model',
        dimensions: 768,
        maxTokens: 1000
      });
    });

    it('경량 모델 정보를 반환해야 함', () => {
      vi.mocked(mementoConfig).embeddingProvider = 'lightweight';
      
      const info = embeddingService.getModelInfo();
      
      expect(info).toEqual({
        model: 'lightweight-model',
        dimensions: 512,
        maxTokens: 2000
      });
    });
  });

  describe('캐시 관리', () => {
    it('캐시 키를 올바르게 생성해야 함', () => {
      const key1 = (embeddingService as any).generateCacheKey('test text');
      const key2 = (embeddingService as any).generateCacheKey('test text');
      const key3 = (embeddingService as any).generateCacheKey('different text');
      
      expect(key1).toBe(key2);
      expect(key1).not.toBe(key3);
    });

    it('텍스트 해시를 올바르게 생성해야 함', () => {
      const hash1 = (embeddingService as any).hashText('test');
      const hash2 = (embeddingService as any).hashText('test');
      const hash3 = (embeddingService as any).hashText('different');
      
      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(hash3);
      expect(typeof hash1).toBe('string');
    });
  });

  describe('텍스트 자르기', () => {
    it('짧은 텍스트는 그대로 반환해야 함', () => {
      const shortText = 'short text';
      const result = (embeddingService as any).truncateText(shortText);
      expect(result).toBe(shortText);
    });

    it('긴 텍스트는 잘라야 함', () => {
      const longText = 'a'.repeat(40000); // 8191 * 4보다 긴 텍스트
      const result = (embeddingService as any).truncateText(longText);
      expect(result.length).toBeLessThanOrEqual(8191 * 4);
    });
  });
});
