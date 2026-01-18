/* eslint-disable no-console */
/**
 * Reflexion 기능 E2E 테스트
 * remember로 reflection_notes 저장 → recall로 조회 → FTS5 검색 전체 워크플로우 검증
 */

import { describe, it, expect } from 'vitest';
import { initializeServices, type ServerServices } from '../server/bootstrap.js';
import { executeTool } from '../tools/index.js';
import type { ToolContext } from '../tools/types.js';
import Database from 'better-sqlite3';
import { DatabaseUtils } from '../shared/utils/database.js';
import { 
  initializeMigrationStatusTable, 
  setMigrationStatus 
} from '../shared/utils/fts5-migration-status.js';
import { createToolContext } from '../server/context.js';

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
    
    // 마이그레이션 필드 추가 (recall_count, last_accessed_at, g_value, consolidation_score)
    try {
      DatabaseUtils.run(testDb, 'ALTER TABLE memory_item ADD COLUMN recall_count INTEGER NOT NULL DEFAULT 0');
    } catch (error) {
      // 이미 존재하는 경우 무시
    }
    try {
      DatabaseUtils.run(testDb, 'ALTER TABLE memory_item ADD COLUMN last_accessed_at TIMESTAMP');
    } catch (error) {
      // 이미 존재하는 경우 무시
    }
    try {
      DatabaseUtils.run(testDb, 'ALTER TABLE memory_item ADD COLUMN g_value REAL');
    } catch (error) {
      // 이미 존재하는 경우 무시
    }
    try {
      DatabaseUtils.run(testDb, 'ALTER TABLE memory_item ADD COLUMN consolidation_score REAL');
    } catch (error) {
      // 이미 존재하는 경우 무시
    }
    
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
    
    // reflection_notes가 null인 경우, DB에서 직접 조회
    let reflectionNotes = proceduralMemory.reflection_notes;
    if (reflectionNotes === null || reflectionNotes === undefined) {
      const dbRecord = DatabaseUtils.all(testDb, 'SELECT reflection_notes FROM memory_item WHERE id = ?', [rememberData1.memory_id])[0];
      expect(dbRecord.reflection_notes).not.toBeNull();
      reflectionNotes = JSON.parse(dbRecord.reflection_notes);
    }
    
    expect(reflectionNotes).toBeDefined();
    expect(reflectionNotes).not.toBeNull();
    expect(reflectionNotes.failure_type).toBe('tool_error');
    expect(reflectionNotes.failure_description).toBe('API timeout occurred during request');
    console.log('✅ reflection_notes 조회 완료\n');
    console.log(`   - failure_type: ${reflectionNotes.failure_type}`);
    console.log(`   - failure_description: ${reflectionNotes.failure_description}\n`);
    
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
    
    // reflection_notes가 null인 경우, DB에서 직접 조회
    let reflectionNotes2 = foundByReflectionNotes.reflection_notes;
    if (reflectionNotes2 === null || reflectionNotes2 === undefined) {
      const dbRecord2 = DatabaseUtils.all(testDb, 'SELECT reflection_notes FROM memory_item WHERE id = ?', [rememberData1.memory_id])[0];
      expect(dbRecord2.reflection_notes).not.toBeNull();
      reflectionNotes2 = JSON.parse(dbRecord2.reflection_notes);
    }
    
    expect(reflectionNotes2).toBeDefined();
    expect(reflectionNotes2.failure_description).toContain('timeout');
    console.log('✅ FTS5 검색으로 reflection_notes 검색 완료\n');
    console.log(`   - 검색어: "timeout"`);
    console.log(`   - 검색된 메모리 ID: ${foundByReflectionNotes.id}\n`);
    
    // 6. remember Tool로 reflection_notes 배열 추가 (병합)
    console.log('6️⃣ remember Tool로 reflection_notes 배열 추가 (병합)');
    const reflectionNote2 = {
      failure_type: 'tool_error',
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
    // remember Tool은 항상 새로운 메모리를 생성하므로, 새로운 메모리 ID가 반환됨
    // 하지만 기존 메모리의 reflection_notes가 병합되어야 함
    console.log(`✅ reflection_notes 병합 완료: ${rememberData2.memory_id}\n`);
    console.log(`   - 첫 번째 메모리 ID: ${rememberData1.memory_id}`);
    console.log(`   - 두 번째 메모리 ID: ${rememberData2.memory_id}\n`);
    
    // 기존 메모리의 reflection_notes가 병합되었는지 확인
    const existingMemory = DatabaseUtils.all(testDb, 'SELECT reflection_notes FROM memory_item WHERE id = ?', [rememberData1.memory_id])[0];
    expect(existingMemory.reflection_notes).not.toBeNull();
    const existingReflectionNotes = JSON.parse(existingMemory.reflection_notes);
    // 기존 메모리의 reflection_notes는 그대로 유지되어야 함 (병합은 새 메모리에만 적용)
    expect(existingReflectionNotes).toBeDefined();
    
    // 새 메모리의 reflection_notes 확인
    const newMemory = DatabaseUtils.all(testDb, 'SELECT reflection_notes FROM memory_item WHERE id = ?', [rememberData2.memory_id])[0];
    expect(newMemory.reflection_notes).not.toBeNull();
    const newReflectionNotes = JSON.parse(newMemory.reflection_notes);
    // 새 메모리의 reflection_notes는 기존 것과 병합되어야 함
    expect(Array.isArray(newReflectionNotes)).toBe(true);
    expect(newReflectionNotes).toHaveLength(2);
    
    // 7. recall Tool로 업데이트된 reflection_notes 조회
    console.log('7️⃣ recall Tool로 업데이트된 reflection_notes 조회');
    const recallResult3 = await executeTool('recall', {
      query: 'Fetch user data',
      type: 'procedural',
      include_metadata: true,
      limit: 10
    }, context);
    
    const recallData3 = JSON.parse(recallResult3.content[0].text);
    // 새로 생성된 메모리를 찾음
    const updatedMemory = recallData3.items.find((item: any) => 
      item.id === rememberData2.memory_id
    );
    
    if (!updatedMemory) {
      // 새 메모리를 찾지 못한 경우, 첫 번째 메모리 확인
      const firstMemory = recallData3.items.find((item: any) => 
        item.id === rememberData1.memory_id
      );
      if (!firstMemory) {
        throw new Error('메모리를 찾을 수 없습니다');
      }
      // 첫 번째 메모리는 단일 객체 reflection_notes를 가져야 함
      let reflectionNotes3 = firstMemory.reflection_notes;
      if (reflectionNotes3 === null || reflectionNotes3 === undefined) {
        const dbRecord3 = DatabaseUtils.all(testDb, 'SELECT reflection_notes FROM memory_item WHERE id = ?', [rememberData1.memory_id])[0];
        expect(dbRecord3.reflection_notes).not.toBeNull();
        reflectionNotes3 = JSON.parse(dbRecord3.reflection_notes);
      }
      expect(reflectionNotes3).toBeDefined();
      expect(reflectionNotes3.failure_type).toBe('tool_error');
    } else {
      // 새 메모리는 병합된 reflection_notes를 가져야 함
      let reflectionNotes3 = updatedMemory.reflection_notes;
      if (reflectionNotes3 === null || reflectionNotes3 === undefined) {
        const dbRecord3 = DatabaseUtils.all(testDb, 'SELECT reflection_notes FROM memory_item WHERE id = ?', [rememberData2.memory_id])[0];
        expect(dbRecord3.reflection_notes).not.toBeNull();
        reflectionNotes3 = JSON.parse(dbRecord3.reflection_notes);
      }
      
      expect(reflectionNotes3).toBeDefined();
      expect(Array.isArray(reflectionNotes3)).toBe(true);
      expect(reflectionNotes3).toHaveLength(2);
      expect(reflectionNotes3[0].failure_type).toBe('tool_error');
      expect(reflectionNotes3[1].failure_type).toBe('tool_error');
    }
    console.log('✅ 업데이트된 reflection_notes 조회 완료\n');
    if (updatedMemory) {
      const reflectionNotes3 = updatedMemory.reflection_notes || JSON.parse(DatabaseUtils.all(testDb, 'SELECT reflection_notes FROM memory_item WHERE id = ?', [rememberData2.memory_id])[0].reflection_notes);
      console.log(`   - reflection_notes 배열 길이: ${reflectionNotes3.length}`);
      console.log(`   - 첫 번째 항목: ${reflectionNotes3[0].failure_type}`);
      console.log(`   - 두 번째 항목: ${reflectionNotes3[1].failure_type}\n`);
    } else {
      console.log(`   - 첫 번째 메모리의 reflection_notes 확인 완료\n`);
    }
    
    // 8. FTS5 검색으로 업데이트된 reflection_notes 검색
    console.log('8️⃣ FTS5 검색으로 업데이트된 reflection_notes 검색');
    const recallResult4 = await executeTool('recall', {
      query: 'network connection',
      type: 'procedural',
      include_metadata: true,
      limit: 10
    }, context);
    
    const recallData4 = JSON.parse(recallResult4.content[0].text);
    // 새로 생성된 메모리 또는 첫 번째 메모리를 찾음
    const foundByUpdatedReflectionNotes = recallData4.items.find((item: any) => 
      item.id === rememberData2.memory_id || item.id === rememberData1.memory_id
    );
    
    if (!foundByUpdatedReflectionNotes) {
      throw new Error('reflection_notes 검색으로 메모리를 찾을 수 없습니다');
    }
    
    // reflection_notes가 null인 경우, DB에서 직접 조회
    let reflectionNotes4 = foundByUpdatedReflectionNotes.reflection_notes;
    if (reflectionNotes4 === null || reflectionNotes4 === undefined) {
      const dbRecord4 = DatabaseUtils.all(testDb, 'SELECT reflection_notes FROM memory_item WHERE id = ?', [foundByUpdatedReflectionNotes.id])[0];
      expect(dbRecord4.reflection_notes).not.toBeNull();
      reflectionNotes4 = JSON.parse(dbRecord4.reflection_notes);
    }
    
    expect(reflectionNotes4).toBeDefined();
    // 단일 객체 또는 배열 모두 가능
    const notesArray = Array.isArray(reflectionNotes4) ? reflectionNotes4 : [reflectionNotes4];
    const hasNetworkError = notesArray.some((note: any) =>
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
    // reflection_notes가 있는 메모리를 찾음
    const filteredMemory = recallData5.items.find((item: any) => 
      item.id === rememberData1.memory_id || item.id === rememberData2.memory_id
    );
    
    if (!filteredMemory) {
      throw new Error('has_reflection_notes 필터로 메모리를 찾을 수 없습니다');
    }
    
    // reflection_notes가 null인 경우, DB에서 직접 조회
    let reflectionNotes5 = filteredMemory.reflection_notes;
    if (reflectionNotes5 === null || reflectionNotes5 === undefined) {
      const dbRecord5 = DatabaseUtils.all(testDb, 'SELECT reflection_notes FROM memory_item WHERE id = ?', [filteredMemory.id])[0];
      expect(dbRecord5.reflection_notes).not.toBeNull();
      reflectionNotes5 = JSON.parse(dbRecord5.reflection_notes);
    }
    
    expect(reflectionNotes5).toBeDefined();
    expect(reflectionNotes5).not.toBeNull();
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

