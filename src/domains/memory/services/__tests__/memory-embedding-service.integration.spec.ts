import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import type { EmbeddingProvider } from '../../../shared/types/embedding.types.js';
import type { MemoryType } from '../../../shared/types/index.js';
import { MemoryEmbeddingService } from './memory-embedding-service.js';
import { VectorSearchEngine } from '../../../algorithms/vector-search-engine.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';

vi.mock('./unified-embedding-service.js', () => {
  let currentProvider: EmbeddingProvider = 'minilm';
  let currentEmbedding: number[] = [0.05, 0.06, 0.07, 0.08];

  class MockUnifiedEmbeddingService {
    isAvailable(): boolean {
      return true;
    }

    async generateEmbedding(): Promise<any> {
      return {
        embedding: currentEmbedding,
        model: `${currentProvider}-model`,
        provider: currentProvider,
        usage: {
          prompt_tokens: currentEmbedding.length,
          total_tokens: currentEmbedding.length
        }
      };
    }

    async searchSimilar() {
      return [];
    }

    getModelInfo(): { model: string; dimensions: number; maxTokens: number } {
      return {
        model: `${currentProvider}-model`,
        dimensions: currentEmbedding.length,
        maxTokens: 8192
      };
    }

    getCurrentProviderName(): string {
      return currentProvider;
    }
  }

  function setMockEmbedding(provider: EmbeddingProvider, embedding: number[]) {
    currentProvider = provider;
    currentEmbedding = embedding;
  }

  return {
    UnifiedEmbeddingService: MockUnifiedEmbeddingService,
    __setMockEmbedding: setMockEmbedding
  };
});

type EmbeddingRecord = {
  rowId: number;
  memoryId: string;
  provider: EmbeddingProvider;
  projectionType: string;
  dim: number;
  dimensions: number;
  precision: number;
  normalized: number;
  version: number;
  embedding: number[];
};

type MemoryItemRecord = {
  id: string;
  content: string;
  type: MemoryType;
  importance: number;
  created_at: string;
  last_accessed: string | null;
  pinned: boolean;
  tags: string[];
};

const providerTableMap: Record<string, string> = {
  tfidf: 'memory_item_vec_tfidf',
  minilm: 'memory_item_vec_minilm',
  openai: 'memory_item_vec_openai',
  gemini: 'memory_item_vec_gemini'
};

