/**
 * 성능 모니터링 기능 테스트
 * Memento MCP 서버의 성능 모니터링 도구들 테스트
 */

import { createMementoClient } from './client/index.js';

async function testPerformanceMonitoring() {
  console.log('📊 성능 모니터링 기능 테스트 시작');
  
  const client = createMementoClient();
  
  try {
    // 1. 서버 연결
    console.log('\n1️⃣ 서버 연결 중...');
    await client.connect();
    console.log('✅ Memento MCP 서버에 연결되었습니다');

    // 2. 테스트 데이터 생성
    console.log('\n2️⃣ 테스트 데이터 생성');
    const testMemories = [];
    for (let i = 0; i < 20; i++) {
      const id = await client.remember({
        content: `성능 테스트 메모리 ${i}: 다양한 타입의 메모리를 생성하여 성능을 측정합니다.`,
        type: i % 2 === 0 ? 'episodic' : 'semantic',
        tags: ['performance', 'test', `batch-${Math.floor(i / 5)}`],
        importance: 0.5 + Math.random() * 0.5,
        source: 'performance-test'
      });
      testMemories.push(id);
      console.log(`✅ 저장됨: ${id.substring(0, 20)}...`);
    }

    // 3. 성능 통계 조회
    console.log('\n3️⃣ 성능 통계 조회');
    try {
      const perfStats = await client.callTool('performance_stats', {});
      console.log('📊 성능 통계:');
      console.log(`   데이터베이스:`);
      console.log(`     총 메모리: ${perfStats.metrics?.database?.totalMemories || 0}개`);
      console.log(`     데이터베이스 크기: ${((perfStats.metrics?.database?.databaseSize || 0) / 1024 / 1024).toFixed(2)} MB`);
      console.log(`     평균 메모리 크기: ${perfStats.metrics?.database?.averageMemorySize || 0} 문자`);
      console.log(`     평균 쿼리 시간: ${perfStats.metrics?.database?.queryPerformance?.averageQueryTime?.toFixed(2) || 'N/A'}ms`);
      
      console.log(`   검색:`);
      console.log(`     총 검색: ${perfStats.metrics?.search?.totalSearches || 0}회`);
      console.log(`     평균 검색 시간: ${perfStats.metrics?.search?.averageSearchTime || 0}ms`);
      console.log(`     캐시 적중률: ${((perfStats.metrics?.search?.cacheHitRate || 0) * 100).toFixed(1)}%`);
      
      console.log(`   메모리 사용량:`);
      console.log(`     힙 사용량: ${((perfStats.metrics?.memory?.heapUsed || 0) / 1024 / 1024).toFixed(2)} MB`);
      console.log(`     RSS: ${((perfStats.metrics?.memory?.rss || 0) / 1024 / 1024).toFixed(2)} MB`);
      
      console.log(`   시스템:`);
      console.log(`     가동 시간: ${Math.floor((perfStats.metrics?.system?.uptime || 0) / 60)}분`);
      
    } catch (error) {
      console.error(`   ❌ 성능 통계 조회 실패: ${error}`);
    }

    // 4. 데이터베이스 최적화 (분석만)
    console.log('\n4️⃣ 데이터베이스 최적화 (분석)');
    try {
      const optimizeResult = await client.callTool('database_optimize', { 
        analyze: true, 
        create_indexes: false 
      });
      console.log('🔧 데이터베이스 최적화 결과:');
      console.log(`   메시지: ${optimizeResult.message}`);
      console.log(`   수행된 작업: ${optimizeResult.operations?.join(', ') || '없음'}`);
      
      if (optimizeResult.report) {
        console.log('📋 최적화 리포트:');
        console.log(optimizeResult.report);
      }
    } catch (error) {
      console.error(`   ❌ 데이터베이스 최적화 실패: ${error}`);
    }

    // 5. 검색 성능 테스트
    console.log('\n5️⃣ 검색 성능 테스트');
    const searchQueries = [
      '성능 테스트',
      '메모리',
      '데이터베이스',
      '최적화',
      '벤치마크'
    ];

    for (const query of searchQueries) {
      const startTime = process.hrtime.bigint();
      try {
        const results = await client.recall({ query, limit: 5 });
        const endTime = process.hrtime.bigint();
        const searchTime = Number(endTime - startTime) / 1_000_000;
        
        console.log(`   🔍 "${query}": ${results.length}개 결과 (${searchTime.toFixed(2)}ms)`);
      } catch (error) {
        console.error(`   ❌ 검색 실패 ("${query}"): ${error}`);
      }
    }

    // 6. 망각 통계 조회
    console.log('\n6️⃣ 망각 통계 조회');
    try {
      const forgettingStats = await client.callTool('forgetting_stats', {});
      console.log('🧠 망각 통계:');
      console.log(`   총 메모리: ${forgettingStats.stats?.totalMemories || 0}개`);
      console.log(`   망각 후보: ${forgettingStats.stats?.forgetCandidates || 0}개`);
      console.log(`   리뷰 후보: ${forgettingStats.stats?.reviewCandidates || 0}개`);
      console.log(`   평균 망각 점수: ${forgettingStats.stats?.averageForgetScore?.toFixed(3) || 'N/A'}`);
      console.log(`   메모리 분포:`, forgettingStats.stats?.memoryDistribution || {});
    } catch (error) {
      console.error(`   ❌ 망각 통계 조회 실패: ${error}`);
    }

    // 7. 메모리 정리 (드라이런)
    console.log('\n7️⃣ 메모리 정리 (드라이런)');
    try {
      const cleanupResult = await client.callTool('cleanup_memory', { dry_run: true });
      console.log('🧹 메모리 정리 분석:');
      console.log(`   모드: ${cleanupResult.mode}`);
      console.log(`   총 메모리: ${cleanupResult.stats?.totalMemories || 0}개`);
      console.log(`   망각 후보: ${cleanupResult.stats?.forgetCandidates || 0}개`);
      console.log(`   리뷰 후보: ${cleanupResult.stats?.reviewCandidates || 0}개`);
      console.log(`   평균 망각 점수: ${cleanupResult.stats?.averageForgetScore?.toFixed(3) || 'N/A'}`);
    } catch (error) {
      console.error(`   ❌ 메모리 정리 분석 실패: ${error}`);
    }

    // 8. 최종 성능 통계
    console.log('\n8️⃣ 최종 성능 통계');
    try {
      const finalStats = await client.callTool('performance_stats', {});
      console.log('📊 최종 성능 통계:');
      console.log(`   데이터베이스:`);
      console.log(`     총 메모리: ${finalStats.metrics?.database?.totalMemories || 0}개`);
      console.log(`     평균 쿼리 시간: ${finalStats.metrics?.database?.queryPerformance?.averageQueryTime?.toFixed(2) || 'N/A'}ms`);
      
      console.log(`   검색:`);
      console.log(`     총 검색: ${finalStats.metrics?.search?.totalSearches || 0}회`);
      console.log(`     평균 검색 시간: ${finalStats.metrics?.search?.averageSearchTime || 0}ms`);
      
      console.log(`   메모리 사용량:`);
      console.log(`     힙 사용량: ${((finalStats.metrics?.memory?.heapUsed || 0) / 1024 / 1024).toFixed(2)} MB`);
      
    } catch (error) {
      console.error(`   ❌ 최종 성능 통계 조회 실패: ${error}`);
    }

    console.log('\n🎉 성능 모니터링 기능 테스트 완료!');
    
  } catch (error) {
    console.error('❌ 테스트 실패:', error);
  } finally {
    await client.disconnect();
  }
}

// 테스트 실행
if (process.argv[1] && process.argv[1].endsWith('test-performance-monitoring.ts')) {
  testPerformanceMonitoring()
    .then(() => {
      console.log('✅ 성능 모니터링 테스트 완료');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ 성능 모니터링 테스트 실패:', error);
      process.exit(1);
    });
}
