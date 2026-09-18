import { CacheKeyGenerator } from '../../../shared/utils/cache-key-generator.js';
import {
  cosineSimilarity,
  type CosineSimilarityOptions,
} from '../../../shared/utils/vector-math.js';

/** 실측 기준 문자당 토큰 비율. ASCII 는 영어 휴리스틱, 그 밖은 한국어 실측(2.124 chars/token). */
const ASCII_CHARS_PER_TOKEN = 4;
const NON_ASCII_CHARS_PER_TOKEN = 2.1;

export function estimateEmbeddingTokens(text: string): number {
  let ascii = 0;
  let nonAscii = 0;
  for (const char of text) {
    if ((char.codePointAt(0) ?? 0) < 128) ascii++;
    else nonAscii++;
  }
  return Math.ceil(ascii / ASCII_CHARS_PER_TOKEN + nonAscii / NON_ASCII_CHARS_PER_TOKEN);
}

export function truncateEmbeddingText(text: string, maxTokens: number): string {
  const estimated = estimateEmbeddingTokens(text);
  if (estimated <= maxTokens) return text;

  const charsPerToken = text.length / estimated;
  let truncated = text.slice(0, Math.max(1, Math.floor(maxTokens * charsPerToken)));
  // 비례 절단은 균일한 텍스트에서만 정확하다. 앞쪽에 비ASCII 가 몰린 경우를 위해 20회까지 5%씩 줄인다.
  for (let attempt = 0; attempt < 20 && truncated.length > 1; attempt++) {
    if (estimateEmbeddingTokens(truncated) <= maxTokens) break;
    truncated = truncated.slice(0, truncated.length - Math.ceil(truncated.length * 0.05));
  }
  return truncated;
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

/**
 * 여러 윈도 벡터를 평균 내고 L2 정규화한다 (#1013).
 * ponytail: 토큰 수 가중이 아니라 단순 평균이다. 짧은 마지막 윈도가 실제 비중보다 크게 반영되는데,
 * 뒤쪽 내용을 벡터에 올리는 것이 이 변경의 목적이라 그대로 둔다. 정밀도가 문제가 되면 토큰 수 가중으로 바꾼다.
 */
export function meanPoolNormalize(vectors: number[][]): number[] {
  if (vectors.length === 0) throw new Error('평균 낼 벡터가 없습니다');
  const first = vectors[0];
  if (!first) throw new Error('평균 낼 벡터가 없습니다');
  if (vectors.length === 1) return first;

  const dimensions = first.length;
  const mean = new Array<number>(dimensions).fill(0);
  for (const vector of vectors) {
    if (vector.length !== dimensions) throw new Error('벡터 차원이 일치하지 않습니다');
    for (let index = 0; index < dimensions; index++) mean[index]! += vector[index]!;
  }

  let squared = 0;
  for (let index = 0; index < dimensions; index++) {
    mean[index]! /= vectors.length;
    squared += mean[index]! * mean[index]!;
  }
  const norm = Math.sqrt(squared);
  if (norm === 0) return mean;
  return mean.map((value) => value / norm);
}
