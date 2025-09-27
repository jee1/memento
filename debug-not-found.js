import { MementoClient, MemoryManager } from './packages/mcp-client/dist/index.js';

async function testNotFound() {
  try {
    console.log('🔍 존재하지 않는 기억 조회 테스트');
    
    const client = new MementoClient({
      serverUrl: 'http://localhost:3000'
    });
    
    await client.connect();
    const manager = new MemoryManager(client);
    
    // 존재하지 않는 기억 조회
    const result = await manager.get('non-existent-id');
    console.log('결과:', result);
    console.log('null인가?', result === null);
    
    await client.disconnect();
    
  } catch (error) {
    console.log('❌ 테스트 실패:', error.message);
  }
}

testNotFound();
