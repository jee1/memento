/* eslint-disable no-console */
/**
 * Gemini 임베딩 서비스 테스트
 * Gemini API를 사용한 임베딩 생성 및 검색 기능 테스트
 */

import { GeminiEmbeddingService } from '@memento/coregemini-embedding-service.js';
import { EmbeddingService } from '@memento/core/domains/embedding/services/embedding-service.js';
import { RetryManager } from '@memento/corescheduler/retry-manager.js';
import { mementoConfig } from '@memento/coreconfig/index.js';
import { PIIMasker } from '@memento/core/shared/utils/pii-masker.js';

async function testGeminiEmbeddingService() {
  console.log('🧪 Gemini 임베딩 서비스 테스트 시작\n');

  // 1. Gemini 임베딩 서비스 직접 테스트
  console.log('1️⃣ Gemini 임베딩 서비스 직접 테스트');
  const geminiService = new GeminiEmbeddingService();
  
  console.log(`   - 서비스 사용 가능: ${geminiService.isAvailable()}`);
  console.log(`   - 모델 정보:`, geminiService.getModelInfo());

  if (geminiService.isAvailable()) {
    try {
      const testText = '안녕하세요! 이것은 Gemini 임베딩 테스트입니다.';
      console.log(`   - 테스트 텍스트: "${testText}"`);
      
      const startTime = Date.now();
      const result = await geminiService.generateEmbedding(testText);
      const endTime = Date.now();
      
      if (result) {
        console.log(`   ✅ 임베딩 생성 성공 (${endTime - startTime}ms)`);
        console.log(`   - 모델: ${result.model}`);
        console.log(`   - 차원: ${result.embedding.length}`);
        console.log(`   - 토큰 사용량: ${result.usage.total_tokens}`);
        console.log(`   - 임베딩 샘플: [${result.embedding.slice(0, 5).map(x => x.toFixed(4)).join(', ')}...]`);
      } else {
        console.log('   ❌ 임베딩 생성 실패');
      }
    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      console.log(`   ❌ Gemini 임베딩 테스트 실패:`, maskedError.message);
    }
  } else {
    console.log('   ⚠️ Gemini 서비스가 사용 불가능합니다 (API 키 확인 필요)');
  }

  console.log('\n' + '='.repeat(60) + '\n');

  // 2. 통합 임베딩 서비스 테스트 (Gemini 제공자)
  console.log('2️⃣ 통합 임베딩 서비스 테스트 (Gemini 제공자)');
  console.log(`   - 현재 임베딩 제공자: ${mementoConfig.embeddingProvider}`);
  
  const embeddingService = new EmbeddingService(
    new RetryManager({ maxAttempts: 3, baseDelay: 100 })
  );
  console.log(`   - 서비스 사용 가능: ${embeddingService.isAvailable()}`);
  console.log(`   - 모델 정보:`, embeddingService.getModelInfo());

  if (embeddingService.isAvailable()) {
    try {
      const testTexts = [
        'React와 TypeScript를 사용한 웹 개발',
        'Node.js 백엔드 API 서버 구축',
        'SQLite 데이터베이스 설계 및 최적화',
        'MCP 프로토콜을 활용한 AI 에이전트 개발',
        '머신러닝과 자연어 처리 기술'
      ];

      console.log('   - 여러 텍스트 임베딩 생성 테스트:');
      
      for (let i = 0; i < testTexts.length; i++) {
        const text = testTexts[i];
        const startTime = Date.now();
        const result = await embeddingService.generateEmbedding(text!);
        const endTime = Date.now();
        
        if (result) {
          console.log(`     ${i + 1}. "${text}"`);
          console.log(`        ✅ 성공 (${endTime - startTime}ms, ${result.embedding.length}차원)`);
        } else {
          console.log(`     ${i + 1}. "${text}"`);
          console.log(`        ❌ 실패`);
        }
      }

      // 3. 유사도 검색 테스트
      console.log('\n   - 유사도 검색 테스트:');
      const query = '웹 개발 프레임워크';
      console.log(`     쿼리: "${query}"`);
      
      const embeddings = [];
      for (let i = 0; i < testTexts.length; i++) {
        const result = await embeddingService.generateEmbedding(testTexts[i]!);
        if (result) {
          embeddings.push({
            id: `test-${i + 1}`,
            content: testTexts[i]!,
            embedding: result.embedding
          });
        }
      }

      if (embeddings.length > 0) {
        const similarities = await embeddingService.searchSimilar(
          query,
          embeddings,
          3, // 상위 3개
          0.5 // 임계값 0.5
        );

        console.log(`     검색 결과 (${similarities.length}개):`);
        similarities.forEach((item, index) => {
          console.log(`       ${index + 1}. "${item.content}" (유사도: ${item.similarity.toFixed(4)})`);
        });
      }

    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      console.log(`   ❌ 통합 임베딩 서비스 테스트 실패:`, maskedError.message);
    }
  } else {
    console.log('   ⚠️ 통합 임베딩 서비스가 사용 불가능합니다');
  }

  console.log('\n' + '='.repeat(60) + '\n');

  // 4. 성능 테스트
  console.log('3️⃣ 성능 테스트');
  
  if (embeddingService.isAvailable()) {
    const performanceTexts = [
      '짧은 텍스트',
      '이것은 좀 더 긴 텍스트입니다. 여러 문장으로 구성되어 있고, 다양한 단어들이 포함되어 있습니다.',
      '매우 긴 텍스트입니다. ' + '반복되는 내용입니다. '.repeat(50) + '끝입니다.'
    ];

    for (const text of performanceTexts) {
      console.log(`   - 텍스트 길이: ${text.length}자`);
      
      const times = [];
      for (let i = 0; i < 3; i++) {
        const startTime = Date.now();
        await embeddingService.generateEmbedding(text);
        const endTime = Date.now();
        times.push(endTime - startTime);
      }
      
      const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
      const minTime = Math.min(...times);
      const maxTime = Math.max(...times);
      
      console.log(`     평균: ${avgTime.toFixed(2)}ms, 최소: ${minTime}ms, 최대: ${maxTime}ms`);
    }
  }

  console.log('\n🎉 Gemini 임베딩 서비스 테스트 완료!');
}

// 테스트 실행
if (import.meta.url === `file://${process.argv[1]}`) {
  testGeminiEmbeddingService().catch(console.error);
}

export { testGeminiEmbeddingService };
