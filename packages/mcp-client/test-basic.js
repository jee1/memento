/**
 * @memento/client 기본 테스트
 * 
 * 이 파일은 클라이언트 라이브러리의 기본 기능을 테스트합니다.
 */

const { MementoClient, MemoryManager, ContextInjector } = require('./dist/index.js');

async function testBasicFunctionality() {
  console.log('🧪 @memento/client 기본 테스트 시작\n');

  try {
    // 1. 클라이언트 생성
    console.log('1. 클라이언트 생성 중...');
    const client = new MementoClient({
      serverUrl: 'http://localhost:8080',
      logLevel: 'info'
    });
    console.log('✅ 클라이언트 생성 완료');

    // 2. MemoryManager 생성
    console.log('\n2. MemoryManager 생성 중...');
    const manager = new MemoryManager(client);
    console.log('✅ MemoryManager 생성 완료');

    // 3. ContextInjector 생성
    console.log('\n3. ContextInjector 생성 중...');
    const injector = new ContextInjector(client);
    console.log('✅ ContextInjector 생성 완료');

    // 4. 클라이언트 옵션 확인
    console.log('\n4. 클라이언트 옵션 확인:');
    const options = client.getOptions();
    console.log(`  서버 URL: ${options.serverUrl}`);
    console.log(`  타임아웃: ${options.timeout}ms`);
    console.log(`  재시도 횟수: ${options.retryCount}`);
    console.log(`  로그 레벨: ${options.logLevel}`);

    // 5. 타입 검증 함수 테스트
    console.log('\n5. 유틸리티 함수 테스트:');
    const { isValidMemoryType, isValidPrivacyScope, isValidImportance } = require('./dist/utils.js');
    
    console.log(`  isValidMemoryType('episodic'): ${isValidMemoryType('episodic')}`);
    console.log(`  isValidMemoryType('invalid'): ${isValidMemoryType('invalid')}`);
    console.log(`  isValidPrivacyScope('private'): ${isValidPrivacyScope('private')}`);
    console.log(`  isValidImportance(0.5): ${isValidImportance(0.5)}`);
    console.log(`  isValidImportance(1.5): ${isValidImportance(1.5)}`);

    console.log('\n✅ 모든 기본 테스트 통과!');
    console.log('\n📝 참고: 실제 서버 연결 테스트를 위해서는 Memento MCP 서버가 실행 중이어야 합니다.');
    console.log('   서버 실행: npm run dev:http');
    console.log('   그 후 연결 테스트를 진행하세요.');

  } catch (error) {
    console.error('❌ 테스트 실패:', error.message);
    console.error('스택 트레이스:', error.stack);
  }
}

// 테스트 실행
if (require.main === module) {
  testBasicFunctionality().catch(console.error);
}

module.exports = { testBasicFunctionality };
