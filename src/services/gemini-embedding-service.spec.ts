import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GeminiEmbeddingService, GeminiEmbeddingResult, GeminiSimilarityResult } from './gemini-embedding-service.js';
import { mementoConfig } from '../config/index.js';
import { LightweightEmbeddingService } from './lightweight-embedding-service.js';

// Mock GoogleGenAI
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      embedContent: vi.fn()
    }
  }))
}));

// Mock config
vi.mock('../config/index.js', () => ({
  mementoConfig: {
    geminiApiKey: 'test-api-key',
    geminiModel: 'text-embedding-004',
    embeddingDimensions: 768
  }
}));

// Mock LightweightEmbeddingService
vi.mock('./lightweight-embedding-service.js', () => ({
  LightweightEmbeddingService: vi.fn().mockImplementation(() => ({
    generateEmbedding: vi.fn(),
    isAvailable: vi.fn(() => true),
    getModelInfo: vi.fn(() => ({
      model: 'lightweight-hybrid',
      dimensions: 768,
      maxTokens: 2048
    }))
  }))
}));

describe('GeminiEmbeddingService', () => {
  let service: GeminiEmbeddingService;
  let mockGenAI: any;
  let mockLightweightService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock GoogleGenAI instance
    mockGenAI = {
      models: {
        embedContent: vi.fn()
      }
    };
    
    // Mock LightweightEmbeddingService instance
    mockLightweightService = {
      generateEmbedding: vi.fn(),
      isAvailable: vi.fn(() => true),
      getModelInfo: vi.fn(() => ({
        model: 'lightweight-hybrid',
        dimensions: 768,
        maxTokens: 2048
      }))
    };

    // Mock constructor dependencies
    vi.mocked(LightweightEmbeddingService).mockImplementation(() => mockLightweightService);
    
    service = new GeminiEmbeddingService();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with Gemini API key', () => {
      expect(service).toBeInstanceOf(GeminiEmbeddingService);
    });

    it('should initialize lightweight service as fallback', () => {
      expect(LightweightEmbeddingService).toHaveBeenCalled();
    });
  });

  describe('generateEmbedding', () => {
    it('should generate embedding using Gemini API', async () => {
      const mockEmbedding = new Array(768).fill(0.1);
      const mockResult = {
        embeddings: [{
          values: mockEmbedding
        }]
      };

      // Mock Gemini API response
      const mockGenAIInstance = {
        models: {
          embedContent: vi.fn().mockResolvedValue(mockResult)
        }
      };
      
      // Mock GoogleGenAI constructor to return our mock
      const { GoogleGenAI } = await import('@google/genai');
      vi.mocked(GoogleGenAI).mockImplementation(() => mockGenAIInstance);

      const text = 'Test text for embedding';
      const result = await service.generateEmbedding(text);

      expect(result).toBeDefined();
      expect(result?.embedding).toEqual(mockEmbedding);
      expect(result?.model).toBe('text-embedding-004');
      expect(result?.usage).toBeDefined();
    });

    it('should use cache for repeated requests', async () => {
      const mockEmbedding = new Array(768).fill(0.1);
      const mockResult = {
        embeddings: [{
          values: mockEmbedding
        }]
      };

      const mockGenAIInstance = {
        models: {
          embedContent: vi.fn().mockResolvedValue(mockResult)
        }
      };
      
      const { GoogleGenAI } = await import('@google/genai');
      vi.mocked(GoogleGenAI).mockImplementation(() => mockGenAIInstance);

      const text = 'Test text for embedding';
      
      // First call
      const result1 = await service.generateEmbedding(text);
      // Second call (should use cache)
      const result2 = await service.generateEmbedding(text);

      expect(result1).toEqual(result2);
      expect(mockGenAIInstance.models.embedContent).toHaveBeenCalledTimes(1);
    });

    it('should fallback to lightweight service when Gemini fails', async () => {
      const mockLightweightResult = {
        embedding: new Array(768).fill(0.2),
        model: 'lightweight-hybrid',
        usage: {
          prompt_tokens: 10,
          total_tokens: 10
        }
      };

      mockLightweightService.generateEmbedding.mockResolvedValue(mockLightweightResult);

      // Mock Gemini failure
      const mockGenAIInstance = {
        models: {
          embedContent: vi.fn().mockRejectedValue(new Error('Gemini API error'))
        }
      };
      
      const { GoogleGenAI } = await import('@google/genai');
      vi.mocked(GoogleGenAI).mockImplementation(() => mockGenAIInstance);

      const text = 'Test text for embedding';
      const result = await service.generateEmbedding(text);

      expect(result).toBeDefined();
      expect(result?.embedding).toEqual(mockLightweightResult.embedding);
      expect(mockLightweightService.generateEmbedding).toHaveBeenCalledWith(text);
    });

    it('should throw error for empty text', async () => {
      await expect(service.generateEmbedding('')).rejects.toThrow('텍스트가 비어있습니다');
      await expect(service.generateEmbedding('   ')).rejects.toThrow('텍스트가 비어있습니다');
    });

    it('should truncate text when exceeding max tokens', async () => {
      const longText = 'a'.repeat(10000); // Exceeds max tokens
      const mockEmbedding = new Array(768).fill(0.1);
      const mockResult = {
        embeddings: [{
          values: mockEmbedding
        }]
      };

      const mockGenAIInstance = {
        models: {
          embedContent: vi.fn().mockResolvedValue(mockResult)
        }
      };
      
      const { GoogleGenAI } = await import('@google/genai');
      vi.mocked(GoogleGenAI).mockImplementation(() => mockGenAIInstance);

      const result = await service.generateEmbedding(longText);

      expect(result).toBeDefined();
      // Should have called with truncated text
      expect(mockGenAIInstance.models.embedContent).toHaveBeenCalledWith({
        model: 'text-embedding-004',
        contents: [{ parts: [{ text: expect.stringMatching(/^a{8192}$/) }] }],
        config: {
          outputDimensionality: 768
        }
      });
    });
  });

  describe('searchSimilar', () => {
    it('should find similar embeddings', async () => {
      const mockEmbedding = new Array(768).fill(0.1);
      const mockResult = {
        embeddings: [{
          values: mockEmbedding
        }]
      };

      const mockGenAIInstance = {
        models: {
          embedContent: vi.fn().mockResolvedValue(mockResult)
        }
      };
      
      const { GoogleGenAI } = await import('@google/genai');
      vi.mocked(GoogleGenAI).mockImplementation(() => mockGenAIInstance);

      const query = 'test query';
      const embeddings = [
        { id: '1', content: 'similar content', embedding: new Array(768).fill(0.1) },
        { id: '2', content: 'different content', embedding: new Array(768).fill(0.9) }
      ];

      const results = await service.searchSimilar(query, embeddings, 10, 0.5);

      expect(results).toHaveLength(2);
      expect(results[0].id).toBe('1'); // More similar (same values)
      expect(results[0].similarity).toBe(1); // Perfect similarity
    });

    it('should filter by threshold', async () => {
      const mockEmbedding = new Array(768).fill(0.1);
      const mockResult = {
        embeddings: [{
          values: mockEmbedding
        }]
      };

      const mockGenAIInstance = {
        models: {
          embedContent: vi.fn().mockResolvedValue(mockResult)
        }
      };
      
      const { GoogleGenAI } = await import('@google/genai');
      vi.mocked(GoogleGenAI).mockImplementation(() => mockGenAIInstance);

      const query = 'test query';
      const embeddings = [
        { id: '1', content: 'similar content', embedding: new Array(768).fill(0.1) },
        { id: '2', content: 'different content', embedding: new Array(768).fill(0.9) }
      ];

      const results = await service.searchSimilar(query, embeddings, 10, 0.9);

      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('1');
    });

    it('should limit results', async () => {
      const mockEmbedding = new Array(768).fill(0.1);
      const mockResult = {
        embeddings: [{
          values: mockEmbedding
        }]
      };

      const mockGenAIInstance = {
        models: {
          embedContent: vi.fn().mockResolvedValue(mockResult)
        }
      };
      
      const { GoogleGenAI } = await import('@google/genai');
      vi.mocked(GoogleGenAI).mockImplementation(() => mockGenAIInstance);

      const query = 'test query';
      const embeddings = Array.from({ length: 20 }, (_, i) => ({
        id: `${i}`,
        content: `content ${i}`,
        embedding: new Array(768).fill(0.1)
      }));

      const results = await service.searchSimilar(query, embeddings, 5, 0.5);

      expect(results).toHaveLength(5);
    });

    it('should return empty array when query embedding fails', async () => {
      mockLightweightService.generateEmbedding.mockResolvedValue(null);

      const query = 'test query';
      const embeddings = [
        { id: '1', content: 'content', embedding: new Array(768).fill(0.1) }
      ];

      const results = await service.searchSimilar(query, embeddings);

      expect(results).toEqual([]);
    });
  });

  describe('cosineSimilarity', () => {
    it('should calculate cosine similarity correctly', () => {
      const a = [1, 0, 0];
      const b = [1, 0, 0];
      const similarity = (service as any).cosineSimilarity(a, b);
      
      expect(similarity).toBe(1); // Perfect similarity
    });

    it('should calculate cosine similarity for different vectors', () => {
      const a = [1, 0, 0];
      const b = [0, 1, 0];
      const similarity = (service as any).cosineSimilarity(a, b);
      
      expect(similarity).toBe(0); // Orthogonal vectors
    });

    it('should handle zero vectors', () => {
      const a = [0, 0, 0];
      const b = [1, 1, 1];
      const similarity = (service as any).cosineSimilarity(a, b);
      
      expect(similarity).toBe(0);
    });

    it('should throw error for mismatched dimensions', () => {
      const a = [1, 2, 3];
      const b = [1, 2];
      
      expect(() => (service as any).cosineSimilarity(a, b)).toThrow('벡터 차원이 일치하지 않습니다');
    });
  });

  describe('isAvailable', () => {
    it('should return true when Gemini is available', () => {
      const result = service.isAvailable();
      expect(result).toBe(true);
    });

    it('should return true when only lightweight service is available', () => {
      // Mock no Gemini API key
      vi.mocked(mementoConfig).geminiApiKey = undefined;
      
      const newService = new GeminiEmbeddingService();
      const result = newService.isAvailable();
      
      expect(result).toBe(true); // Should fallback to lightweight
    });
  });

  describe('getModelInfo', () => {
    it('should return Gemini model info when available', () => {
      const result = service.getModelInfo();
      
      expect(result.model).toBe('text-embedding-004');
      expect(result.dimensions).toBe(768);
      expect(result.maxTokens).toBe(2048);
    });

    it('should return lightweight model info when Gemini unavailable', () => {
      // Mock no Gemini API key
      vi.mocked(mementoConfig).geminiApiKey = undefined;
      
      const newService = new GeminiEmbeddingService();
      const result = newService.getModelInfo();
      
      expect(result.model).toBe('lightweight-hybrid');
      expect(result.dimensions).toBe(768);
      expect(result.maxTokens).toBe(2048);
    });
  });

  describe('private methods', () => {
    describe('generateCacheKey', () => {
      it('should generate consistent cache keys', () => {
        const text = 'test text';
        const key1 = (service as any).generateCacheKey(text);
        const key2 = (service as any).generateCacheKey(text);
        
        expect(key1).toBe(key2);
        expect(key1).toMatch(/^gemini_embedding:[a-z0-9]+$/);
      });

      it('should generate different keys for different texts', () => {
        const key1 = (service as any).generateCacheKey('text1');
        const key2 = (service as any).generateCacheKey('text2');
        
        expect(key1).not.toBe(key2);
      });
    });

    describe('hashText', () => {
      it('should generate consistent hashes', () => {
        const text = 'test text';
        const hash1 = (service as any).hashText(text);
        const hash2 = (service as any).hashText(text);
        
        expect(hash1).toBe(hash2);
        expect(typeof hash1).toBe('string');
      });

      it('should generate different hashes for different texts', () => {
        const hash1 = (service as any).hashText('text1');
        const hash2 = (service as any).hashText('text2');
        
        expect(hash1).not.toBe(hash2);
      });
    });

    describe('truncateText', () => {
      it('should not truncate short text', () => {
        const text = 'short text';
        const result = (service as any).truncateText(text);
        
        expect(result).toBe(text);
      });

      it('should truncate long text', () => {
        const longText = 'a'.repeat(10000);
        const result = (service as any).truncateText(longText);
        
        expect(result.length).toBeLessThan(longText.length);
        expect(result.length).toBe(8192); // maxTokens * 4
      });
    });

    describe('estimateTokens', () => {
      it('should estimate tokens correctly', () => {
        const text = 'hello world'; // 11 characters
        const tokens = (service as any).estimateTokens(text);
        
        expect(tokens).toBe(3); // 11 / 4 = 2.75, rounded up to 3
      });
    });

    describe('cleanupCache', () => {
      it('should clean up cache when size exceeds limit', () => {
        // Add many items to cache
        for (let i = 0; i < 1001; i++) {
          (service as any).embeddingCache.set(`key${i}`, {
            embedding: new Array(768).fill(0.1),
            model: 'test',
            usage: { prompt_tokens: 1, total_tokens: 1 }
          });
        }

        // Trigger cleanup
        (service as any).cleanupCache();

        expect((service as any).embeddingCache.size).toBe(500);
      });
    });
  });
});
