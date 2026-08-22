import { describe, it, expect, vi } from "vitest";
import { describeRecallTool, db, tool, context, hybridSearchEngine, anchorManager } from "./recall-tool.test-setup.js";

describeRecallTool("automatic anchors", () => {
  describe('자동 앵커 설정 및 이웃 기억 포함 파라미터 검증', () => {
    describe('RecallSchema 파라미터 검증', () => {
      it('given: 새 파라미터들 없음, when: 스키마 파싱, then: 기본값 확인', async () => {
        // Given: 새 파라미터들 없이 recall 호출
        const params = {
          query: 'test',
          limit: 10
        };

        // Mock 검색 결과
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [],
          total_count: 0,
          query_time: 10
        });

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: 기본값이 적용되어야 함 (기본값은 내부적으로 처리되므로 에러가 발생하지 않으면 성공)
        expect(resultData).toBeDefined();
        expect(resultData.items).toBeDefined();
      });

      it('given: auto_set_anchor=true, when: 스키마 파싱, then: 파라미터가 정상적으로 파싱되어야 함', async () => {
        // Given: auto_set_anchor=true로 설정
        const params = {
          query: 'test',
          limit: 10,
          auto_set_anchor: true
        };

        // Mock 검색 결과
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [],
          total_count: 0,
          query_time: 10
        });

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: 에러가 발생하지 않아야 함
        expect(resultData).toBeDefined();
      });

      it('given: include_neighbors=true, when: 스키마 파싱, then: 파라미터가 정상적으로 파싱되어야 함', async () => {
        // Given: include_neighbors=true로 설정
        const params = {
          query: 'test',
          limit: 10,
          include_neighbors: true
        };

        // Mock 검색 결과
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [],
          total_count: 0,
          query_time: 10
        });

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: 에러가 발생하지 않아야 함
        expect(resultData).toBeDefined();
      });

      it('given: neighbors_limit 범위 밖 값(0), when: 스키마 파싱, then: 검증 에러 발생', async () => {
        // Given: neighbors_limit=0 (최소값 1 미만)
        const params = {
          query: 'test',
          limit: 10,
          include_neighbors: true,
          neighbors_limit: 0
        };

        // When/Then: recall Tool 실행 시 검증 에러 발생해야 함
        await expect(tool.handle(params, context)).rejects.toThrow();
      });

      it('given: neighbors_limit 범위 밖 값(11), when: 스키마 파싱, then: 검증 에러 발생', async () => {
        // Given: neighbors_limit=11 (최대값 10 초과)
        const params = {
          query: 'test',
          limit: 10,
          include_neighbors: true,
          neighbors_limit: 11
        };

        // When/Then: recall Tool 실행 시 검증 에러 발생해야 함
        await expect(tool.handle(params, context)).rejects.toThrow();
      });

      it('given: neighbors_per_item 범위 밖 값(0), when: 스키마 파싱, then: 검증 에러 발생', async () => {
        // Given: neighbors_per_item=0 (최소값 1 미만)
        const params = {
          query: 'test',
          limit: 10,
          include_neighbors: true,
          neighbors_per_item: 0
        };

        // When/Then: recall Tool 실행 시 검증 에러 발생해야 함
        await expect(tool.handle(params, context)).rejects.toThrow();
      });

      it('given: neighbors_per_item 범위 밖 값(51), when: 스키마 파싱, then: 검증 에러 발생', async () => {
        // Given: neighbors_per_item=51 (최대값 50 초과)
        const params = {
          query: 'test',
          limit: 10,
          include_neighbors: true,
          neighbors_per_item: 51
        };

        // When/Then: recall Tool 실행 시 검증 에러 발생해야 함
        await expect(tool.handle(params, context)).rejects.toThrow();
      });

      it('given: neighbors_similarity_threshold 범위 밖 값(-0.1), when: 스키마 파싱, then: 검증 에러 발생', async () => {
        // Given: neighbors_similarity_threshold=-0.1 (최소값 0 미만)
        const params = {
          query: 'test',
          limit: 10,
          include_neighbors: true,
          neighbors_similarity_threshold: -0.1
        };

        // When/Then: recall Tool 실행 시 검증 에러 발생해야 함
        await expect(tool.handle(params, context)).rejects.toThrow();
      });

      it('given: neighbors_similarity_threshold 범위 밖 값(1.1), when: 스키마 파싱, then: 검증 에러 발생', async () => {
        // Given: neighbors_similarity_threshold=1.1 (최대값 1 초과)
        const params = {
          query: 'test',
          limit: 10,
          include_neighbors: true,
          neighbors_similarity_threshold: 1.1
        };

        // When/Then: recall Tool 실행 시 검증 에러 발생해야 함
        await expect(tool.handle(params, context)).rejects.toThrow();
      });

      it('given: 유효한 범위 내 값들, when: 스키마 파싱, then: 정상적으로 파싱되어야 함', async () => {
        // Given: 모든 새 파라미터를 유효한 범위 내 값으로 설정
        const params = {
          query: 'test',
          limit: 10,
          auto_set_anchor: true,
          include_neighbors: true,
          neighbors_limit: 5,
          neighbors_per_item: 10,
          neighbors_similarity_threshold: 0.75
        };

        // Mock 검색 결과
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [],
          total_count: 0,
          query_time: 10
        });

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: 에러가 발생하지 않아야 함
        expect(resultData).toBeDefined();
      });
    });
  });

  describe('자동 앵커 설정', () => {
    describe('자동 앵커 설정 성공 시나리오', () => {
      it('given: 검색 결과 있음, when: auto_set_anchor=true, then: 슬롯 A에 앵커 설정됨', async () => {
        // Given: 검색 결과가 있는 상황
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

        // Then: 슬롯 A에 앵커가 설정되어야 함
        const anchor = db.prepare(`
          SELECT memory_id, slot FROM anchor WHERE agent_id = ? AND slot = 'A'
        `).get(agentId) as { memory_id: string; slot: string } | undefined;

        expect(anchor).toBeDefined();
        expect(anchor?.memory_id).toBe(memoryId);
        expect(anchor?.slot).toBe('A');

        // Then: metadata에 anchor_set이 포함되어야 함
        expect(resultData.metadata).toBeDefined();
        expect(resultData.metadata.anchor_set).toBeDefined();
        expect(resultData.metadata.anchor_set.memory_id).toBe(memoryId);
        expect(resultData.metadata.anchor_set.slot).toBe('A');
        expect(resultData.metadata.anchor_set.agent_id).toBe(agentId);
        expect(resultData.metadata.anchor_set_error).toBeUndefined();
        expect(resultData.metadata.anchor_set_skipped).toBeUndefined();
      });
    });

    describe('슬롯 회전 로직', () => {
      it('given: 슬롯 A/B/C에 앵커 있음, when: auto_set_anchor=true, then: A→B→C→제거 순서로 이동', async () => {
        // Given: 슬롯 A/B/C에 앵커가 있는 상황
        const agentId = 'default';
        const memoryIdA = 'mem_slot_a';
        const memoryIdB = 'mem_slot_b';
        const memoryIdC = 'mem_slot_c';
        const newMemoryId = 'mem_new';

        // 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES (?, 'episodic', 'Memory A', 0.8, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Memory B', 0.7, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Memory C', 0.6, CURRENT_TIMESTAMP),
            (?, 'episodic', 'New Memory', 0.9, CURRENT_TIMESTAMP)
        `).run(memoryIdA, memoryIdB, memoryIdC, newMemoryId);

        // 슬롯 A, B, C에 앵커 설정
        await anchorManager.setAnchor(agentId, memoryIdA, 'A');
        await anchorManager.setAnchor(agentId, memoryIdB, 'B');
        await anchorManager.setAnchor(agentId, memoryIdC, 'C');

        // Mock 검색 결과 (새로운 메모리가 첫 번째 결과)
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: newMemoryId,
              content: 'New Memory',
              type: 'episodic',
              importance: 0.9,
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

        // Then: A→B→C→제거 순서로 이동
        // 슬롯 A에 새로운 앵커가 설정되어야 함
        const slotA = db.prepare(`
          SELECT memory_id FROM anchor WHERE agent_id = ? AND slot = 'A'
        `).get(agentId) as { memory_id: string } | undefined;
        expect(slotA?.memory_id).toBe(newMemoryId);

        // 슬롯 B에 기존 A의 앵커가 이동해야 함
        const slotB = db.prepare(`
          SELECT memory_id FROM anchor WHERE agent_id = ? AND slot = 'B'
        `).get(agentId) as { memory_id: string } | undefined;
        expect(slotB?.memory_id).toBe(memoryIdA);

        // 슬롯 C에 기존 B의 앵커가 이동해야 함
        const slotC = db.prepare(`
          SELECT memory_id FROM anchor WHERE agent_id = ? AND slot = 'C'
        `).get(agentId) as { memory_id: string } | undefined;
        expect(slotC?.memory_id).toBe(memoryIdB);

        // 기존 C의 앵커는 제거되어야 함 (더 이상 존재하지 않음)
        const oldSlotC = db.prepare(`
          SELECT memory_id FROM anchor WHERE agent_id = ? AND memory_id = ?
        `).get(agentId, memoryIdC);
        expect(oldSlotC).toBeUndefined();

        // Then: metadata에 anchor_set이 포함되어야 함
        expect(resultData.metadata).toBeDefined();
        expect(resultData.metadata.anchor_set).toBeDefined();
        expect(resultData.metadata.anchor_set.memory_id).toBe(newMemoryId);
        expect(resultData.metadata.anchor_set.slot).toBe('A');
      });
    });

    describe('슬롯 A의 pinned 앵커 보호 정책', () => {
      it('given: 슬롯 A에 pinned 앵커 있음, when: auto_set_anchor=true, then: 앵커 설정 건너뜀', async () => {
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

        // Then: 슬롯 A의 앵커가 변경되지 않아야 함 (pinned 앵커 보호)
        const slotA = db.prepare(`
          SELECT memory_id FROM anchor WHERE agent_id = ? AND slot = 'A'
        `).get(agentId) as { memory_id: string } | undefined;
        expect(slotA?.memory_id).toBe(pinnedMemoryId);

        // Then: metadata에 anchor_set_skipped가 포함되어야 함
        expect(resultData.metadata).toBeDefined();
        expect(resultData.metadata.anchor_set).toBeNull();
        expect(resultData.metadata.anchor_set_skipped).toBe(true);
        expect(resultData.metadata.anchor_set_skipped_reason).toBe('pinned_anchor_protected');
        expect(resultData.metadata.anchor_set_error).toBeUndefined();
      });
    });

    describe('슬롯 B/C의 pinned 앵커 덮어쓰기', () => {
      it('given: 슬롯 B에 pinned 앵커 있음, when: auto_set_anchor=true, then: 경고 로그 및 덮어쓰기', async () => {
        // Given: 슬롯 B에 pinned 앵커가 있는 상황
        const agentId = 'default';
        const memoryIdA = 'mem_slot_a';
        const pinnedMemoryIdB = 'mem_pinned_b';
        const newMemoryId = 'mem_new';

        // 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, pinned, created_at) VALUES (?, 'episodic', 'Memory A', 0.8, 0, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Pinned Memory B', 0.9, 1, CURRENT_TIMESTAMP),
            (?, 'episodic', 'New Memory', 0.85, 0, CURRENT_TIMESTAMP)
        `).run(memoryIdA, pinnedMemoryIdB, newMemoryId);

        // 슬롯 A와 B에 앵커 설정 (B는 pinned)
        await anchorManager.setAnchor(agentId, memoryIdA, 'A');
        await anchorManager.setAnchor(agentId, pinnedMemoryIdB, 'B');

        // Mock 검색 결과 (새로운 메모리가 첫 번째 결과)
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: newMemoryId,
              content: 'New Memory',
              type: 'episodic',
              importance: 0.85,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            }
          ],
          total_count: 1,
          query_time: 10
        });

        // logWarning spy 설정
        const logWarningSpy = vi.spyOn(tool as any, 'logWarning');

        const params = {
          query: 'test',
          limit: 10,
          auto_set_anchor: true,
          agent_id: agentId
        };

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: 슬롯 B의 pinned 앵커가 덮어써졌는지 확인
        const slotB = db.prepare(`
          SELECT memory_id FROM anchor WHERE agent_id = ? AND slot = 'B'
        `).get(agentId) as { memory_id: string } | undefined;
        expect(slotB?.memory_id).toBe(memoryIdA); // 기존 A의 앵커가 B로 이동

        // Then: 경고 로그가 기록되었는지 확인
        expect(logWarningSpy).toHaveBeenCalledWith(
          '슬롯 B의 pinned 앵커가 덮어써집니다',
          expect.objectContaining({
            agent_id: agentId,
            old_memory_id: pinnedMemoryIdB,
            new_memory_id: memoryIdA
          })
        );

        // Then: 슬롯 A에 새로운 앵커가 설정되어야 함
        const slotA = db.prepare(`
          SELECT memory_id FROM anchor WHERE agent_id = ? AND slot = 'A'
        `).get(agentId) as { memory_id: string } | undefined;
        expect(slotA?.memory_id).toBe(newMemoryId);

        // Then: metadata에 anchor_set이 포함되어야 함
        expect(resultData.metadata).toBeDefined();
        expect(resultData.metadata.anchor_set).toBeDefined();
        expect(resultData.metadata.anchor_set.memory_id).toBe(newMemoryId);
      });

      it('given: 슬롯 C에 pinned 앵커 있음, when: auto_set_anchor=true, then: 경고 로그 및 제거', async () => {
        // Given: 슬롯 C에 pinned 앵커가 있는 상황
        const agentId = 'default';
        const memoryIdA = 'mem_slot_a';
        const memoryIdB = 'mem_slot_b';
        const pinnedMemoryIdC = 'mem_pinned_c';
        const newMemoryId = 'mem_new';

        // 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, pinned, created_at) VALUES (?, 'episodic', 'Memory A', 0.8, 0, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Memory B', 0.7, 0, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Pinned Memory C', 0.9, 1, CURRENT_TIMESTAMP),
            (?, 'episodic', 'New Memory', 0.85, 0, CURRENT_TIMESTAMP)
        `).run(memoryIdA, memoryIdB, pinnedMemoryIdC, newMemoryId);

        // 슬롯 A, B, C에 앵커 설정 (C는 pinned)
        await anchorManager.setAnchor(agentId, memoryIdA, 'A');
        await anchorManager.setAnchor(agentId, memoryIdB, 'B');
        await anchorManager.setAnchor(agentId, pinnedMemoryIdC, 'C');

        // Mock 검색 결과 (새로운 메모리가 첫 번째 결과)
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: newMemoryId,
              content: 'New Memory',
              type: 'episodic',
              importance: 0.85,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            }
          ],
          total_count: 1,
          query_time: 10
        });

        // logWarning spy 설정
        const logWarningSpy = vi.spyOn(tool as any, 'logWarning');

        const params = {
          query: 'test',
          limit: 10,
          auto_set_anchor: true,
          agent_id: agentId
        };

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: 슬롯 C의 pinned 앵커가 제거되고 B의 앵커가 C로 이동했는지 확인
        // PRD: 슬롯 B/C의 pinned 앵커도 덮어쓰고 A→B→C→제거 순으로 회전
        const slotC = db.prepare(`
          SELECT memory_id FROM anchor WHERE agent_id = ? AND slot = 'C'
        `).get(agentId) as { memory_id: string } | undefined;
        expect(slotC?.memory_id).toBe(memoryIdB); // 슬롯 B의 앵커가 C로 이동

        // Then: 경고 로그가 기록되었는지 확인
        expect(logWarningSpy).toHaveBeenCalledWith(
          '슬롯 C의 pinned 앵커가 제거됩니다',
          expect.objectContaining({
            agent_id: agentId,
            old_memory_id: pinnedMemoryIdC
          })
        );

        // Then: 슬롯 A에 새로운 앵커가 설정되어야 함
        const slotA = db.prepare(`
          SELECT memory_id FROM anchor WHERE agent_id = ? AND slot = 'A'
        `).get(agentId) as { memory_id: string } | undefined;
        expect(slotA?.memory_id).toBe(newMemoryId);

        // Then: 슬롯 B에 기존 A의 앵커가 이동해야 함
        const slotB = db.prepare(`
          SELECT memory_id FROM anchor WHERE agent_id = ? AND slot = 'B'
        `).get(agentId) as { memory_id: string } | undefined;
        expect(slotB?.memory_id).toBe(memoryIdA);

        // Then: metadata에 anchor_set이 포함되어야 함
        expect(resultData.metadata).toBeDefined();
        expect(resultData.metadata.anchor_set).toBeDefined();
        expect(resultData.metadata.anchor_set.memory_id).toBe(newMemoryId);
      });
    });

    describe('앵커 설정 실패 시 에러 처리', () => {
      it('given: 앵커 설정 실패, when: auto_set_anchor=true, then: 검색 결과는 정상 반환, metadata에 anchor_set_error 포함', async () => {
        // Given: 앵커 설정이 실패하는 상황
        const agentId = 'default';
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

        // AnchorManager.setAnchor를 mock하여 에러 발생시키기
        const setAnchorError = new Error('앵커 설정 실패');
        vi.spyOn(anchorManager, 'setAnchor').mockRejectedValue(setAnchorError);

        // logError spy 설정
        const logErrorSpy = vi.spyOn(tool as any, 'logError');

        const params = {
          query: 'test',
          limit: 10,
          auto_set_anchor: true,
          agent_id: agentId
        };

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: 검색 결과는 정상 반환되어야 함
        expect(resultData.items).toBeDefined();
        expect(resultData.items.length).toBe(1);
        expect(resultData.items[0].id).toBe(memoryId);

        // Then: metadata에 anchor_set_error가 포함되어야 함
        expect(resultData.metadata).toBeDefined();
        expect(resultData.metadata.anchor_set).toBeNull();
        expect(resultData.metadata.anchor_set_error).toBe(true);
        expect(resultData.metadata.anchor_set_skipped).toBeUndefined();

        // Then: 에러 로그가 기록되었는지 확인
        expect(logErrorSpy).toHaveBeenCalledWith(
          setAnchorError,
          '앵커 자동 설정 실패',
          expect.objectContaining({
            agent_id: agentId,
            memory_id: memoryId
          })
        );
      });
    });
  });

});
