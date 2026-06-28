/**
 * Docker 환경에서 Memento 서버 테스트
 */

const { spawn } = require('child_process');

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

async function testDockerServer() {
  console.log('🐳 Docker 환경에서 Memento 서버 테스트 시작');
  
  try {
    // 1. Docker 컨테이너 빌드 및 실행
    console.log('\n1️⃣ Docker 컨테이너 빌드 중...');
    const buildProcess = spawn('docker-compose', ['build'], { stdio: 'inherit' });
    
    await new Promise((resolve, reject) => {
      buildProcess.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Docker 빌드 완료');
          resolve();
        } else {
          reject(new Error(`Docker 빌드 실패: ${code}`));
        }
      });
    });
    
    // 2. 컨테이너 시작
    console.log('\n2️⃣ Docker 컨테이너 시작 중...');
    const upProcess = spawn('docker-compose', ['up', '-d'], { stdio: 'inherit' });
    
    await new Promise((resolve, reject) => {
      upProcess.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Docker 컨테이너 시작 완료');
          resolve();
        } else {
          reject(new Error(`Docker 컨테이너 시작 실패: ${code}`));
        }
      });
    });
    
    // 3. 서버가 준비될 때까지 대기
    console.log('\n3️⃣ 서버 준비 대기 중...');
    await new Promise(resolve => setTimeout(resolve, 10000));
    
    // 4. HTTP 서버 테스트
    console.log('\n4️⃣ HTTP 서버 테스트');
    try {
      const health = await fetchJson('http://localhost:9001/health');
      console.log('✅ HTTP 서버 응답:', health);
    } catch (error) {
      console.log('⚠️  HTTP 서버 테스트 실패:', error.message);
    }
    
    // 5. MCP 서버 테스트 (HTTP를 통해)
    console.log('\n5️⃣ MCP 서버 테스트');
    try {
      const testData = {
        content: "Docker 환경에서 테스트하는 메모리입니다.",
        type: "episodic",
        tags: ["docker", "test"],
        importance: 0.8
      };
      
      const rememberResult = await fetchJson('http://localhost:9001/api/remember', {
        method: 'POST',
        body: JSON.stringify(testData),
      });
      console.log('✅ 메모리 저장 성공:', rememberResult);
      
      const recallResult = await fetchJson('http://localhost:9001/api/recall', {
        method: 'POST',
        body: JSON.stringify({
          query: "Docker",
          limit: 5
        }),
      });
      console.log('✅ 메모리 검색 성공:', recallResult);
      
    } catch (error) {
      console.log('⚠️  MCP 서버 테스트 실패:', error.message);
    }
    
    // 6. 컨테이너 로그 확인
    console.log('\n6️⃣ 컨테이너 로그 확인');
    const logsProcess = spawn('docker-compose', ['logs', '--tail=20'], { stdio: 'inherit' });
    
    await new Promise((resolve) => {
      logsProcess.on('close', () => resolve());
    });
    
  } catch (error) {
    console.error('❌ 테스트 실패:', error.message);
  } finally {
    // 7. 정리
    console.log('\n7️⃣ 컨테이너 정리');
    const downProcess = spawn('docker-compose', ['down'], { stdio: 'inherit' });
    
    await new Promise((resolve) => {
      downProcess.on('close', () => {
        console.log('✅ 정리 완료');
        resolve();
      });
    });
  }
}

// 테스트 실행
testDockerServer().catch(console.error);
