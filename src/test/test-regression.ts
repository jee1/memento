/**
 * 회귀 테스트
 * 기존 기능이 변경사항으로 인해 깨지지 않았는지 확인
 */

import { initializeServices } from '../server/bootstrap.js';
import { executeTool, getToolRegistry } from '../tools/index.js';
import type { ToolContext } from '../tools/types.js';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../shared/utils/database.js';

/**
 * ToolContext 생성 헬퍼 함수
 */
function createToolContext(db: Database.Database, services: ReturnType<typeof initializeServices> extends Promise<infer T> ? T : never): ToolContext {
  return {
    db,
    services: {
      searchEngine: services.searchEngine,
      hybridSearchEngine: services.hybridSearchEngine,
      embeddingService: services.embeddingService,
      forgettingPolicyService: services.forgettingPolicyService,
      performanceMonitor: services.performanceMonitor,
      databaseOptimizer: services.databaseOptimizer,
      errorLoggingService: services.errorLoggingService,
      performanceAlertService: services.performanceAlertService,
      consolidationScoreService: services.consolidationScoreService,
      writeCoalescingManager: services.writeCoalescingManager
    }
  };
}

async function testRegression() {
  console.log('🧪 회귀 테스트 시작\n');
  console.log('기존 기능이 변경사항으로 인해 깨지지 않았는지 확인합니다.\n');
  
  let testDb: Database.Database | null = null;
  const createdMemoryIds: string[] = [];
  
  try {
    // 1. 데이터베이스 초기화
    console.log('1️⃣ 데이터베이스 초기화');
    testDb = new Database(':memory:');
    DatabaseUtils.initializeDatabase(testDb);
    console.log('✅ 데이터베이스 초기화 완료\n');
    
    // 2. 부트스트랩 함수로 서비스 초기화
    console.log('2️⃣ 부트스트랩 함수로 서비스 초기화');
    const services = await initializeServices(testDb);
    const context = createToolContext(testDb, services);
    console.log('✅ 서비스 초기화 완료\n');
    
    // 3. 핵심 도구들이 정상적으로 등록되어 있는지 확인
    console.log('3️⃣ 도구 레지스트리 확인');
    const toolRegistry = getToolRegistry();
    const allTools = toolRegistry.getAll();
    const toolNames = allTools.map(tool => tool.name);
    
    const requiredTools = ['remember', 'recall', 'forget', 'pin', 'unpin'];
    for (const toolName of requiredTools) {
      if (!toolNames.includes(toolName)) {
        throw new Error(`필수 도구 ${toolName}이 등록되지 않았습니다`);
      }
    }
    console.log(`✅ 모든 필수 도구가 등록되어 있습니다 (${toolNames.length}개)\n`);
    
    // 4. remember 도구 테스트
    console.log('4️⃣ remember 도구 테스트');
    const rememberResult = await executeTool('remember', {
      content: '회귀 테스트를 위한 메모리입니다.',
      type: 'episodic',
      importance: 0.7,
      tags: ['regression', 'test']
    }, context);
    
    if (!rememberResult || !rememberResult.content) {
      throw new Error('remember 도구가 정상적으로 동작하지 않습니다');
    }
    
    try {
      const rememberData = JSON.parse(rememberResult.content[0].text);
      if (rememberData.id) {
        createdMemoryIds.push(rememberData.id);
        console.log(`✅ remember 도구 정상 동작 (메모리 ID: ${rememberData.id})\n`);
      } else {
        throw new Error('remember 결과에 메모리 ID가 없습니다');
      }
    } catch (e) {
      throw new Error('remember 결과 파싱 실패');
    }
    
    // 5. recall 도구 테스트
    console.log('5️⃣ recall 도구 테스트');
    const recallResult = await executeTool('recall', {
      query: '회귀 테스트',
      limit: 10
    }, context);
    
    if (!recallResult || !recallResult.content) {
      throw new Error('recall 도구가 정상적으로 동작하지 않습니다');
    }
    
    try {
      const recallData = JSON.parse(recallResult.content[0].text);
      if (!Array.isArray(recallData.items)) {
        throw new Error('recall 결과가 올바른 형식이 아닙니다');
      }
      console.log(`✅ recall 도구 정상 동작 (${recallData.items.length}개 결과)\n`);
    } catch (e) {
      throw new Error('recall 결과 파싱 실패');
    }
    
    // 6. pin 도구 테스트
    if (createdMemoryIds.length > 0) {
      console.log('6️⃣ pin 도구 테스트');
      const pinResult = await executeTool('pin', {
        id: createdMemoryIds[0]
      }, context);
      
      if (!pinResult || !pinResult.content) {
        throw new Error('pin 도구가 정상적으로 동작하지 않습니다');
      }
      
      try {
        const pinData = JSON.parse(pinResult.content[0].text);
        if (pinData.success !== true) {
          throw new Error('pin 도구가 실패했습니다');
        }
        console.log('✅ pin 도구 정상 동작\n');
      } catch (e) {
        throw new Error('pin 결과 파싱 실패');
      }
    }
    
    // 7. 서비스 동작 확인
    console.log('7️⃣ 서비스 동작 확인');
    
    // SearchEngine 동작 확인
    const searchResult = await services.searchEngine.search(testDb, {
      query: '테스트',
      limit: 5
    });
    if (!searchResult || !searchResult.items) {
      throw new Error('SearchEngine이 정상 동작하지 않습니다');
    }
    console.log('   ✅ SearchEngine 정상 동작');
    
    // HybridSearchEngine 동작 확인
    const hybridResult = await services.hybridSearchEngine.search({
      query: '테스트',
      limit: 5
    });
    if (!hybridResult || !hybridResult.items) {
      throw new Error('HybridSearchEngine이 정상 동작하지 않습니다');
    }
    console.log('   ✅ HybridSearchEngine 정상 동작');
    
    // EmbeddingService 동작 확인
    const embeddingResult = await services.embeddingService.createAndStoreEmbedding(
      testDb,
      'test-memory-id',
      '테스트 내용',
      'episodic'
    );
    if (!embeddingResult) {
      throw new Error('EmbeddingService가 정상 동작하지 않습니다');
    }
    console.log('   ✅ EmbeddingService 정상 동작');
    
    // PerformanceMonitor 동작 확인
    const metrics = await services.performanceMonitor.collectMetrics();
    if (!metrics || !metrics.timestamp) {
      throw new Error('PerformanceMonitor가 정상 동작하지 않습니다');
    }
    console.log('   ✅ PerformanceMonitor 정상 동작');
    
    console.log('✅ 모든 서비스가 정상 동작합니다\n');
    
    // 8. ToolContext에 모든 서비스가 포함되어 있는지 확인
    console.log('8️⃣ ToolContext 서비스 포함 확인');
    const contextServices = Object.keys(context.services);
    const expectedServices = [
      'searchEngine',
      'hybridSearchEngine',
      'embeddingService',
      'forgettingPolicyService',
      'performanceMonitor',
      'databaseOptimizer',
      'errorLoggingService',
      'performanceAlertService'
    ];
    
    for (const serviceName of expectedServices) {
      if (!(serviceName in context.services)) {
        throw new Error(`ToolContext에 ${serviceName}이 포함되지 않았습니다`);
      }
      if (context.services[serviceName as keyof typeof context.services] === undefined) {
        throw new Error(`ToolContext의 ${serviceName}이 undefined입니다`);
      }
    }
    console.log('✅ ToolContext에 모든 필수 서비스가 포함되어 있습니다\n');
    
    // 9. 기존 기능 유지 확인
    console.log('9️⃣ 기존 기능 유지 확인');
    
    // 데이터베이스에 메모리가 저장되었는지 확인
    const memoryCount = DatabaseUtils.get(testDb, 'SELECT COUNT(*) as count FROM memory_item', []);
    if (!memoryCount || (memoryCount as any).count === 0) {
      throw new Error('메모리가 데이터베이스에 저장되지 않았습니다');
    }
    console.log(`   ✅ 메모리 저장 기능 정상 (${(memoryCount as any).count}개 메모리)`);
    
    // 검색 기능이 정상 동작하는지 확인
    const searchCount = searchResult.items.length;
    console.log(`   ✅ 검색 기능 정상 (${searchCount}개 결과)`);
    
    console.log('✅ 모든 기존 기능이 정상적으로 유지되고 있습니다\n');
    
    console.log('🎉 모든 회귀 테스트 통과!\n');
    console.log('✅ 변경사항이 기존 기능에 영향을 주지 않았습니다.\n');
    
  } catch (error) {
    console.error('\n❌ 회귀 테스트 실패:', error);
    if (error instanceof Error) {
      console.error('에러 메시지:', error.message);
      console.error('스택 트레이스:', error.stack);
    }
    process.exit(1);
  } finally {
    // 정리
    if (testDb) {
      console.log('🧹 테스트 데이터베이스 정리 중...');
      
      // 생성된 메모리 삭제
      if (createdMemoryIds.length > 0) {
        try {
          for (const id of createdMemoryIds) {
            DatabaseUtils.run(testDb, 'DELETE FROM memory_item WHERE id = ?', [id]);
          }
        } catch (e) {
          console.warn('메모리 정리 실패:', e);
        }
      }
      
      testDb.close();
    }
    console.log('✅ 정리 완료');
  }
}

// Node.js 환경에서 직접 실행할 때만 테스트 실행
if (import.meta.url === `file://${process.argv[1]}`) {
  testRegression().catch((error) => {
    console.error('테스트 실행 실패:', error);
    process.exit(1);
  });
}

// Vitest를 위한 export (선택적)
export { testRegression };