describe('MemoryEmbeddingService ↔ VectorSearchEngine integration', () => {
  let setMockEmbedding: (provider: EmbeddingProvider, embedding: number[]) => void;
  let embeddingRows: EmbeddingRecord[];
  let memoryItems: Map<string, MemoryItemRecord>;
  let runSpy: ReturnType<typeof vi.spyOn>;
  let allSpy: ReturnType<typeof vi.spyOn>;
  let nextRowId: number;

  beforeAll(async () => {
    const mod: any = await import('./unified-embedding-service.js');
    setMockEmbedding = mod.__setMockEmbedding;
  });

  beforeEach(() => {
    embeddingRows = [];
    memoryItems = new Map();
    nextRowId = 1;

    runSpy = vi.spyOn(DatabaseUtils, 'run').mockImplementation((db: any, sql: string, params: any[] = []) => {
      if (sql.includes('INSERT OR REPLACE INTO memory_embedding')) {
        const [
          memoryId,
          provider,
          projectionType,
          embeddingJson,
          dim,
          _model,
          dimensions,
          precision,
          normalized,
          version,
          _createdBy
        ] = params;
        const existingIdx = embeddingRows.findIndex(row => row.memoryId === memoryId);
        const rowId = existingIdx >= 0 ? embeddingRows[existingIdx].rowId : nextRowId++;
        const record: EmbeddingRecord = {
          rowId,
          memoryId,
          provider,
          projectionType,
          dim,
          dimensions,
          precision,
          normalized,
          version,
          embedding: JSON.parse(embeddingJson)
        };
        if (existingIdx >= 0) {
          embeddingRows[existingIdx] = record;
        } else {
          embeddingRows.push(record);
        }
        return { changes: 1 } as any;
      }

      if (sql.includes('UPDATE memory_embedding')) {
        const fallbackProvider = params[0] ?? 'tfidf';
        embeddingRows = embeddingRows.map(row => ({
          ...row,
          provider: row.provider || (fallbackProvider as EmbeddingProvider),
          projectionType: row.projectionType || 'native',
          precision: row.precision || 32,
          normalized: row.normalized ?? 0,
          version: row.version || 1,
          dim: row.dim || row.embedding.length,
          dimensions: row.dimensions || row.embedding.length
        }));
        return { changes: embeddingRows.length } as any;
      }

      return { changes: 0 } as any;
    });

    allSpy = vi.spyOn(DatabaseUtils, 'all').mockImplementation(() => []);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const scenarios: Array<{ provider: EmbeddingProvider; dimensions: number; type: MemoryType }> = [
    { provider: 'tfidf', dimensions: 512, type: 'semantic' }, // TF-IDF는 512차원
    { provider: 'minilm', dimensions: 384, type: 'episodic' },
    { provider: 'openai', dimensions: 1536, type: 'semantic' },
    { provider: 'gemini', dimensions: 768, type: 'semantic' }
  ];

  describe.each(scenarios)('provider $provider', ({ provider, dimensions, type }) => {
    it('stores embeddings and returns vector search results with metadata', async () => {
      const mockEmbedding = Array.from({ length: dimensions }, (_, idx) => (idx + 1) / dimensions);
      setMockEmbedding(provider, mockEmbedding);

      const memoryId = `${provider}-memory`;
      const memoryRecord: MemoryItemRecord = {
        id: memoryId,
        content: `${provider} memory content`,
        type,
        importance: 0.7,
        created_at: new Date().toISOString(),
        last_accessed: new Date().toISOString(),
        pinned: false,
        tags: [`tag-${provider}`]
      };
      memoryItems.set(memoryId, memoryRecord);

      const dbStub = createDbStub(() => embeddingRows, () => memoryItems);

      const embeddingService = new MemoryEmbeddingService();
      const vectorEngine = new VectorSearchEngine();

      await embeddingService.createAndStoreEmbedding(dbStub as any, memoryId, memoryRecord.content, type);

      const insertCall = runSpy.mock.calls.find(
        ([targetDb, sql]) => targetDb === dbStub && typeof sql === 'string' && sql.includes('INSERT OR REPLACE INTO memory_embedding')
      );
      expect(insertCall).toBeDefined();
      const [, , insertParams] = insertCall!;
      expect(insertParams[0]).toBe(memoryId);
      expect(insertParams[1]).toBe(provider);
      expect(typeof insertParams[2]).toBe('string');

      vectorEngine.initialize(dbStub as any);

      const queryVector = new Array(dimensions).fill(0.01);
      const results = await vectorEngine.search(
        queryVector,
        { limit: 5, includeContent: true, includeMetadata: true, types: [type] },
        provider
      );

      expect(results).toHaveLength(1);
      const [result] = results;
      expect(result.memory_id).toBe(memoryId);
      expect(result.content).toBe(memoryRecord.content);
      expect(result.type).toBe(memoryRecord.type);
      expect(result.tags).toEqual(memoryRecord.tags);
      expect(result.similarity).toBeGreaterThan(0);

      const stored = embeddingRows.find(row => row.memoryId === memoryId);
      expect(stored).toBeDefined();
      expect(stored?.provider).toBe(provider);
      expect(stored?.dimensions).toBe(dimensions);
      expect(stored?.projectionType).toBe('native');
    });
  });

  it('pads legacy 384-dimension embeddings for openai provider', async () => {
    const provider: EmbeddingProvider = 'openai';
    const legacyDimensions = 384;
    const targetDimensions = 1536;
    const mockEmbedding = Array.from({ length: legacyDimensions }, (_, idx) => (idx + 1) / legacyDimensions);
    setMockEmbedding(provider, mockEmbedding);

    const memoryId = 'legacy-openai-memory';
    const memoryRecord: MemoryItemRecord = {
      id: memoryId,
      content: 'legacy openai memory content',
      type: 'semantic',
      importance: 0.7,
      created_at: new Date().toISOString(),
      last_accessed: new Date().toISOString(),
      pinned: false,
      tags: ['legacy-openai']
    };
    memoryItems.set(memoryId, memoryRecord);

    const dbStub = createDbStub(() => embeddingRows, () => memoryItems);
    const embeddingService = new MemoryEmbeddingService();

    await embeddingService.createAndStoreEmbedding(dbStub as any, memoryId, memoryRecord.content, memoryRecord.type);

    const stored = embeddingRows.find(row => row.memoryId === memoryId);
    expect(stored).toBeDefined();
    expect(stored?.provider).toBe(provider);
    expect(stored?.dim).toBe(legacyDimensions);
    expect(stored?.dimensions).toBe(targetDimensions);
    expect(stored?.projectionType).toBe('zero_pad');
    expect(stored?.embedding).toHaveLength(targetDimensions);
    expect(stored?.embedding.slice(0, legacyDimensions)).toEqual(mockEmbedding);
    expect(stored?.embedding.slice(legacyDimensions).every(value => value === 0)).toBe(true);
  });
});

function createDbStub(
  getEmbeddingRows: () => EmbeddingRecord[],
  getMemoryItems: () => Map<string, MemoryItemRecord>
) {
  const prepare = vi.fn((sql: string) => {
    if (sql.includes('sqlite_master')) {
      return { all: vi.fn().mockReturnValue(Object.values(providerTableMap).map(name => ({ name }))) };
    }

    if (sql.includes('SELECT distance FROM memory_item_vec')) {
      return { get: vi.fn().mockReturnValue({ distance: 0.2 }) };
    }

    if (sql.includes('SELECT COUNT(*) as count FROM memory_item_vec')) {
      const match = sql.match(/memory_item_vec_(\w+)/);
      const providerSuffix = match?.[1] ?? 'tfidf';
      const count = getEmbeddingRows().filter(row => row.provider === providerSuffix).length;
      return { get: vi.fn().mockReturnValue({ count }) };
    }

    if (sql.includes('SELECT embedding_provider as provider')) {
      const aggregated = new Map<string, number>();
      for (const row of getEmbeddingRows()) {
        aggregated.set(row.provider, Math.max(aggregated.get(row.provider) ?? 0, row.dimensions));
      }
      return {
        all: vi.fn().mockReturnValue(
          Array.from(aggregated.entries()).map(([provider, dimensions]) => ({ provider, dimensions }))
        )
      };
    }

    if (sql.includes('FROM memory_item_vec_')) {
      const match = sql.match(/memory_item_vec_(\w+)/);
      const providerSuffix = match?.[1] ?? 'tfidf';

      return {
        all: vi.fn().mockImplementation((_, ...params: any[]) => {
          const limit = params.at(-1) ?? getEmbeddingRows().length;
          const typeFilters = params.slice(1, params.length - 1);

          const rows = getEmbeddingRows()
            .filter(row => row.provider === providerSuffix)
            .map(row => {
              const memory = getMemoryItems().get(row.memoryId);
              if (!memory) {
                return null;
              }
              if (typeFilters.length > 0 && !typeFilters.includes(memory.type)) {
                return null;
              }
              return {
                memory_id: row.memoryId,
                similarity: 0.2,
                content: memory.content,
                type: memory.type,
                importance: memory.importance,
                created_at: memory.created_at,
                last_accessed: memory.last_accessed,
                pinned: memory.pinned ? 1 : 0,
                tags: JSON.stringify(memory.tags)
              };
            })
            .filter((row): row is NonNullable<typeof row> => Boolean(row))
            .slice(0, limit);

          return rows;
        })
      };
    }

    return {
      all: vi.fn().mockReturnValue([]),
      get: vi.fn().mockReturnValue(undefined)
    };
  });

  return {
    loadExtension: vi.fn(),
    prepare
  };
}
