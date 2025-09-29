/**
 * Docker 환경에서 간단한 테스트
 */

import http from 'http';

async function testDockerServer() {
  console.log('🐳 Docker 환경에서 Memento 서버 테스트');
  
  try {
    // 1. 헬스 체크
    console.log('\n1️⃣ 헬스 체크');
    const healthResponse = await makeRequest('GET', '/health');
    console.log('✅ 헬스 체크 성공:', healthResponse);
    
    // 2. 메모리 저장
    console.log('\n2️⃣ 메모리 저장');
    const rememberData = {
      content: "Docker 환경에서 테스트하는 메모리입니다.",
      type: "episodic",
      tags: ["docker", "test"],
      importance: 0.8
    };
    
    const rememberResponse = await makeRequest('POST', '/api/remember', rememberData);
    console.log('✅ 메모리 저장 성공:', rememberResponse);
    
    // 3. 메모리 검색
    console.log('\n3️⃣ 메모리 검색');
    const recallData = {
      query: "Docker",
      limit: 5
    };
    
    const recallResponse = await makeRequest('POST', '/api/recall', recallData);
    console.log('✅ 메모리 검색 성공:', recallResponse);
    
    // 4. 검색 결과 출력
    if (recallResponse && recallResponse.items) {
      console.log('\n📋 검색 결과:');
      recallResponse.items.forEach((item, index) => {
        console.log(`   ${index + 1}. [${item.type}] ${item.content.substring(0, 50)}... (점수: ${item.score || 'N/A'})`);
      });
    }
    
  } catch (error) {
    console.error('❌ 테스트 실패:', error.message);
  }
}

function makeRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 9001,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    const req = http.request(options, (res) => {
      let body = '';
      
      res.on('data', (chunk) => {
        body += chunk;
      });
      
      res.on('end', () => {
        try {
          const response = JSON.parse(body);
          resolve(response);
        } catch (error) {
          resolve(body);
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    if (data) {
      req.write(JSON.stringify(data));
    }
    
    req.end();
  });
}

// 테스트 실행
testDockerServer().catch(console.error);
