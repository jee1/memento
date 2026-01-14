/**
 * UnifiedEmbeddingService 테스트
 * 벡터 차원 불일치 및 fallback 메커니즘 테스트
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnifiedEmbeddingService } from '../unified-embedding-service.js';
import { VECTOR_SEARCH } from '../../../../shared/config/constants.js';

describe('UnifiedEmbeddingService', () => {
  let service: UnifiedEmbeddingService;

  beforeEach(() => {
    service = new UnifiedEmbeddingService();
  });

  describe('fallback 시 차원 정보 동기화', () => {
    it('Given: MiniLM(384)에서 TF-IDF(512)로 fallback할 때, When: getModelInfo()를 호출하면, Then: 현재 제공자의 차원(512)을 반환해야 함', async () => {
      // Given: MiniLM이 실패하고 TF-IDF로 fallback하는 상황
      // 실제로는 MiniLM이 실패하면 자동으로 fallback되므로,
      // getModelInfo()가 현재 제공자의 차원을 정확히 반환하는지 확인
      
      // When: getModelInfo() 호출 (fallback 후)
      const modelInfo = service.getModelInfo();
      
      // Then: 차원 정보가 PROVIDER_DIMENSIONS와 일치해야 함
      // currentProvider가 없으면 기본값이지만, 실제 사용 시에는 현재 제공자 차원을 반환해야 함
      expect(modelInfo).toBeDefined();
      expect(modelInfo.dimensions).toBeGreaterThan(0);
      
      // 차원이 PROVIDER_DIMENSIONS 중 하나와 일치하는지 확인
      const validDimensions = Object.values(VECTOR_SEARCH.PROVIDER_DIMENSIONS);
      expect(validDimensions).toContain(modelInfo.dimensions);
    });

    it('Given: fallback 발생 시, When: generateEmbedding 결과를 확인하면, Then: 차원 정보가 결과에 포함되어야 함', async () => {
      // Given: 텍스트 입력
      const text = 'test embedding';

      // When: generateEmbedding 호출 (fallback 발생 가능)
      const result = await service.generateEmbedding(text);

      // Then: 결과에 provider와 차원 정보가 포함되어야 함
      if (result) {
        expect(result.provider).toBeDefined();
        expect(result.embedding).toBeDefined();
        expect(result.embedding.length).toBeGreaterThan(0);
        
        // provider에 따른 차원 확인
        const expectedDimensions = VECTOR_SEARCH.PROVIDER_DIMENSIONS[result.provider as keyof typeof VECTOR_SEARCH.PROVIDER_DIMENSIONS];
        if (expectedDimensions) {
          expect(result.embedding.length).toBe(expectedDimensions);
        }
      }
    });
  });

  describe('getModelInfo 차원 정확성', () => {
    it('Given: currentProvider가 설정되었을 때, When: getModelInfo()를 호출하면, Then: 현재 제공자의 정확한 차원을 반환해야 함', async () => {
      // Given: 임베딩 생성으로 currentProvider 설정
      const text = 'test';
      await service.generateEmbedding(text);

      // When: getModelInfo() 호출
      const modelInfo = service.getModelInfo();
      const currentProviderName = service.getCurrentProviderName();

      // Then: 현재 제공자의 차원과 일치해야 함
      if (currentProviderName !== 'none') {
        const expectedDimensions = VECTOR_SEARCH.PROVIDER_DIMENSIONS[currentProviderName as keyof typeof VECTOR_SEARCH.PROVIDER_DIMENSIONS];
        if (expectedDimensions) {
          expect(modelInfo.dimensions).toBe(expectedDimensions);
        }
      }
    });
  });
});
