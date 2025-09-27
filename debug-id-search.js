import axios from 'axios';

async function testIdSearch() {
  try {
    console.log('🔍 ID 검색 디버깅 테스트 시작');
    
    // 1. remember API로 기억 생성
    console.log('\n🔍 1. 기억 생성');
    const rememberResponse = await axios.post('http://localhost:3000/tools/remember', {
      content: 'ID 검색 테스트용 기억입니다',
      type: 'episodic',
      importance: 0.5
    });
    console.log('✅ remember 성공:', rememberResponse.data);
    const memoryId = rememberResponse.data.result.memory_id;
    console.log('생성된 ID:', memoryId);

    // 2. recall API로 해당 ID 검색
    console.log('\n🔍 2. ID로 검색');
    try {
      const recallResponse = await axios.post('http://localhost:3000/tools/recall', {
        query: 'memory',
        filters: { id: [memoryId] },
        limit: 1
      });
      console.log('✅ recall 성공:', recallResponse.data);
      console.log('검색 결과 개수:', recallResponse.data.result.items.length);
      if (recallResponse.data.result.items.length > 0) {
        console.log('첫 번째 결과 ID:', recallResponse.data.result.items[0].id);
        console.log('ID 매칭:', recallResponse.data.result.items[0].id === memoryId);
      }
    } catch (error) {
      console.log('❌ recall 실패:', error.response?.status, error.response?.data);
    }

    // 3. 모든 기억 검색해서 해당 ID가 있는지 확인
    console.log('\n🔍 3. 모든 기억 검색');
    try {
      const allResponse = await axios.post('http://localhost:3000/tools/recall', {
        query: '*',
        limit: 50
      });
      console.log('✅ 모든 기억 검색 성공');
      console.log('전체 기억 개수:', allResponse.data.result.items.length);
      
      const foundMemory = allResponse.data.result.items.find(m => m.id === memoryId);
      console.log('해당 ID 기억 찾음:', !!foundMemory);
      if (foundMemory) {
        console.log('찾은 기억 내용:', foundMemory.content.substring(0, 50) + '...');
      }
    } catch (error) {
      console.log('❌ 모든 기억 검색 실패:', error.response?.status, error.response?.data);
    }

  } catch (error) {
    console.log('❌ 전체 테스트 실패:', error.message);
  }
}

testIdSearch();
