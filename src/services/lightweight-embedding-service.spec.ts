import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LightweightEmbeddingService, LightweightEmbeddingResult, LightweightSimilarityResult } from './lightweight-embedding-service.js';
import { getStopWords } from '../utils/stopwords.js';

// Mock stopwords
vi.mock('../utils/stopwords.js', () => ({
  getStopWords: vi.fn(() => new Set(['the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'but']))
}));

describe('LightweightEmbeddingService', () => {
  let service: LightweightEmbeddingService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new LightweightEmbeddingService();
  });

  describe('constructor', () => {
    it('should initialize with default settings', () => {
      expect(service).toBeInstanceOf(LightweightEmbeddingService);
      expect(service.isAvailable()).toBe(true);
    });

    it('should load stop words', () => {
      expect(getStopWords).toHaveBeenCalled();
    });
  });

  describe('generateEmbedding', () => {
    it('should generate embedding for valid text', async () => {
      const text = 'This is a test document for embedding generation';
      const result = await service.generateEmbedding(text);

      expect(result).toBeDefined();
      expect(result?.embedding).toBeDefined();
      expect(Array.isArray(result?.embedding)).toBe(true);
      expect(result?.embedding.length).toBe(512); // Fixed dimensions
      expect(result?.model).toBe('lightweight-hybrid');
      expect(result?.usage).toBeDefined();
      expect(result?.usage.prompt_tokens).toBeGreaterThan(0);
      expect(result?.usage.total_tokens).toBeGreaterThan(0);
    });

    it('should throw error for empty text', async () => {
      await expect(service.generateEmbedding('')).rejects.toThrow('텍스트가 비어있습니다');
      await expect(service.generateEmbedding('   ')).rejects.toThrow('텍스트가 비어있습니다');
    });

    it('should handle Korean text', async () => {
      const text = '안녕하세요. 이것은 한국어 텍스트입니다.';
      const result = await service.generateEmbedding(text);

      expect(result).toBeDefined();
      expect(result?.embedding).toBeDefined();
      expect(result?.embedding.length).toBe(512);
    });

    it('should handle technical terms', async () => {
      const text = 'React API HTTP JSON TypeScript camelCase snake_case';
      const result = await service.generateEmbedding(text);

      expect(result).toBeDefined();
      expect(result?.embedding).toBeDefined();
    });

    it('should generate consistent embeddings for same text', async () => {
      const text = 'Consistent test text';
      const result1 = await service.generateEmbedding(text);
      const result2 = await service.generateEmbedding(text);

      expect(result1?.embedding).toEqual(result2?.embedding);
    });

    it('should generate different embeddings for different text', async () => {
      const text1 = 'First test text';
      const text2 = 'Second test text';
      const result1 = await service.generateEmbedding(text1);
      const result2 = await service.generateEmbedding(text2);

      expect(result1?.embedding).not.toEqual(result2?.embedding);
    });
  });

  describe('searchSimilar', () => {
    it('should find similar embeddings', async () => {
      const query = 'test query';
      const embeddings = [
        { id: '1', content: 'similar test content', embedding: new Array(512).fill(0.1) },
        { id: '2', content: 'different content', embedding: new Array(512).fill(0.9) }
      ];

      const results = await service.searchSimilar(query, embeddings, 10, 0.5);

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
      results.forEach(result => {
        expect(result).toHaveProperty('id');
        expect(result).toHaveProperty('content');
        expect(result).toHaveProperty('similarity');
        expect(result).toHaveProperty('score');
        expect(typeof result.similarity).toBe('number');
        expect(typeof result.score).toBe('number');
      });
    });

    it('should filter by threshold', async () => {
      const query = 'test query';
      const embeddings = [
        { id: '1', content: 'similar content', embedding: new Array(512).fill(0.1) },
        { id: '2', content: 'different content', embedding: new Array(512).fill(0.9) }
      ];

      const results = await service.searchSimilar(query, embeddings, 10, 0.9);

      expect(Array.isArray(results)).toBe(true);
      results.forEach(result => {
        expect(result.similarity).toBeGreaterThanOrEqual(0.9);
      });
    });

    it('should limit results', async () => {
      const query = 'test query';
      const embeddings = Array.from({ length: 20 }, (_, i) => ({
        id: `${i}`,
        content: `content ${i}`,
        embedding: new Array(512).fill(0.1)
      }));

      const results = await service.searchSimilar(query, embeddings, 5, 0.5);

      expect(results.length).toBeLessThanOrEqual(5);
    });

    it('should return empty array when query embedding fails', async () => {
      // Mock generateEmbedding to return null
      vi.spyOn(service, 'generateEmbedding').mockResolvedValue(null);

      const query = 'test query';
      const embeddings = [
        { id: '1', content: 'content', embedding: new Array(512).fill(0.1) }
      ];

      const results = await service.searchSimilar(query, embeddings);

      expect(results).toEqual([]);
    });

    it('should sort results by similarity descending', async () => {
      const query = 'test query';
      const embeddings = [
        { id: '1', content: 'low similarity', embedding: new Array(512).fill(0.1) },
        { id: '2', content: 'high similarity', embedding: new Array(512).fill(0.9) },
        { id: '3', content: 'medium similarity', embedding: new Array(512).fill(0.5) }
      ];

      const results = await service.searchSimilar(query, embeddings, 10, 0.1);

      expect(results.length).toBe(3);
      for (let i = 1; i < results.length; i++) {
        expect(results[i-1].similarity).toBeGreaterThanOrEqual(results[i].similarity);
      }
    });
  });

  describe('getModelInfo', () => {
    it('should return correct model information', () => {
      const info = service.getModelInfo();

      expect(info.model).toBe('lightweight-hybrid');
      expect(info.dimensions).toBe(512);
      expect(info.maxTokens).toBe(8191);
    });
  });

  describe('isAvailable', () => {
    it('should always return true', () => {
      expect(service.isAvailable()).toBe(true);
    });
  });

  describe('private methods', () => {
    describe('preprocessText', () => {
      it('should preprocess text correctly', () => {
        const text = 'Hello World! This is a TEST.';
        const result = (service as any).preprocessText(text);

        expect(Array.isArray(result)).toBe(true);
        expect(result).toContain('hello');
        expect(result).toContain('world');
        expect(result).toContain('test');
        expect(result).not.toContain('this'); // Should be filtered as stop word
        expect(result).not.toContain('is'); // Should be filtered as stop word
        expect(result).not.toContain('a'); // Should be filtered as stop word
      });

      it('should handle Korean text', () => {
        const text = '안녕하세요! 이것은 테스트입니다.';
        const result = (service as any).preprocessText(text);

        expect(Array.isArray(result)).toBe(true);
        expect(result).toContain('안녕하세요');
        expect(result).toContain('테스트입니다');
      });

      it('should filter out short words', () => {
        const text = 'a b c hello world';
        const result = (service as any).preprocessText(text);

        expect(result).not.toContain('a');
        expect(result).not.toContain('b');
        expect(result).not.toContain('c');
        expect(result).toContain('hello');
        expect(result).toContain('world');
      });

      it('should filter out stop words', () => {
        const text = 'the quick brown fox jumps over the lazy dog';
        const result = (service as any).preprocessText(text);

        expect(result).not.toContain('the');
        expect(result).toContain('quick');
        expect(result).toContain('brown');
        expect(result).toContain('fox');
      });
    });

    describe('createTFIDFVector', () => {
      it('should create TF-IDF vector', () => {
        const words = ['hello', 'world', 'hello', 'test'];
        const result = (service as any).createTFIDFVector(words);

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(512);
        expect(result.every(val => typeof val === 'number')).toBe(true);
      });

      it('should handle empty words array', () => {
        const words: string[] = [];
        const result = (service as any).createTFIDFVector(words);

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(512);
        expect(result.every(val => val === 0)).toBe(true);
      });
    });

    describe('calculateIDF', () => {
      it('should calculate IDF for different word types', () => {
        const shortWord = 'hi';
        const longWord = 'supercalifragilisticexpialidocious';
        const numberWord = 'test123';
        const specialWord = 'test-word';

        const shortIDF = (service as any).calculateIDF(shortWord);
        const longIDF = (service as any).calculateIDF(longWord);
        const numberIDF = (service as any).calculateIDF(numberWord);
        const specialIDF = (service as any).calculateIDF(specialWord);

        expect(shortIDF).toBeGreaterThan(0);
        expect(longIDF).toBeGreaterThan(shortIDF);
        expect(numberIDF).toBeLessThan(shortIDF);
        expect(specialIDF).toBeGreaterThan(shortIDF);
      });
    });

    describe('applyKeywordWeights', () => {
      it('should apply weights to technical terms', () => {
        const vector = new Array(512).fill(0.1);
        const words = ['React', 'API', 'HTTP', 'JSON'];

        const result = (service as any).applyKeywordWeights(vector, words);

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBe(512);
      });

      it('should handle empty words array', () => {
        const vector = new Array(512).fill(0.1);
        const words: string[] = [];

        const result = (service as any).applyKeywordWeights(vector, words);

        expect(result).toEqual(vector);
      });

      it('should handle undefined values safely', () => {
        const vector = new Array(512).fill(0.1);
        const words = ['test', '', undefined, 'word'];

        expect(() => (service as any).applyKeywordWeights(vector, words)).not.toThrow();
      });
    });

    describe('isTechnicalTerm', () => {
      it('should identify camelCase as technical term', () => {
        const result = (service as any).isTechnicalTerm('camelCase');
        expect(result).toBe(true);
      });

      it('should identify PascalCase as technical term', () => {
        const result = (service as any).isTechnicalTerm('PascalCase');
        expect(result).toBe(true);
      });

      it('should identify snake_case as technical term', () => {
        const result = (service as any).isTechnicalTerm('snake_case');
        expect(result).toBe(true);
      });

      it('should identify kebab-case as technical term', () => {
        const result = (service as any).isTechnicalTerm('kebab-case');
        expect(result).toBe(true);
      });

      it('should identify technology terms', () => {
        const techTerms = ['API', 'HTTP', 'JSON', 'XML', 'SQL', 'DB', 'UI', 'UX', 'AI', 'ML', 'NLP'];
        
        techTerms.forEach(term => {
          const result = (service as any).isTechnicalTerm(term);
          expect(result).toBe(true);
        });
      });

      it('should identify framework terms', () => {
        const frameworkTerms = ['React', 'Vue', 'Angular', 'Node', 'Python', 'Java', 'TypeScript'];
        
        frameworkTerms.forEach(term => {
          const result = (service as any).isTechnicalTerm(term);
          expect(result).toBe(true);
        });
      });

      it('should not identify regular words as technical terms', () => {
        const regularWords = ['hello', 'world', 'test', 'document'];
        
        regularWords.forEach(word => {
          const result = (service as any).isTechnicalTerm(word);
          expect(result).toBe(false);
        });
      });
    });

    describe('normalizeVector', () => {
      it('should normalize vector correctly', () => {
        const vector = [3, 4, 0];
        const result = (service as any).normalizeVector(vector);

        expect(result.length).toBe(3);
        expect(result[0]).toBeCloseTo(0.6, 1);
        expect(result[1]).toBeCloseTo(0.8, 1);
        expect(result[2]).toBe(0);
      });

      it('should handle zero vector', () => {
        const vector = [0, 0, 0];
        const result = (service as any).normalizeVector(vector);

        expect(result).toEqual(vector);
      });
    });

    describe('adjustDimensions', () => {
      it('should pad vector when too short', () => {
        const vector = [1, 2, 3];
        const result = (service as any).adjustDimensions(vector);

        expect(result.length).toBe(512);
        expect(result[0]).toBe(1);
        expect(result[1]).toBe(2);
        expect(result[2]).toBe(3);
        expect(result.slice(3).every(val => val === 0)).toBe(true);
      });

      it('should truncate vector when too long', () => {
        const vector = new Array(600).fill(1);
        const result = (service as any).adjustDimensions(vector);

        expect(result.length).toBe(512);
        expect(result.every(val => val === 1)).toBe(true);
      });

      it('should return same vector when dimensions match', () => {
        const vector = new Array(512).fill(0.5);
        const result = (service as any).adjustDimensions(vector);

        expect(result).toEqual(vector);
      });
    });

    describe('hashToIndex', () => {
      it('should generate consistent indices', () => {
        const word = 'test';
        const index1 = (service as any).hashToIndex(word);
        const index2 = (service as any).hashToIndex(word);

        expect(index1).toBe(index2);
        expect(index1).toBeGreaterThanOrEqual(0);
        expect(index1).toBeLessThan(512);
      });

      it('should generate different indices for different words', () => {
        const index1 = (service as any).hashToIndex('word1');
        const index2 = (service as any).hashToIndex('word2');

        expect(index1).not.toBe(index2);
      });
    });

    describe('cosineSimilarity', () => {
      it('should calculate cosine similarity correctly', () => {
        const a = [1, 0, 0];
        const b = [1, 0, 0];
        const similarity = (service as any).cosineSimilarity(a, b);

        expect(similarity).toBe(1);
      });

      it('should calculate cosine similarity for different vectors', () => {
        const a = [1, 0, 0];
        const b = [0, 1, 0];
        const similarity = (service as any).cosineSimilarity(a, b);

        expect(similarity).toBe(0);
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

    describe('estimateTokens', () => {
      it('should estimate tokens correctly', () => {
        const text = 'hello world'; // 11 characters
        const tokens = (service as any).estimateTokens(text);

        expect(tokens).toBe(3); // 11 / 4 = 2.75, rounded up to 3
      });

      it('should handle empty text', () => {
        const text = '';
        const tokens = (service as any).estimateTokens(text);

        expect(tokens).toBe(0);
      });
    });
  });
});
