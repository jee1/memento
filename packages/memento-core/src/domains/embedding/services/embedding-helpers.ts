import { CacheKeyGenerator } from '../../../shared/utils/cache-key-generator.js';
import {
  cosineSimilarity,
  type CosineSimilarityOptions,
} from '../../../shared/utils/vector-math.js';

export function estimateEmbeddingTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function truncateEmbeddingText(text: string, maxTokens: number): string {
  return estimateEmbeddingTokens(text) <= maxTokens ? text : text.substring(0, maxTokens * 4);
}

function hashEmbeddingText(text: string): number {
  let hash = 0;
  for (let index = 0; index < text.length; index++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(index);
    hash |= 0;
  }
  return hash;
}

export function generateEmbeddingCacheKey(
  prefix: string,
  text: string,
  absoluteHash: boolean = false,
): string {
  const hash = hashEmbeddingText(text);
  const encodedHash = (absoluteHash ? Math.abs(hash) : hash).toString(36);
  return CacheKeyGenerator.generateEmbeddingKey(prefix, encodedHash);
}

export function cleanupEmbeddingCache<T>(
  cache: Map<string, T>,
  maxSize: number = 1_000,
  retainSize: number = maxSize / 2,
): void {
  if (cache.size <= maxSize) return;

  const retained = Array.from(cache.entries()).slice(-retainSize);
  cache.clear();
  for (const [key, value] of retained) cache.set(key, value);
}

export interface EmbeddingSearchCandidate {
  id: string;
  content: string;
  embedding: number[];
}

export interface RankedEmbeddingResult {
  id: string;
  content: string;
  similarity: number;
  score: number;
}

export function rankSimilarEmbeddings(
  queryEmbedding: number[],
  embeddings: EmbeddingSearchCandidate[],
  limit: number,
  threshold: number,
  options: CosineSimilarityOptions = {},
): RankedEmbeddingResult[] {
  return embeddings
    .map((item) => {
      if (queryEmbedding.length !== item.embedding.length) {
        throw new Error('벡터 차원이 일치하지 않습니다');
      }
      const similarity = cosineSimilarity(queryEmbedding, item.embedding, options);
      return { id: item.id, content: item.content, similarity, score: similarity };
    })
    .filter((item) => item.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}
