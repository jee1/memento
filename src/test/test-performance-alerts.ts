/**
 * 성능 알림 시스템 테스트
 * 성능 알림 서비스의 기능을 테스트하고 알림을 확인
 */

import { createMementoClient } from '../client/index.js';
import { PIIMasker } from '../shared/utils/pii-masker.js';

async function testPerformanceAlerts() {
  console.log('🚨 성능 알림 시스템 테스트 시작');
  
  let client;
  try {
    // MCP 클라이언트 연결
    client = createMementoClient();
    await client.connect();
    console.log('✅ MCP 클라이언트 연결 완료');

    // 1. 초기 알림 통계 조회
    console.log('\n📊 초기 알림 통계:');
    const initialStats = await client.callTool('performance_alerts', { 
      action: 'stats',
      hours: 1 
    });
    console.log(JSON.stringify(initialStats, null, 2));

    // 2. 활성 알림 조회
    console.log('\n🔍 활성 알림 조회:');
    const activeAlerts = await client.callTool('performance_alerts', {
      action: 'list',
      hours: 1,
      limit: 10
    });
    console.log(JSON.stringify(activeAlerts, null, 2));

    // 3. 성능 테스트 실행 (알림 트리거용)
    console.log('\n⚡ 성능 테스트 실행 (알림 트리거):');
    
    // 메모리 사용량 증가 시뮬레이션
    console.log('📝 대량 메모리 작업 실행...');
    for (let i = 0; i < 50; i++) {
      await client.remember({
        content: `성능 테스트용 메모리 ${i} - ${'x'.repeat(1000)}`, // 큰 데이터
        type: 'episodic',
        tags: ['performance', 'test', 'alert'],
        importance: 0.5
      });
    }

    // 검색 성능 테스트
    console.log('🔍 검색 성능 테스트...');
    for (let i = 0; i < 20; i++) {
      await client.recall({
        query: `성능 테스트 ${i}`,
        limit: 10
      });
    }

    // 4. 알림 발생 후 통계 재조회
    console.log('\n📊 알림 발생 후 통계:');
    const afterStats = await client.callTool('performance_alerts', {
      action: 'stats',
      hours: 1
    });
    console.log(JSON.stringify(afterStats, null, 2));

    // 5. 특정 레벨별 알림 조회
    console.log('\n🔍 WARNING 레벨 알림 조회:');
    const warningAlerts = await client.callTool('performance_alerts', {
      action: 'search',
      level: 'warning',
      hours: 1,
      limit: 5
    });
    console.log(JSON.stringify(warningAlerts, null, 2));

    // 6. 알림 해결 테스트 (첫 번째 알림 해결)
    if (afterStats.stats && afterStats.stats.recentAlerts && afterStats.stats.recentAlerts.length > 0) {
      const firstAlert = afterStats.stats.recentAlerts[0];
      console.log(`\n🔧 알림 해결 테스트: ${firstAlert.id}`);
      
      const resolveResult = await client.callTool('performance_alerts', {
        action: 'resolve',
        alertId: firstAlert.id,
        resolvedBy: 'test_user',
        resolution: '테스트용 알림 해결'
      });
      console.log('해결 결과:', JSON.stringify(resolveResult, null, 2));

      // 7. 해결 후 통계 확인
      console.log('\n📊 알림 해결 후 통계:');
      const afterResolveStats = await client.callTool('performance_alerts', {
        action: 'stats',
        hours: 1
      });
      console.log(JSON.stringify(afterResolveStats, null, 2));
    }

    // 8. 성능 통계와 비교
    console.log('\n📈 성능 통계와 비교:');
    const performanceStats = await client.callTool('performance_stats', {});
    console.log('성능 통계:', JSON.stringify(performanceStats, null, 2));

    // 9. 에러 통계와 비교
    console.log('\n🚨 에러 통계와 비교:');
    const errorStats = await client.callTool('error_stats', { hours: 1 });
    console.log('에러 통계:', JSON.stringify(errorStats, null, 2));

  } catch (error) {
    const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
    console.error('❌ 테스트 실패:', maskedError.message);
  } finally {
    if (client) {
      await client.disconnect();
      console.log('🔌 MCP 클라이언트 연결 해제');
    }
  }

  console.log('\n🎉 성능 알림 시스템 테스트 완료');
}

// 직접 실행
if (import.meta.url === `file://${process.argv[1]}`) {
  testPerformanceAlerts().catch(console.error);
}

export { testPerformanceAlerts };
