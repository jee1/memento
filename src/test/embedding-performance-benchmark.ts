/* eslint-disable no-console */
/**
 * 임베딩 서비스 성능 벤치마크
 * TF-IDF, MiniLM, OpenAI, Gemini 성능 비교
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { MiniLMEmbeddingService } from '../services/minilm-embedding-service.js';
import { LightweightEmbeddingService } from '../services/lightweight-embedding-service.js';
import { UnifiedEmbeddingService } from '../services/unified-embedding-service.js';
import type { EmbeddingData } from '../shared/types/embedding.types.js';

// 테스트 데이터
const testTexts = [
  'Hello world, this is a simple test.',
  'The quick brown fox jumps over the lazy dog.',
  'Machine learning and artificial intelligence are transforming the world.',
  'TypeScript is a strongly typed programming language that builds on JavaScript.',
  'Memento is an AI memory system that helps agents remember and recall information.',
  'Vector embeddings are numerical representations of text that capture semantic meaning.',
  'Natural language processing enables computers to understand human language.',
  'Deep learning models can process vast amounts of data to find patterns.',
  'The future of AI lies in creating more efficient and accessible systems.',
  'Open source software drives innovation in the technology industry.'
];

const testEmbeddings: EmbeddingData[] = testTexts.map((text, index) => ({
  id: `test-${index}`,
  content: text,
  embedding: Array.from({ length: 384 }, () => Math.random())
}));

interface BenchmarkResult {
  provider: string;
  operation: string;
  duration: number;
  success: boolean;
  error?: string;
  memoryUsage?: number;
}

class PerformanceBenchmark {
  private results: BenchmarkResult[] = [];

  async measureOperation<T>(
    provider: string,
    operation: string,
    fn: () => Promise<T>
  ): Promise<T | null> {
    const startTime = performance.now();
    const startMemory = process.memoryUsage();
    
    try {
      const result = await fn();
      const endTime = performance.now();
      const endMemory = process.memoryUsage();
      
      this.results.push({
        provider,
        operation,
        duration: endTime - startTime,
        success: true,
        memoryUsage: endMemory.heapUsed - startMemory.heapUsed
      });
      
      return result;
    } catch (error) {
      const endTime = performance.now();
      
      this.results.push({
        provider,
        operation,
        duration: endTime - startTime,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      return null;
    }
  }

  getResults(): BenchmarkResult[] {
    return this.results;
  }

  getSummary(): Record<string, any> {
    const summary: Record<string, any> = {};
    
    // 제공자별 성능 요약
    const providers = [...new Set(this.results.map(r => r.provider))];
    
    for (const provider of providers) {
      const providerResults = this.results.filter(r => r.provider === provider);
      const successfulResults = providerResults.filter(r => r.success);
      
      summary[provider] = {
        totalOperations: providerResults.length,
        successfulOperations: successfulResults.length,
        successRate: successfulResults.length / providerResults.length,
        averageDuration: successfulResults.reduce((sum, r) => sum + r.duration, 0) / successfulResults.length,
        totalMemoryUsage: successfulResults.reduce((sum, r) => sum + (r.memoryUsage || 0), 0),
        operations: providerResults.map(r => ({
          operation: r.operation,
          duration: r.duration,
          success: r.success,
          error: r.error
        }))
      };
    }
    
    return summary;
  }
}

describe('임베딩 서비스 성능 벤치마크', () => {
  let benchmark: PerformanceBenchmark;
  let minilmService: MiniLMEmbeddingService;
  let tfidfService: LightweightEmbeddingService;
  let unifiedService: UnifiedEmbeddingService;

  beforeAll(async () => {
    benchmark = new PerformanceBenchmark();
    minilmService = new MiniLMEmbeddingService();
    tfidfService = new LightweightEmbeddingService();
    unifiedService = new UnifiedEmbeddingService();
  });

  afterAll(() => {
    // 벤치마크 결과 출력
    const summary = benchmark.getSummary();
    console.log('\n📊 임베딩 서비스 성능 벤치마크 결과:');
    console.log(JSON.stringify(summary, null, 2));
  });

  describe('MiniLM 임베딩 서비스', () => {
    it('단일 텍스트 임베딩 생성 성능', async () => {
      const text = testTexts[0];
      
      const result = await benchmark.measureOperation(
        'minilm',
        'single-embedding',
        () => minilmService.generateEmbedding(text)
      );
      
      expect(result).toBeDefined();
      expect(result?.embedding).toHaveLength(384);
    });

    it('배치 임베딩 생성 성능', async () => {
      const promises = testTexts.map(text => 
        benchmark.measureOperation(
          'minilm',
          'batch-embedding',
          () => minilmService.generateEmbedding(text)
        )
      );
      
      const results = await Promise.all(promises);
      
      expect(results).toHaveLength(testTexts.length);
      results.forEach(result => {
        expect(result).toBeDefined();
        expect(result?.embedding).toHaveLength(384);
      });
    });

    it('유사도 검색 성능', async () => {
      const query = 'artificial intelligence and machine learning';
      
      const result = await benchmark.measureOperation(
        'minilm',
        'similarity-search',
        () => minilmService.searchSimilar(query, testEmbeddings, 5, 0.7)
      );
      
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('TF-IDF 임베딩 서비스', () => {
    it('단일 텍스트 임베딩 생성 성능', async () => {
      const text = testTexts[0];
      
      const result = await benchmark.measureOperation(
        'tfidf',
        'single-embedding',
        () => tfidfService.generateEmbedding(text)
      );
      
      expect(result).toBeDefined();
      expect(result?.embedding).toHaveLength(512);
    });

    it('배치 임베딩 생성 성능', async () => {
      const promises = testTexts.map(text => 
        benchmark.measureOperation(
          'tfidf',
          'batch-embedding',
          () => tfidfService.generateEmbedding(text)
        )
      );
      
      const results = await Promise.all(promises);
      
      expect(results).toHaveLength(testTexts.length);
      results.forEach(result => {
        expect(result).toBeDefined();
        expect(result?.embedding).toHaveLength(512);
      });
    });

    it('유사도 검색 성능', async () => {
      const query = 'artificial intelligence and machine learning';
      
      const result = await benchmark.measureOperation(
        'tfidf',
        'similarity-search',
        () => tfidfService.searchSimilar(query, testEmbeddings, 5, 0.7)
      );
      
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('통합 임베딩 서비스', () => {
    it('MiniLM 제공자로 임베딩 생성 성능', async () => {
      const text = testTexts[0];
      
      const result = await benchmark.measureOperation(
        'unified-minilm',
        'single-embedding',
        () => unifiedService.generateEmbedding(text)
      );
      
      expect(result).toBeDefined();
      expect(result?.embedding).toHaveLength(384);
    });

    it('배치 임베딩 생성 성능', async () => {
      const promises = testTexts.map(text => 
        benchmark.measureOperation(
          'unified-minilm',
          'batch-embedding',
          () => unifiedService.generateEmbedding(text)
        )
      );
      
      const results = await Promise.all(promises);
      
      expect(results).toHaveLength(testTexts.length);
      results.forEach(result => {
        expect(result).toBeDefined();
        expect(result?.embedding).toHaveLength(384);
      });
    });

    it('유사도 검색 성능', async () => {
      const query = 'artificial intelligence and machine learning';
      
      const result = await benchmark.measureOperation(
        'unified-minilm',
        'similarity-search',
        () => unifiedService.searchSimilar(query, testEmbeddings, 5, 0.7)
      );
      
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('성능 비교 분석', () => {
    it('임베딩 생성 속도 비교', () => {
      const summary = benchmark.getSummary();
      
      // MiniLM vs TF-IDF 속도 비교
      const minilmAvg = summary['minilm']?.averageDuration || 0;
      const tfidfAvg = summary['tfidf']?.averageDuration || 0;
      
      console.log(`\n⚡ 임베딩 생성 속도 비교:`);
      console.log(`MiniLM: ${minilmAvg.toFixed(2)}ms`);
      console.log(`TF-IDF: ${tfidfAvg.toFixed(2)}ms`);
      
      // MiniLM이 TF-IDF보다 빠를 것으로 예상
      expect(minilmAvg).toBeGreaterThan(0);
      expect(tfidfAvg).toBeGreaterThan(0);
    });

    it('메모리 사용량 비교', () => {
      const summary = benchmark.getSummary();
      
      const minilmMemory = summary['minilm']?.totalMemoryUsage || 0;
      const tfidfMemory = summary['tfidf']?.totalMemoryUsage || 0;
      
      console.log(`\n💾 메모리 사용량 비교:`);
      console.log(`MiniLM: ${(minilmMemory / 1024 / 1024).toFixed(2)}MB`);
      console.log(`TF-IDF: ${(tfidfMemory / 1024 / 1024).toFixed(2)}MB`);
      
      expect(minilmMemory).toBeGreaterThan(0);
      expect(tfidfMemory).toBeGreaterThan(0);
    });

    it('성공률 확인', () => {
      const summary = benchmark.getSummary();
      
      Object.entries(summary).forEach(([provider, stats]) => {
        console.log(`\n✅ ${provider} 성공률: ${(stats.successRate * 100).toFixed(1)}%`);
        expect(stats.successRate).toBeGreaterThan(0.8); // 80% 이상 성공률
      });
    });
  });
});
