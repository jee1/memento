/**
 * Migrate Embeddings Tool 테스트
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../shared/utils/database.js';
import { MigrateEmbeddingsTool } from '../migrate-embeddings-tool.js';
import type { ToolContext } from '../types.js';
import { initializeTestDatabase, insertMemoryItem, insertMemoryEmbedding } from '../test/helpers/consolidation-test-data.js';
import type { EmbeddingProvider, EmbeddingResult } from '../shared/types/embedding.types.js';

describe('MigrateEmbeddingsTool', () => {
  let db: Database.Database;
  let tool: MigrateEmbeddingsTool;
  let context: ToolContext;
  let mockGenerateEmbedding: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    db = new Database(':memory:');
    initializeTestDatabase(db);

    tool = new MigrateEmbeddingsTool();

    // embeddingService.generateEmbedding을 mock으로 교체
    // provider에 따라 적절한 차원의 임베딩 반환
    mockGenerateEmbedding = vi.fn().mockImplementation(async (content: string, provider?: EmbeddingProvider): Promise<EmbeddingResult | null> => {
      // provider에 따라 차원 결정
      let dimensions = 384; // 기본값 (minilm)
      if (provider === 'openai') {
        dimensions = 1536;
      } else if (provider === 'gemini') {
        dimensions = 768;
      } else if (provider === 'tfidf' || provider === 'lightweight') {
        dimensions = 512;
      }

      return {
        embedding: new Array(dimensions).fill(0).map((_, i) => Math.random() * 0.1),
        model: provider || 'minilm',
        provider: provider || 'minilm',
        usage: {
          prompt_tokens: content.length,
          total_tokens: content.length
        }
      };
    });

    // tool의 private embeddingService에 mock 주입
    (tool as any).embeddingService = {
      generateEmbedding: mockGenerateEmbedding
    };

    context = {
      db,
      services: {}
    };
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  describe('성공 케이스', () => {
    it('성공 케이스 - minilm에서 openai로 마이그레이션', async () => {
      // Given: minilm provider로 임베딩이 저장된 메모리
      insertMemoryItem(db, {
        id: 'mem1',
        type: 'episodic',
        content: '테스트 메모리 1'
      });
      insertMemoryEmbedding(db, {
        memory_id: 'mem1',
        embedding: new Array(384).fill(0.1),
        embedding_provider: 'minilm',
        dim: 384,
        dimensions: 384
      });

      insertMemoryItem(db, {
        id: 'mem2',
        type: 'episodic',
        content: '테스트 메모리 2'
      });
      insertMemoryEmbedding(db, {
        memory_id: 'mem2',
        embedding: new Array(384).fill(0.2),
        embedding_provider: 'minilm',
        dim: 384,
        dimensions: 384
      });

      // When: minilm에서 openai로 마이그레이션
      const params = {
        source_provider: 'minilm',
        target_provider: 'openai',
        batch_size: 100
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      // Then: 마이그레이션이 성공해야 함
      expect(resultData.total_count).toBe(2);
      expect(resultData.success_count).toBe(2);
      expect(resultData.failed_count).toBe(0);
      expect(resultData.failed_memory_ids).toHaveLength(0);

      // openai 임베딩이 추가되었는지 확인
      const openaiEmbeddings = db.prepare(`
        SELECT memory_id FROM memory_embedding
        WHERE embedding_provider = 'openai'
      `).all() as Array<{ memory_id: string }>;

      expect(openaiEmbeddings.length).toBeGreaterThanOrEqual(2);

      // 기존 minilm 임베딩은 유지되어야 함
      const minilmEmbeddings = db.prepare(`
        SELECT memory_id FROM memory_embedding
        WHERE embedding_provider = 'minilm'
      `).all() as Array<{ memory_id: string }>;

      expect(minilmEmbeddings.length).toBe(2);
    });

    it('source_provider 미지정 - 모든 provider에서 마이그레이션', async () => {
      // Given: 여러 provider로 임베딩이 저장된 메모리
      insertMemoryItem(db, {
        id: 'mem-minilm',
        type: 'episodic',
        content: 'MiniLM 메모리'
      });
      insertMemoryEmbedding(db, {
        memory_id: 'mem-minilm',
        embedding: new Array(384).fill(0.1),
        embedding_provider: 'minilm',
        dim: 384,
        dimensions: 384
      });

      insertMemoryItem(db, {
        id: 'mem-tfidf',
        type: 'episodic',
        content: 'TF-IDF 메모리'
      });
      insertMemoryEmbedding(db, {
        memory_id: 'mem-tfidf',
        embedding: new Array(512).fill(0.2),
        embedding_provider: 'tfidf',
        dim: 512,
        dimensions: 512
      });

      // When: source_provider 없이 openai로 마이그레이션
      const params = {
        target_provider: 'openai',
        batch_size: 100
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      // Then: 모든 provider의 메모리가 마이그레이션되어야 함
      expect(resultData.total_count).toBe(2);
      expect(resultData.success_count).toBe(2);
    });
  });

  describe('에러 처리', () => {
    it('source_provider === target_provider 케이스 - 에러 반환', async () => {
      // Given: source와 target이 동일
      const params = {
        source_provider: 'minilm',
        target_provider: 'minilm',
        batch_size: 100
      };

      // When/Then: 에러 반환 (refine()에서 검증)
      const result = await tool.handle(params, context);
      
      expect(result).toHaveProperty('error');
      expect((result as any).error).toBe('INVALID_PARAMETERS');
      // refine()의 에러 메시지 확인 (details에 포함됨)
      const details = (result as any).details || '';
      expect(details).toMatch(/재임베딩 불필요|source와 target이 동일/);
    });

    it('부분 실패 케이스 - 일부 메모리 재임베딩 실패', async () => {
      // Given: 여러 메모리 (일부는 재임베딩 실패 시뮬레이션)
      insertMemoryItem(db, {
        id: 'mem-success',
        type: 'episodic',
        content: '성공할 메모리'
      });
      insertMemoryEmbedding(db, {
        memory_id: 'mem-success',
        embedding: new Array(384).fill(0.1),
        embedding_provider: 'minilm',
        dim: 384,
        dimensions: 384
      });

      insertMemoryItem(db, {
        id: 'mem-fail',
        type: 'episodic',
        content: '실패할 메모리'
      });
      insertMemoryEmbedding(db, {
        memory_id: 'mem-fail',
        embedding: new Array(384).fill(0.2),
        embedding_provider: 'minilm',
        dim: 384,
        dimensions: 384
      });

      // Mock embeddingService.generateEmbedding가 특정 메모리에서 실패하도록 설정
      mockGenerateEmbedding.mockImplementation(async (content: string, provider?: EmbeddingProvider) => {
        if (content === '실패할 메모리') {
          throw new Error('임베딩 생성 실패: API 오류');
        }
        // 성공 케이스: 기본 mock 동작 사용
        let dimensions = 384;
        if (provider === 'openai') {
          dimensions = 1536;
        } else if (provider === 'gemini') {
          dimensions = 768;
        } else if (provider === 'tfidf' || provider === 'lightweight') {
          dimensions = 512;
        }
        return {
          embedding: new Array(dimensions).fill(0).map((_, i) => Math.random() * 0.1),
          model: provider || 'minilm',
          provider: provider || 'minilm',
          usage: {
            prompt_tokens: content.length,
            total_tokens: content.length
          }
        };
      });

      // When: 마이그레이션 실행
      const params = {
        source_provider: 'minilm',
        target_provider: 'openai',
        batch_size: 100
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      // Then: 실패한 메모리는 스킵되고 전체 작업은 계속 진행
      expect(resultData.total_count).toBe(2);
      expect(resultData.success_count).toBe(1);
      expect(resultData.failed_count).toBe(1);
      expect(resultData.failed_memory_ids).toContain('mem-fail');
      expect(resultData.errors).toHaveLength(1);
      expect(resultData.errors[0].memory_id).toBe('mem-fail');
    });
  });

  describe('배치 처리 검증', () => {
    it('배치 처리 - batch_size에 따라 배치로 처리', async () => {
      // Given: 여러 메모리 생성 (작은 수로 테스트하여 타임아웃 방지)
      const memoryCount = 5; // batch_size 2로 3개 배치
      for (let i = 1; i <= memoryCount; i++) {
        insertMemoryItem(db, {
          id: `mem-${i}`,
          type: 'episodic',
          content: `테스트 메모리 ${i}`
        });
        insertMemoryEmbedding(db, {
          memory_id: `mem-${i}`,
          embedding: new Array(384).fill(0.1 + i * 0.001),
          embedding_provider: 'minilm',
          dim: 384,
          dimensions: 384
        });
      }

      // When: batch_size 2로 마이그레이션
      const params = {
        source_provider: 'minilm',
        target_provider: 'openai',
        batch_size: 2
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      // Then: 모든 메모리가 처리되어야 함
      expect(resultData.total_count).toBe(memoryCount);
      expect(resultData.success_count).toBe(memoryCount);
      expect(resultData.failed_count).toBe(0);
    }, 60000); // 60초 타임아웃
  });

  describe('dry_run 모드', () => {
    it('dry_run 모드 - DB write 없이 로그/결과만 검증', async () => {
      // Given: minilm provider로 임베딩이 저장된 메모리
      insertMemoryItem(db, {
        id: 'mem-dry-run',
        type: 'episodic',
        content: 'Dry run 테스트 메모리'
      });
      insertMemoryEmbedding(db, {
        memory_id: 'mem-dry-run',
        embedding: new Array(384).fill(0.1),
        embedding_provider: 'minilm',
        dim: 384,
        dimensions: 384
      });

      // 마이그레이션 전 openai 임베딩 개수 확인
      const beforeCount = (db.prepare(`
        SELECT COUNT(*) as count FROM memory_embedding
        WHERE embedding_provider = 'openai'
      `).get() as { count: number }).count;

      // When: dry_run 모드로 마이그레이션
      const params = {
        source_provider: 'minilm',
        target_provider: 'openai',
        batch_size: 100,
        dry_run: true
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      // Then: 결과는 반환되지만 DB에는 변경 없음
      expect(resultData.total_count).toBe(1);
      expect(resultData.success_count).toBe(1);
      expect(resultData.dry_run).toBe(true);

      // DB에 openai 임베딩이 추가되지 않았는지 확인
      const afterCount = (db.prepare(`
        SELECT COUNT(*) as count FROM memory_embedding
        WHERE embedding_provider = 'openai'
      `).get() as { count: number }).count;

      expect(afterCount).toBe(beforeCount); // 변경 없음
    });

    it('dry_run 모드 - 여러 메모리 시뮬레이션', async () => {
      // Given: 여러 메모리
      for (let i = 1; i <= 5; i++) {
        insertMemoryItem(db, {
          id: `mem-dry-${i}`,
          type: 'episodic',
          content: `Dry run 메모리 ${i}`
        });
        insertMemoryEmbedding(db, {
          memory_id: `mem-dry-${i}`,
          embedding: new Array(384).fill(0.1 + i * 0.01),
          embedding_provider: 'minilm',
          dim: 384,
          dimensions: 384
        });
      }

      // When: dry_run 모드로 마이그레이션
      const params = {
        source_provider: 'minilm',
        target_provider: 'openai',
        batch_size: 2, // 작은 배치로 테스트
        dry_run: true
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      // Then: 모든 메모리가 시뮬레이션되었지만 DB 변경 없음
      expect(resultData.total_count).toBe(5);
      expect(resultData.success_count).toBe(5);
      expect(resultData.dry_run).toBe(true);

      // openai 임베딩이 없어야 함
      const openaiCount = (db.prepare(`
        SELECT COUNT(*) as count FROM memory_embedding
        WHERE embedding_provider = 'openai'
      `).get() as { count: number }).count;

      expect(openaiCount).toBe(0);
    });
  });

  describe('기존 임베딩 유지 검증', () => {
    it('기존 임베딩 유지 - 새 provider 임베딩만 추가', async () => {
      // Given: minilm provider로 임베딩이 저장된 메모리
      insertMemoryItem(db, {
        id: 'mem-existing',
        type: 'episodic',
        content: '기존 임베딩 테스트'
      });
      insertMemoryEmbedding(db, {
        memory_id: 'mem-existing',
        embedding: new Array(384).fill(0.1),
        embedding_provider: 'minilm',
        dim: 384,
        dimensions: 384
      });

      // When: openai로 마이그레이션
      const params = {
        source_provider: 'minilm',
        target_provider: 'openai',
        batch_size: 100
      };

      await tool.handle(params, context);

      // Then: minilm 임베딩은 유지되고 openai 임베딩이 추가되어야 함
      const embeddings = db.prepare(`
        SELECT embedding_provider FROM memory_embedding
        WHERE memory_id = 'mem-existing'
        ORDER BY embedding_provider
      `).all() as Array<{ embedding_provider: string }>;

      const providers = embeddings.map(e => e.embedding_provider);
      expect(providers).toContain('minilm');
      expect(providers).toContain('openai');
      expect(embeddings.length).toBe(2); // 두 provider 모두 있어야 함
    });
  });
});
