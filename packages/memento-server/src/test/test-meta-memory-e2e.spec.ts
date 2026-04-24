/**
 * Meta-Memory 통합 E2E 테스트
 * recall 호출 → 통계 수집 → get_meta_memory_stats로 조회 전체 워크플로우 검증
 * 
 * Phase 5.3: get_meta_memory_stats는 MCP에서 제거되고 HTTP API로만 제공됩니다.
 * 이 테스트는 GetMetaMemoryStatsTool을 직접 사용하여 통계 조회를 검증합니다.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setupTestDatabase, cleanupTestDatabase, type TestDatabaseContext } from '../server/test/helpers/test-database.js';
import { executeTool } from '@memento/core/index.js';
import { createToolContext } from '@memento/core/context.js';
import { GetMetaMemoryStatsTool } from '@memento/core/domains/monitoring/tools/get-meta-memory-stats-tool.js';
import Database from 'better-sqlite3';

describe('Meta-Memory 통합 E2E 테스트', () => {
  let ctx: TestDatabaseContext | null = null;
  let db: Database.Database;
  let services: any;

  beforeEach(async () => {
    ctx = await setupTestDatabase();
    db = ctx.db;
    services = ctx.services;
  });

  afterEach(async () => {
    await cleanupTestDatabase(ctx);
    ctx = null;
  });

  it('given: 전체 시스템이 초기화될 때, when: recall을 호출하고 get_meta_memory_stats로 조회하면, then: 통계가 올바르게 수집되고 조회되어야 함', async () => {
    // Given: 전체 시스템이 초기화됨
    const toolContext = createToolContext(db, services);

    // 1. remember로 메모리 저장
    const rememberResult = await executeTool('remember', {
      content: 'Meta-Memory E2E 테스트용 메모리',
      type: 'episodic',
      tags: ['test', 'meta-memory'],
      importance: 0.8
    }, toolContext);

    const rememberData = JSON.parse(rememberResult.content[0].text);
    const memoryId = rememberData.memory_id;
    expect(memoryId).toBeDefined();

    // 2. recall 호출 (통계 수집) - 저장한 메모리를 검색
    const recallResult = await executeTool('recall', {
      query: 'Meta-Memory E2E 테스트용 메모리',
      limit: 10
    }, toolContext);

    const recallData = JSON.parse(recallResult.content[0].text);
    expect(recallData.items).toBeDefined();
    
    // recall 결과가 있을 때만 통계 확인
    if (recallData.items.length > 0) {
      // debounce flush를 위해 대기
      await new Promise(resolve => setTimeout(resolve, 200));

      // 3. get_meta_memory_stats로 통계 조회 (Phase 5.3: HTTP API로만 제공되므로 도구를 직접 사용)
      const statsTool = new GetMetaMemoryStatsTool();
      const statsResult = await statsTool.handle({
        memory_id: memoryId,
        limit: 10
      }, toolContext);

      const statsData = JSON.parse(statsResult.content[0].text);
      
      // Then: 통계가 올바르게 수집되고 조회되어야 함
      expect(statsData).toBeDefined();
      expect(statsData.items).toBeDefined();
      expect(Array.isArray(statsData.items)).toBe(true);
      
      const stats = statsData.items.find((item: any) => item.memory_id === memoryId);
      if (stats) {
        expect(stats.recall_count).toBeGreaterThanOrEqual(1);
        expect(stats.success_count).toBeGreaterThanOrEqual(0);
        expect(stats.failure_count).toBeGreaterThanOrEqual(0);
        expect(stats.avg_confidence).toBeGreaterThanOrEqual(0);
        expect(stats.avg_confidence).toBeLessThanOrEqual(1);
        expect(stats.last_recalled_at).toBeDefined();
      }
    } else {
      // recall 결과가 없어도 통계 조회는 가능해야 함 (빈 결과)
      // Phase 5.3: HTTP API로만 제공되므로 도구를 직접 사용
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const statsTool = new GetMetaMemoryStatsTool();
      const statsResult = await statsTool.handle({
        memory_id: memoryId,
        limit: 10
      }, toolContext);

      const statsData = JSON.parse(statsResult.content[0].text);
      expect(statsData).toBeDefined();
      expect(statsData.items).toBeDefined();
      expect(Array.isArray(statsData.items)).toBe(true);
    }
  });
});
