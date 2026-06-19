/**
 * Mock 임베딩 서비스
 * 오프라인 벤치마크 전용 - 결정론적 해시 기반 벡터 생성
 * API 호출 없이 콘텐츠에 따라 구별 가능한 벡터를 생성하여 alpha 가중치 효과를 검증
 */

import type {
  EmbeddingResult,
  EmbeddingServiceInterface,
  SimilarityResult,
  EmbeddingData,
} from '../../../shared/types/embedding.types.js';

export const MOCK_EMBEDDING_DIMENSIONS = 64;

/**
 * 결정론적 해시 함수 (seed 기반)
 * 동일한 입력에 대해 항상 동일한 결과를 반환
 */
function deterministicHash(text: string, seed: number): number {
  let h = seed;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x9e3779b9);
    h ^= h >>> 16;
  }
  return h >>> 0;
}

/**
 * 텍스트로부터 결정론적 단위 벡터를 생성
 */
function generateMockEmbedding(text: string): number[] {
  const vec: number[] = [];
  for (let i = 0; i < MOCK_EMBEDDING_DIMENSIONS; i++) {
    const h = deterministicHash(text, i + 1);
    vec.push((h / 0xffffffff) * 2 - 1);
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map(v => v / norm);
}

export class MockEmbeddingService implements EmbeddingServiceInterface {
  async generateEmbedding(text: string): Promise<EmbeddingResult | null> {
    return {
      embedding: generateMockEmbedding(text),
      model: 'mock',
      provider: 'mock',
      usage: { prompt_tokens: 0, total_tokens: 0 },
    };
  }

  async searchSimilar(
    query: string,
    embeddings: EmbeddingData[],
    _limit?: number,
    _threshold?: number
  ): Promise<SimilarityResult[]> {
    const qVec = generateMockEmbedding(query);
    return embeddings
      .map(e => {
        const dot = e.embedding.reduce((s, v, i) => s + v * (qVec[i] ?? 0), 0);
        return { id: e.id, content: e.content, similarity: dot, score: dot };
      })
      .sort((a, b) => b.score - a.score);
  }

  isAvailable(): boolean {
    return true;
  }

  getModelInfo(): { model: string; dimensions: number; maxTokens: number } {
    return { model: 'mock', dimensions: MOCK_EMBEDDING_DIMENSIONS, maxTokens: 0 };
  }
}
