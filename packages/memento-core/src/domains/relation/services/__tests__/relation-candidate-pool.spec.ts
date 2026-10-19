import { describe, expect, it } from 'vitest';
import type { MemoryItem, MemoryType } from '../../../shared/types/memory.types.js';
import {
  compressRelationMemories,
  RELATION_TEXT_CHARS,
} from '../relation-candidate-pool.js';

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
