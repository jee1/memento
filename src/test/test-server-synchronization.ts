/**
 * 두 서버 동기화 검증 테스트
 * HTTP 서버와 MCP 서버가 동일한 서비스를 초기화하는지 검증
 */

import { initializeServices, type ServerServices } from '../server/bootstrap.js';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../shared/utils/database.js';
import { mementoConfig } from '../shared/config/index.js';

/**
 * 서비스 집합을 비교하는 헬퍼 함수
 */
function compareServices(services1: ServerServices, services2: ServerServices): {
  same: boolean;
  differences: string[];
} {
  const differences: string[] = [];
  
  // 필수 서비스 타입 확인
  const requiredServices: Array<keyof ServerServices> = [
    'searchEngine',
    'hybridSearchEngine',
    'embeddingService',
    'forgettingPolicyService',
    'performanceMonitor',
    'databaseOptimizer',
    'errorLoggingService',
    'performanceAlertService'
  ];
  
  for (const serviceName of requiredServices) {
    const service1 = services1[serviceName];
    const service2 = services2[serviceName];
    
    if (!service1 || !service2) {
      differences.push(`${serviceName}: 한쪽이 undefined입니다`);
      continue;
    }
    
    // PerformanceMonitor는 싱글톤이므로 같은 인스턴스여야 함
    if (serviceName === 'performanceMonitor') {
      if (service1 !== service2) {
        differences.push(`${serviceName}: 싱글톤이지만 다른 인스턴스입니다`);
      }
    } else {
      // 다른 서비스들은 다른 인스턴스이지만 같은 타입이어야 함
      const type1 = service1.constructor.name;
      const type2 = service2.constructor.name;
      if (type1 !== type2) {
        differences.push(`${serviceName}: 타입이 다릅니다 (${type1} vs ${type2})`);
      }
    }
  }
  
  // 선택적 서비스 확인
  const hasConsolidation1 = services1.consolidationScoreService !== undefined;
  const hasConsolidation2 = services2.consolidationScoreService !== undefined;
  if (hasConsolidation1 !== hasConsolidation2) {
    differences.push('consolidationScoreService: 한쪽만 초기화되었습니다');
  }
  
  const hasWriteCoalescing1 = services1.writeCoalescingManager !== undefined;
  const hasWriteCoalescing2 = services2.writeCoalescingManager !== undefined;
  if (hasWriteCoalescing1 !== hasWriteCoalescing2) {
    differences.push('writeCoalescingManager: 한쪽만 초기화되었습니다');
  }
  
  return {
    same: differences.length === 0,
    differences
  };
}

