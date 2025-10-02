import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MemoryEmbeddingService, MemoryEmbedding, VectorSearchResult } from './memory-embedding-service.js';
import { EmbeddingService } from './embedding-service.js';
import { DatabaseUtils } from '../utils/database.js';
import type { MemoryType } from '../types/index.js';

// Mock dependencies
vi.mock('./embedding-service.js', () => ({
  EmbeddingService: vi.fn().mockImplementation(() => ({
    isAvailable: vi.fn(() => true),
    generateEmbedding: vi.fn(),
    searchSimilar: vi.fn(),
    getModelInfo: vi.fn(() => ({
      model: 'test-model',
      dimensions: 768,
      maxTokens: 2048
    }))
  }))
}));

vi.mock('../utils/database.js', () => ({
  DatabaseUtils: {
    run: vi.fn(),
    all: vi.fn()
  }
}));

describe('MemoryEmbeddingService', () => {
  let service: MemoryEmbeddingService;
  let mockDb: any;
  let mockEmbeddingService: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    mockDb = {} as any;
    service = new MemoryEmbeddingService();
    mockEmbeddingService = (service as any).embeddingService;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with EmbeddingService', () => {
      expect(service).toBeInstanceOf(MemoryEmbeddingService);
      expect(EmbeddingService).toHaveBeenCalled();
    });
  });

  describe('createAndStoreEmbedding', () => {
    it('should create and store embedding successfully', async () => {
      const mockEmbeddingResult = {
        embedding: new Array(768).fill(0.1),
        model: 'test-model',
        usage: {
          prompt_tokens: 10,
          total_tokens: 10
        }
      };

      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbeddingResult);
      vi.mocked(DatabaseUtils.run).mockResolvedValue(undefined);

      const result = await service.createAndStoreEmbedding(
        mockDb,
        'memory-123',
        'Test content',
        'episodic' as MemoryType
      );

      expect(result).toEqual(mockEmbeddingResult);
      expect(mockEmbeddingService.generateEmbedding).toHaveBeenCalledWith('Test content');
      expect(DatabaseUtils.run).toHaveBeenCalledWith(
        mockDb,
        expect.stringContaining('INSERT OR REPLACE INTO memory_embedding'),
        ['memory-123', JSON.stringify(mockEmbeddingResult.embedding), 768, 'test-model']
      );
    });

    it('should return null when embedding service is not available', async () => {
      mockEmbeddingService.isAvailable.mockReturnValue(false);

      const result = await service.createAndStoreEmbedding(
        mockDb,
        'memory-123',
        'Test content',
        'episodic' as MemoryType
      );

      expect(result).toBeNull();
      expect(mockEmbeddingService.generateEmbedding).not.toHaveBeenCalled();
    });

    it('should return null when embedding generation fails', async () => {
      mockEmbeddingService.generateEmbedding.mockResolvedValue(null);

      const result = await service.createAndStoreEmbedding(
        mockDb,
        'memory-123',
        'Test content',
        'episodic' as MemoryType
      );

      expect(result).toBeNull();
      expect(DatabaseUtils.run).not.toHaveBeenCalled();
    });

    it('should handle database errors gracefully', async () => {
      const mockEmbeddingResult = {
        embedding: new Array(768).fill(0.1),
        model: 'test-model',
        usage: { prompt_tokens: 10, total_tokens: 10 }
      };

      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbeddingResult);
      vi.mocked(DatabaseUtils.run).mockRejectedValue(new Error('Database error'));

      const result = await service.createAndStoreEmbedding(
        mockDb,
        'memory-123',
        'Test content',
        'episodic' as MemoryType
      );

      expect(result).toBeNull();
    });
  });

  describe('searchBySimilarity', () => {
    it('should search by similarity successfully', async () => {
      const mockEmbeddingResult = {
        embedding: new Array(768).fill(0.1),
        model: 'test-model',
        usage: { prompt_tokens: 10, total_tokens: 10 }
      };

      const mockEmbeddings = [
        { id: 'memory-1', content: 'Test content 1', embedding: new Array(768).fill(0.1) },
        { id: 'memory-2', content: 'Test content 2', embedding: new Array(768).fill(0.2) }
      ];

      const mockSimilarities = [
        { id: 'memory-1', content: 'Test content 1', similarity: 0.9, score: 0.9 },
        { id: 'memory-2', content: 'Test content 2', similarity: 0.8, score: 0.8 }
      ];

      const mockMemory = {
        id: 'memory-1',
        content: 'Test content 1',
        type: 'episodic',
        importance: 0.8,
        created_at: '2023-01-01T00:00:00Z',
        last_accessed: '2023-01-02T00:00:00Z',
        pinned: false,
        tags: '["tag1", "tag2"]'
      };

      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbeddingResult);
      mockEmbeddingService.searchSimilar.mockResolvedValue(mockSimilarities);
      vi.mocked(DatabaseUtils.all)
        .mockResolvedValueOnce(mockEmbeddings) // getAllEmbeddings
        .mockResolvedValueOnce([mockMemory]); // getMemoryById

      const results = await service.searchBySimilarity(mockDb, 'test query');

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual({
        id: 'memory-1',
        content: 'Test content 1',
        type: 'episodic',
        importance: 0.8,
        created_at: '2023-01-01T00:00:00Z',
        last_accessed: '2023-01-02T00:00:00Z',
        pinned: false,
        tags: ['tag1', 'tag2'],
        similarity: 0.9,
        score: 0.9
      });
    });

    it('should return empty array when embedding service is not available', async () => {
      mockEmbeddingService.isAvailable.mockReturnValue(false);

      const results = await service.searchBySimilarity(mockDb, 'test query');

      expect(results).toEqual([]);
    });

    it('should return empty array when query embedding fails', async () => {
      mockEmbeddingService.generateEmbedding.mockResolvedValue(null);

      const results = await service.searchBySimilarity(mockDb, 'test query');

      expect(results).toEqual([]);
    });

    it('should return empty array when no embeddings found', async () => {
      const mockEmbeddingResult = {
        embedding: new Array(768).fill(0.1),
        model: 'test-model',
        usage: { prompt_tokens: 10, total_tokens: 10 }
      };

      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbeddingResult);
      vi.mocked(DatabaseUtils.all).mockResolvedValue([]); // No embeddings

      const results = await service.searchBySimilarity(mockDb, 'test query');

      expect(results).toEqual([]);
    });

    it('should apply type filters', async () => {
      const mockEmbeddingResult = {
        embedding: new Array(768).fill(0.1),
        model: 'test-model',
        usage: { prompt_tokens: 10, total_tokens: 10 }
      };

      const mockEmbeddings = [
        { id: 'memory-1', content: 'Test content 1', embedding: new Array(768).fill(0.1) }
      ];

      const mockSimilarities = [
        { id: 'memory-1', content: 'Test content 1', similarity: 0.9, score: 0.9 }
      ];

      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbeddingResult);
      mockEmbeddingService.searchSimilar.mockResolvedValue(mockSimilarities);
      vi.mocked(DatabaseUtils.all).mockResolvedValue(mockEmbeddings);

      await service.searchBySimilarity(mockDb, 'test query', {
        type: ['episodic', 'semantic'],
        limit: 5,
        threshold: 0.8
      });

      expect(DatabaseUtils.all).toHaveBeenCalledWith(
        mockDb,
        expect.stringContaining('WHERE mi.type IN (?,?)'),
        ['episodic', 'semantic']
      );
    });

    it('should handle memory not found gracefully', async () => {
      const mockEmbeddingResult = {
        embedding: new Array(768).fill(0.1),
        model: 'test-model',
        usage: { prompt_tokens: 10, total_tokens: 10 }
      };

      const mockEmbeddings = [
        { id: 'memory-1', content: 'Test content 1', embedding: new Array(768).fill(0.1) }
      ];

      const mockSimilarities = [
        { id: 'memory-1', content: 'Test content 1', similarity: 0.9, score: 0.9 }
      ];

      mockEmbeddingService.generateEmbedding.mockResolvedValue(mockEmbeddingResult);
      mockEmbeddingService.searchSimilar.mockResolvedValue(mockSimilarities);
      vi.mocked(DatabaseUtils.all)
        .mockResolvedValueOnce(mockEmbeddings) // getAllEmbeddings
        .mockResolvedValueOnce([]); // getMemoryById - no memory found

      const results = await service.searchBySimilarity(mockDb, 'test query');

      expect(results).toEqual([]);
    });
  });

  describe('deleteEmbedding', () => {
    it('should delete embedding successfully', async () => {
      vi.mocked(DatabaseUtils.run).mockResolvedValue(undefined);

      await service.deleteEmbedding(mockDb, 'memory-123');

      expect(DatabaseUtils.run).toHaveBeenCalledWith(
        mockDb,
        'DELETE FROM memory_embedding WHERE memory_id = ?',
        ['memory-123']
      );
    });

    it('should handle database errors gracefully', async () => {
      vi.mocked(DatabaseUtils.run).mockRejectedValue(new Error('Database error'));

      // Should not throw
      await expect(service.deleteEmbedding(mockDb, 'memory-123')).resolves.toBeUndefined();
    });
  });

  describe('isAvailable', () => {
    it('should return embedding service availability', () => {
      mockEmbeddingService.isAvailable.mockReturnValue(true);
      expect(service.isAvailable()).toBe(true);

      mockEmbeddingService.isAvailable.mockReturnValue(false);
      expect(service.isAvailable()).toBe(false);
    });
  });

  describe('getEmbeddingStats', () => {
    it('should return embedding statistics', async () => {
      const mockStats = {
        total_embeddings: 100,
        avg_dimensions: 768
      };

      vi.mocked(DatabaseUtils.all).mockResolvedValue([mockStats]);

      const stats = await service.getEmbeddingStats(mockDb);

      expect(stats).toEqual({
        totalEmbeddings: 100,
        averageDimensions: 768,
        model: 'test-model'
      });
    });

    it('should handle database errors gracefully', async () => {
      vi.mocked(DatabaseUtils.all).mockRejectedValue(new Error('Database error'));

      const stats = await service.getEmbeddingStats(mockDb);

      expect(stats).toEqual({
        totalEmbeddings: 0,
        averageDimensions: 0,
        model: 'unknown'
      });
    });

    it('should handle empty results', async () => {
      vi.mocked(DatabaseUtils.all).mockResolvedValue([]);

      const stats = await service.getEmbeddingStats(mockDb);

      expect(stats).toEqual({
        totalEmbeddings: 0,
        averageDimensions: 0,
        model: 'test-model'
      });
    });
  });

  describe('private methods', () => {
    describe('getAllEmbeddings', () => {
      it('should get all embeddings without type filter', async () => {
        const mockEmbeddings = [
          { memory_id: 'memory-1', content: 'Content 1', embedding: '[0.1,0.2,0.3]' },
          { memory_id: 'memory-2', content: 'Content 2', embedding: '[0.4,0.5,0.6]' }
        ];

        vi.mocked(DatabaseUtils.all).mockResolvedValue(mockEmbeddings);

        const result = await (service as any).getAllEmbeddings(mockDb);

        expect(result).toEqual([
          { id: 'memory-1', content: 'Content 1', embedding: [0.1, 0.2, 0.3] },
          { id: 'memory-2', content: 'Content 2', embedding: [0.4, 0.5, 0.6] }
        ]);
      });

      it('should get embeddings with type filter', async () => {
        const mockEmbeddings = [
          { memory_id: 'memory-1', content: 'Content 1', embedding: '[0.1,0.2,0.3]' }
        ];

        vi.mocked(DatabaseUtils.all).mockResolvedValue(mockEmbeddings);

        const result = await (service as any).getAllEmbeddings(mockDb, ['episodic', 'semantic']);

        expect(DatabaseUtils.all).toHaveBeenCalledWith(
          mockDb,
          expect.stringContaining('WHERE mi.type IN (?,?)'),
          ['episodic', 'semantic']
        );
        expect(result).toHaveLength(1);
      });
    });

    describe('getMemoryById', () => {
      it('should get memory by id', async () => {
        const mockMemory = {
          id: 'memory-1',
          content: 'Test content',
          type: 'episodic',
          importance: 0.8,
          created_at: '2023-01-01T00:00:00Z',
          last_accessed: '2023-01-02T00:00:00Z',
          pinned: false,
          tags: '["tag1", "tag2"]'
        };

        vi.mocked(DatabaseUtils.all).mockResolvedValue([mockMemory]);

        const result = await (service as any).getMemoryById(mockDb, 'memory-1');

        expect(result).toEqual(mockMemory);
        expect(DatabaseUtils.all).toHaveBeenCalledWith(
          mockDb,
          expect.stringContaining('SELECT id, content, type, importance'),
          ['memory-1']
        );
      });

      it('should return null when memory not found', async () => {
        vi.mocked(DatabaseUtils.all).mockResolvedValue([]);

        const result = await (service as any).getMemoryById(mockDb, 'memory-1');

        expect(result).toBeNull();
      });
    });
  });
});
