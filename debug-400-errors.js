import axios from 'axios';

async function test400Errors() {
  try {
    console.log('🔍 400 에러 디버깅 테스트 시작');
    
    // 1. remember API 테스트
    console.log('\n🔍 1. remember API 테스트');
    const rememberResponse = await axios.post('http://localhost:3000/tools/remember', {
      content: '400 에러 테스트용 기억입니다',
      type: 'episodic',
      importance: 0.5
    });
    console.log('✅ remember 성공:', rememberResponse.data);
    const memoryId = rememberResponse.data.result.memory_id;

    // 2. pin API 테스트 (고급 기능)
    console.log('\n🔍 2. pin API 테스트');
    try {
      const pinResponse = await axios.post('http://localhost:3000/tools/pin', {
        id: memoryId
      });
      console.log('✅ pin 성공:', pinResponse.data);
    } catch (error) {
      console.log('❌ pin 실패:', error.response?.status, error.response?.data);
    }

    // 3. unpin API 테스트 (고급 기능)
    console.log('\n🔍 3. unpin API 테스트');
    try {
      const unpinResponse = await axios.post('http://localhost:3000/tools/unpin', {
        id: memoryId
      });
      console.log('✅ unpin 성공:', unpinResponse.data);
    } catch (error) {
      console.log('❌ unpin 실패:', error.response?.status, error.response?.data);
    }

    // 4. forget API 테스트 (CRUD)
    console.log('\n🔍 4. forget API 테스트');
    try {
      const forgetResponse = await axios.post('http://localhost:3000/tools/forget', {
        id: memoryId
      });
      console.log('✅ forget 성공:', forgetResponse.data);
    } catch (error) {
      console.log('❌ forget 실패:', error.response?.status, error.response?.data);
    }

    // 5. recall with filters 테스트 (검색 기능)
    console.log('\n🔍 5. recall with filters 테스트');
    try {
      const recallResponse = await axios.post('http://localhost:3000/tools/recall', {
        query: '테스트',
        filters: { type: ['episodic'] },
        limit: 5
      });
      console.log('✅ recall with filters 성공:', recallResponse.data);
    } catch (error) {
      console.log('❌ recall with filters 실패:', error.response?.status, error.response?.data);
    }

  } catch (error) {
    console.log('❌ 전체 테스트 실패:', error.message);
  }
}

test400Errors();
