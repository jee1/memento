import axios from 'axios';

async function testCRUDErrors() {
  try {
    console.log('🔍 CRUD 400 에러 디버깅 테스트 시작');
    
    // 1. remember API 테스트
    console.log('\n🔍 1. remember API 테스트');
    const rememberResponse = await axios.post('http://localhost:3000/tools/remember', {
      content: 'CRUD 테스트용 기억입니다',
      type: 'episodic',
      importance: 0.5
    });
    console.log('✅ remember 성공:', rememberResponse.data);
    const memoryId = rememberResponse.data.result.memory_id;

    // 2. forget API 테스트 (update에서 사용)
    console.log('\n🔍 2. forget API 테스트');
    try {
      const forgetResponse = await axios.post('http://localhost:3000/tools/forget', {
        id: memoryId,
        hard: false
      });
      console.log('✅ forget 성공:', forgetResponse.data);
    } catch (error) {
      console.log('❌ forget 실패:', error.response?.status, error.response?.data);
    }

    // 3. pin API 테스트 (고급 기능에서 사용)
    console.log('\n🔍 3. pin API 테스트');
    try {
      const pinResponse = await axios.post('http://localhost:3000/tools/pin', {
        id: memoryId
      });
      console.log('✅ pin 성공:', pinResponse.data);
    } catch (error) {
      console.log('❌ pin 실패:', error.response?.status, error.response?.data);
    }

    // 4. unpin API 테스트
    console.log('\n🔍 4. unpin API 테스트');
    try {
      const unpinResponse = await axios.post('http://localhost:3000/tools/unpin', {
        id: memoryId
      });
      console.log('✅ unpin 성공:', unpinResponse.data);
    } catch (error) {
      console.log('❌ unpin 실패:', error.response?.status, error.response?.data);
    }

  } catch (error) {
    console.log('❌ 전체 테스트 실패:', error.message);
  }
}

testCRUDErrors();
