/**
 * @memento/client 마이그레이션 가이드
 * 
 * 이 예제는 기존 내부 클라이언트에서 새로운 @memento/client로 마이그레이션하는 방법을 보여줍니다.
 */

import { MementoClient, MemoryManager, ContextInjector } from '@memento/client';

/**
 * 기존 내부 클라이언트 사용법 (참고용)
 */
class LegacyClient {
  // 기존 내부 클라이언트의 사용법
  async connect(): Promise<void> {
    // stdio 연결
  }
  
  async callTool(tool: string, params: any): Promise<any> {
    // MCP 도구 호출
  }
}

/**
 * 새로운 @memento/client 사용법
 */
class ModernClient {
  private client: MementoClient;
  private memoryManager: MemoryManager;
  private injector: ContextInjector;

  constructor(serverUrl: string, apiKey?: string) {
    this.client = new MementoClient({
      serverUrl,
      apiKey,
      logLevel: 'info'
    });
    
    this.memoryManager = new MemoryManager(this.client);
    this.injector = new ContextInjector(this.client);
  }

  async connect(): Promise<void> {
    await this.client.connect();
  }

  // 기존 callTool 방식에서 새로운 메서드 방식으로 마이그레이션
  async remember(content: string, options?: any): Promise<string> {
    // 기존: await legacyClient.callTool('remember', { content, ...options })
    // 새로운: await memoryManager.create({ content, ...options })
    
    const result = await this.memoryManager.create({
      content,
      type: options?.type || 'episodic',
      importance: options?.importance || 0.5,
      tags: options?.tags || [],
      source: options?.source
    });
    
    return result.id;
  }

  async recall(query: string, options?: any): Promise<any[]> {
    // 기존: await legacyClient.callTool('recall', { query, ...options })
    // 새로운: await memoryManager.search(query, options)
    
    const results = await this.memoryManager.search(query, {
      filters: options?.filters,
      limit: options?.limit || 10
    });
    
    return results.items;
  }

  async pin(memoryId: string): Promise<void> {
    // 기존: await legacyClient.callTool('pin', { memory_id: memoryId })
    // 새로운: await memoryManager.pin(memoryId)
    
    await this.memoryManager.pin(memoryId);
  }

  async unpin(memoryId: string): Promise<void> {
    // 기존: await legacyClient.callTool('unpin', { memory_id: memoryId })
    // 새로운: await memoryManager.unpin(memoryId)
    
    await this.memoryManager.unpin(memoryId);
  }

  async forget(memoryId: string, hard: boolean = false): Promise<void> {
    // 기존: await legacyClient.callTool('forget', { memory_id: memoryId, hard })
    // 새로운: await memoryManager.delete(memoryId, hard)
    
    await this.memoryManager.delete(memoryId, hard);
  }
}

/**
 * 마이그레이션 예제 함수
 */
