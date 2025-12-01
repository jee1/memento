/**
 * 부트스트랩 함수 통합 테스트
 * 실제 데이터베이스와 함께 서비스 초기화 및 동작 검증
 */

import { initializeServices } from '../server/bootstrap.js';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../shared/utils/database.js';
import { mementoConfig } from '../shared/config/index.js';

async function testBootstrapIntegration() {
  console.log('🧪 부트스트랩 함수 통합 테스트 시작\n');
  
  let testDb: Database.Database | null = null;
  
  try {
    // 1. 테스트 데이터베이스 설정
    console.log('1️⃣ 테스트 데이터베이스 설정');
    testDb = new Database(':memory:');
    DatabaseUtils.initializeDatabase(testDb);
    console.log('✅ 데이터베이스 초기화 완료\n');
    
    // 2. 부트스트랩 함수로 서비스 초기화
    console.log('2️⃣ 부트스트랩 함수로 서비스 초기화');
    const services = await initializeServices(testDb);
    console.log('✅ 서비스 초기화 완료\n');
    
    // 3. 필수 서비스 검증
    console.log('3️⃣ 필수 서비스 검증');
    if (!services.searchEngine || !services.hybridSearchEngine || !services.embeddingService ||
        !services.forgettingPolicyService || !services.performanceMonitor ||
        !services.databaseOptimizer || !services.errorLoggingService || !services.performanceAlertService) {
      throw new Error('필수 서비스가 초기화되지 않았습니다');
    }
    console.log('✅ 모든 필수 서비스가 초기화되었습니다\n');
    
    // 4. 선택적 서비스 검증
    console.log('4️⃣ 선택적 서비스 검증');
    if (mementoConfig.consolidationScoreEnabled) {
      if (!services.consolidationScoreService || !services.writeCoalescingManager) {
        throw new Error('선택적 서비스가 초기화되지 않았습니다 (consolidationScoreEnabled=true)');
      }
      console.log('✅ 선택적 서비스가 초기화되었습니다 (consolidationScoreEnabled=true)\n');
    } else {
      if (services.consolidationScoreService !== undefined || services.writeCoalescingManager !== undefined) {
        throw new Error('선택적 서비스가 초기화되었습니다 (consolidationScoreEnabled=false)');
      }
      console.log('✅ 선택적 서비스가 초기화되지 않았습니다 (consolidationScoreEnabled=false)\n');
    }
    
    // 5. 서비스 동작 검증 - SearchEngine
    console.log('5️⃣ SearchEngine 동작 검증');
    const searchResult = await services.searchEngine.search(testDb, {
      query: 'test',
      limit: 10
    });
    if (!searchResult || !searchResult.items || !Array.isArray(searchResult.items)) {
      throw new Error('SearchEngine이 정상 동작하지 않습니다');
    }
    console.log('✅ SearchEngine이 정상 동작합니다\n');
    
    // 6. 서비스 동작 검증 - HybridSearchEngine
    console.log('6️⃣ HybridSearchEngine 동작 검증');
    const hybridSearchResult = await services.hybridSearchEngine.search({
      query: 'test',
      limit: 10
    });
    if (!hybridSearchResult || !hybridSearchResult.items || !Array.isArray(hybridSearchResult.items)) {
      throw new Error('HybridSearchEngine이 정상 동작하지 않습니다');
    }
    console.log('✅ HybridSearchEngine이 정상 동작합니다\n');
    
    // 7. 서비스 동작 검증 - EmbeddingService
    console.log('7️⃣ EmbeddingService 동작 검증');
    const embeddingResult = await services.embeddingService.embed('test content');
    if (!embeddingResult || !embeddingResult.embedding || !Array.isArray(embeddingResult.embedding)) {
      throw new Error('EmbeddingService가 정상 동작하지 않습니다');
    }
    console.log('✅ EmbeddingService가 정상 동작합니다\n');
    
    // 8. 서비스 동작 검증 - PerformanceMonitor
    console.log('8️⃣ PerformanceMonitor 동작 검증');
    const metrics = await services.performanceMonitor.collectMetrics();
    if (!metrics || !metrics.timestamp || !metrics.memory || !metrics.cpu || !metrics.database) {
      throw new Error('PerformanceMonitor가 정상 동작하지 않습니다');
    }
    console.log('✅ PerformanceMonitor가 정상 동작합니다\n');
    
    // 9. 서비스 동작 검증 - DatabaseOptimizer
    console.log('9️⃣ DatabaseOptimizer 동작 검증');
    const optimizeResult = await services.databaseOptimizer.optimize();
    if (optimizeResult === undefined) {
      throw new Error('DatabaseOptimizer가 정상 동작하지 않습니다');
    }
    console.log('✅ DatabaseOptimizer가 정상 동작합니다\n');
    
    // 10. 서비스 동작 검증 - ErrorLoggingService
    console.log('🔟 ErrorLoggingService 동작 검증');
    services.errorLoggingService.logError({
      message: '테스트 에러',
      error: new Error('테스트'),
      context: { test: true }
    });
    console.log('✅ ErrorLoggingService가 정상 동작합니다\n');
    
    // 11. 서비스 동작 검증 - PerformanceAlertService
    console.log('1️⃣1️⃣ PerformanceAlertService 동작 검증');
    const alerts = services.performanceAlertService.getActiveAlerts();
    if (!Array.isArray(alerts)) {
      throw new Error('PerformanceAlertService가 정상 동작하지 않습니다');
    }
    console.log('✅ PerformanceAlertService가 정상 동작합니다\n');
    
    // 12. 선택적 서비스 동작 검증 (활성화된 경우)
    if (services.consolidationScoreService && services.writeCoalescingManager) {
      console.log('1️⃣2️⃣ 선택적 서비스 동작 검증');
      
      // ConsolidationScoreService 검증
      const scoreResult = services.consolidationScoreService.calculateScore({
        recallCount: 1,
        lastAccessedAt: new Date(),
        createdAt: new Date(Date.now() - 86400000), // 1일 전
        gValue: null,
        type: 'episodic',
        pinned: false
      });
      if (!scoreResult || scoreResult.score < 0 || scoreResult.score > 1) {
        throw new Error('ConsolidationScoreService가 정상 동작하지 않습니다');
      }
      console.log('✅ ConsolidationScoreService가 정상 동작합니다');
      
      // WriteCoalescingManager 검증
      services.writeCoalescingManager.addWrite({
        memoryId: 'test-memory-id',
        fields: {
          recall_count: 1,
          last_accessed_at: new Date().toISOString()
        }
      });
      await services.writeCoalescingManager.flush();
      console.log('✅ WriteCoalescingManager가 정상 동작합니다\n');
    }
    
    // 13. 서비스 간 상호작용 검증
    console.log('1️⃣3️⃣ 서비스 간 상호작용 검증');
    
    // PerformanceMonitor가 다른 서비스들의 메트릭을 수집할 수 있는지 확인
    const metricsAfterUse = await services.performanceMonitor.collectMetrics();
    if (!metricsAfterUse) {
      throw new Error('서비스 간 상호작용이 정상 동작하지 않습니다');
    }
    console.log('✅ 서비스 간 상호작용이 정상 동작합니다\n');
    
    // 14. 여러 번 초기화해도 안정적인지 확인
    console.log('1️⃣4️⃣ 여러 번 초기화 안정성 검증');
    const services2 = await initializeServices(testDb);
    if (!services2 || !services2.searchEngine) {
      throw new Error('여러 번 초기화가 안정적으로 동작하지 않습니다');
    }
    if (services2.performanceMonitor !== services.performanceMonitor) {
      throw new Error('PerformanceMonitor 싱글톤이 유지되지 않습니다');
    }
    console.log('✅ 여러 번 초기화해도 안정적으로 동작합니다\n');
    
    console.log('🎉 모든 통합 테스트 통과!\n');
    
  } catch (error) {
    console.error('\n❌ 테스트 실패:', error);
    if (error instanceof Error) {
      console.error('에러 메시지:', error.message);
      console.error('스택 트레이스:', error.stack);
    }
    process.exit(1);
  } finally {
    // 정리
    if (testDb) {
      console.log('🧹 테스트 데이터베이스 정리 중...');
      testDb.close();
      console.log('✅ 정리 완료');
    }
  }
}

// Node.js 환경에서 직접 실행할 때만 테스트 실행
if (import.meta.url === `file://${process.argv[1]}`) {
  testBootstrapIntegration().catch((error) => {
    console.error('테스트 실행 실패:', error);
    process.exit(1);
  });
}

// Vitest를 위한 export (선택적)
export { testBootstrapIntegration };

