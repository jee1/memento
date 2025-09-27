/**
 * @memento/client 통합 테스트
 * 
 * 이 파일은 실제 Memento MCP 서버와의 연동을 테스트합니다.
 * 테스트 실행 전에 Memento MCP 서버가 실행 중이어야 합니다.
 * 
 * 서버 실행: npm run dev:http
 */

const { MementoClient, MemoryManager, ContextInjector } = require('./dist/index.js');

class IntegrationTester {
  constructor() {
    this.client = new MementoClient({
      serverUrl: 'http://localhost:3000',
      logLevel: 'info',
      timeout: 15000,
      retryCount: 3
    });
    
    this.manager = new MemoryManager(this.client);
    this.injector = new ContextInjector(this.client);
    this.testResults = [];
  }

  async runAllTests() {
    console.log('🧪 @memento/client 통합 테스트 시작\n');
    console.log('📋 테스트 전제조건:');
    console.log('  - Memento MCP 서버가 http://localhost:3000에서 실행 중이어야 함');
    console.log('  - 서버 실행 명령: npm run dev:http\n');

    try {
      // 1. 서버 연결 테스트
      await this.testServerConnection();
      
      // 2. 기본 CRUD 테스트
      await this.testBasicCRUD();
      
      // 3. 검색 기능 테스트
      await this.testSearchFeatures();
      
      // 4. 컨텍스트 주입 테스트
      await this.testContextInjection();
      
      // 5. 고급 기능 테스트
      await this.testAdvancedFeatures();
      
      // 6. 에러 처리 테스트
      await this.testErrorHandling();
      
      // 7. 성능 테스트
      await this.testPerformance();
      
      // 테스트 결과 요약
      this.printTestSummary();
      
    } catch (error) {
      console.error('❌ 통합 테스트 실패:', error.message);
      console.error('스택 트레이스:', error.stack);
    } finally {
      // 정리 작업
      await this.cleanup();
    }
  }

  async testServerConnection() {
    console.log('🔌 1. 서버 연결 테스트');
    
    try {
      await this.client.connect();
      this.recordTest('서버 연결', true, '서버에 성공적으로 연결됨');
      
      // 서버 상태 확인
      const health = await this.client.healthCheck();
      this.recordTest('서버 상태 확인', true, `서버 상태: ${health.status}`);
      
    } catch (error) {
      this.recordTest('서버 연결', false, `연결 실패: ${error.message}`);
      throw error;
    }
  }

  async testBasicCRUD() {
    console.log('\n📝 2. 기본 CRUD 테스트');
    
    try {
      // 기억 생성
      const memory = await this.manager.create({
        content: '통합 테스트용 기억입니다. React Hook에 대해 학습했습니다.',
        type: 'episodic',
        importance: 0.8,
        tags: ['test', 'react', 'integration'],
        source: 'integration-test'
      });
      
      this.recordTest('기억 생성', true, `생성된 기억 ID: ${memory.id}`);
      
      // 기억 조회
      const retrieved = await this.manager.get(memory.id);
      this.recordTest('기억 조회', !!retrieved, retrieved ? '기억 조회 성공' : '기억 조회 실패');
      
      // 기억 업데이트
      const updated = await this.manager.update(memory.id, {
        importance: 0.9,
        tags: ['test', 'react', 'integration', 'updated']
      });
      
      this.recordTest('기억 업데이트', true, `중요도: ${updated.importance}`);
      
      // 기억 고정
      await this.manager.pin(memory.id);
      this.recordTest('기억 고정', true, '기억이 고정됨');
      
      // 테스트용 기억 ID 저장 (정리용)
      this.testMemoryId = memory.id;
      
    } catch (error) {
      this.recordTest('기본 CRUD', false, `CRUD 테스트 실패: ${error.message}`);
    }
  }

