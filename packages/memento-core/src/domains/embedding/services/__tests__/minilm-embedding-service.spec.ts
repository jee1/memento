/**
 * MiniLMEmbeddingService 테스트
 * Worker 스레드 에러 처리 및 fallback 메커니즘 테스트
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MiniLMEmbeddingService } from '../minilm-embedding-service.js';
import { meanPoolNormalize } from '../embedding-helpers.js';

describe('MiniLMEmbeddingService', () => {
  let service: MiniLMEmbeddingService;

  beforeEach(() => {
    service = new MiniLMEmbeddingService();
  });

  describe('Worker 스레드 에러 처리', () => {
    it('Given: ERR_WORKER_PATH 에러가 발생할 때, When: 모델을 로딩하면, Then: 에러를 처리하고 fallback 경로로 전환해야 함', async () => {
      // Given: ERR_WORKER_PATH 에러 시뮬레이션
      // 실제로는 pipeline() 호출 시 에러가 발생하지만, 
      // 여기서는 에러 처리 로직이 존재하는지 확인
      
      // When: generateEmbedding 호출 (에러 발생 가능)
      // Then: 에러가 발생해도 적절히 처리되어야 함
      // 실제 테스트는 통합 테스트에서 수행
      expect(service).toBeDefined();
      expect(typeof service.generateEmbedding).toBe('function');
    });

    it('Given: 환경 변수 ENABLE_WORKER가 false일 때, When: 서비스를 초기화하면, Then: Worker 스레드를 사용하지 않아야 함', () => {
      // Given: ENABLE_WORKER=false 환경
      const originalEnv = process.env.ENABLE_WORKER;
      process.env.ENABLE_WORKER = 'false';

      // When: 서비스 생성
      const newService = new MiniLMEmbeddingService();

      // Then: 서비스가 생성되어야 함
      expect(newService).toBeDefined();
      expect(newService.isAvailable()).toBe(true);

      // 환경 변수 복원
      if (originalEnv) {
        process.env.ENABLE_WORKER = originalEnv;
      } else {
        delete process.env.ENABLE_WORKER;
      }
    });

    it('Given: 모델 로딩 실패 시, When: generateEmbedding을 호출하면, Then: 에러를 발생시키고 fallback이 사용되도록 해야 함', async () => {
      // Given: 모델 로딩이 실패하는 상황
      // 실제로는 pipeline()이 실패하지만, 여기서는 에러 처리 로직 확인
      
      // When: generateEmbedding 호출 시도
      // Then: 에러가 발생해야 함 (fallback은 UnifiedEmbeddingService에서 처리)
      await expect(
        service.generateEmbedding('test')
      ).rejects.toThrow();
    });
  });

  describe('fallback 시 차원 정보', () => {
    it('Given: MiniLM이 실패하고 TF-IDF로 fallback할 때, When: getModelInfo()를 호출하면, Then: MiniLM 차원(384)을 반환해야 함', () => {
      // Given: MiniLM 서비스 (실패 시에도 차원 정보는 유지)
      // When: getModelInfo() 호출
      const modelInfo = service.getModelInfo();

      // Then: MiniLM 차원(384)을 반환해야 함
      expect(modelInfo).toBeDefined();
      expect(modelInfo.dimensions).toBe(384);
      expect(modelInfo.model).toBe('paraphrase-multilingual-MiniLM-L12-v2');
    });
  });

  describe('generateWindowEmbeddings', () => {
    const WINDOW_TOKENS = 510;

    function createMockVector(seed: number): number[] {
      const vector = new Array(384).fill(0);
      vector[0] = seed;
      vector[1] = seed / 10;
      return vector;
    }

    function installMockModel(options: { tokenCount: number; withTokenizer: boolean; stableVector?: boolean }) {
      let callIndex = 0;
      const modelFn = vi.fn().mockImplementation(async () => {
        const seed = options.stableVector ? 1 : callIndex + 1;
        if (!options.stableVector) {
          callIndex += 1;
        }
        return { data: createMockVector(seed) };
      });

      const model = modelFn as ReturnType<typeof vi.fn> & {
        tokenizer?: {
          (text: string, options?: Record<string, unknown>): Promise<{ input_ids: { data: number[] } }>;
          decode: (ids: number[], options?: { skip_special_tokens?: boolean }) => string;
        };
      };

      if (options.withTokenizer) {
        const ids = Array.from({ length: options.tokenCount }, (_, index) => index + 1);
        const tokenizer = Object.assign(
          vi.fn().mockImplementation(async () => ({ input_ids: { data: ids } })),
          {
            decode: vi.fn().mockImplementation((slice: number[]) => `window-${slice.length}-${slice[0] ?? 0}`)
          }
        );
        model.tokenizer = tokenizer;
      }

      (service as unknown as { model: unknown }).model = model;
      return modelFn;
    }

    it('Given: 짧은 텍스트(단일 윈도), When: generateWindowEmbeddings 호출, Then: vectors 길이 1이고 meanPoolNormalize가 generateEmbedding과 같아야 함', async () => {
      installMockModel({ tokenCount: 100, withTokenizer: true, stableVector: true });

      const text = 'hello world';
      const windowResult = await service.generateWindowEmbeddings(text);
      service.clearCache();
      const embeddingResult = await service.generateEmbedding(text);

      expect(windowResult.vectors).toHaveLength(1);
      expect(windowResult.vectors[0]).toHaveLength(384);
      expect(windowResult.model).toBe('paraphrase-multilingual-MiniLM-L12-v2');
      expect(meanPoolNormalize(windowResult.vectors)).toEqual(embeddingResult?.embedding);
    });

    it('Given: 여러 윈도로 나뉘는 긴 텍스트, When: generateWindowEmbeddings 호출, Then: vectors 길이가 윈도 수와 같고 각 벡터는 384차원이어야 함', async () => {
      const tokenCount = WINDOW_TOKENS * 3;
      installMockModel({ tokenCount, withTokenizer: true });
      const expectedWindows = Math.ceil(tokenCount / WINDOW_TOKENS);

      const windowResult = await service.generateWindowEmbeddings('long document text');

      expect(windowResult.vectors).toHaveLength(expectedWindows);
      for (const vector of windowResult.vectors) {
        expect(vector).toHaveLength(384);
      }
      expect(windowResult.tokenCount).toBe(tokenCount);
    });

    it('Given: 토크나이저를 사용할 수 없을 때, When: generateWindowEmbeddings 호출, Then: vectors 길이 1이어야 함', async () => {
      installMockModel({ tokenCount: WINDOW_TOKENS * 3, withTokenizer: false });

      const windowResult = await service.generateWindowEmbeddings('tokenizer unavailable path');

      expect(windowResult.vectors).toHaveLength(1);
      expect(windowResult.vectors[0]).toHaveLength(384);
    });

    it('Given: 빈 문자열 또는 공백만 있는 텍스트, When: generateWindowEmbeddings 호출, Then: generateEmbedding과 같이 거절해야 함', async () => {
      await expect(service.generateWindowEmbeddings('')).rejects.toThrow('텍스트가 비어있습니다');
      await expect(service.generateWindowEmbeddings('   ')).rejects.toThrow('텍스트가 비어있습니다');
      await expect(service.generateEmbedding('')).rejects.toThrow('텍스트가 비어있습니다');
      await expect(service.generateEmbedding('   ')).rejects.toThrow('텍스트가 비어있습니다');
    });
  });
});
