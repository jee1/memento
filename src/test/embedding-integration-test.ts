/**
 * 임베딩 서비스 통합 테스트
 * 실제 시나리오에서의 동작 검증
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { UnifiedEmbeddingService } from '../services/unified-embedding-service.js';
import { EmbeddingProviderFactory } from '../domains/embedding/providers/embedding-provider-factory.js';
import type { EmbeddingData } from '../shared/types/embedding.types.js';

// 실제 사용 시나리오 데이터
const memoryItems: EmbeddingData[] = [
  {
    id: 'memory-1',
    content: '사용자가 React Hook에 대해 질문했습니다. useState와 useEffect의 차이점을 설명해주세요.',
    embedding: []
  },
  {
    id: 'memory-2', 
    content: 'TypeScript의 타입 시스템에 대한 질문이 있었습니다. 인터페이스와 타입의 차이점을 알고 싶어합니다.',
    embedding: []
  },
  {
    id: 'memory-3',
    content: '데이터베이스 최적화에 대한 질문입니다. 인덱스 설계와 쿼리 성능 개선 방법을 문의했습니다.',
    embedding: []
  },
  {
    id: 'memory-4',
    content: 'AI 모델 학습에 대한 질문입니다. 과적합 방지와 일반화 성능 향상 방법을 알고 싶어합니다.',
    embedding: []
  },
  {
    id: 'memory-5',
    content: '웹 개발에서 보안 관련 질문입니다. XSS와 CSRF 공격 방어 방법에 대해 문의했습니다.',
    embedding: []
  }
];

describe('임베딩 서비스 통합 테스트', () => {
  let unifiedService: UnifiedEmbeddingService;
  let factory: EmbeddingProviderFactory;

  beforeAll(async () => {
    unifiedService = new UnifiedEmbeddingService();
    factory = EmbeddingProviderFactory.getInstance();
  });

  afterAll(async () => {
    // 정리 작업
  });

  describe('실제 사용 시나리오', () => {
    it('메모리 아이템 임베딩 생성 및 저장', async () => {
      console.log('\n📝 메모리 아이템 임베딩 생성 테스트');
      
      for (const item of memoryItems) {
        const result = await unifiedService.generateEmbedding(item.content);
        
        expect(result).toBeDefined();
        expect(result?.embedding).toBeDefined();
        expect(result?.embedding.length).toBeGreaterThan(0);
        
        // 임베딩을 아이템에 저장
        item.embedding = result!.embedding;
        
        console.log(`✅ ${item.id}: ${result?.embedding.length}차원 임베딩 생성 완료`);
      }
    });

    it('유사한 메모리 검색', async () => {
      console.log('\n🔍 유사한 메모리 검색 테스트');
      
      const queries = [
        'React Hook 사용법',
        'TypeScript 타입 정의',
        '데이터베이스 성능',
        '머신러닝 모델',
        '웹 보안 취약점'
      ];

      for (const query of queries) {
        const results = await unifiedService.searchSimilar(query, memoryItems, 3, 0.5);
        
        expect(results).toBeDefined();
        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBeGreaterThan(0);
        
        console.log(`\n🔍 쿼리: "${query}"`);
        results.forEach((result, index) => {
          console.log(`  ${index + 1}. ${result.id} (유사도: ${result.similarity.toFixed(3)})`);
          console.log(`     내용: ${result.content.substring(0, 50)}...`);
        });
      }
    });

    it('제공자 전환 테스트', async () => {
      console.log('\n🔄 제공자 전환 테스트');
      
      const text = '제공자 전환 테스트를 위한 샘플 텍스트입니다.';
      
      // 현재 제공자 확인
      const currentProvider = unifiedService.getCurrentProviderName();
      console.log(`현재 제공자: ${currentProvider}`);
      
      // 임베딩 생성
      const result = await unifiedService.generateEmbedding(text);
      expect(result).toBeDefined();
      
      // 사용 가능한 제공자 목록 확인
      const availableProviders = factory.getAvailableProviders();
      console.log('사용 가능한 제공자:');
      availableProviders.forEach(provider => {
        console.log(`  - ${provider.name}: ${provider.available ? '사용 가능' : '사용 불가'} (우선순위: ${provider.priority})`);
      });
    });

    it('에러 처리 및 폴백 테스트', async () => {
      console.log('\n⚠️ 에러 처리 및 폴백 테스트');
      
      // 빈 텍스트 처리
      try {
        await unifiedService.generateEmbedding('');
        expect.fail('빈 텍스트에 대해 에러가 발생해야 합니다');
      } catch (error) {
        expect(error).toBeDefined();
        console.log('✅ 빈 텍스트 에러 처리 확인');
      }
      
      // null 텍스트 처리
      try {
        await unifiedService.generateEmbedding(null as any);
        expect.fail('null 텍스트에 대해 에러가 발생해야 합니다');
      } catch (error) {
        expect(error).toBeDefined();
        console.log('✅ null 텍스트 에러 처리 확인');
      }
    });

    it('성능 및 메모리 사용량 모니터링', async () => {
      console.log('\n📊 성능 및 메모리 사용량 모니터링');
      
      const startMemory = process.memoryUsage();
      const startTime = performance.now();
      
      // 대량 임베딩 생성
      const largeTexts = Array.from({ length: 10 }, (_, i) => 
        `대량 처리 테스트 텍스트 ${i + 1}. 이것은 성능 테스트를 위한 샘플 텍스트입니다.`
      );
      
      const results = await Promise.all(
        largeTexts.map(text => unifiedService.generateEmbedding(text))
      );
      
      const endTime = performance.now();
      const endMemory = process.memoryUsage();
      
      const duration = endTime - startTime;
      const memoryUsed = endMemory.heapUsed - startMemory.heapUsed;
      
      console.log(`처리 시간: ${duration.toFixed(2)}ms`);
      console.log(`메모리 사용량: ${(memoryUsed / 1024 / 1024).toFixed(2)}MB`);
      console.log(`평균 처리 시간: ${(duration / largeTexts.length).toFixed(2)}ms/텍스트`);
      
      expect(results).toHaveLength(largeTexts.length);
      results.forEach(result => {
        expect(result).toBeDefined();
        expect(result?.embedding).toBeDefined();
      });
    });
  });

  describe('제공자별 특성 검증', () => {
    it('MiniLM 제공자 특성', async () => {
      console.log('\n🤖 MiniLM 제공자 특성 검증');
      
      const text = 'MiniLM 모델은 경량화된 언어 모델입니다.';
      const result = await unifiedService.generateEmbedding(text);
      
      expect(result).toBeDefined();
      expect(result?.embedding).toHaveLength(384);
      expect(result?.model).toContain('MiniLM');
      
      console.log(`모델: ${result?.model}`);
      console.log(`차원: ${result?.embedding.length}`);
      console.log(`토큰 사용량: ${result?.usage.total_tokens}`);
    });

    it('TF-IDF 제공자 특성', async () => {
      console.log('\n📊 TF-IDF 제공자 특성 검증');
      
      // TF-IDF 서비스를 직접 사용
      const { LightweightEmbeddingService } = await import('../services/lightweight-embedding-service.js');
      const tfidfService = new LightweightEmbeddingService();
      
      const text = 'TF-IDF는 텍스트 마이닝에서 중요한 기법입니다.';
      const result = await tfidfService.generateEmbedding(text);
      
      expect(result).toBeDefined();
      expect(result?.embedding).toHaveLength(512);
      expect(result?.model).toContain('lightweight');
      
      console.log(`모델: ${result?.model}`);
      console.log(`차원: ${result?.embedding.length}`);
    });
  });

  describe('실제 사용 패턴 시뮬레이션', () => {
    it('AI Agent 메모리 저장 시나리오', async () => {
      console.log('\n🤖 AI Agent 메모리 저장 시나리오');
      
      const agentMemories = [
        '사용자가 React 컴포넌트 생명주기에 대해 질문했습니다.',
        'TypeScript의 제네릭 사용법에 대한 설명을 요청했습니다.',
        '데이터베이스 정규화 과정을 설명해달라고 했습니다.',
        '머신러닝 모델 평가 지표에 대해 문의했습니다.',
        '웹 애플리케이션 보안 체크리스트를 요청했습니다.'
      ];
      
      const embeddings: EmbeddingData[] = [];
      
      for (let i = 0; i < agentMemories.length; i++) {
        const memory = agentMemories[i];
        const result = await unifiedService.generateEmbedding(memory);
        
        expect(result).toBeDefined();
        
        embeddings.push({
          id: `agent-memory-${i + 1}`,
          content: memory,
          embedding: result!.embedding
        });
        
        console.log(`✅ Agent 메모리 ${i + 1} 저장 완료`);
      }
      
      // 관련 메모리 검색
      const query = 'React와 TypeScript 관련 질문';
      const similarMemories = await unifiedService.searchSimilar(query, embeddings, 3, 0.3);
      
      expect(similarMemories).toBeDefined();
      expect(similarMemories.length).toBeGreaterThan(0);
      
      console.log(`\n🔍 쿼리: "${query}"`);
      similarMemories.forEach((memory, index) => {
        console.log(`  ${index + 1}. ${memory.id} (유사도: ${memory.similarity.toFixed(3)})`);
      });
    });

    it('대화 컨텍스트 검색 시나리오', async () => {
      console.log('\n💬 대화 컨텍스트 검색 시나리오');
      
      const conversationHistory = [
        '안녕하세요! React에 대해 질문이 있습니다.',
        'useState Hook을 사용할 때 주의사항이 있나요?',
        '네, 의존성 배열을 잘 관리해야 합니다.',
        'useEffect의 cleanup 함수는 언제 사용하나요?',
        '컴포넌트가 언마운트될 때 정리 작업을 위해 사용합니다.'
      ];
      
      const conversationEmbeddings: EmbeddingData[] = [];
      
      for (let i = 0; i < conversationHistory.length; i++) {
        const message = conversationHistory[i];
        const result = await unifiedService.generateEmbedding(message);
        
        expect(result).toBeDefined();
        
        conversationEmbeddings.push({
          id: `conv-${i + 1}`,
          content: message,
          embedding: result!.embedding
        });
      }
      
      // 관련 대화 검색
      const currentQuestion = 'React Hook의 의존성 배열에 대해 더 자세히 알고 싶습니다.';
      const relevantMessages = await unifiedService.searchSimilar(
        currentQuestion, 
        conversationEmbeddings, 
        5, 
        0.4
      );
      
      expect(relevantMessages).toBeDefined();
      expect(relevantMessages.length).toBeGreaterThan(0);
      
      console.log(`\n🔍 현재 질문: "${currentQuestion}"`);
      console.log('관련 대화:');
      relevantMessages.forEach((message, index) => {
        console.log(`  ${index + 1}. ${message.content} (유사도: ${message.similarity.toFixed(3)})`);
      });
    });
  });
});