  async testSearchFeatures() {
    console.log('\n🔍 3. 검색 기능 테스트');
    
    try {
      // 기본 검색
      const searchResults = await this.manager.search('React Hook', {
        limit: 5
      });
      
      this.recordTest('기본 검색', searchResults.total_count > 0, 
        `검색 결과: ${searchResults.total_count}개`);
      
      // 태그 검색
      const tagResults = await this.manager.searchByTags(['test', 'react']);
      this.recordTest('태그 검색', tagResults.total_count > 0, 
        `태그 검색 결과: ${tagResults.total_count}개`);
      
      // 타입별 검색
      const typeResults = await this.manager.searchByType('episodic');
      this.recordTest('타입별 검색', typeResults.total_count > 0, 
        `타입별 검색 결과: ${typeResults.total_count}개`);
      
      // 하이브리드 검색
      const hybridResults = await this.manager.search('React Hook', {
        useHybrid: true,
        limit: 3
      });
      
      this.recordTest('하이브리드 검색', hybridResults.total_count > 0, 
        `하이브리드 검색 결과: ${hybridResults.total_count}개`);
      
    } catch (error) {
      this.recordTest('검색 기능', false, `검색 테스트 실패: ${error.message}`);
    }
  }

  async testContextInjection() {
    console.log('\n💭 4. 컨텍스트 주입 테스트');
    
    try {
      // 기본 컨텍스트 주입
      const context = await this.injector.inject('React 개발 질문', {
        tokenBudget: 1000,
        contextType: 'conversation'
      });
      
      this.recordTest('컨텍스트 주입', !!context.content, 
        `주입된 컨텍스트 길이: ${context.content.length}자`);
      
      // 대화 컨텍스트 주입
      const conversationContext = await this.injector.injectConversationContext(
        '프로그래밍 학습', 800
      );
      
      this.recordTest('대화 컨텍스트', !!conversationContext.content, 
        '대화 컨텍스트 주입 성공');
      
      // 학습 컨텍스트 주입
      const learningContext = await this.injector.injectLearningContext(
        'React Hook', 1200
      );
      
      this.recordTest('학습 컨텍스트', !!learningContext.content, 
        '학습 컨텍스트 주입 성공');
      
    } catch (error) {
      this.recordTest('컨텍스트 주입', false, `컨텍스트 주입 실패: ${error.message}`);
    }
  }

  async testAdvancedFeatures() {
    console.log('\n🚀 5. 고급 기능 테스트');
    
    try {
      // 통계 조회
      const stats = await this.manager.getStats();
      this.recordTest('통계 조회', stats.total > 0, 
        `총 기억 수: ${stats.total}, 고정: ${stats.pinned}개`);
      
      // 인기 태그 조회
      const popularTags = await this.manager.getPopularTags(5);
      this.recordTest('인기 태그', popularTags.length > 0, 
        `인기 태그: ${popularTags.map(t => t.tag).join(', ')}`);
      
      // 유사 기억 검색 (테스트용 기억이 있는 경우)
      if (this.testMemoryId) {
        const similarMemories = await this.manager.findSimilar(this.testMemoryId, 3);
        this.recordTest('유사 기억 검색', true, 
          `유사 기억: ${similarMemories.total_count}개`);
      }
      
      // 관련 기억 검색
      if (this.testMemoryId) {
        const relatedMemories = await this.manager.findRelated(this.testMemoryId, 3);
        this.recordTest('관련 기억 검색', true, 
          `관련 기억: ${relatedMemories.total_count}개`);
      }
      
    } catch (error) {
      this.recordTest('고급 기능', false, `고급 기능 테스트 실패: ${error.message}`);
    }
  }

  async testErrorHandling() {
    console.log('\n⚠️ 6. 에러 처리 테스트');
    
    try {
      // 존재하지 않는 기억 조회
      const notFound = await this.manager.get('non-existent-id');
      this.recordTest('존재하지 않는 기억 조회', notFound === null, 
        '존재하지 않는 기억은 null 반환');
      
      // 잘못된 서버 URL로 연결 시도
      const badClient = new MementoClient({
        serverUrl: 'http://localhost:9999',
        timeout: 1000
      });
      
      try {
        await badClient.connect();
        this.recordTest('잘못된 서버 연결', false, '연결이 성공했지만 실패해야 함');
      } catch (error) {
        this.recordTest('잘못된 서버 연결', true, '예상대로 연결 실패');
      }
      
    } catch (error) {
      this.recordTest('에러 처리', false, `에러 처리 테스트 실패: ${error.message}`);
    }
  }

