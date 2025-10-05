/**
 * MiniLM 임베딩 서비스 테스트
 * TDD 방식으로 구현
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MiniLMEmbeddingService } from './minilm-embedding-service.js';
import type { EmbeddingResult, SimilarityResult, EmbeddingData } from '../types/embedding.types.js';

// @xenova/transformers 모킹
vi.mock('@xenova/transformers', () => ({
  pipeline: vi.fn().mockResolvedValue(
    vi.fn().mockResolvedValue({
      data: [0.1, 0.2, 0.3, 0.4] // 384차원 벡터 예시
    })
  )
}));

describe('MiniLMEmbeddingService', () => {
  let service: MiniLMEmbeddingService;
  
  beforeEach(() => {
    service = new MiniLMEmbeddingService();
  });

  describe('생성자', () => {
    it('서비스가 올바르게 초기화되어야 한다', () => {
      expect(service).toBeDefined();
      expect(service.isAvailable()).toBe(true); // MiniLM은 항상 사용 가능 (lazy loading)
    });
  });

  describe('generateEmbedding', () => {
    it('빈 텍스트에 대해 에러를 던져야 한다', async () => {
      await expect(service.generateEmbedding('')).rejects.toThrow('텍스트가 비어있습니다');
      await expect(service.generateEmbedding('   ')).rejects.toThrow('텍스트가 비어있습니다');
    });

    it('null이나 undefined에 대해 에러를 던져야 한다', async () => {
      await expect(service.generateEmbedding(null as any)).rejects.toThrow();
      await expect(service.generateEmbedding(undefined as any)).rejects.toThrow();
    });

    it('유효한 텍스트에 대해 임베딩을 생성해야 한다', async () => {
      const result = await service.generateEmbedding('테스트 텍스트');
      
      expect(result).toBeDefined();
      expect(result?.embedding).toEqual([0.1, 0.2, 0.3, 0.4]);
      expect(result?.model).toBe('all-MiniLM-L6-v2');
      expect(result?.usage.prompt_tokens).toBeGreaterThan(0);
    });
  });

  describe('searchSimilar', () => {
    it('빈 임베딩 배열에 대해 빈 배열을 반환해야 한다', async () => {
      const result = await service.searchSimilar('쿼리', []);
      expect(result).toEqual([]);
    });

    it('유사도 임계값을 적용해야 한다', async () => {
      const embeddings: EmbeddingData[] = [
        { id: '1', content: '유사한 내용', embedding: [0.1, 0.2, 0.3, 0.4] },
        { id: '2', content: '다른 내용', embedding: [0.9, 0.8, 0.7, 0.6] }
      ];

      const result = await service.searchSimilar('쿼리', embeddings, 10, 0.8);
      
      // 유사도가 0.8 이상인 것만 반환되어야 함
      expect(result.every(r => r.similarity >= 0.8)).toBe(true);
    });

    it('결과 개수를 제한해야 한다', async () => {
      const embeddings: EmbeddingData[] = Array.from({ length: 20 }, (_, i) => ({
        id: i.toString(),
        content: `내용 ${i}`,
        embedding: [0.1, 0.2, 0.3, 0.4]
      }));

      const result = await service.searchSimilar('쿼리', embeddings, 5);
      expect(result).toHaveLength(5);
    });
  });

  describe('isAvailable', () => {
    it('MiniLM은 항상 사용 가능해야 한다 (lazy loading)', () => {
      expect(service.isAvailable()).toBe(true);
    });

    it('모델 로딩 후에는 true를 반환해야 한다', async () => {
      await service.generateEmbedding('테스트');
      expect(service.isAvailable()).toBe(true);
    });
  });

  describe('getModelInfo', () => {
    it('올바른 모델 정보를 반환해야 한다', () => {
      const info = service.getModelInfo();
      
      expect(info.model).toBe('all-MiniLM-L6-v2');
      expect(info.dimensions).toBe(384);
      expect(info.maxTokens).toBe(256);
    });
  });
});
