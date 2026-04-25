/* eslint-disable no-console */
/**
 * 에러 로깅 시스템 테스트
 * 에러 로깅 서비스의 기능을 테스트하고 통계를 확인
 */

import { createMementoClient } from '@memento/clientindex.js';
import { PIIMasker } from '@memento/core/shared/utils/pii-masker.js';

async function testErrorLogging() {
  console.log('🔍 에러 로깅 시스템 테스트 시작');
  
  let client;
  try {
    // MCP 클라이언트 연결
    client = createMementoClient();
    await client.connect();
    console.log('✅ MCP 클라이언트 연결 완료');

    // 1. 에러 통계 조회 (초기 상태)
    console.log('\n📊 초기 에러 통계:');
    const initialStats = await client.callTool('error_stats', { hours: 1 });
    console.log(JSON.stringify(initialStats, null, 2));

    // 2. 의도적으로 에러 발생시키기 (remember 도구에 잘못된 파라미터)
    console.log('\n⚠️ 의도적 에러 발생 테스트:');
    
    try {
      await client.remember({
        content: '', // 빈 내용으로 에러 발생
        type: 'episodic' as any, // 타입 우회
        importance: 1.5 // 범위 초과
      });
    } catch (error) {
      console.log('✅ 예상된 에러 발생:', (error as Error).message);
    }

    try {
      await client.recall({
        query: '', // 빈 쿼리로 에러 발생
        limit: -1 // 잘못된 제한값
      });
    } catch (error) {
      console.log('✅ 예상된 에러 발생:', (error as Error).message);
    }

    // 3. 에러 통계 재조회
    console.log('\n📊 에러 발생 후 통계:');
    const afterErrorStats = await client.callTool('error_stats', { 
      hours: 1,
      includeResolved: false,
      limit: 10
    });
    console.log(JSON.stringify(afterErrorStats, null, 2));

    // 4. 특정 심각도별 에러 조회
    console.log('\n🔍 HIGH 심각도 에러 조회:');
    const highSeverityStats = await client.callTool('error_stats', {
      hours: 1,
      severity: 'high',
      limit: 5
    });
    console.log(JSON.stringify(highSeverityStats, null, 2));

    // 5. 에러 해결 테스트 (첫 번째 에러 해결)
    if (afterErrorStats.stats && afterErrorStats.stats.filteredErrors && afterErrorStats.stats.filteredErrors.length > 0) {
      const firstError = afterErrorStats.stats.filteredErrors[0];
      console.log(`\n🔧 에러 해결 테스트: ${firstError.id}`);
      
      const resolveResult = await client.callTool('resolve_error', {
        errorId: firstError.id,
        resolvedBy: 'test_user',
        reason: '테스트용 에러 해결'
      });
      console.log('해결 결과:', JSON.stringify(resolveResult, null, 2));

      // 6. 해결 후 통계 확인
      console.log('\n📊 에러 해결 후 통계:');
      const afterResolveStats = await client.callTool('error_stats', {
        hours: 1,
        includeResolved: true,
        limit: 10
      });
      console.log(JSON.stringify(afterResolveStats, null, 2));
    }

    // 7. 활성 알림 확인
    console.log('\n🚨 활성 알림 확인:');
    const alertStats = await client.callTool('error_stats', { hours: 1 });
    if (alertStats.alerts && alertStats.alerts.length > 0) {
      console.log('활성 알림:', JSON.stringify(alertStats.alerts, null, 2));
    } else {
      console.log('활성 알림 없음');
    }

    // 8. 성능 통계와 비교
    console.log('\n📈 성능 통계와 비교:');
    const performanceStats = await client.callTool('performance_stats', {});
    console.log('성능 통계:', JSON.stringify(performanceStats, null, 2));

  } catch (error) {
    const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
    console.error('❌ 테스트 실패:', maskedError.message);
  } finally {
    if (client) {
      await client.disconnect();
      console.log('🔌 MCP 클라이언트 연결 해제');
    }
  }

  console.log('\n🎉 에러 로깅 시스템 테스트 완료');
}

// 직접 실행
if (import.meta.url === `file://${process.argv[1]}`) {
  testErrorLogging().catch(console.error);
}

export { testErrorLogging };