  async testPerformance() {
    console.log('\n⚡ 7. 성능 테스트');
    
    try {
      // 대량 기억 생성 테스트
      const startTime = Date.now();
      const batchSize = 10;
      const batchMemories = [];
      
      for (let i = 0; i < batchSize; i++) {
        batchMemories.push({
          content: `성능 테스트용 기억 ${i + 1}: TypeScript와 React에 대한 학습 내용입니다.`,
          type: 'episodic',
          importance: 0.5 + (i * 0.05),
          tags: ['performance', 'test', `batch-${i}`],
          source: 'performance-test'
        });
      }
      
      const createdMemories = await this.manager.createBatch(batchMemories);
      const creationTime = Date.now() - startTime;
      
      this.recordTest('대량 기억 생성', createdMemories.length === batchSize, 
        `${batchSize}개 기억 생성 시간: ${creationTime}ms`);
      
      // 대량 검색 테스트
      const searchStartTime = Date.now();
      const searchResults = await this.manager.search('TypeScript React', {
        limit: 20
      });
      const searchTime = Date.now() - searchStartTime;
      
      this.recordTest('대량 검색', searchResults.total_count > 0, 
        `검색 시간: ${searchTime}ms, 결과: ${searchResults.total_count}개`);
      
      // 성능 테스트용 기억 ID 저장 (정리용)
      this.performanceMemoryIds = createdMemories.map(m => m.id);
      
    } catch (error) {
      this.recordTest('성능 테스트', false, `성능 테스트 실패: ${error.message}`);
    }
  }

  async cleanup() {
    console.log('\n🧹 정리 작업');
    
    try {
      // 테스트용 기억들 삭제
      const memoryIdsToDelete = [
        this.testMemoryId,
        ...(this.performanceMemoryIds || [])
      ].filter(Boolean);
      
      if (memoryIdsToDelete.length > 0) {
        const deletedCount = await this.manager.deleteBatch(memoryIdsToDelete, false);
        console.log(`  삭제된 테스트 기억: ${deletedCount}개`);
      }
      
      // 연결 해제
      await this.client.disconnect();
      console.log('  클라이언트 연결 해제 완료');
      
    } catch (error) {
      console.error('  정리 작업 중 오류:', error.message);
    }
  }

  recordTest(testName, passed, message) {
    this.testResults.push({ testName, passed, message });
    const status = passed ? '✅' : '❌';
    console.log(`  ${status} ${testName}: ${message}`);
  }

  printTestSummary() {
    console.log('\n📊 테스트 결과 요약');
    console.log('='.repeat(50));
    
    const totalTests = this.testResults.length;
    const passedTests = this.testResults.filter(t => t.passed).length;
    const failedTests = totalTests - passedTests;
    
    console.log(`총 테스트: ${totalTests}개`);
    console.log(`성공: ${passedTests}개`);
    console.log(`실패: ${failedTests}개`);
    console.log(`성공률: ${((passedTests / totalTests) * 100).toFixed(1)}%`);
    
    if (failedTests > 0) {
      console.log('\n❌ 실패한 테스트:');
      this.testResults
        .filter(t => !t.passed)
        .forEach(t => console.log(`  - ${t.testName}: ${t.message}`));
    }
    
    console.log('\n' + '='.repeat(50));
    
    if (failedTests === 0) {
      console.log('🎉 모든 테스트 통과! @memento/client가 정상적으로 작동합니다.');
    } else {
      console.log('⚠️ 일부 테스트가 실패했습니다. 서버 상태를 확인해주세요.');
    }
  }
}

// 테스트 실행
async function runIntegrationTests() {
  const tester = new IntegrationTester();
  await tester.runAllTests();
}

// 모듈로 실행할 때만 테스트 실행
if (require.main === module) {
  runIntegrationTests().catch(console.error);
}

module.exports = { IntegrationTester, runIntegrationTests };
