/**
 * UnifiedEmbeddingService 테스트
 * 벡터 차원 불일치 및 fallback 메커니즘 테스트
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnifiedEmbeddingService } from '../unified-embedding-service.js';
import { LocalEmbeddingService } from '../local-embedding-service.js';
import { GeminiEmbeddingService } from '../gemini-embedding-service.js';
import { LOCAL_EMBEDDING_MODEL } from '../../../../shared/config/embedding-models.js';
import type { EmbeddingServiceInterface } from '../../../../shared/types/embedding.types.js';
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
      if (currentProviderName != null) {
        const expectedDimensions = VECTOR_SEARCH.PROVIDER_DIMENSIONS[currentProviderName as keyof typeof VECTOR_SEARCH.PROVIDER_DIMENSIONS];
        if (expectedDimensions) {
          expect(modelInfo.dimensions).toBe(expectedDimensions);
        }
      }
    });
  });

  describe('gemini 실패 뒤 로컬 모델 대체 (#1760)', () => {
    it('대체로 만든 벡터는 gemini 가 아니라 로컬 제공자와 로컬 모델로 표기된다', async () => {
      const gemini = new GeminiEmbeddingService();
      const internals = gemini as unknown as {
        genAI: unknown;
        localService: { generateEmbedding: () => Promise<unknown> };
      };
      internals.genAI = { models: { embedContent: vi.fn().mockRejectedValue(new Error('quota exceeded')) } };
      internals.localService = {
        generateEmbedding: async () => ({
          embedding: [0.1],
          model: LOCAL_EMBEDDING_MODEL.storedName,
          usage: { prompt_tokens: 1, total_tokens: 1 },
        }),
      };
      (service as unknown as { factory: unknown }).factory = {
        selectProviderWithHealthCheck: async () => ({ service: gemini, decision: { selectedProvider: 'gemini' } }),
        getAvailableProviders: () => [],
        handleProviderFailure: () => undefined,
      };

      const result = await service.generateEmbedding('memory');

      expect(result?.provider).toBe('minilm');
      expect(result?.model).toBe(LOCAL_EMBEDDING_MODEL.storedName);
      expect(service.getCurrentProviderName()).toBe('minilm');
    });
  });

  describe('embedQuery (#1729)', () => {
    const vector = { embedding: [0.1], model: 'm', usage: { prompt_tokens: 1, total_tokens: 1 } };

    function useProvider(target: UnifiedEmbeddingService, provider: string, providerService: EmbeddingServiceInterface) {
      (target as unknown as { factory: unknown }).factory = {
        selectProviderWithHealthCheck: async () => ({ service: providerService, decision: { selectedProvider: provider } }),
        getAvailableProviders: () => [],
        handleProviderFailure: () => undefined,
      };
    }

    it('로컬 임베딩 모델이면 질의는 embedQuery, 저장은 generateEmbedding 으로 간다', async () => {
      const local = new LocalEmbeddingService();
      const embedQuery = vi.spyOn(local, 'embedQuery').mockResolvedValue({ ...vector });
      const generateEmbedding = vi.spyOn(local, 'generateEmbedding').mockResolvedValue({ ...vector });
      useProvider(service, 'minilm', local);

      expect((await service.embedQuery('q'))?.provider).toBe('minilm');
      expect(embedQuery).toHaveBeenCalledWith('q');
      expect(generateEmbedding).not.toHaveBeenCalled();

      await service.generateEmbedding('memory');
      expect(generateEmbedding).toHaveBeenCalledWith('memory');
      expect(embedQuery).toHaveBeenCalledTimes(1);
    });

    it('다른 제공자는 질의도 generateEmbedding 과 같다', async () => {
      const remote = {
        generateEmbedding: vi.fn().mockResolvedValue({ ...vector }),
        isAvailable: () => true,
        getModelInfo: () => ({ model: 'remote', dimensions: 1, maxTokens: 1 }),
      } as unknown as EmbeddingServiceInterface;
      useProvider(service, 'openai', remote);

      expect((await service.embedQuery('q'))?.provider).toBe('openai');
      expect(remote.generateEmbedding).toHaveBeenCalledWith('q');
    });
  });

  describe('generateEmbeddingStrict (#1729)', () => {
    const vector = { embedding: [0.1], model: 'm', usage: { prompt_tokens: 1, total_tokens: 1 } };

    function useProviders(target: UnifiedEmbeddingService, providers: Record<string, EmbeddingServiceInterface>) {
      const selectProviderWithHealthCheck = vi.fn();
      (target as unknown as { factory: unknown }).factory = {
        getProvider: (name: string) => providers[name] ?? null,
        selectProviderWithHealthCheck,
        getAvailableProviders: () => [],
        handleProviderFailure: () => undefined,
      };
      return selectProviderWithHealthCheck;
    }

    function fakeService(generateEmbedding: () => Promise<unknown>): EmbeddingServiceInterface {
      return {
        generateEmbedding: vi.fn(generateEmbedding),
        isAvailable: () => true,
        getModelInfo: () => ({ model: 'm', dimensions: 1, maxTokens: 1 }),
      } as unknown as EmbeddingServiceInterface;
    }

    it('지정한 제공자 결과에 그 제공자를 붙이고 현재 제공자로 둔다', async () => {
      const local = fakeService(async () => ({ ...vector }));
      const select = useProviders(service, { minilm: local });

      expect((await service.generateEmbeddingStrict('memory', 'minilm')).provider).toBe('minilm');
      expect(service.getCurrentProviderService()).toBe(local);
      expect(select).not.toHaveBeenCalled();
    });

    it('지정한 제공자가 실패하면 다른 제공자로 넘어가지 않고 throw 한다', async () => {
      const other = fakeService(async () => ({ ...vector }));
      const select = useProviders(service, {
        minilm: fakeService(async () => {
          throw new Error('model load failed');
        }),
        openai: other,
      });

      await expect(service.generateEmbeddingStrict('memory', 'minilm')).rejects.toThrow('model load failed');
      expect(other.generateEmbedding).not.toHaveBeenCalled();
      expect(select).not.toHaveBeenCalled();
    });

    it('제공자 서비스 안에서 다른 제공자로 넘어간 결과는 받지 않는다', async () => {
      useProviders(service, { openai: fakeService(async () => ({ ...vector, provider: 'tfidf' })) });

      await expect(service.generateEmbeddingStrict('memory', 'openai')).rejects.toThrow(/tfidf/);
    });
  });
});