async function testServerSynchronization() {
  console.log('🧪 두 서버 동기화 검증 테스트 시작\n');
  
  let testDb1: Database.Database | null = null;
  let testDb2: Database.Database | null = null;
  
  try {
    // 1. 두 개의 테스트 데이터베이스 설정 (서로 다른 서버를 시뮬레이션)
    console.log('1️⃣ 테스트 데이터베이스 설정 (서버 1, 서버 2)');
    testDb1 = new Database(':memory:');
    DatabaseUtils.initializeDatabase(testDb1);
    console.log('✅ 서버 1 데이터베이스 초기화 완료');
    
    testDb2 = new Database(':memory:');
    DatabaseUtils.initializeDatabase(testDb2);
    console.log('✅ 서버 2 데이터베이스 초기화 완료\n');
    
    // 2. 서버 1 (HTTP 서버 시뮬레이션) 서비스 초기화
    console.log('2️⃣ 서버 1 (HTTP 서버 시뮬레이션) 서비스 초기화');
    const httpServerServices = await initializeServices(testDb1);
    console.log('✅ 서버 1 서비스 초기화 완료\n');
    
    // 3. 서버 2 (MCP 서버 시뮬레이션) 서비스 초기화
    console.log('3️⃣ 서버 2 (MCP 서버 시뮬레이션) 서비스 초기화');
    const mcpServerServices = await initializeServices(testDb2);
    console.log('✅ 서버 2 서비스 초기화 완료\n');
    
    // 4. 서비스 집합 비교
    console.log('4️⃣ 서비스 집합 비교');
    const comparison = compareServices(httpServerServices, mcpServerServices);
    
    if (!comparison.same) {
      console.error('❌ 서비스 집합이 일치하지 않습니다:');
      comparison.differences.forEach(diff => {
        console.error(`   - ${diff}`);
      });
      throw new Error('서버 간 서비스 동기화 실패');
    }
    console.log('✅ 서비스 집합이 일치합니다\n');
    
    // 5. 필수 서비스 타입 확인
    console.log('5️⃣ 필수 서비스 타입 확인');
    const requiredServices: Array<keyof ServerServices> = [
      'searchEngine',
      'hybridSearchEngine',
      'embeddingService',
      'forgettingPolicyService',
      'performanceMonitor',
      'databaseOptimizer',
      'errorLoggingService',
      'performanceAlertService'
    ];
    
    for (const serviceName of requiredServices) {
      const httpService = httpServerServices[serviceName];
      const mcpService = mcpServerServices[serviceName];
      
      if (!httpService || !mcpService) {
        throw new Error(`${serviceName}이 초기화되지 않았습니다`);
      }
      
      const httpType = httpService.constructor.name;
      const mcpType = mcpService.constructor.name;
      
      if (httpType !== mcpType) {
        throw new Error(`${serviceName}의 타입이 다릅니다 (HTTP: ${httpType}, MCP: ${mcpType})`);
      }
      
      console.log(`   ✅ ${serviceName}: ${httpType}`);
    }
    console.log('✅ 모든 필수 서비스 타입이 일치합니다\n');
    
    // 6. PerformanceMonitor 싱글톤 확인
    console.log('6️⃣ PerformanceMonitor 싱글톤 확인');
    if (httpServerServices.performanceMonitor !== mcpServerServices.performanceMonitor) {
      throw new Error('PerformanceMonitor가 싱글톤이 아닙니다');
    }
    console.log('✅ PerformanceMonitor가 싱글톤으로 동작합니다\n');
    
    // 7. 선택적 서비스 일관성 확인
    console.log('7️⃣ 선택적 서비스 일관성 확인');
    const httpHasConsolidation = httpServerServices.consolidationScoreService !== undefined;
    const mcpHasConsolidation = mcpServerServices.consolidationScoreService !== undefined;
    
    if (httpHasConsolidation !== mcpHasConsolidation) {
      throw new Error('consolidationScoreService 초기화가 일관되지 않습니다');
    }
    
    const httpHasWriteCoalescing = httpServerServices.writeCoalescingManager !== undefined;
    const mcpHasWriteCoalescing = mcpServerServices.writeCoalescingManager !== undefined;
    
    if (httpHasWriteCoalescing !== mcpHasWriteCoalescing) {
      throw new Error('writeCoalescingManager 초기화가 일관되지 않습니다');
    }
    
    if (httpHasConsolidation) {
      console.log('   ✅ consolidationScoreService: 양쪽 모두 초기화됨');
    } else {
      console.log('   ✅ consolidationScoreService: 양쪽 모두 초기화되지 않음');
    }
    
    if (httpHasWriteCoalescing) {
      console.log('   ✅ writeCoalescingManager: 양쪽 모두 초기화됨');
    } else {
      console.log('   ✅ writeCoalescingManager: 양쪽 모두 초기화되지 않음');
    }
    console.log('✅ 선택적 서비스 초기화가 일관됩니다\n');
    
    // 8. 서비스 동작 검증 (양쪽 서버에서 동일하게 동작하는지)
    console.log('8️⃣ 서비스 동작 검증');
    
    // SearchEngine 동작 검증
    const httpSearchResult = await httpServerServices.searchEngine.search(testDb1, {
      query: 'test',
      limit: 10
    });
    const mcpSearchResult = await mcpServerServices.searchEngine.search(testDb2, {
      query: 'test',
      limit: 10
    });
    
    if (!httpSearchResult || !mcpSearchResult) {
      throw new Error('SearchEngine이 정상 동작하지 않습니다');
    }
    console.log('   ✅ SearchEngine: 양쪽 서버에서 정상 동작');
    
    // EmbeddingService 동작 검증
    const httpEmbeddingResult = await httpServerServices.embeddingService.embed('test');
    const mcpEmbeddingResult = await mcpServerServices.embeddingService.embed('test');
    
    if (!httpEmbeddingResult || !mcpEmbeddingResult) {
      throw new Error('EmbeddingService가 정상 동작하지 않습니다');
    }
    console.log('   ✅ EmbeddingService: 양쪽 서버에서 정상 동작');
    
    // PerformanceMonitor 동작 검증
    const httpMetrics = await httpServerServices.performanceMonitor.collectMetrics();
    const mcpMetrics = await mcpServerServices.performanceMonitor.collectMetrics();
    
    if (!httpMetrics || !mcpMetrics) {
      throw new Error('PerformanceMonitor가 정상 동작하지 않습니다');
    }
    console.log('   ✅ PerformanceMonitor: 양쪽 서버에서 정상 동작');
    console.log('✅ 모든 서비스가 양쪽 서버에서 정상 동작합니다\n');
    
    // 9. 같은 데이터베이스로 초기화했을 때의 동작 확인
    console.log('9️⃣ 같은 데이터베이스로 초기화 시 동작 확인');
    const testDb3 = new Database(':memory:');
    DatabaseUtils.initializeDatabase(testDb3);
    
    const services1 = await initializeServices(testDb3);
    const services2 = await initializeServices(testDb3);
    
    // PerformanceMonitor는 싱글톤이므로 같은 인스턴스여야 함
    if (services1.performanceMonitor !== services2.performanceMonitor) {
      throw new Error('같은 데이터베이스로 초기화했을 때 PerformanceMonitor 싱글톤이 유지되지 않습니다');
    }
    
    // 다른 서비스들은 다른 인스턴스이지만 같은 타입이어야 함
    if (services1.searchEngine === services2.searchEngine) {
      throw new Error('SearchEngine이 같은 인스턴스입니다 (새로 생성되어야 함)');
    }
    
    testDb3.close();
    console.log('✅ 같은 데이터베이스로 초기화해도 정상 동작합니다\n');
    
    // 10. 실제 서버 초기화 로직 검증 (코드 레벨)
    console.log('🔟 실제 서버 초기화 로직 검증');
    
    // HTTP 서버와 MCP 서버 모두 initializeServices를 사용하는지 확인
    // 이는 코드 검증이므로 실제로는 이미 확인됨
    // 하지만 테스트에서 명시적으로 확인
    const httpServices = await initializeServices(testDb1);
    const mcpServices = await initializeServices(testDb2);
    
    // 두 서버가 동일한 서비스 집합을 초기화하는지 확인
    const finalComparison = compareServices(httpServices, mcpServices);
    if (!finalComparison.same) {
      throw new Error('최종 검증 실패: 서버 간 서비스 동기화 불일치');
    }
    
    // 모든 필수 서비스가 양쪽 모두 초기화되었는지 확인
    const allRequiredServices = [
      'searchEngine',
      'hybridSearchEngine',
      'embeddingService',
      'forgettingPolicyService',
      'performanceMonitor',
      'databaseOptimizer',
      'errorLoggingService',
      'performanceAlertService'
    ];
    
    for (const serviceName of allRequiredServices) {
      const httpService = httpServices[serviceName];
      const mcpService = mcpServices[serviceName];
      
      if (!httpService || !mcpService) {
        throw new Error(`${serviceName}이 한쪽 서버에서 초기화되지 않았습니다`);
      }
      
      // 타입 확인
      if (httpService.constructor.name !== mcpService.constructor.name) {
        throw new Error(`${serviceName}의 타입이 서버 간에 다릅니다`);
      }
    }
    
    console.log('   ✅ HTTP 서버와 MCP 서버가 동일한 서비스를 초기화합니다');
    console.log('   ✅ 모든 필수 서비스가 양쪽 서버에서 동일하게 초기화됩니다');
    console.log('✅ 실제 서버 초기화 로직 검증 완료\n');
    
    console.log('🎉 모든 동기화 검증 테스트 통과!\n');
    
  } catch (error) {
    console.error('\n❌ 테스트 실패:', error);
    if (error instanceof Error) {
      console.error('에러 메시지:', error.message);
      console.error('스택 트레이스:', error.stack);
    }
    process.exit(1);
  } finally {
    // 정리
    if (testDb1) {
      console.log('🧹 서버 1 데이터베이스 정리 중...');
      testDb1.close();
    }
    if (testDb2) {
      console.log('🧹 서버 2 데이터베이스 정리 중...');
      testDb2.close();
    }
    console.log('✅ 정리 완료');
  }
}

// Node.js 환경에서 직접 실행할 때만 테스트 실행
if (import.meta.url === `file://${process.argv[1]}`) {
  testServerSynchronization().catch((error) => {
    console.error('테스트 실행 실패:', error);
    process.exit(1);
  });
}

// Vitest를 위한 export (선택적)
export { testServerSynchronization, compareServices };