async function migrationExample() {
  console.log('🔄 Memento 클라이언트 마이그레이션 예제\n');

  // 1. 기존 방식 (참고용)
  console.log('📜 기존 내부 클라이언트 사용법:');
  console.log(`
  // 기존 방식
  const legacyClient = new LegacyClient();
  await legacyClient.connect();
  
  // 기억 저장
  const memoryId = await legacyClient.callTool('remember', {
    content: 'React Hook 학습',
    type: 'episodic',
    importance: 0.8
  });
  
  // 기억 검색
  const results = await legacyClient.callTool('recall', {
    query: 'React Hook',
    limit: 10
  });
  
  // 기억 고정
  await legacyClient.callTool('pin', { memory_id: memoryId });
  `);

  // 2. 새로운 방식
  console.log('\n✨ 새로운 @memento/client 사용법:');
  
  const modernClient = new ModernClient('http://localhost:8080', 'your-api-key');
  
  try {
    await modernClient.connect();
    console.log('✅ 새로운 클라이언트에 연결되었습니다');

    // 기억 저장
    const memoryId = await modernClient.remember('React Hook 학습', {
      type: 'episodic',
      importance: 0.8,
      tags: ['react', 'frontend']
    });
    console.log(`📝 기억 저장 완료: ${memoryId}`);

    // 기억 검색
    const results = await modernClient.recall('React Hook', { limit: 10 });
    console.log(`🔍 검색 결과: ${results.length}개`);

    // 기억 고정
    await modernClient.pin(memoryId);
    console.log('📌 기억 고정 완료');

    // 3. 새로운 기능들
    console.log('\n🚀 새로운 기능들:');
    
    // MemoryManager 사용
    const manager = new MemoryManager(modernClient.client);
    
    // 태그로 검색
    const tagResults = await manager.searchByTags(['react']);
    console.log(`🏷️ 태그 검색 결과: ${tagResults.total_count}개`);
    
    // 최근 기억 검색
    const recentResults = await manager.searchRecent(7);
    console.log(`⏰ 최근 기억: ${recentResults.total_count}개`);
    
    // 통계 조회
    const stats = await manager.getStats();
    console.log(`📊 총 기억 수: ${stats.total}개`);
    
    // ContextInjector 사용
    const injector = new ContextInjector(modernClient.client);
    
    // 컨텍스트 주입
    const context = await injector.inject('React 개발 질문', {
      tokenBudget: 1000,
      contextType: 'conversation'
    });
    console.log('💭 컨텍스트 주입 완료');
    
    // 4. 마이그레이션 체크리스트
    console.log('\n📋 마이그레이션 체크리스트:');
    console.log('✅ 기존 callTool 방식에서 새로운 메서드 방식으로 변경');
    console.log('✅ MementoClient, MemoryManager, ContextInjector 클래스 사용');
    console.log('✅ 타입 안전성 확보 (TypeScript)');
    console.log('✅ 에러 처리 개선');
    console.log('✅ 이벤트 리스닝 지원');
    console.log('✅ 고급 검색 기능 활용');
    console.log('✅ 컨텍스트 주입 기능 활용');

    // 5. 성능 비교
    console.log('\n⚡ 성능 개선 사항:');
    console.log('• HTTP/WebSocket 통신으로 성능 향상');
    console.log('• 자동 재시도 로직으로 안정성 향상');
    console.log('• 캐싱 및 최적화로 응답 속도 향상');
    console.log('• 배치 작업 지원으로 처리량 향상');

  } catch (error) {
    console.error('❌ 마이그레이션 중 오류:', error);
  } finally {
    await modernClient.client.disconnect();
    console.log('\n🔌 연결이 해제되었습니다');
  }
}

/**
 * 단계별 마이그레이션 가이드
 */
function migrationSteps() {
  console.log('\n📖 단계별 마이그레이션 가이드:\n');
  
  console.log('1단계: 의존성 설치');
  console.log('  npm install @memento/client');
  console.log('');
  
  console.log('2단계: 클라이언트 초기화 변경');
  console.log('  // 기존');
  console.log('  const client = new LegacyClient();');
  console.log('  // 새로운');
  console.log('  const client = new MementoClient({ serverUrl: "http://localhost:8080" });');
  console.log('');
  
  console.log('3단계: API 호출 방식 변경');
  console.log('  // 기존');
  console.log('  await client.callTool("remember", { content: "..." });');
  console.log('  // 새로운');
  console.log('  const manager = new MemoryManager(client);');
  console.log('  await manager.create({ content: "..." });');
  console.log('');
  
  console.log('4단계: 새로운 기능 활용');
  console.log('  // 컨텍스트 주입');
  console.log('  const injector = new ContextInjector(client);');
  console.log('  const context = await injector.inject("질문", { tokenBudget: 1000 });');
  console.log('');
  
  console.log('5단계: 테스트 및 검증');
  console.log('  // 기존 기능이 정상 작동하는지 확인');
  console.log('  // 새로운 기능을 활용하여 개선');
  console.log('');
}

/**
 * 호환성 가이드
 */
function compatibilityGuide() {
  console.log('\n🔧 호환성 가이드:\n');
  
  console.log('M1 (로컬 SQLite):');
  console.log('  • serverUrl: "http://localhost:8080"');
  console.log('  • apiKey: 없음');
  console.log('  • 인증: 없음');
  console.log('');
  
  console.log('M2 (팀 협업):');
  console.log('  • serverUrl: "http://your-server:8080"');
  console.log('  • apiKey: "team-secret-key"');
  console.log('  • 인증: API Key');
  console.log('');
  
  console.log('M3+ (조직):');
  console.log('  • serverUrl: "https://your-org.com/memento"');
  console.log('  • apiKey: "jwt-token"');
  console.log('  • 인증: JWT');
  console.log('');
}

// 예제 실행
if (require.main === module) {
  migrationExample()
    .then(() => {
      migrationSteps();
      compatibilityGuide();
    })
    .catch(console.error);
}

export { 
  LegacyClient, 
  ModernClient, 
  migrationExample, 
  migrationSteps, 
  compatibilityGuide 
};
