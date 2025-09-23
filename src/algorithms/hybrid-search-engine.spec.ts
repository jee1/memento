import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HybridSearchEngine } from './hybrid-search-engine.js';

const mockTextSearch = vi.fn();
const mockIsEmbeddingAvailable = vi.fn();
const mockVectorSearch = vi.fn();

vi.mock('./search-engine.js', () => {
  return {
    SearchEngine: class {
      search = mockTextSearch;
    }
  };
});

vi.mock('../services/memory-embedding-service.js', () => {
  return {
    MemoryEmbeddingService: class {
      isAvailable = mockIsEmbeddingAvailable;
      searchBySimilarity = mockVectorSearch;
      getEmbeddingStats = vi.fn();
    }
  };
});

const createTextResult = (overrides: Partial<any> = {}) => ({
  id: 'memory-text',
  content: '텍스트 전용 결과',
  type: 'episodic',
  importance: 0.5,
  created_at: '2024-01-01T00:00:00.000Z',
  last_accessed: undefined,
  pinned: false,
  tags: ['ai'],
  score: 0.9,
  recall_reason: '텍스트 매칭',
  ...overrides,
});

const createVectorResult = (overrides: Partial<any> = {}) => ({
  id: 'memory-vector',
  content: '벡터 전용 결과',
  type: 'episodic',
  importance: 0.4,
  created_at: '2024-01-02T00:00:00.000Z',
  last_accessed: undefined,
  pinned: false,
  tags: ['memory'],
  similarity: 0.9,
  score: 0.9,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('HybridSearchEngine', () => {
  it('텍스트와 벡터 검색 결과를 가중치로 결합한다', async () => {
    mockIsEmbeddingAvailable.mockReturnValue(true);
    mockTextSearch.mockResolvedValue([
      createTextResult({ id: 'memory-text', score: 0.9 }),
      createTextResult({ id: 'memory-both', content: '텍스트+벡터 결과', score: 0.6 })
    ]);
    mockVectorSearch.mockResolvedValue([
      createVectorResult({ id: 'memory-both', content: '텍스트+벡터 결과', similarity: 0.8 }),
      createVectorResult({ id: 'memory-vector', similarity: 0.9 })
    ]);

    const engine = new HybridSearchEngine();
    const results = await engine.search({}, { query: '기억 검색', limit: 3 });

    expect(mockTextSearch).toHaveBeenCalledWith({}, expect.objectContaining({
      query: '기억 검색',
      limit: 6,
    }));
    expect(mockVectorSearch).toHaveBeenCalledWith({}, '기억 검색', expect.objectContaining({
      limit: 6,
      threshold: 0.5,
    }));

    expect(results).toHaveLength(3);
    expect(results.map(r => r.id)).toEqual([
      'memory-both',
      'memory-vector',
      'memory-text'
    ]);

    const merged = results.find(r => r.id === 'memory-both');
    expect(merged?.textScore).toBeCloseTo(0.6);
    expect(merged?.vectorScore).toBeCloseTo(0.8);
    expect(merged?.finalScore).toBeCloseTo(0.72, 2);
    expect(merged?.recall_reason).toContain('텍스트+벡터 결합');

    const vectorOnly = results.find(r => r.id === 'memory-vector');
    expect(vectorOnly?.textScore).toBe(0);
    expect(vectorOnly?.vectorScore).toBeCloseTo(0.9);
    expect(vectorOnly?.finalScore).toBeCloseTo(0.54, 2);
    expect(vectorOnly?.recall_reason).toBe('벡터 유사도: 0.900');

    const textOnly = results.find(r => r.id === 'memory-text');
    expect(textOnly?.vectorScore).toBe(0);
    expect(textOnly?.finalScore).toBeCloseTo(0.36, 2);
    expect(textOnly?.recall_reason).toBe('텍스트 매칭');
  });

  it('임베딩 서비스가 비활성화되면 텍스트 결과만 반환한다', async () => {
    mockIsEmbeddingAvailable.mockReturnValue(false);
    mockTextSearch.mockResolvedValue([
      createTextResult({ id: 'memory-alpha', score: 0.7 })
    ]);

    const engine = new HybridSearchEngine();
    const results = await engine.search({}, { query: '테스트', limit: 2 });

    expect(mockVectorSearch).not.toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0]?.id).toBe('memory-alpha');
    expect(results[0]?.vectorScore).toBe(0);
    expect(results[0]?.finalScore).toBeCloseTo(0.28, 2);
  });
});
