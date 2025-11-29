/**
 * 앵커 시스템 통합 테스트
 * 전체 워크플로우, 멀티 클라이언트, Fallback 메커니즘 검증
 */

import { initializeServices, type ServerServices } from '../server/bootstrap.js';
import { executeTool, getToolRegistry } from '../tools/index.js';
import type { ToolContext } from '../tools/types.js';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../shared/utils/database.js';

/**
 * ToolContext 생성 헬퍼 함수
 */
function createToolContext(db: Database.Database, services: ServerServices): ToolContext {
  return {
    db,
    services: {
      searchEngine: services.searchEngine,
      hybridSearchEngine: services.hybridSearchEngine,
      embeddingService: services.embeddingService,
      forgettingPolicyService: services.forgettingPolicyService,
      performanceMonitor: services.performanceMonitor,
      databaseOptimizer: services.databaseOptimizer,
      errorLoggingService: services.errorLoggingService,
      performanceAlertService: services.performanceAlertService,
      consolidationScoreService: services.consolidationScoreService,
      writeCoalescingManager: services.writeCoalescingManager,
      anchorManager: services.anchorManager
    }
  };
}

/**
 * 앵커 테이블 생성
 */
function createAnchorTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS anchor (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      slot TEXT CHECK (slot IN ('A', 'B', 'C')) NOT NULL,
      memory_id TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE SET NULL,
      UNIQUE(agent_id, slot)
    );

    CREATE INDEX IF NOT EXISTS idx_anchor_agent_slot ON anchor(agent_id, slot);
    CREATE INDEX IF NOT EXISTS idx_anchor_memory_id ON anchor(memory_id) WHERE memory_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_anchor_agent_memory ON anchor(agent_id, memory_id) WHERE memory_id IS NOT NULL;
  `);
}

async function testAnchorSystemWorkflow() {
  console.log('🧪 앵커 시스템 통합 테스트 시작\n');
  console.log('전체 워크플로우를 검증합니다.\n');
  
  let testDb: Database.Database | null = null;
  const createdMemoryIds: string[] = [];
  
  try {
    // 1. 데이터베이스 초기화
    console.log('1️⃣ 데이터베이스 초기화');
    testDb = new Database(':memory:');
    DatabaseUtils.initializeDatabase(testDb);
    createAnchorTable(testDb);
    console.log('✅ 데이터베이스 초기화 완료\n');
    
    // 2. 부트스트랩 함수로 서비스 초기화
    console.log('2️⃣ 부트스트랩 함수로 서비스 초기화');
    const services = await initializeServices(testDb);
    const context = createToolContext(testDb, services);
    console.log('✅ 서비스 초기화 완료\n');
    
    // 3. 테스트용 메모리 생성
    console.log('3️⃣ 테스트용 메모리 생성');
    const memory1 = await executeTool('remember', {
      content: 'React Hook에 대한 설명: useState와 useEffect의 차이점',
      type: 'episodic',
      tags: ['react', 'hooks'],
      importance: 0.8
    }, context);
    const memory1Data = JSON.parse(memory1.content[0].text);
    createdMemoryIds.push(memory1Data.memory_id);
    console.log(`✅ 메모리 1 생성: ${memory1Data.memory_id}`);
    
    const memory2 = await executeTool('remember', {
      content: 'TypeScript 타입 시스템: 인터페이스와 타입 별칭',
      type: 'semantic',
      tags: ['typescript', 'types'],
      importance: 0.9
    }, context);
    const memory2Data = JSON.parse(memory2.content[0].text);
    createdMemoryIds.push(memory2Data.memory_id);
    console.log(`✅ 메모리 2 생성: ${memory2Data.memory_id}`);
    
    const memory3 = await executeTool('remember', {
      content: 'Node.js 비동기 처리: Promise와 async/await',
      type: 'procedural',
      tags: ['nodejs', 'async'],
      importance: 0.7
    }, context);
    const memory3Data = JSON.parse(memory3.content[0].text);
    createdMemoryIds.push(memory3Data.memory_id);
    console.log(`✅ 메모리 3 생성: ${memory3Data.memory_id}\n`);
    
    // 4. 앵커 설정 테스트
    console.log('4️⃣ 앵커 설정 테스트');
    const setAnchorResult = await executeTool('set_anchor', {
      memory_id: memory1Data.memory_id,
      slot: 'A',
      agent_id: 'agent1'
    }, context);
    const setAnchorData = JSON.parse(setAnchorResult.content[0].text);
    expect(setAnchorData.success).toBe(true);
    expect(setAnchorData.memory_id).toBe(memory1Data.memory_id);
    console.log(`✅ 앵커 설정 완료: agent1/A -> ${memory1Data.memory_id}\n`);
    
    // 5. 앵커 조회 테스트
    console.log('5️⃣ 앵커 조회 테스트');
    const getAnchorResult = await executeTool('get_anchor', {
      slot: 'A',
      agent_id: 'agent1'
    }, context);
    const getAnchorData = JSON.parse(getAnchorResult.content[0].text);
    expect(getAnchorData.anchor).not.toBeNull();
    expect(getAnchorData.anchor.memory_id).toBe(memory1Data.memory_id);
    console.log(`✅ 앵커 조회 완료: ${getAnchorData.anchor.memory_id}\n`);
    
    // 6. 국소 검색 테스트 (쿼리 있음)
    console.log('6️⃣ 국소 검색 테스트 (쿼리 있음)');
    const searchLocalResult = await executeTool('search_local', {
      slot: 'A',
      query: 'React',
      agent_id: 'agent1',
      limit: 10
    }, context);
    const searchLocalData = JSON.parse(searchLocalResult.content[0].text);
    expect(searchLocalData).toHaveProperty('items');
    expect(searchLocalData).toHaveProperty('local_results_count');
    expect(searchLocalData).toHaveProperty('fallback_used');
    expect(searchLocalData).toHaveProperty('anchor_info');
    console.log(`✅ 국소 검색 완료: ${searchLocalData.items.length}개 결과 (local: ${searchLocalData.local_results_count}, fallback: ${searchLocalData.fallback_used})\n`);
    
    // 7. 국소 검색 테스트 (쿼리 없음 - 앵커 기반 리콜)
    console.log('7️⃣ 국소 검색 테스트 (쿼리 없음 - 앵커 기반 리콜)');
    const searchLocalNoQueryResult = await executeTool('search_local', {
      slot: 'A',
      agent_id: 'agent1',
      limit: 10
    }, context);
    const searchLocalNoQueryData = JSON.parse(searchLocalNoQueryResult.content[0].text);
    expect(searchLocalNoQueryData).toHaveProperty('items');
    expect(searchLocalNoQueryData.fallback_used).toBe(false); // query 없으면 fallback 없음
    console.log(`✅ 앵커 기반 리콜 완료: ${searchLocalNoQueryData.items.length}개 결과\n`);
    
    // 8. 앵커 제거 테스트
    console.log('8️⃣ 앵커 제거 테스트');
    const clearAnchorResult = await executeTool('clear_anchor', {
      slot: 'A',
      agent_id: 'agent1'
    }, context);
    const clearAnchorData = JSON.parse(clearAnchorResult.content[0].text);
    expect(clearAnchorData.success).toBe(true);
    console.log('✅ 앵커 제거 완료\n');
    
    // 9. 앵커 복원 테스트
    console.log('9️⃣ 앵커 복원 테스트');
    // 다시 앵커 설정
    await executeTool('set_anchor', {
      memory_id: memory2Data.memory_id,
      slot: 'B',
      agent_id: 'agent1'
    }, context);
    
    // 앵커 복원
    const restoreAnchorsResult = await executeTool('restore_anchors', {
      agent_id: 'agent1'
    }, context);
    const restoreAnchorsData = JSON.parse(restoreAnchorsResult.content[0].text);
    expect(restoreAnchorsData.success).toBe(true);
    expect(restoreAnchorsData.total_anchors).toBeGreaterThan(0);
    console.log(`✅ 앵커 복원 완료: ${restoreAnchorsData.total_anchors}개 슬롯\n`);
    
    console.log('🎉 전체 워크플로우 테스트 완료!\n');
    
  } catch (error) {
    console.error('❌ 테스트 실패:', error);
    throw error;
  } finally {
    if (testDb) {
      testDb.close();
    }
  }
}

async function testMultiClientScenario() {
  console.log('🧪 멀티 클라이언트 시나리오 테스트 시작\n');
  console.log('여러 agent_id가 동시에 앵커를 설정하고 사용하는 시나리오를 검증합니다.\n');
  
  let testDb: Database.Database | null = null;
  const createdMemoryIds: string[] = [];
  
  try {
    // 1. 데이터베이스 초기화
    console.log('1️⃣ 데이터베이스 초기화');
    testDb = new Database(':memory:');
    DatabaseUtils.initializeDatabase(testDb);
    createAnchorTable(testDb);
    console.log('✅ 데이터베이스 초기화 완료\n');
    
    // 2. 서비스 초기화
    console.log('2️⃣ 서비스 초기화');
    const services = await initializeServices(testDb);
    const context = createToolContext(testDb, services);
    console.log('✅ 서비스 초기화 완료\n');
    
    // 3. 테스트용 메모리 생성
    console.log('3️⃣ 테스트용 메모리 생성');
    const memories = [];
    for (let i = 0; i < 5; i++) {
      const memory = await executeTool('remember', {
        content: `테스트 메모리 ${i + 1}: 멀티 클라이언트 시나리오 테스트용`,
        type: 'episodic',
        importance: 0.7
      }, context);
      const memoryData = JSON.parse(memory.content[0].text);
      memories.push(memoryData.memory_id);
      createdMemoryIds.push(memoryData.memory_id);
    }
    console.log(`✅ ${memories.length}개 메모리 생성 완료\n`);
    
    // 4. 여러 agent_id가 동시에 앵커 설정
    console.log('4️⃣ 여러 agent_id가 동시에 앵커 설정');
    await executeTool('set_anchor', {
      memory_id: memories[0],
      slot: 'A',
      agent_id: 'agent1'
    }, context);
    console.log('✅ agent1/A 설정 완료');
    
    await executeTool('set_anchor', {
      memory_id: memories[1],
      slot: 'A',
      agent_id: 'agent2'
    }, context);
    console.log('✅ agent2/A 설정 완료');
    
    await executeTool('set_anchor', {
      memory_id: memories[2],
      slot: 'B',
      agent_id: 'agent1'
    }, context);
    console.log('✅ agent1/B 설정 완료');
    
    await executeTool('set_anchor', {
      memory_id: memories[3],
      slot: 'C',
      agent_id: 'agent2'
    }, context);
    console.log('✅ agent2/C 설정 완료\n');
    
    // 5. 각 agent_id의 앵커 조회
    console.log('5️⃣ 각 agent_id의 앵커 조회');
    const agent1Anchors = await executeTool('get_anchor', {
      agent_id: 'agent1'
    }, context);
    const agent1Data = JSON.parse(agent1Anchors.content[0].text);
    expect(agent1Data.anchors.A).not.toBeNull();
    expect(agent1Data.anchors.B).not.toBeNull();
    expect(agent1Data.anchors.A.memory_id).toBe(memories[0]);
    expect(agent1Data.anchors.B.memory_id).toBe(memories[2]);
    console.log('✅ agent1 앵커 조회 완료');
    
    const agent2Anchors = await executeTool('get_anchor', {
      agent_id: 'agent2'
    }, context);
    const agent2Data = JSON.parse(agent2Anchors.content[0].text);
    expect(agent2Data.anchors.A).not.toBeNull();
    expect(agent2Data.anchors.C).not.toBeNull();
    expect(agent2Data.anchors.A.memory_id).toBe(memories[1]);
    expect(agent2Data.anchors.C.memory_id).toBe(memories[3]);
    console.log('✅ agent2 앵커 조회 완료\n');
    
    // 6. 각 agent_id의 국소 검색
    console.log('6️⃣ 각 agent_id의 국소 검색');
    const agent1Search = await executeTool('search_local', {
      slot: 'A',
      query: '테스트',
      agent_id: 'agent1',
      limit: 5
    }, context);
    const agent1SearchData = JSON.parse(agent1Search.content[0].text);
    expect(agent1SearchData.anchor_info.agent_id).toBe('agent1');
    console.log(`✅ agent1 국소 검색 완료: ${agent1SearchData.items.length}개 결과`);
    
    const agent2Search = await executeTool('search_local', {
      slot: 'A',
      query: '테스트',
      agent_id: 'agent2',
      limit: 5
    }, context);
    const agent2SearchData = JSON.parse(agent2Search.content[0].text);
    expect(agent2SearchData.anchor_info.agent_id).toBe('agent2');
    console.log(`✅ agent2 국소 검색 완료: ${agent2SearchData.items.length}개 결과\n`);
    
    // 7. 같은 메모리를 다른 agent_id가 다른 슬롯에 설정 가능한지 확인
    console.log('7️⃣ 같은 메모리를 다른 agent_id가 다른 슬롯에 설정 가능한지 확인');
    await executeTool('set_anchor', {
      memory_id: memories[0], // agent1이 A에 설정한 메모리
      slot: 'B',
      agent_id: 'agent2' // agent2가 B에 설정
    }, context);
    const agent2AnchorsAfter = await executeTool('get_anchor', {
      agent_id: 'agent2'
    }, context);
    const agent2AfterData = JSON.parse(agent2AnchorsAfter.content[0].text);
    expect(agent2AfterData.anchors.B.memory_id).toBe(memories[0]);
    console.log('✅ 다른 agent_id가 같은 메모리를 다른 슬롯에 설정 가능\n');
    
    console.log('🎉 멀티 클라이언트 시나리오 테스트 완료!\n');
    
  } catch (error) {
    console.error('❌ 테스트 실패:', error);
    throw error;
  } finally {
    if (testDb) {
      testDb.close();
    }
  }
}

async function testFallbackMechanism() {
  console.log('🧪 Fallback 메커니즘 통합 테스트 시작\n');
  console.log('query가 있을 때만 fallback이 발생하는지 검증합니다.\n');
  
  let testDb: Database.Database | null = null;
  const createdMemoryIds: string[] = [];
  
  try {
    // 1. 데이터베이스 초기화
    console.log('1️⃣ 데이터베이스 초기화');
    testDb = new Database(':memory:');
    DatabaseUtils.initializeDatabase(testDb);
    createAnchorTable(testDb);
    console.log('✅ 데이터베이스 초기화 완료\n');
    
    // 2. 서비스 초기화
    console.log('2️⃣ 서비스 초기화');
    const services = await initializeServices(testDb);
    const context = createToolContext(testDb, services);
    console.log('✅ 서비스 초기화 완료\n');
    
    // 3. 테스트용 메모리 생성
    console.log('3️⃣ 테스트용 메모리 생성');
    const memory = await executeTool('remember', {
      content: 'Fallback 테스트용 메모리: React Hook 설명',
      type: 'episodic',
      tags: ['react', 'test'],
      importance: 0.8
    }, context);
    const memoryData = JSON.parse(memory.content[0].text);
    createdMemoryIds.push(memoryData.memory_id);
    console.log(`✅ 메모리 생성: ${memoryData.memory_id}\n`);
    
    // 4. 앵커 설정
    console.log('4️⃣ 앵커 설정');
    await executeTool('set_anchor', {
      memory_id: memoryData.memory_id,
      slot: 'A',
      agent_id: 'agent1'
    }, context);
    console.log('✅ 앵커 설정 완료\n');
    
    // 5. query가 있을 때 fallback 가능한지 확인
    console.log('5️⃣ query가 있을 때 fallback 가능한지 확인');
    const searchWithQuery = await executeTool('search_local', {
      slot: 'A',
      query: 'nonexistent content that will not match anything',
      agent_id: 'agent1',
      limit: 10,
      min_results: 3
    }, context);
    const searchWithQueryData = JSON.parse(searchWithQuery.content[0].text);
    // query가 있으면 fallback이 발생할 수 있음 (결과가 부족한 경우)
    expect(searchWithQueryData).toHaveProperty('fallback_used');
    console.log(`✅ query 있음 검색 완료: fallback_used=${searchWithQueryData.fallback_used}\n`);
    
    // 6. query가 없을 때 fallback이 발생하지 않는지 확인
    console.log('6️⃣ query가 없을 때 fallback이 발생하지 않는지 확인');
    const searchWithoutQuery = await executeTool('search_local', {
      slot: 'A',
      agent_id: 'agent1',
      limit: 10,
      min_results: 3
    }, context);
    const searchWithoutQueryData = JSON.parse(searchWithoutQuery.content[0].text);
    // query가 없으면 fallback이 발생하지 않아야 함
    expect(searchWithoutQueryData.fallback_used).toBe(false);
    console.log(`✅ query 없음 검색 완료: fallback_used=${searchWithoutQueryData.fallback_used} (반드시 false)\n`);
    
    // 7. 앵커가 없을 때 query가 있으면 fallback 확인
    console.log('7️⃣ 앵커가 없을 때 query가 있으면 fallback 확인');
    await executeTool('clear_anchor', {
      slot: 'A',
      agent_id: 'agent1'
    }, context);
    
    const searchWithoutAnchor = await executeTool('search_local', {
      slot: 'A',
      query: 'test query',
      agent_id: 'agent1',
      limit: 10
    }, context);
    const searchWithoutAnchorData = JSON.parse(searchWithoutAnchor.content[0].text);
    // 앵커가 없고 query가 있으면 fallback 발생
    expect(searchWithoutAnchorData.fallback_used).toBe(true);
    console.log(`✅ 앵커 없음 + query 있음 검색 완료: fallback_used=${searchWithoutAnchorData.fallback_used} (반드시 true)\n`);
    
    // 8. 앵커가 없을 때 query가 없으면 에러 확인
    console.log('8️⃣ 앵커가 없을 때 query가 없으면 에러 확인');
    try {
      await executeTool('search_local', {
        slot: 'A',
        agent_id: 'agent1',
        limit: 10
      }, context);
      throw new Error('에러가 발생해야 하는데 발생하지 않았습니다');
    } catch (error) {
      expect((error as Error).message).toContain('anchor');
      console.log('✅ 예상된 에러 발생: 앵커 없음 + query 없음\n');
    }
    
    console.log('🎉 Fallback 메커니즘 테스트 완료!\n');
    
  } catch (error) {
    console.error('❌ 테스트 실패:', error);
    throw error;
  } finally {
    if (testDb) {
      testDb.close();
    }
  }
}

// 간단한 expect 함수 (vitest가 없을 경우)
function expect(condition: any): { toBe: (value: any) => void; not: { toBeNull: () => void; toBe: (value: any) => void }; toHaveProperty: (prop: string, value?: any) => void; toContain: (value: string) => void; toBeGreaterThan: (value: number) => void } {
  return {
    toBe: (value: any) => {
      if (condition !== value) {
        throw new Error(`Expected ${condition} to be ${value}`);
      }
    },
    not: {
      toBeNull: () => {
        if (condition === null || condition === undefined) {
          throw new Error(`Expected ${condition} not to be null`);
        }
      },
      toBe: (value: any) => {
        if (condition === value) {
          throw new Error(`Expected ${condition} not to be ${value}`);
        }
      }
    },
    toHaveProperty: (prop: string, value?: any) => {
      if (!(prop in condition)) {
        throw new Error(`Expected object to have property ${prop}`);
      }
      if (value !== undefined && condition[prop] !== value) {
        throw new Error(`Expected ${prop} to be ${value}, but got ${condition[prop]}`);
      }
    },
    toContain: (value: string) => {
      if (typeof condition === 'string' && !condition.includes(value)) {
        throw new Error(`Expected string to contain ${value}`);
      }
    },
    toBeGreaterThan: (value: number) => {
      if (typeof condition !== 'number' || condition <= value) {
        throw new Error(`Expected ${condition} to be greater than ${value}`);
      }
    }
  };
}

async function runAllTests() {
  try {
    await testAnchorSystemWorkflow();
    await testMultiClientScenario();
    await testFallbackMechanism();
    console.log('🎉 모든 통합 테스트가 성공적으로 완료되었습니다!');
  } catch (error) {
    console.error('❌ 통합 테스트 실패:', error);
    process.exit(1);
  }
}

// 테스트 실행
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('test-anchor-system.ts')) {
  runAllTests()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ 테스트 실행 실패:', error);
      process.exit(1);
    });
}

export { testAnchorSystemWorkflow, testMultiClientScenario, testFallbackMechanism };

