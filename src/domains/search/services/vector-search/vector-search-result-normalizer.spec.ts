import { describe, it, expect } from 'vitest';
import { VectorSearchResultNormalizer } from '../vector-search-result-normalizer.js';
import type { ProviderHybridResult } from '../../../../shared/types/vector-search.types.js';

const normalizer = new VectorSearchResultNormalizer();

describe('VectorSearchResultNormalizer', () => {
  it('normalizes scores across providers and sorts descending', () => {
    const providerResults: ProviderHybridResult[] = [
      {
        provider: 'minilm',
        vectorLatencyMs: 12,
        hybridLatencyMs: 18,
        vectorResults: [
          {
            memory_id: 'm1',
            similarity: 0.9,
            content: 'Minilm result 1',
            type: 'semantic',
            importance: 0.6,
            created_at: '2024-01-01T00:00:00Z',
            pinned: false
          },
          {
            memory_id: 'm2',
            similarity: 0.7,
            content: 'Minilm result 2',
            type: 'semantic',
            importance: 0.5,
            created_at: '2024-01-01T00:00:00Z',
            pinned: false
          }
        ],
        hybridResults: [
          {
            memory_id: 'm1',
            similarity: 0.95,
            content: 'Minilm hybrid 1',
            type: 'semantic',
            importance: 0.7,
            created_at: '2024-01-01T00:00:00Z',
            pinned: false
          }
        ]
      },
      {
        provider: 'openai',
        vectorLatencyMs: 20,
        vectorResults: [
          {
            memory_id: 'm3',
            similarity: 0.85,
            content: 'OpenAI result 1',
            type: 'semantic',
            importance: 0.8,
            created_at: '2024-01-01T00:00:00Z',
            pinned: false
          }
        ],
        hybridResults: []
      }
    ];

    const hits = normalizer.normalize(providerResults);
    expect(hits).toHaveLength(3);
    expect(hits[0].memoryId).toBe('m1');
    expect(hits[0].normalizedScore).toBeGreaterThanOrEqual(hits[1].normalizedScore);
    expect(hits[0].source).toBe('hybrid');
  });

  it('handles providers with identical scores without division by zero', () => {
    const providerResults: ProviderHybridResult[] = [
      {
        provider: 'minilm',
        vectorLatencyMs: 10,
        vectorResults: [
          {
            memory_id: 'm1',
            similarity: 0.8,
            content: 'Result',
            type: 'semantic',
            importance: 0.6,
            created_at: '2024-01-01T00:00:00Z',
            pinned: false
          }
        ],
        hybridResults: []
      }
    ];

    const hits = normalizer.normalize(providerResults);
    expect(hits).toHaveLength(1);
    expect(hits[0].normalizedScore).toBe(0);
  });
});
