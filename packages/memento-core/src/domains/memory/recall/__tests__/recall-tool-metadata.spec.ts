import { describe, it, expect, beforeEach, vi } from "vitest";
import { describeRecallTool, db, tool, context, hybridSearchEngine, anchorManager } from "./recall-tool.test-setup.js";

describeRecallTool("metadata and telemetry", () => {
  describe('앵커 설정 메타데이터', () => {
    describe('앵커 설정 성공 시 메타데이터', () => {
      it('given: 앵커 설정 성공, when: auto_set_anchor=true, then: metadata.anchor_set={memory_id, slot: "A", agent_id}, anchor_set_error/anchor_set_skipped 없음', async () => {
        // Given: 앵커 설정이 성공하는 상황
        const memoryId = 'mem_test_001';
        const agentId = 'default';

        // 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES (?, 'episodic', 'Test memory content', 0.8, CURRENT_TIMESTAMP)
        `).run(memoryId);

        // Mock 검색 결과
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: memoryId,
              content: 'Test memory content',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const params = {
          query: 'test',
          limit: 10,
          auto_set_anchor: true,
          agent_id: agentId
        };

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: metadata.anchor_set={memory_id, slot: "A", agent_id}
        expect(resultData.metadata).toBeDefined();
        expect(resultData.metadata.anchor_set).toBeDefined();
        expect(resultData.metadata.anchor_set).toEqual({
          memory_id: memoryId,
          slot: 'A',
          agent_id: agentId
        });

        // Then: anchor_set_error/anchor_set_skipped 없음
        expect(resultData.metadata.anchor_set_error).toBeUndefined();
        expect(resultData.metadata.anchor_set_skipped).toBeUndefined();
        expect(resultData.metadata.anchor_set_skipped_reason).toBeUndefined();
      });
    });

    describe('앵커 설정 실패 시 메타데이터', () => {
      it('given: 앵커 설정 실패, when: auto_set_anchor=true, then: metadata.anchor_set=null, anchor_set_error=true, anchor_set_skipped 없음', async () => {
        // Given: 앵커 설정이 실패하는 상황
        const memoryId = 'mem_test_001';
        const agentId = 'default';

        // 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES (?, 'episodic', 'Test memory content', 0.8, CURRENT_TIMESTAMP)
        `).run(memoryId);

        // Mock 검색 결과
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: memoryId,
              content: 'Test memory content',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            }
          ],
          total_count: 1,
          query_time: 10
        });

        // AnchorManager.setAnchor를 mock하여 에러 발생시키기
        const setAnchorError = new Error('앵커 설정 실패');
        vi.spyOn(anchorManager, 'setAnchor').mockRejectedValue(setAnchorError);

        const params = {
          query: 'test',
          limit: 10,
          auto_set_anchor: true,
          agent_id: agentId
        };

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: metadata.anchor_set=null
        expect(resultData.metadata).toBeDefined();
        expect(resultData.metadata.anchor_set).toBeNull();

        // Then: anchor_set_error=true
        expect(resultData.metadata.anchor_set_error).toBe(true);

        // Then: anchor_set_skipped 없음
        expect(resultData.metadata.anchor_set_skipped).toBeUndefined();
        expect(resultData.metadata.anchor_set_skipped_reason).toBeUndefined();
      });
    });

    describe('앵커 설정 건너뜀 시 메타데이터', () => {
      it('given: 슬롯 A에 pinned 앵커 있음, when: auto_set_anchor=true, then: metadata.anchor_set=null, anchor_set_skipped=true, anchor_set_skipped_reason="pinned_anchor_protected", anchor_set_error 없음', async () => {
        // Given: 슬롯 A에 pinned 앵커가 있는 상황
        const agentId = 'default';
        const pinnedMemoryId = 'mem_pinned';
        const newMemoryId = 'mem_new';

        // pinned 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, pinned, created_at) VALUES (?, 'episodic', 'Pinned Memory', 0.9, 1, CURRENT_TIMESTAMP),
            (?, 'episodic', 'New Memory', 0.8, 0, CURRENT_TIMESTAMP)
        `).run(pinnedMemoryId, newMemoryId);

        // 슬롯 A에 pinned 앵커 설정
        await anchorManager.setAnchor(agentId, pinnedMemoryId, 'A');

        // Mock 검색 결과 (새로운 메모리가 첫 번째 결과)
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: newMemoryId,
              content: 'New Memory',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const params = {
          query: 'test',
          limit: 10,
          auto_set_anchor: true,
          agent_id: agentId
        };

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: metadata.anchor_set=null
        expect(resultData.metadata).toBeDefined();
        expect(resultData.metadata.anchor_set).toBeNull();

        // Then: anchor_set_skipped=true
        expect(resultData.metadata.anchor_set_skipped).toBe(true);

        // Then: anchor_set_skipped_reason="pinned_anchor_protected"
        expect(resultData.metadata.anchor_set_skipped_reason).toBe('pinned_anchor_protected');

        // Then: anchor_set_error 없음
        expect(resultData.metadata.anchor_set_error).toBeUndefined();
      });
    });

    describe('앵커 설정 비활성화 시 메타데이터', () => {
      it('given: auto_set_anchor=false, when: recall 호출, then: metadata.anchor_set=null, anchor_set_error/anchor_set_skipped 없음', async () => {
        // Given: auto_set_anchor=false
        const memoryId = 'mem_test_001';

        // 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES (?, 'episodic', 'Test memory content', 0.8, CURRENT_TIMESTAMP)
        `).run(memoryId);

        // Mock 검색 결과
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: memoryId,
              content: 'Test memory content',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const params = {
          query: 'test',
          limit: 10,
          auto_set_anchor: false // 비활성화
        };

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: metadata.anchor_set=null
        expect(resultData.metadata).toBeDefined();
        expect(resultData.metadata.anchor_set).toBeNull();

        // Then: anchor_set_error/anchor_set_skipped 없음
        expect(resultData.metadata.anchor_set_error).toBeUndefined();
        expect(resultData.metadata.anchor_set_skipped).toBeUndefined();
        expect(resultData.metadata.anchor_set_skipped_reason).toBeUndefined();
      });
    });

    describe('검색 결과 없을 때 자동 앵커 설정 메타데이터', () => {
      it('given: 검색 결과 없음, auto_set_anchor=true, when: recall 호출, then: metadata.anchor_set=null, anchor_set_error/anchor_set_skipped 없음', async () => {
        // Given: 검색 결과 없음, auto_set_anchor=true
        const agentId = 'default';

        // Mock 검색 결과 (빈 배열)
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [],
          total_count: 0,
          query_time: 10
        });

        const params = {
          query: 'test',
          limit: 10,
          auto_set_anchor: true,
          agent_id: agentId
        };

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: metadata.anchor_set=null
        expect(resultData.metadata).toBeDefined();
        expect(resultData.metadata.anchor_set).toBeNull();

        // Then: anchor_set_error/anchor_set_skipped 없음
        expect(resultData.metadata.anchor_set_error).toBeUndefined();
        expect(resultData.metadata.anchor_set_skipped).toBeUndefined();
        expect(resultData.metadata.anchor_set_skipped_reason).toBeUndefined();

        // Then: 검색 결과가 없어서 앵커 설정이 시도되지 않았는지 확인
        expect(resultData.items).toBeDefined();
        expect(resultData.items.length).toBe(0);
        expect(resultData.total_count).toBe(0);
      });
    });
  });

  describe('메타 통계 수집 통합', () => {
    it('given: recall 호출 시 검색 결과가 있을 때, when: 통계를 확인하면, then: 각 메모리 항목의 통계가 업데이트되어야 함', async () => {
      // Given: 메모리 항목 생성 및 검색 결과 준비
      const memoryId1 = 'mem_test_meta_1';
      const memoryId2 = 'mem_test_meta_2';

      // memory_item 테이블에 테스트 데이터 삽입
      db.exec(`
        INSERT INTO memory_item (id, type, content, importance, created_at) VALUES ('${memoryId1}', 'episodic', 'Test memory 1', 0.8, CURRENT_TIMESTAMP),
          ('${memoryId2}', 'episodic', 'Test memory 2', 0.7, CURRENT_TIMESTAMP)
      `);

      // meta_memory_stats 테이블 생성 (마이그레이션 실행)
      db.exec(`
        CREATE TABLE IF NOT EXISTS meta_memory_stats (
          memory_id TEXT PRIMARY KEY,
          recall_count INTEGER DEFAULT 0 NOT NULL,
          success_count INTEGER DEFAULT 0 NOT NULL,
          failure_count INTEGER DEFAULT 0 NOT NULL,
          avg_confidence REAL DEFAULT 0.0 NOT NULL,
          last_recalled_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE
        )
      `);

      // MetaMemoryService 초기화
      const { MetaMemoryService } = await import('../../introspection/meta-memory-service.js');
      const metaMemoryService = new MetaMemoryService(db);

      // context에 MetaMemoryService 추가
      context.services.metaMemoryService = metaMemoryService;

      // Mock 검색 결과 (final_score 포함)
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [
          {
            id: memoryId1,
            memory_id: memoryId1,
            content: 'Test memory 1',
            type: 'episodic',
            importance: 0.8,
            created_at: new Date().toISOString(),
            final_score: 0.95, // 성공 (>= 0.5)
            consolidation_score: 0.9,
            vectorScore: 0.85
          },
          {
            id: memoryId2,
            memory_id: memoryId2,
            content: 'Test memory 2',
            type: 'episodic',
            importance: 0.7,
            created_at: new Date().toISOString(),
            final_score: 0.3, // 실패 (< 0.5)
            consolidation_score: 0.2,
            vectorScore: 0.25
          }
        ],
        total_count: 2,
        query_time: 10
      });

      // When: recall 호출
      const params = {
        query: 'test',
        limit: 10
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      // 검색 결과 확인
      expect(resultData.items).toBeDefined();
      expect(resultData.items.length).toBe(2);

      // 통계 업데이트를 위해 debounce 시간 대기 (100ms)
      await new Promise(resolve => setTimeout(resolve, 150));

      // MetaMemoryService destroy로 남은 버퍼 flush
      await metaMemoryService.destroy();

      // Then: 각 메모리 항목의 통계가 업데이트되어야 함
      const stats1 = await metaMemoryService.getStatsById(memoryId1);
      const stats2 = await metaMemoryService.getStatsById(memoryId2);

      // memoryId1: 성공 (final_score >= 0.5)
      expect(stats1.recall_count).toBe(1);
      expect(stats1.success_count).toBe(1);
      expect(stats1.failure_count).toBe(0);
      expect(stats1.avg_confidence).toBeGreaterThan(0);
      expect(stats1.last_recalled_at).toBeDefined();

      // memoryId2: 실패 (final_score < 0.5)
      expect(stats2.recall_count).toBe(1);
      expect(stats2.success_count).toBe(0);
      expect(stats2.failure_count).toBe(1);
      expect(stats2.avg_confidence).toBeGreaterThan(0);
      expect(stats2.last_recalled_at).toBeDefined();
    });

    it('given: 검색 결과가 0개일 때, when: recall을 호출하면, then: 통계 업데이트가 발생하지 않아야 함', async () => {
      // Given: 메모리 항목 생성 (하지만 검색 결과는 0개)
      const memoryId = 'mem_test_meta_empty';

      // memory_item 테이블에 테스트 데이터 삽입
      db.exec(`
        INSERT INTO memory_item (id, type, content, importance, created_at) VALUES ('${memoryId}', 'episodic', 'Test memory', 0.8, CURRENT_TIMESTAMP)
      `);

      // meta_memory_stats 테이블 생성 (마이그레이션 실행)
      db.exec(`
        CREATE TABLE IF NOT EXISTS meta_memory_stats (
          memory_id TEXT PRIMARY KEY,
          recall_count INTEGER DEFAULT 0 NOT NULL,
          success_count INTEGER DEFAULT 0 NOT NULL,
          failure_count INTEGER DEFAULT 0 NOT NULL,
          avg_confidence REAL DEFAULT 0.0 NOT NULL,
          last_recalled_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE
        )
      `);

      // MetaMemoryService 초기화
      const { MetaMemoryService } = await import('../../introspection/meta-memory-service.js');
      const metaMemoryService = new MetaMemoryService(db);

      // context에 MetaMemoryService 추가
      context.services.metaMemoryService = metaMemoryService;

      // Mock 검색 결과 (0개)
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [],
        total_count: 0,
        query_time: 10
      });

      // When: recall 호출
      const params = {
        query: 'nonexistent',
        limit: 10
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      // 검색 결과 확인
      expect(resultData.items).toBeDefined();
      expect(resultData.items.length).toBe(0);

      // 통계 업데이트를 위해 debounce 시간 대기 (100ms)
      await new Promise(resolve => setTimeout(resolve, 150));

      // MetaMemoryService destroy로 남은 버퍼 flush
      await metaMemoryService.destroy();

      // Then: 통계 업데이트가 발생하지 않아야 함
      const stats = await metaMemoryService.getStatsById(memoryId);

      // 통계가 기본값(0)으로 유지되어야 함
      expect(stats.recall_count).toBe(0);
      expect(stats.success_count).toBe(0);
      expect(stats.failure_count).toBe(0);
      expect(stats.avg_confidence).toBe(0.0);
      expect(stats.last_recalled_at).toBeUndefined();
    });

    it('given: include_metadata=true로 recall 호출할 때, when: 응답을 확인하면, then: meta_stats 필드가 포함되어야 함', async () => {
      // Given: 메모리 항목 생성 및 검색 결과 준비
      const memoryId1 = 'mem_test_meta_stats_1';
      const memoryId2 = 'mem_test_meta_stats_2';

      // memory_item 테이블에 테스트 데이터 삽입
      db.exec(`
        INSERT INTO memory_item (id, type, content, importance, created_at) VALUES ('${memoryId1}', 'episodic', 'Test memory 1', 0.8, CURRENT_TIMESTAMP),
          ('${memoryId2}', 'episodic', 'Test memory 2', 0.7, CURRENT_TIMESTAMP)
      `);

      // meta_memory_stats 테이블 생성 (마이그레이션 실행)
      db.exec(`
        CREATE TABLE IF NOT EXISTS meta_memory_stats (
          memory_id TEXT PRIMARY KEY,
          recall_count INTEGER DEFAULT 0 NOT NULL,
          success_count INTEGER DEFAULT 0 NOT NULL,
          failure_count INTEGER DEFAULT 0 NOT NULL,
          avg_confidence REAL DEFAULT 0.0 NOT NULL,
          last_recalled_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE
        )
      `);

      // MetaMemoryService 초기화
      const { MetaMemoryService } = await import('../../introspection/meta-memory-service.js');
      const metaMemoryService = new MetaMemoryService(db);

      // context에 MetaMemoryService 추가
      context.services.metaMemoryService = metaMemoryService;

      // Mock 검색 결과
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [
          {
            id: memoryId1,
            memory_id: memoryId1,
            content: 'Test memory 1',
            type: 'episodic',
            importance: 0.8,
            created_at: new Date().toISOString(),
            final_score: 0.95,
            consolidation_score: 0.9,
            vectorScore: 0.85
          },
          {
            id: memoryId2,
            memory_id: memoryId2,
            content: 'Test memory 2',
            type: 'episodic',
            importance: 0.7,
            created_at: new Date().toISOString(),
            final_score: 0.3,
            consolidation_score: 0.2,
            vectorScore: 0.25
          }
        ],
        total_count: 2,
        query_time: 10
      });

      // When: include_metadata=true로 recall 호출
      const params = {
        query: 'test',
        limit: 10,
        include_metadata: true
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      // 검색 결과 확인
      expect(resultData.items).toBeDefined();
      expect(resultData.items.length).toBe(2);

      // 통계 업데이트를 위해 debounce 시간 대기 (100ms)
      await new Promise(resolve => setTimeout(resolve, 150));

      // MetaMemoryService destroy로 남은 버퍼 flush
      await metaMemoryService.destroy();

      // Then: meta_stats 필드가 포함되어야 함
      expect(resultData.meta_stats).toBeDefined();
      expect(typeof resultData.meta_stats).toBe('object');

      // meta_stats는 memory_id를 키로 하는 객체
      expect(resultData.meta_stats[memoryId1]).toBeDefined();
      expect(resultData.meta_stats[memoryId2]).toBeDefined();

      const stats1 = resultData.meta_stats[memoryId1];
      const stats2 = resultData.meta_stats[memoryId2];

      expect(stats1).toBeDefined();
      expect(stats1.recall_count).toBe(1);
      expect(stats1.success_count).toBe(1);
      expect(stats1.failure_count).toBe(0);
      expect(stats1.avg_confidence).toBeGreaterThan(0);
      expect(stats1.last_recalled_at).toBeDefined();

      expect(stats2).toBeDefined();
      expect(stats2.recall_count).toBe(1);
      expect(stats2.success_count).toBe(0);
      expect(stats2.failure_count).toBe(1);
      expect(stats2.avg_confidence).toBeGreaterThan(0);
      expect(stats2.last_recalled_at).toBeDefined();
    });

    it('given: include_metadata=true, when: recall이 반환되면, then: 고정 150ms 대기 없이 이번 호출 meta_stats가 포함되어야 함', async () => {
      const memoryId = 'mem_test_meta_stats_no_sleep';

      db.exec(`
        INSERT INTO memory_item (id, type, content, importance, created_at) VALUES ('${memoryId}', 'episodic', 'Test memory', 0.8, CURRENT_TIMESTAMP)
      `);

      const { MetaMemoryService } = await import('../../introspection/meta-memory-service.js');
      const metaMemoryService = new MetaMemoryService(db);
      context.services.metaMemoryService = metaMemoryService;

      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [
          {
            id: memoryId,
            memory_id: memoryId,
            content: 'Test memory',
            type: 'episodic',
            importance: 0.8,
            created_at: new Date().toISOString(),
            final_score: 0.95,
            consolidation_score: 0.9,
            vectorScore: 0.85
          }
        ],
        total_count: 1,
        query_time: 10
      });

      const started = Date.now();
      const result = await tool.handle(
        { query: 'test', type: 'episodic', limit: 10, include_metadata: true },
        context
      );
      const elapsedMs = Date.now() - started;
      const resultData = JSON.parse(result.content[0].text);

      expect(elapsedMs).toBeLessThan(80);
      expect(resultData.meta_stats?.[memoryId]?.recall_count).toBe(1);

      await metaMemoryService.destroy();
    });

    it('given: 같은 memory_id가 여러 번 검색 결과에 포함될 때, when: 통계를 확인하면, then: 각각 별도로 통계가 업데이트되어야 함', async () => {
      // Given: 메모리 항목 생성 및 검색 결과에 같은 memory_id가 2번 포함
      const memoryId = 'mem_test_meta_duplicate';

      // memory_item 테이블에 테스트 데이터 삽입
      db.exec(`
        INSERT INTO memory_item (id, type, content, importance, created_at) VALUES ('${memoryId}', 'episodic', 'Test memory', 0.8, CURRENT_TIMESTAMP)
      `);

      // meta_memory_stats 테이블 생성 (마이그레이션 실행)
      db.exec(`
        CREATE TABLE IF NOT EXISTS meta_memory_stats (
          memory_id TEXT PRIMARY KEY,
          recall_count INTEGER DEFAULT 0 NOT NULL,
          success_count INTEGER DEFAULT 0 NOT NULL,
          failure_count INTEGER DEFAULT 0 NOT NULL,
          avg_confidence REAL DEFAULT 0.0 NOT NULL,
          last_recalled_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE
        )
      `);

      // MetaMemoryService 초기화
      const { MetaMemoryService } = await import('../../introspection/meta-memory-service.js');
      const metaMemoryService = new MetaMemoryService(db);

      // context에 MetaMemoryService 추가
      context.services.metaMemoryService = metaMemoryService;

      // Mock 검색 결과 (같은 memory_id가 2번 포함)
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [
          {
            id: memoryId,
            memory_id: memoryId,
            content: 'Test memory',
            type: 'episodic',
            importance: 0.8,
            created_at: new Date().toISOString(),
            final_score: 0.95, // 첫 번째: 성공
            consolidation_score: 0.9,
            vectorScore: 0.85
          },
          {
            id: memoryId, // 같은 memory_id
            memory_id: memoryId,
            content: 'Test memory (duplicate)',
            type: 'episodic',
            importance: 0.8,
            created_at: new Date().toISOString(),
            final_score: 0.3, // 두 번째: 실패
            consolidation_score: 0.2,
            vectorScore: 0.25
          }
        ],
        total_count: 2,
        query_time: 10
      });

      // When: recall 호출
      const params = {
        query: 'test',
        limit: 10
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      // 검색 결과 확인
      expect(resultData.items).toBeDefined();
      expect(resultData.items.length).toBe(2);

      // 통계 업데이트를 위해 debounce 시간 대기 (100ms)
      await new Promise(resolve => setTimeout(resolve, 150));

      // MetaMemoryService destroy로 남은 버퍼 flush
      await metaMemoryService.destroy();

      // Then: 각각 별도로 통계가 업데이트되어야 함
      const stats = await metaMemoryService.getStatsById(memoryId);

      // 같은 memory_id가 2번 나타났으므로 recall_count는 2여야 함
      expect(stats.recall_count).toBe(2);
      // 첫 번째는 성공 (final_score >= 0.5), 두 번째는 실패 (final_score < 0.5)
      expect(stats.success_count).toBe(1);
      expect(stats.failure_count).toBe(1);
      expect(stats.avg_confidence).toBeGreaterThan(0);
      expect(stats.last_recalled_at).toBeDefined();
    });

    it('given: 통계 수집이 실패할 때, when: recall 응답을 확인하면, then: recall은 정상적으로 성공해야 함', async () => {
      // Given: 메모리 항목 생성 및 MetaMemoryService mock (에러 발생하도록)
      const memoryId = 'mem_test_meta_error';

      // memory_item 테이블에 테스트 데이터 삽입
      db.exec(`
        INSERT INTO memory_item (id, type, content, importance, created_at) VALUES ('${memoryId}', 'episodic', 'Test memory', 0.8, CURRENT_TIMESTAMP)
      `);

      // meta_memory_stats 테이블 생성 (마이그레이션 실행)
      db.exec(`
        CREATE TABLE IF NOT EXISTS meta_memory_stats (
          memory_id TEXT PRIMARY KEY,
          recall_count INTEGER DEFAULT 0 NOT NULL,
          success_count INTEGER DEFAULT 0 NOT NULL,
          failure_count INTEGER DEFAULT 0 NOT NULL,
          avg_confidence REAL DEFAULT 0.0 NOT NULL,
          last_recalled_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
          FOREIGN KEY (memory_id) REFERENCES memory_item(id) ON DELETE CASCADE
        )
      `);

      // MetaMemoryService 초기화
      const { MetaMemoryService } = await import('../../introspection/meta-memory-service.js');
      const metaMemoryService = new MetaMemoryService(db);

      // context에 MetaMemoryService 추가
      context.services.metaMemoryService = metaMemoryService;

      // MetaMemoryService.recordRecall을 mock하여 에러 발생하도록 설정
      const originalRecordRecall = metaMemoryService.recordRecall.bind(metaMemoryService);
      vi.spyOn(metaMemoryService, 'recordRecall').mockRejectedValue(new Error('통계 수집 실패'));

      // Mock 검색 결과
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [
          {
            id: memoryId,
            memory_id: memoryId,
            content: 'Test memory',
            type: 'episodic',
            importance: 0.8,
            created_at: new Date().toISOString(),
            final_score: 0.95,
            consolidation_score: 0.9,
            vectorScore: 0.85
          }
        ],
        total_count: 1,
        query_time: 10
      });

      // When: recall 호출
      const params = {
        query: 'test',
        limit: 10
      };

      const result = await tool.handle(params, context);
      const resultData = JSON.parse(result.content[0].text);

      // Then: recall은 정상적으로 성공해야 함
      expect(resultData.items).toBeDefined();
      expect(resultData.items.length).toBe(1);
      expect(resultData.items[0].memory_id).toBe(memoryId);
      expect(resultData.items[0].content).toBe('Test memory');
      expect(resultData.total_count).toBe(1);

      // 통계 수집이 실패했어도 recall은 성공해야 함
      // (에러가 발생했는지 확인하기 위해 spy 확인)
      expect(metaMemoryService.recordRecall).toHaveBeenCalled();
    });
  });

  describe('source 필드 round-trip (#671)', () => {
    const sourceUri = 'https://github.com/jee1/memento/issues/671';

    beforeEach(() => {
      vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
        items: [
          {
            id: 'mem_source_1',
            memory_id: 'mem_source_1',
            content: 'source round-trip test',
            type: 'semantic',
            importance: 0.7,
            created_at: new Date().toISOString(),
            source: sourceUri,
            final_score: 0.9,
          },
        ],
        total_count: 1,
        query_time: 5,
        text_count: 1,
        vector_count: 0,
      });
    });

    it('remember 시 저장한 source가 recall 응답에 포함된다', async () => {
      const result = await tool.handle(
        { query: 'source', type: 'semantic', include_metadata: true, limit: 5 },
        context,
      );
      const resultData = JSON.parse(result.content[0].text);

      expect(resultData.items).toHaveLength(1);
      expect(resultData.items[0].source).toBe(sourceUri);
    });
  });
});
