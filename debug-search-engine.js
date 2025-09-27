import axios from 'axios';

async function testSearchEngine() {
  try {
    console.log('🔍 SearchEngine 직접 테스트');
    
    // 1. remember API로 기억 생성
    console.log('\n🔍 1. 기억 생성');
    const rememberResponse = await axios.post('http://localhost:3000/tools/remember', {
      content: 'SearchEngine 테스트용 기억입니다',
      type: 'episodic',
      importance: 0.5
    });
    console.log('✅ remember 성공:', rememberResponse.data);
    const memoryId = rememberResponse.data.result.memory_id;

    // 2. recall API로 검색 (하이브리드 검색)
    console.log('\n🔍 2. 하이브리드 검색');
    try {
      const recallResponse = await axios.post('http://localhost:3000/tools/recall', {
        query: 'SearchEngine',
        limit: 5
      });
      console.log('✅ recall 성공');
      console.log('응답 구조:', JSON.stringify(recallResponse.data, null, 2));
    } catch (error) {
      console.log('❌ recall 실패:', error.response?.status, error.response?.data);
    }

  } catch (error) {
    console.log('❌ 전체 테스트 실패:', error.message);
  }
}

testSearchEngine();
