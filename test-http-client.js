/**
 * HTTP/WebSocket MCP 서버 테스트 클라이언트
 */

const baseUrl = 'http://localhost:3000';

async function testHTTPClient() {
  console.log('🧪 HTTP/WebSocket MCP 서버 테스트 시작...\n');
  
  try {
    // 1. 헬스 체크
    console.log('1️⃣ 헬스 체크...');
    const healthResponse = await fetch(`${baseUrl}/health`);
    const health = await healthResponse.json();
    console.log('✅ 서버 상태:', health);
    console.log('');
    
    // 2. 도구 목록 조회
    console.log('2️⃣ 도구 목록 조회...');
    const toolsResponse = await fetch(`${baseUrl}/tools`);
    const tools = await toolsResponse.json();
    console.log('✅ 사용 가능한 도구:', tools.tools.map(t => t.name).join(', '));
    console.log('');
    
    // 3. 기억 저장
    console.log('3️⃣ 기억 저장...');
    const rememberResponse = await fetch(`${baseUrl}/tools/remember`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: 'HTTP/WebSocket MCP 서버 테스트 완료',
        type: 'episodic',
        importance: 0.8,
        tags: ['test', 'http', 'websocket']
      })
    });
    const rememberResult = await rememberResponse.json();
    console.log('✅ 기억 저장 결과:', rememberResult);
    const memoryId = rememberResult.result.memory_id;
    console.log('');
    
    // 4. 기억 검색
    console.log('4️⃣ 기억 검색...');
    const recallResponse = await fetch(`${baseUrl}/tools/recall`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'HTTP',
        limit: 5
      })
    });
    const recallResult = await recallResponse.json();
    console.log('✅ 검색 결과:', recallResult.result.items.length, '개 항목 발견');
    recallResult.result.items.forEach((item, index) => {
      console.log(`   ${index + 1}. ${item.content} (${item.type})`);
    });
    console.log('');
    
    // 5. 기억 고정
    console.log('5️⃣ 기억 고정...');
    const pinResponse = await fetch(`${baseUrl}/tools/pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: memoryId })
    });
    const pinResult = await pinResponse.json();
    console.log('✅ 고정 결과:', pinResult);
    console.log('');
    
    // 6. 고정된 기억 검색
    console.log('6️⃣ 고정된 기억 검색...');
    const pinnedRecallResponse = await fetch(`${baseUrl}/tools/recall`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: 'test',
        filters: { pinned: true },
        limit: 5
      })
    });
    const pinnedRecallResult = await pinnedRecallResponse.json();
    console.log('✅ 고정된 기억 검색 결과:', pinnedRecallResult.result.items.length, '개 항목 발견');
    console.log('');
    
    // 7. 기억 고정 해제
    console.log('7️⃣ 기억 고정 해제...');
    const unpinResponse = await fetch(`${baseUrl}/tools/unpin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: memoryId })
    });
    const unpinResult = await unpinResponse.json();
    console.log('✅ 고정 해제 결과:', unpinResult);
    console.log('');
    
    // 8. 기억 삭제 (소프트 삭제)
    console.log('8️⃣ 기억 삭제 (소프트)...');
    const forgetResponse = await fetch(`${baseUrl}/tools/forget`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        id: memoryId,
        hard: false
      })
    });
    const forgetResult = await forgetResponse.json();
    console.log('✅ 삭제 결과:', forgetResult);
    console.log('');
    
    console.log('🎉 모든 테스트 완료!');
    
  } catch (error) {
    console.error('❌ 테스트 실패:', error.message);
    if (error.response) {
      const errorText = await error.response.text();
      console.error('응답 내용:', errorText);
    }
  }
}

// Node.js 환경에서 실행
testHTTPClient();
