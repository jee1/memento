import axios from 'axios';

async function testAPI() {
  try {
    console.log('🔍 1. 헬스 체크 테스트');
    const healthResponse = await axios.get('http://localhost:3000/health');
    console.log('✅ 헬스 체크 성공:', healthResponse.data);

    console.log('\n🔍 2. remember API 테스트');
    const rememberResponse = await axios.post('http://localhost:3000/tools/remember', {
      content: '테스트 기억입니다',
      type: 'episodic',
      importance: 0.5
    });
    console.log('✅ remember 성공:', rememberResponse.data);
    const memoryId = rememberResponse.data.result.memory_id;

    console.log('\n🔍 3. recall API 테스트');
    const recallResponse = await axios.post('http://localhost:3000/tools/recall', {
      query: '테스트',
      limit: 10
    });
    console.log('✅ recall 성공:', JSON.stringify(recallResponse.data, null, 2));
    
    console.log('\n🔍 3-1. recall API with filters 테스트');
    const recallWithFiltersResponse = await axios.post('http://localhost:3000/tools/recall', {
      query: 'memory',
      filters: { id: [memoryId] },
      limit: 1
    });
    console.log('✅ recall with filters 성공:', JSON.stringify(recallWithFiltersResponse.data, null, 2));
    
    console.log('\n🔍 3-2. recall API with specific ID 테스트');
    const recallWithSpecificIdResponse = await axios.post('http://localhost:3000/tools/recall', {
      query: ' ',
      filters: { id: [memoryId] },
      limit: 1
    });
    console.log('✅ recall with specific ID 성공:', JSON.stringify(recallWithSpecificIdResponse.data, null, 2));

    console.log('\n🔍 4. forget API 테스트');
    const forgetResponse = await axios.post('http://localhost:3000/tools/forget', {
      id: memoryId
    });
    console.log('✅ forget 성공:', forgetResponse.data);

  } catch (error) {
    console.error('❌ API 테스트 실패:', error.response?.data || error.message);
    if (error.response) {
      console.error('상태 코드:', error.response.status);
      console.error('응답 데이터:', error.response.data);
    }
  }
}

testAPI();
