/* eslint-disable no-console */
/**
 * HTTP 서버 v2 디버그 테스트
 */

console.log('🚀 HTTP 서버 v2 디버그 테스트 시작');

async function testFetch() {
  try {
    console.log('📡 HTTP 요청 테스트 중...');
    
    const response = await fetch('http://localhost:9001/health');
    console.log('📊 응답 상태:', response.status);
    
    const data = await response.json();
    console.log('📋 응답 데이터:', data);
    
    if (response.ok && data.status === 'healthy') {
      console.log('✅ HTTP 요청 성공');
    } else {
      console.log('❌ HTTP 요청 실패');
    }
  } catch (error) {
    console.error('❌ HTTP 요청 에러:', error);
  }
}

// 테스트 실행
testFetch().then(() => {
  console.log('🏁 테스트 완료');
}).catch(console.error);
