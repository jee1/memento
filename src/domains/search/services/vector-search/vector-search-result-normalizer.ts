import type {
  ProviderHybridResult,
  UnifiedSearchHit
} from '../../../../shared/types/vector-search.types.js';
import type { VectorSearchResult } from '../../../../shared/types/vector-search.types.js';
import type { EmbeddingProvider } from '../../../../shared/types/embedding.types.js';

function selectScore(result: VectorSearchResult, hybridResult?: VectorSearchResult): {
  score: number;
  source: 'vector' | 'hybrid';
  hybridSimilarity?: number;
} {
  if (hybridResult) {
    return {
      score: hybridResult.similarity,
      source: 'hybrid',
      hybridSimilarity: hybridResult.similarity
    };
  }

  return {
    score: result.similarity,
    source: 'vector'
  };
}

function computeNormalizationRange(scores: number[]): { min: number; max: number; denom: number } {
  if (scores.length === 0) {
    return { min: 0, max: 1, denom: 1 };
  }
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const denom = max - min === 0 ? 1 : max - min;
  return { min, max, denom };
}

export class VectorSearchResultNormalizer {
  normalize(providerResults: ProviderHybridResult[]): UnifiedSearchHit[] {
    const unifiedMap = new Map<string, UnifiedSearchHit>();

    for (const providerResult of providerResults) {
      const vectorResults = providerResult.vectorResults ?? [];
      const hybridResults = providerResult.hybridResults ?? [];

      const hybridById = new Map<string, VectorSearchResult>();
      for (const hybrid of hybridResults) {
        hybridById.set(hybrid.memory_id, hybrid);
      }

      const scores = vectorResults.map(result => {
        const hybrid = hybridById.get(result.memory_id);
        return selectScore(result, hybrid).score;
      });

      const { min, denom } = computeNormalizationRange(scores);

      for (const vectorResult of vectorResults) {
        const hybrid = hybridById.get(vectorResult.memory_id);
        const scoreInfo = selectScore(vectorResult, hybrid);
        const normalizedScore = (scoreInfo.score - min) / denom;

        const key = `${vectorResult.memory_id}:${providerResult.provider}`;
        const existing = unifiedMap.get(key);

        if (!existing || normalizedScore > existing.normalizedScore) {
          unifiedMap.set(key, {
            memoryId: vectorResult.memory_id,
            provider: providerResult.provider as EmbeddingProvider,
            normalizedScore,
            vectorSimilarity: vectorResult.similarity,
            hybridSimilarity: scoreInfo.hybridSimilarity,
            content: vectorResult.content,
            type: vectorResult.type,
            importance: vectorResult.importance,
            createdAt: vectorResult.created_at,
            tags: vectorResult.tags,
            source: scoreInfo.source
          });
        }
      }
    }

    return Array.from(unifiedMap.values()).sort((a, b) => b.normalizedScore - a.normalizedScore);
  }
}

export const vectorSearchResultNormalizer = new VectorSearchResultNormalizer();
