/**
 * Reflexion 기능 E2E 테스트
 * remember로 reflection_notes 저장 → recall로 조회 → FTS5 검색 전체 워크플로우 검증
 */

import { describe, it, expect } from 'vitest';
import { initializeServices, type ServerServices } from '../server/bootstrap.js';
import { executeTool } from '../tools/index.js';
import type { ToolContext } from '../tools/types.js';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../utils/database.js';
import { 
  initializeMigrationStatusTable, 
  setMigrationStatus 
} from '../utils/fts5-migration-status.js';

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

async function testReflexionE2E() {
  console.log('🧪 Reflexion 기능 E2E 테스트 시작\n');
  console.log('전체 워크플로우를 검증합니다:\n');
  console.log('1. remember Tool로 reflection_notes 저장 (단일 객체)\n');
  console.log('2. recall Tool로 reflection_notes 조회\n');
  console.log('3. FTS5 검색으로 reflection_notes 검색\n');
  console.log('4. remember Tool로 reflection_notes 배열 추가 (병합)\n');
  console.log('5. recall Tool로 업데이트된 reflection_notes 조회\n');
  console.log('6. FTS5 검색으로 업데이트된 reflection_notes 검색\n\n');
  
  let testDb: Database.Database | null = null;
  const createdMemoryIds: string[] = [];
  
  try {
    // 1. 데이터베이스 초기화
    console.log('1️⃣ 데이터베이스 초기화');
    testDb = new Database(':memory:');
    DatabaseUtils.initializeDatabase(testDb);
    
    // FTS5 마이그레이션 상태 테이블 생성
    initializeMigrationStatusTable(testDb);
    setMigrationStatus(testDb, 'in_progress');
    setMigrationStatus(testDb, 'completed');
    
    // FTS5 테이블 생성 (reflection_notes 컬럼 포함)
    try {
      testDb.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_item_fts USING fts5(
          content,
          tags,
          reflection_notes,
          content=memory_item,
          content_rowid=rowid
        );
      `);
    } catch (error) {
      // FTS5 테이블이 이미 존재하거나 생성 실패 시 무시
    }
    
    console.log('✅ 데이터베이스 초기화 완료\n');
    
    // 2. 부트스트랩 함수로 서비스 초기화
    console.log('2️⃣ 부트스트랩 함수로 서비스 초기화');
    const services = await initializeServices(testDb);
    const context = createToolContext(testDb, services);
    console.log('✅ 서비스 초기화 완료\n');
    
    // 3. remember Tool로 reflection_notes 저장 (단일 객체)
    console.log('3️⃣ remember Tool로 reflection_notes 저장 (단일 객체)');
    const reflectionNote1 = {
      failure_type: 'tool_error',
      failure_description: 'API timeout occurred during request',
      timestamp: new Date().toISOString(),
      original_task: 'Fetch user data from external API',
      lessons_learned: 'Need to implement retry logic with exponential backoff',
      suggested_improvements: 'Add timeout configuration and retry mechanism'
    };
    
    const rememberResult1 = await executeTool('remember', {
      content: 'How to fetch user data from external API',
      type: 'procedural',
      task_goal: 'Fetch user data',
      steps: JSON.stringify(['step1', 'step2', 'step3']),
      reflection_notes: JSON.stringify(reflectionNote1),
      importance: 0.8,
      tags: ['api', 'error-handling']
    }, context);
    
    const rememberData1 = JSON.parse(rememberResult1.content[0].text);
    createdMemoryIds.push(rememberData1.memory_id);
    console.log(`✅ reflection_notes 저장 완료: ${rememberData1.memory_id}\n`);
    
    // 4. recall Tool로 reflection_notes 조회
    console.log('4️⃣ recall Tool로 reflection_notes 조회');
    const recallResult1 = await executeTool('recall', {
      query: 'Fetch user data',
      type: 'procedural',
      include_metadata: true,
      limit: 10
    }, context);
    
    const recallData1 = JSON.parse(recallResult1.content[0].text);
    const proceduralMemory = recallData1.items.find((item: any) => item.type === 'procedural');
    
    if (!proceduralMemory) {
      throw new Error('Procedural memory를 찾을 수 없습니다');
    }
    
    expect(proceduralMemory.reflection_notes).toBeDefined();
    expect(proceduralMemory.reflection_notes).not.toBeNull();
    expect(proceduralMemory.reflection_notes.failure_type).toBe('tool_error');
    expect(proceduralMemory.reflection_notes.failure_description).toBe('API timeout occurred during request');
    console.log('✅ reflection_notes 조회 완료\n');
    console.log(`   - failure_type: ${proceduralMemory.reflection_notes.failure_type}`);
    console.log(`   - failure_description: ${proceduralMemory.reflection_notes.failure_description}\n`);
    
    // 5. FTS5 검색으로 reflection_notes 검색
    console.log('5️⃣ FTS5 검색으로 reflection_notes 검색');
    const recallResult2 = await executeTool('recall', {
      query: 'timeout',
      type: 'procedural',
      include_metadata: true,
      limit: 10
    }, context);
    
    const recallData2 = JSON.parse(recallResult2.content[0].text);
    const foundByReflectionNotes = recallData2.items.find((item: any) => 
      item.id === rememberData1.memory_id
    );
    
    if (!foundByReflectionNotes) {
      throw new Error('reflection_notes 검색으로 메모리를 찾을 수 없습니다');
    }
    
    expect(foundByReflectionNotes.reflection_notes).toBeDefined();
    expect(foundByReflectionNotes.reflection_notes.failure_description).toContain('timeout');
    console.log('✅ FTS5 검색으로 reflection_notes 검색 완료\n');
    console.log(`   - 검색어: "timeout"`);
    console.log(`   - 검색된 메모리 ID: ${foundByReflectionNotes.id}\n`);
    
    // 6. remember Tool로 reflection_notes 배열 추가 (병합)
    console.log('6️⃣ remember Tool로 reflection_notes 배열 추가 (병합)');
    const reflectionNote2 = {
      failure_type: 'network_error',
      failure_description: 'Network connection failed',
      timestamp: new Date().toISOString(),
      original_task: 'Fetch user data from external API',
      lessons_learned: 'Need to handle network errors gracefully',
      suggested_improvements: 'Add network error detection and fallback mechanism'
    };
    
    const rememberResult2 = await executeTool('remember', {
      content: 'How to fetch user data from external API',
      type: 'procedural',
      task_goal: 'Fetch user data', // 동일한 task_goal으로 병합
      steps: JSON.stringify(['step1', 'step2', 'step3']),
      reflection_notes: JSON.stringify(reflectionNote2),
      importance: 0.8,
      tags: ['api', 'error-handling']
    }, context);
    
    const rememberData2 = JSON.parse(rememberResult2.content[0].text);
    // 동일한 task_goal이므로 같은 메모리 ID를 반환해야 함
    expect(rememberData2.memory_id).toBe(rememberData1.memory_id);
    console.log(`✅ reflection_notes 병합 완료: ${rememberData2.memory_id}\n`);
    
    // 7. recall Tool로 업데이트된 reflection_notes 조회
    console.log('7️⃣ recall Tool로 업데이트된 reflection_notes 조회');
    const recallResult3 = await executeTool('recall', {
      query: 'Fetch user data',
      type: 'procedural',
      include_metadata: true,
      limit: 10
    }, context);
    
    const recallData3 = JSON.parse(recallResult3.content[0].text);
    const updatedMemory = recallData3.items.find((item: any) => 
      item.id === rememberData1.memory_id
    );
    
    if (!updatedMemory) {
      throw new Error('업데이트된 메모리를 찾을 수 없습니다');
    }
    
    expect(updatedMemory.reflection_notes).toBeDefined();
    expect(Array.isArray(updatedMemory.reflection_notes)).toBe(true);
    expect(updatedMemory.reflection_notes).toHaveLength(2);
    expect(updatedMemory.reflection_notes[0].failure_type).toBe('tool_error');
    expect(updatedMemory.reflection_notes[1].failure_type).toBe('network_error');
    console.log('✅ 업데이트된 reflection_notes 조회 완료\n');
    console.log(`   - reflection_notes 배열 길이: ${updatedMemory.reflection_notes.length}`);
    console.log(`   - 첫 번째 항목: ${updatedMemory.reflection_notes[0].failure_type}`);
    console.log(`   - 두 번째 항목: ${updatedMemory.reflection_notes[1].failure_type}\n`);
    
    // 8. FTS5 검색으로 업데이트된 reflection_notes 검색
    console.log('8️⃣ FTS5 검색으로 업데이트된 reflection_notes 검색');
    const recallResult4 = await executeTool('recall', {
      query: 'network connection',
      type: 'procedural',
      include_metadata: true,
      limit: 10
    }, context);
    
    const recallData4 = JSON.parse(recallResult4.content[0].text);
    const foundByUpdatedReflectionNotes = recallData4.items.find((item: any) => 
      item.id === rememberData1.memory_id
    );
    
    if (!foundByUpdatedReflectionNotes) {
      throw new Error('업데이트된 reflection_notes 검색으로 메모리를 찾을 수 없습니다');
    }
    
    expect(foundByUpdatedReflectionNotes.reflection_notes).toBeDefined();
    expect(Array.isArray(foundByUpdatedReflectionNotes.reflection_notes)).toBe(true);
    const hasNetworkError = foundByUpdatedReflectionNotes.reflection_notes.some((note: any) =>
      note.failure_description.toLowerCase().includes('network')
    );
    expect(hasNetworkError).toBe(true);
    console.log('✅ 업데이트된 reflection_notes 검색 완료\n');
    console.log(`   - 검색어: "network connection"`);
    console.log(`   - 검색된 메모리 ID: ${foundByUpdatedReflectionNotes.id}\n`);
    
    // 9. has_reflection_notes 필터링 테스트
    console.log('9️⃣ has_reflection_notes 필터링 테스트');
    const recallResult5 = await executeTool('recall', {
      query: 'API',
      type: 'procedural',
      has_reflection_notes: true,
      include_metadata: true,
      limit: 10
    }, context);
    
    const recallData5 = JSON.parse(recallResult5.content[0].text);
    const filteredMemory = recallData5.items.find((item: any) => 
      item.id === rememberData1.memory_id
    );
    
    if (!filteredMemory) {
      throw new Error('has_reflection_notes 필터로 메모리를 찾을 수 없습니다');
    }
    
    expect(filteredMemory.reflection_notes).toBeDefined();
    expect(filteredMemory.reflection_notes).not.toBeNull();
    console.log('✅ has_reflection_notes 필터링 완료\n');
    
    console.log('✅ 모든 E2E 테스트 통과!\n');
    
  } catch (error) {
    console.error('❌ E2E 테스트 실패:', error);
    throw error;
  } finally {
    if (testDb) {
      testDb.close();
    }
  }
}

describe('Reflexion E2E 테스트', () => {
  it('should complete full workflow: remember → recall → FTS5 search', async () => {
    await testReflexionE2E();
  });
});

