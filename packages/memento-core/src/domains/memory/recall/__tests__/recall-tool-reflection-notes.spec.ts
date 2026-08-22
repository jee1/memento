import { describe, it, expect, beforeEach, vi } from "vitest";
import { DatabaseUtils } from "../../../../shared/utils/database.js";
import { describeRecallTool, db, tool, context, hybridSearchEngine } from "./recall-tool.test-setup.js";

describeRecallTool("reflection notes", () => {
  describe('reflection_notes 조회', () => {
    const createValidReflectionNote = (overrides: Partial<any> = {}) => ({
      failure_type: 'tool_error',
      failure_description: 'Test error',
      timestamp: new Date().toISOString(),
      ...overrides
    });

    beforeEach(() => {
      // 테스트용 procedural memory 데이터 생성
      const reflectionNote1 = createValidReflectionNote({
        timestamp: '2025-01-01T00:00:00Z',
        failure_description: 'Error 1'
      });
      const reflectionNote2 = createValidReflectionNote({
        timestamp: '2025-01-02T00:00:00Z',
        failure_description: 'Error 2'
      });

      // reflection_notes가 있는 procedural memory
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, task_goal, steps, reflection_notes, importance, privacy_scope, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        'proc_1',
        'procedural',
        'Test procedure 1',
        'Task A',
        JSON.stringify(['step1', 'step2']),
        JSON.stringify(reflectionNote1),
        0.8,
        'private',
        new Date().toISOString()
      ]);

      // reflection_notes가 배열인 procedural memory
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, task_goal, steps, reflection_notes, importance, privacy_scope, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        'proc_2',
        'procedural',
        'Test procedure 2',
        'Task B',
        JSON.stringify(['step1']),
        JSON.stringify([reflectionNote1, reflectionNote2]),
        0.7,
        'private',
        new Date().toISOString()
      ]);

      // reflection_notes가 없는 procedural memory
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, task_goal, steps, reflection_notes, importance, privacy_scope, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        'proc_3',
        'procedural',
        'Test procedure 3',
        'Task C',
        JSON.stringify(['step1']),
        null,
        0.6,
        'private',
        new Date().toISOString()
      ]);

      // episodic memory (reflection_notes 없음)
      DatabaseUtils.run(db, `
        INSERT INTO memory_item (id, type, content, importance, privacy_scope, created_at) VALUES (?, ?, ?, ?, ?, ?)
      `, [
        'epi_1',
        'episodic',
        'Test episodic memory',
        0.5,
        'private',
        new Date().toISOString()
      ]);

      // FTS5 인덱스 생성 (검색을 위해 필요)
      try {
        db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS memory_item_fts USING fts5(
            content,
            tags,
            reflection_notes,
            content=memory_item,
            content_rowid=rowid
          );
        `);

        // FTS5 인덱스에 데이터 삽입
        db.exec(`
          INSERT INTO memory_item_fts(rowid, content, tags, reflection_notes)
          SELECT rowid, content, tags, reflection_notes FROM memory_item;
        `);
      } catch (error) {
        // FTS5 테이블이 이미 존재하거나 생성 실패 시 무시
      }
    });

    describe('includeMetadata가 true일 때 reflection_notes 포함', () => {
      it('should include reflection_notes when includeMetadata is true', async () => {
        const params = {
          query: 'Test procedure',
          type: 'procedural',
          include_metadata: true,
          limit: 10
        };

        vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: 'proc_1',
              content: 'Test procedure 1',
              type: 'procedural',
              importance: 0.8,
              created_at: new Date().toISOString(),
              task_goal: 'Task A',
              steps: JSON.stringify(['step1', 'step2']),
              reflection_notes: JSON.stringify(createValidReflectionNote({
                timestamp: '2025-01-01T00:00:00Z',
                failure_description: 'Error 1'
              })),
              finalScore: 0.9,
              textScore: 0.5,
              vectorScore: 0.4,
              pinned: false,
              recall_reason: 'hybrid'
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        expect(resultData.items).toBeDefined();
        expect(resultData.items.length).toBeGreaterThan(0);

        const proceduralItem = resultData.items.find((item: any) => item.type === 'procedural');
        expect(proceduralItem).toBeDefined();
        expect(proceduralItem.reflection_notes).toBeDefined();
        expect(proceduralItem.reflection_notes).not.toBeNull();
      });

      it('should not include reflection_notes when includeMetadata is false', async () => {
        const params = {
          query: 'Test procedure',
          type: 'procedural',
          include_metadata: false,
          limit: 10
        };

        vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: 'proc_1',
              content: 'Test procedure 1',
              type: 'procedural',
              importance: 0.8,
              created_at: new Date().toISOString(),
              reflection_notes: JSON.stringify(createValidReflectionNote()),
              finalScore: 0.9,
              textScore: 0.5,
              vectorScore: 0.4,
              pinned: false,
              recall_reason: 'hybrid'
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        expect(resultData.items).toBeDefined();
        const proceduralItem = resultData.items.find((item: any) => item.type === 'procedural');
        expect(proceduralItem).toBeDefined();
        expect(proceduralItem.reflection_notes).toBeUndefined();
      });
    });

    describe('Procedural Memory 조회 시 reflection_notes 자동 포함', () => {
      it('should automatically include reflection_notes for procedural memory', async () => {
        const params = {
          query: 'Test procedure',
          type: 'procedural',
          include_metadata: true,
          limit: 10
        };

        vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: 'proc_1',
              content: 'Test procedure 1',
              type: 'procedural',
              importance: 0.8,
              created_at: new Date().toISOString(),
              task_goal: 'Task A',
              steps: JSON.stringify(['step1', 'step2']),
              reflection_notes: JSON.stringify(createValidReflectionNote()),
              finalScore: 0.9,
              textScore: 0.5,
              vectorScore: 0.4,
              pinned: false,
              recall_reason: 'hybrid'
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        const proceduralItem = resultData.items.find((item: any) => item.type === 'procedural');
        expect(proceduralItem).toBeDefined();
        expect(proceduralItem.reflection_notes).toBeDefined();
        expect(proceduralItem.task_goal).toBe('Task A');
        expect(proceduralItem.steps).toBeDefined();
      });

      it('should not include reflection_notes for non-procedural memory', async () => {
        const params = {
          query: 'Test episodic',
          type: 'episodic',
          include_metadata: true,
          limit: 10
        };

        vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: 'epi_1',
              content: 'Test episodic memory',
              type: 'episodic',
              importance: 0.5,
              created_at: new Date().toISOString(),
              finalScore: 0.8,
              textScore: 0.5,
              vectorScore: 0.3,
              pinned: false,
              recall_reason: 'hybrid'
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        const episodicItem = resultData.items.find((item: any) => item.type === 'episodic');
        expect(episodicItem).toBeDefined();
        expect(episodicItem.reflection_notes).toBeUndefined();
        expect(episodicItem.task_goal).toBeUndefined();
        expect(episodicItem.steps).toBeUndefined();
      });
    });

    describe('reflection_notes JSON 파싱', () => {
      it('should parse reflection_notes from string to object', async () => {
        const reflectionNote = createValidReflectionNote({
          timestamp: '2025-01-01T00:00:00Z',
          failure_description: 'Error 1'
        });

        const params = {
          query: 'Test procedure',
          type: 'procedural',
          include_metadata: true,
          limit: 10
        };

        vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: 'proc_1',
              content: 'Test procedure 1',
              type: 'procedural',
              importance: 0.8,
              created_at: new Date().toISOString(),
              task_goal: 'Task A',
              steps: JSON.stringify(['step1', 'step2']),
              reflection_notes: JSON.stringify(reflectionNote),
              finalScore: 0.9,
              textScore: 0.5,
              vectorScore: 0.4,
              pinned: false,
              recall_reason: 'hybrid'
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        const proceduralItem = resultData.items.find((item: any) => item.type === 'procedural');
        expect(proceduralItem).toBeDefined();
        expect(proceduralItem.reflection_notes).toBeDefined();
        expect(typeof proceduralItem.reflection_notes).toBe('object');
        expect(proceduralItem.reflection_notes.failure_type).toBe('tool_error');
        expect(proceduralItem.reflection_notes.failure_description).toBe('Error 1');
      });

      it('should parse reflection_notes from string to array', async () => {
        const reflectionNotes = [
          createValidReflectionNote({ timestamp: '2025-01-01T00:00:00Z', failure_description: 'Error 1' }),
          createValidReflectionNote({ timestamp: '2025-01-02T00:00:00Z', failure_description: 'Error 2' })
        ];

        const params = {
          query: 'Test procedure',
          type: 'procedural',
          include_metadata: true,
          limit: 10
        };

        vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: 'proc_2',
              content: 'Test procedure 2',
              type: 'procedural',
              importance: 0.7,
              created_at: new Date().toISOString(),
              task_goal: 'Task B',
              steps: JSON.stringify(['step1']),
              reflection_notes: JSON.stringify(reflectionNotes),
              finalScore: 0.8,
              textScore: 0.5,
              vectorScore: 0.3,
              pinned: false,
              recall_reason: 'hybrid'
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        const proceduralItem = resultData.items.find((item: any) => item.type === 'procedural');
        expect(proceduralItem).toBeDefined();
        expect(proceduralItem.reflection_notes).toBeDefined();
        expect(Array.isArray(proceduralItem.reflection_notes)).toBe(true);
        expect(proceduralItem.reflection_notes).toHaveLength(2);
        expect(proceduralItem.reflection_notes[0].failure_description).toBe('Error 1');
        expect(proceduralItem.reflection_notes[1].failure_description).toBe('Error 2');
      });

      it('should return original string when JSON parsing fails', async () => {
        const params = {
          query: 'Test procedure',
          type: 'procedural',
          include_metadata: true,
          limit: 10
        };

        vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: 'proc_1',
              content: 'Test procedure 1',
              type: 'procedural',
              importance: 0.8,
              created_at: new Date().toISOString(),
              task_goal: 'Task A',
              steps: JSON.stringify(['step1', 'step2']),
              reflection_notes: '{ invalid json }',
              finalScore: 0.9,
              textScore: 0.5,
              vectorScore: 0.4,
              pinned: false,
              recall_reason: 'hybrid'
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        const proceduralItem = resultData.items.find((item: any) => item.type === 'procedural');
        expect(proceduralItem).toBeDefined();
        expect(proceduralItem.reflection_notes).toBeDefined();
        expect(typeof proceduralItem.reflection_notes).toBe('string');
        expect(proceduralItem.reflection_notes).toBe('{ invalid json }');
      });

      it('should return null when reflection_notes is null', async () => {
        const params = {
          query: 'Test procedure',
          type: 'procedural',
          include_metadata: true,
          limit: 10
        };

        vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: 'proc_3',
              content: 'Test procedure 3',
              type: 'procedural',
              importance: 0.6,
              created_at: new Date().toISOString(),
              task_goal: 'Task C',
              steps: JSON.stringify(['step1']),
              reflection_notes: null,
              finalScore: 0.7,
              textScore: 0.5,
              vectorScore: 0.2,
              pinned: false,
              recall_reason: 'hybrid'
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        const proceduralItem = resultData.items.find((item: any) => item.type === 'procedural');
        expect(proceduralItem).toBeDefined();
        expect(proceduralItem.reflection_notes).toBeNull();
      });
    });

    describe('has_reflection_notes 필터링', () => {
      it('should filter memories with reflection_notes when has_reflection_notes is true', async () => {
        const params = {
          query: 'Test procedure',
          type: 'procedural',
          has_reflection_notes: true,
          include_metadata: true,
          limit: 10
        };

        // has_reflection_notes 필터가 적용되어야 함
        vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: 'proc_1',
              content: 'Test procedure 1',
              type: 'procedural',
              importance: 0.8,
              created_at: new Date().toISOString(),
              task_goal: 'Task A',
              steps: JSON.stringify(['step1', 'step2']),
              reflection_notes: JSON.stringify(createValidReflectionNote()),
              finalScore: 0.9,
              textScore: 0.5,
              vectorScore: 0.4,
              pinned: false,
              recall_reason: 'hybrid'
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // has_reflection_notes 필터가 search 호출에 전달되었는지 확인
        expect(hybridSearchEngine.search).toHaveBeenCalled();
        const searchCall = (hybridSearchEngine.search as any).mock.calls[0];
        const searchQuery = searchCall[1];
        expect(searchQuery.filters?.has_reflection_notes).toBe(true);
      });

      it('should filter memories without reflection_notes when has_reflection_notes is false', async () => {
        const params = {
          query: 'Test procedure',
          type: 'procedural',
          has_reflection_notes: false,
          include_metadata: true,
          limit: 10
        };

        vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: 'proc_3',
              content: 'Test procedure 3',
              type: 'procedural',
              importance: 0.6,
              created_at: new Date().toISOString(),
              task_goal: 'Task C',
              steps: JSON.stringify(['step1']),
              reflection_notes: null,
              finalScore: 0.7,
              textScore: 0.5,
              vectorScore: 0.2,
              pinned: false,
              recall_reason: 'hybrid'
            }
          ],
          total_count: 1,
          query_time: 10
        });

        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // has_reflection_notes 필터가 search 호출에 전달되었는지 확인
        expect(hybridSearchEngine.search).toHaveBeenCalled();
        const searchCall = (hybridSearchEngine.search as any).mock.calls[0];
        const searchQuery = searchCall[1];
        expect(searchQuery.filters?.has_reflection_notes).toBe(false);
      });
    });

    describe('Procedural Memory Enhancement (v7.0)', () => {
      beforeEach(() => {
        // Mock hybridSearchEngine 메서드들
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [],
          total_count: 0,
          query_time: 10
        });
        vi.spyOn(hybridSearchEngine, 'isEmbeddingAvailable').mockReturnValue(true);
      });

      describe('workflow_name/skill_name 필터링', () => {
        it('should filter by workflow_name', async () => {
          // Given: workflow_name이 있는 procedural memory 생성
          DatabaseUtils.run(db, `
            INSERT INTO memory_item (id, type, content, workflow_name, skill_name) VALUES ('mem1', 'procedural', 'Test procedure', '데이터 마이그레이션', '스키마 백업')
          `);

          const params = {
            query: 'test',
            type: 'procedural',
            workflow_name: '데이터 마이그레이션'
          };

          // Mock 검색 결과
          vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
            items: [
              {
                id: 'mem1',
                content: 'Test procedure',
                type: 'procedural',
                workflow_name: '데이터 마이그레이션',
                skill_name: '스키마 백업',
                importance: 0.5,
                created_at: new Date(),
                finalScore: 0.8
              }
            ],
            total_count: 1,
            query_time: 10
          });

          // When: recall Tool 실행
          const result = await tool.handle(params, context);
          const resultData = JSON.parse(result.content[0].text);

          // Then: workflow_name 필터가 전달되어야 함
          expect(hybridSearchEngine.search).toHaveBeenCalled();
          const searchCall = vi.mocked(hybridSearchEngine.search).mock.calls[0];
          const searchQuery = searchCall[1];
          expect(searchQuery.filters?.workflow_name).toBe('데이터 마이그레이션');
        });

        it('should filter by skill_name', async () => {
          // Given: skill_name이 있는 procedural memory 생성
          DatabaseUtils.run(db, `
            INSERT INTO memory_item (id, type, content, workflow_name, skill_name) VALUES ('mem1', 'procedural', 'Test procedure', '데이터 마이그레이션', '스키마 백업')
          `);

          const params = {
            query: 'test',
            type: 'procedural',
            skill_name: '스키마 백업'
          };

          // Mock 검색 결과
          vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
            items: [
              {
                id: 'mem1',
                content: 'Test procedure',
                type: 'procedural',
                workflow_name: '데이터 마이그레이션',
                skill_name: '스키마 백업',
                importance: 0.5,
                created_at: new Date(),
                finalScore: 0.8
              }
            ],
            total_count: 1,
            query_time: 10
          });

          // When: recall Tool 실행
          const result = await tool.handle(params, context);
          const resultData = JSON.parse(result.content[0].text);

          // Then: skill_name 필터가 전달되어야 함
          expect(hybridSearchEngine.search).toHaveBeenCalled();
          const searchCall = vi.mocked(hybridSearchEngine.search).mock.calls[0];
          const searchQuery = searchCall[1];
          expect(searchQuery.filters?.skill_name).toBe('스키마 백업');
        });
      });

      describe('trigger_conditions 매칭', () => {
        it('should filter by trigger_conditions when match_trigger_conditions is true', async () => {
          // Given: trigger_conditions가 있는 procedural memory 생성
          DatabaseUtils.run(db, `
            INSERT INTO memory_item (id, type, content, workflow_name, skill_name, trigger_conditions) VALUES ('mem1', 'procedural', 'Test procedure', '데이터 마이그레이션', '스키마 백업', '{"event": "migration_start"}')
          `);

          const params = {
            query: 'migration_start', // trigger_conditions의 값과 매칭되도록 수정
            type: 'procedural',
            match_trigger_conditions: true
          };

          // Mock 검색 결과 (trigger_conditions가 있는 항목과 없는 항목)
          vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
            items: [
              {
                id: 'mem1',
                content: 'Test procedure',
                type: 'procedural',
                workflow_name: '데이터 마이그레이션',
                skill_name: '스키마 백업',
                trigger_conditions: '{"event": "migration_start"}',
                importance: 0.5,
                created_at: new Date(),
                finalScore: 0.8
              },
              {
                id: 'mem2',
                content: 'Another procedure',
                type: 'procedural',
                workflow_name: 'API 배포',
                skill_name: '배포 검증',
                trigger_conditions: null,
                importance: 0.5,
                created_at: new Date(),
                finalScore: 0.7
              }
            ],
            total_count: 2,
            query_time: 10
          });

          // When: recall Tool 실행
          const result = await tool.handle(params, context);
          const resultData = JSON.parse(result.content[0].text);

          // Then: trigger_conditions가 있는 항목만 반환되어야 함
          expect(resultData.items).toHaveLength(1);
          expect(resultData.items[0].memory_id).toBe('mem1');
          expect(resultData.items[0].trigger_conditions).toBeDefined();
        });

        it('should require all keys in trigger_conditions to match (not just first key)', async () => {
          // Given: 여러 키를 가진 trigger_conditions가 있는 procedural memory
          DatabaseUtils.run(db, `
            INSERT INTO memory_item (id, type, content, workflow_name, skill_name, trigger_conditions) VALUES ('mem_all_match', 'procedural', 'All match procedure', '데이터 마이그레이션', '스키마 백업', '{"tool_name": "remember", "error_type": "tool_error"}'),
              ('mem_partial_match', 'procedural', 'Partial match procedure', 'API 배포', '배포 검증', '{"tool_name": "remember", "error_type": "validation_error"}')
          `);

          // Mock 검색 결과
          vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
            items: [
              {
                id: 'mem_all_match',
                content: 'All match procedure',
                type: 'procedural',
                workflow_name: '데이터 마이그레이션',
                skill_name: '스키마 백업',
                trigger_conditions: '{"tool_name": "remember", "error_type": "tool_error"}',
                importance: 0.5,
                created_at: new Date(),
                finalScore: 0.8
              },
              {
                id: 'mem_partial_match',
                content: 'Partial match procedure',
                type: 'procedural',
                workflow_name: 'API 배포',
                skill_name: '배포 검증',
                trigger_conditions: '{"tool_name": "remember", "error_type": "validation_error"}',
                importance: 0.5,
                created_at: new Date(),
                finalScore: 0.7
              }
            ],
            total_count: 2,
            query_time: 10
          });

          // When: 모든 키가 매칭되는 컨텍스트로 검색
          const params = {
            query: 'remember tool error',
            type: 'procedural',
            match_trigger_conditions: true,
            trigger_context: {
              tool_name: 'remember',
              error_type: 'tool_error'
            }
          };

          const result = await tool.handle(params, context);
          const resultData = JSON.parse(result.content[0].text);

          // Then: 모든 키가 매칭되는 항목만 반환되어야 함 (첫 번째 키만 맞는 항목은 제외)
          expect(resultData.items).toHaveLength(1);
          expect(resultData.items[0].memory_id).toBe('mem_all_match');
          expect(resultData.items[0].memory_id).not.toBe('mem_partial_match');
        });

        it('should reject when trigger_conditions key is missing in context', async () => {
          // Given: 여러 키를 가진 trigger_conditions가 있는 procedural memory
          DatabaseUtils.run(db, `
            INSERT INTO memory_item (id, type, content, workflow_name, skill_name, trigger_conditions) VALUES ('mem_missing_key', 'procedural', 'Missing key procedure', '데이터 마이그레이션', '스키마 백업', '{"tool_name": "remember", "error_type": "tool_error"}')
          `);

          // Mock 검색 결과
          vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
            items: [
              {
                id: 'mem_missing_key',
                content: 'Missing key procedure',
                type: 'procedural',
                workflow_name: '데이터 마이그레이션',
                skill_name: '스키마 백업',
                trigger_conditions: '{"tool_name": "remember", "error_type": "tool_error"}',
                importance: 0.5,
                created_at: new Date(),
                finalScore: 0.8
              }
            ],
            total_count: 1,
            query_time: 10
          });

          // When: 일부 키만 있는 컨텍스트로 검색 (error_type 누락)
          const params = {
            query: 'remember',
            type: 'procedural',
            match_trigger_conditions: true,
            trigger_context: {
              tool_name: 'remember'
              // error_type 누락
            }
          };

          const result = await tool.handle(params, context);
          const resultData = JSON.parse(result.content[0].text);

          // Then: 매칭되지 않아야 함 (모든 키가 필요하므로)
          expect(resultData.items).toHaveLength(0);
        });
      });

      describe('return_format 처리', () => {
        it('should return only steps when return_format is steps_only', async () => {
          // Given: procedural memory 생성
          DatabaseUtils.run(db, `
            INSERT INTO memory_item (id, type, content, workflow_name, skill_name, steps) VALUES ('mem1', 'procedural', 'Test procedure', '데이터 마이그레이션', '스키마 백업', '["step1", "step2", "step3"]')
          `);

          const params = {
            query: 'test',
            type: 'procedural',
            return_format: 'steps_only'
          };

          // Mock 검색 결과
          vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
            items: [
              {
                id: 'mem1',
                content: 'Test procedure',
                type: 'procedural',
                workflow_name: '데이터 마이그레이션',
                skill_name: '스키마 백업',
                steps: '["step1", "step2", "step3"]',
                task_goal: 'Test task',
                reflection_notes: null,
                importance: 0.5,
                created_at: new Date(),
                finalScore: 0.8
              }
            ],
            total_count: 1,
            query_time: 10
          });

          // When: recall Tool 실행
          const result = await tool.handle(params, context);
          const resultData = JSON.parse(result.content[0].text);

          // Then: steps_only일 때 steps만 반환되어야 함
          expect(resultData.items).toHaveLength(1);
          expect(resultData.items[0]).toEqual({
            memory_id: 'mem1',
            id: 'mem1',
            steps: '["step1", "step2", "step3"]'
          });
          expect(resultData.items[0].content).toBeUndefined();
          expect(resultData.items[0].task_goal).toBeUndefined();
        });

        it('should return all fields when return_format is full', async () => {
          // Given: procedural memory 생성
          DatabaseUtils.run(db, `
            INSERT INTO memory_item (id, type, content, workflow_name, skill_name, steps, task_goal) VALUES ('mem1', 'procedural', 'Test procedure', '데이터 마이그레이션', '스키마 백업', '["step1", "step2"]', 'Test task')
          `);

          const params = {
            query: 'test',
            type: 'procedural',
            return_format: 'full'
          };

          // Mock 검색 결과
          vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
            items: [
              {
                id: 'mem1',
                content: 'Test procedure',
                type: 'procedural',
                workflow_name: '데이터 마이그레이션',
                skill_name: '스키마 백업',
                steps: '["step1", "step2"]',
                task_goal: 'Test task',
                importance: 0.5,
                created_at: new Date(),
                finalScore: 0.8
              }
            ],
            total_count: 1,
            query_time: 10
          });

          // When: recall Tool 실행
          const result = await tool.handle(params, context);
          const resultData = JSON.parse(result.content[0].text);

          // Then: 모든 필드가 반환되어야 함
          expect(resultData.items).toHaveLength(1);
          expect(resultData.items[0].memory_id).toBe('mem1');
          expect(resultData.items[0].content).toBe('Test procedure');
          expect(resultData.items[0].steps).toBe('["step1", "step2"]');
          expect(resultData.items[0].task_goal).toBe('Test task');
          expect(resultData.items[0].workflow_name).toBe('데이터 마이그레이션');
          expect(resultData.items[0].skill_name).toBe('스키마 백업');
        });
      });
    });
  });

});
