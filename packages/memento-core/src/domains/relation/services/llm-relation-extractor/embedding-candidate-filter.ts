import type { EmbeddingData } from '../../../../shared/types/embedding.types.js';
import type { MemoryItem } from '../../../../shared/types/memory.types.js';
import { LIMITS } from '../../../../shared/constants/relation-constants.js';
import { logger } from '../../../../shared/utils/logger.js';
import type { UnifiedEmbeddingService } from '../../../embedding/services/unified-embedding-service.js';

export async function filterRelationCandidatesByEmbedding(
  embeddingService: UnifiedEmbeddingService,
  newMemory: MemoryItem,
  existingMemories: MemoryItem[],
  limit: number = LIMITS.LLM_CANDIDATE_DEFAULT
): Promise<MemoryItem[]> {
  if (existingMemories.length <= limit) {
    return existingMemories;
  }

  try {
    const newEmbedding = await embeddingService.generateEmbedding(newMemory.content);
    if (!newEmbedding || !newEmbedding.embedding) {
      return existingMemories.slice(0, limit);
    }

    const embeddingData: EmbeddingData[] = [];
    for (const memory of existingMemories) {
      if (memory.embedding && memory.embedding.length > 0) {
        embeddingData.push({
          id: memory.id,
          content: memory.content,
          embedding: memory.embedding
        });
      }
    }

    if (embeddingData.length === 0) {
      return existingMemories.slice(0, limit);
    }

    const similarMemories = await embeddingService.searchSimilar(
      newMemory.content,
      embeddingData,
      limit,
      0.0
    );

    const similarIds = new Set(similarMemories.map((r) => r.id));

    const result: MemoryItem[] = [];
    const added = new Set<string>();

    for (const memory of existingMemories) {
      if (similarIds.has(memory.id) && result.length < limit) {
        result.push(memory);
        added.add(memory.id);
      }
    }

    for (const memory of existingMemories) {
      if (!added.has(memory.id) && result.length < limit) {
        result.push(memory);
      }
    }

    return result;
  } catch (error) {
    logger.warn('Embedding 기반 필터링 실패, 기본 제한 사용', {
      error: error instanceof Error ? error.message : String(error)
    });
    return existingMemories.slice(0, limit);
  }
}
