import { describe, expect, it, vi } from 'vitest';
import type { MemoryItem, MemoryType } from '../../../shared/types/memory.types.js';
import type { UnifiedEmbeddingService } from '../../embedding/services/unified-embedding-service.js';
import {
  compressRelationMemories,
  prepareRelationCandidatePool,
  RELATION_TEXT_CHARS,
} from '../relation-candidate-pool.js';
import { filterRelationCandidatesByEmbedding } from '../llm-relation-extractor/embedding-candidate-filter.js';

function memory(id: string, content: string, type: MemoryType = 'episodic'): MemoryItem {
  return {
    id,
    type,
    content,
    importance: 0.5,
    privacy_scope: 'private',
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    pinned: false,
  };
}

describe('compressRelationMemories', () => {
  it('keeps ten memories and clips each body to 200 characters plus an ellipsis', () => {
    const memories = Array.from({ length: 12 }, (_, index) => memory(`id-${index}`, 'x'.repeat(250)));
    const compressed = compressRelationMemories(memories);

    expect(compressed).toHaveLength(10);
    expect(compressed[0]?.content).toBe(`${'x'.repeat(RELATION_TEXT_CHARS)}...`);
    expect(compressed[0]?.id).toBe('id-0');
  });
});

describe('filterRelationCandidatesByEmbedding (#1473)', () => {
  it('existingMemories에 embedding이 없으면 generateEmbedding을 호출하지 않고 즉시 상위 limit개를 반환한다', async () => {
    const generateEmbedding = vi.fn();
    const searchSimilar = vi.fn();
    const embeddingService = {
      generateEmbedding,
      searchSimilar,
    } as unknown as UnifiedEmbeddingService;

    const source = memory('new', 'source memory content');
    const existing = Array.from({ length: 100 }, (_, i) => memory(`existing-${i}`, `content ${i}`));

    const filtered = await filterRelationCandidatesByEmbedding(embeddingService, source, existing, 30);
    expect(filtered).toHaveLength(30);
    expect(filtered[0]?.id).toBe('existing-0');
    expect(generateEmbedding).not.toHaveBeenCalled();
    expect(searchSimilar).not.toHaveBeenCalled();

    const pool = await prepareRelationCandidatePool(embeddingService, source, existing, 30);
    expect(pool).toHaveLength(10);
    expect(generateEmbedding).not.toHaveBeenCalled();
  });
});
