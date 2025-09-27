/**
 * @memento/client 기본 사용법 예제
 * 
 * 이 예제는 Memento 클라이언트 라이브러리의 기본적인 사용법을 보여줍니다.
 */

import { MementoClient, MemoryManager, ContextInjector } from '@memento/client';

async function basicUsageExample() {
  console.log('🚀 Memento 클라이언트 기본 사용법 예제\n');

  // 1. 클라이언트 생성 및 연결
  const client = new MementoClient({
    serverUrl: 'http://localhost:8080',
    apiKey: 'your-api-key', // M2+에서 사용
    logLevel: 'info'
  });

  try {
    await client.connect();
    console.log('✅ 서버에 연결되었습니다\n');

    // 2. 기억 저장
    console.log('📝 기억 저장 중...');
    const memory1 = await client.remember({
      content: 'React Hook에 대해 학습했다. useState와 useEffect의 차이점을 이해했다.',
      type: 'episodic',
      importance: 0.8,
      tags: ['react', 'frontend', 'learning'],
      source: 'tutorial'
    });
    console.log(`저장된 기억 ID: ${memory1.memory_id}\n`);

    const memory2 = await client.remember({
      content: 'TypeScript 인터페이스는 객체의 구조를 정의하는 방법이다.',
      type: 'semantic',
      importance: 0.9,
      tags: ['typescript', 'programming', 'concept'],
      source: 'documentation'
    });
    console.log(`저장된 기억 ID: ${memory2.memory_id}\n`);

    // 3. 기억 검색
    console.log('🔍 기억 검색 중...');
    const searchResults = await client.recall('React Hook', {
      limit: 5
    });
    
    console.log(`검색 결과 (${searchResults.total_count}개):`);
    searchResults.items.forEach((item, index) => {
      console.log(`  ${index + 1}. [${item.type}] ${item.content.substring(0, 50)}...`);
      console.log(`     점수: ${item.score?.toFixed(3)}, 중요도: ${item.importance}`);
    });
    console.log('');

    // 4. 하이브리드 검색
    console.log('🔬 하이브리드 검색 중...');
    const hybridResults = await client.hybridSearch({
      query: '프로그래밍 개념',
      vectorWeight: 0.7,
      textWeight: 0.3,
      limit: 3
    });
    
    console.log(`하이브리드 검색 결과 (${hybridResults.total_count}개):`);
    hybridResults.items.forEach((item, index) => {
      console.log(`  ${index + 1}. [${item.type}] ${item.content.substring(0, 50)}...`);
      console.log(`     텍스트 점수: ${item.textScore.toFixed(3)}, 벡터 점수: ${item.vectorScore.toFixed(3)}`);
      console.log(`     최종 점수: ${item.finalScore.toFixed(3)}`);
    });
    console.log('');

    // 5. 기억 고정
    console.log('📌 기억 고정 중...');
    await client.pin(memory1.memory_id);
    console.log(`기억 ${memory1.memory_id}가 고정되었습니다\n`);

    // 6. 컨텍스트 주입
    console.log('💭 컨텍스트 주입 중...');
    const injector = new ContextInjector(client);
    const context = await injector.inject('React 개발 질문', {
      tokenBudget: 500,
      contextType: 'conversation'
    });
    
    console.log('주입된 컨텍스트:');
    console.log(context.content);
    console.log('');

    // 7. 기억 통계
    console.log('📊 기억 통계 조회 중...');
    const manager = new MemoryManager(client);
    const stats = await manager.getStats();
    
    console.log('기억 통계:');
    console.log(`  총 기억 수: ${stats.total}`);
    console.log(`  타입별 분포:`);
    Object.entries(stats.byType).forEach(([type, count]) => {
      console.log(`    ${type}: ${count}개`);
    });
    console.log(`  고정된 기억: ${stats.pinned}개`);
    console.log(`  최근 기억: ${stats.recent}개`);
    console.log('');

  } catch (error) {
    console.error('❌ 오류 발생:', error);
  } finally {
    // 8. 연결 해제
    await client.disconnect();
    console.log('🔌 연결이 해제되었습니다');
  }
}

// 예제 실행
if (require.main === module) {
  basicUsageExample().catch(console.error);
}

export { basicUsageExample };
