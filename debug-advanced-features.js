import axios from 'axios';

async function testAdvancedFeatures() {
  try {
    console.log('🔍 고급 기능 400 에러 디버깅 테스트 시작');
    
    // 1. remember API로 테스트 기억 생성
    console.log('\n🔍 1. 테스트 기억 생성');
    const rememberResponse = await axios.post('http://localhost:3000/tools/remember', {
      content: '고급 기능 테스트용 기억입니다',
      type: 'episodic',
      importance: 0.5,
      tags: ['test', 'advanced']
    });
    console.log('✅ remember 성공:', rememberResponse.data);
    const memoryId = rememberResponse.data.result.memory_id;

    // 2. recall API로 모든 기억 검색 (통계용)
    console.log('\n🔍 2. 모든 기억 검색 (통계용)');
    try {
      const recallResponse = await axios.post('http://localhost:3000/tools/recall', {
        query: '*',
        limit: 1000
      });
      console.log('✅ recall 성공:', recallResponse.data);
      console.log(`검색 결과: ${recallResponse.data.result.items.length}개`);
    } catch (error) {
      console.log('❌ recall 실패:', error.response?.status, error.response?.data);
    }

    // 3. recall API로 최근 기억 검색
    console.log('\n🔍 3. 최근 기억 검색');
    try {
      const recentResponse = await axios.post('http://localhost:3000/tools/recall', {
        query: '*',
        filters: {
          time_from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
        },
        limit: 1000
      });
      console.log('✅ 최근 기억 검색 성공:', recentResponse.data);
      console.log(`최근 기억: ${recentResponse.data.result.items.length}개`);
    } catch (error) {
      console.log('❌ 최근 기억 검색 실패:', error.response?.status, error.response?.data);
    }

  } catch (error) {
    console.log('❌ 전체 테스트 실패:', error.message);
  }
}

testAdvancedFeatures();
