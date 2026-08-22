import { describe, it, expect, vi } from "vitest";
import { describeRecallTool, db, tool, context, hybridSearchEngine } from "./recall-tool.test-setup.js";

describeRecallTool("neighbor memories", () => {
  describe('자동 이웃 기억 포함', () => {
    describe('자동 이웃 기억 포함 성공 시나리오', () => {
      it('given: 검색 결과 있음, when: include_neighbors=true, then: 상위 결과에 neighbors 필드 포함', async () => {
        // Given: 검색 결과가 있는 상황
        const memoryId1 = 'mem_test_001';
        const memoryId2 = 'mem_test_002';
        const neighborId1 = 'mem_neighbor_001';
        const neighborId2 = 'mem_neighbor_002';

        // 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES (?, 'episodic', 'Test memory 1', 0.8, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Test memory 2', 0.7, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Neighbor memory 1', 0.6, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Neighbor memory 2', 0.5, CURRENT_TIMESTAMP)
        `).run(memoryId1, memoryId2, neighborId1, neighborId2);

        // Mock 검색 결과
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: memoryId1,
              content: 'Test memory 1',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            },
            {
              id: memoryId2,
              content: 'Test memory 2',
              type: 'episodic',
              importance: 0.7,
              created_at: new Date().toISOString(),
              finalScore: 0.85
            }
          ],
          total_count: 2,
          query_time: 10
        });

        // Note: recall-tool.ts 내부에서 MemoryNeighborService를 생성하므로 직접 mock하기 어렵습니다.
        // 이 테스트는 neighbors 필드가 포함되는지 확인하는 것을 목표로 합니다.
        // 실제 이웃 기억 조회는 memory_embedding 테이블에 임베딩이 있어야 하므로,
        // 이 테스트에서는 neighbors 필드의 존재 여부만 확인합니다.

        const params = {
          query: 'test',
          limit: 10,
          include_neighbors: true,
          neighbors_limit: 2,
          neighbors_per_item: 5,
          neighbors_similarity_threshold: 0.8
        };

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: 검색 결과는 정상 반환되어야 함
        expect(resultData.items).toBeDefined();
        expect(resultData.items.length).toBe(2);

        // Then: 상위 결과에 neighbors 필드가 포함되어야 함
        // (실제로는 이웃 기억 조회가 실패할 수 있지만, 필드 자체는 존재해야 함)
        // neighbors_limit=2이므로 상위 2개 결과에 neighbors 필드가 있어야 함
        expect(resultData.items[0].neighbors).toBeDefined();
        expect(resultData.items[1].neighbors).toBeDefined();
        // neighbors는 배열이어야 함 (빈 배열일 수도 있음)
        expect(Array.isArray(resultData.items[0].neighbors)).toBe(true);
        expect(Array.isArray(resultData.items[1].neighbors)).toBe(true);
      });
    });

    describe('이웃 기억 조회 병렬 처리', () => {
      it('given: 여러 검색 결과, when: include_neighbors=true, then: 모든 이웃 기억이 병렬로 조회됨', async () => {
        // Given: 여러 검색 결과가 있는 상황
        const memoryId1 = 'mem_test_001';
        const memoryId2 = 'mem_test_002';
        const memoryId3 = 'mem_test_003';

        // 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES (?, 'episodic', 'Test memory 1', 0.8, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Test memory 2', 0.7, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Test memory 3', 0.6, CURRENT_TIMESTAMP)
        `).run(memoryId1, memoryId2, memoryId3);

        // Mock 검색 결과
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: memoryId1,
              content: 'Test memory 1',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            },
            {
              id: memoryId2,
              content: 'Test memory 2',
              type: 'episodic',
              importance: 0.7,
              created_at: new Date().toISOString(),
              finalScore: 0.85
            },
            {
              id: memoryId3,
              content: 'Test memory 3',
              type: 'episodic',
              importance: 0.6,
              created_at: new Date().toISOString(),
              finalScore: 0.75
            }
          ],
          total_count: 3,
          query_time: 10
        });

        // 이웃 기억 조회 호출 추적을 위한 변수
        const callTimestamps: number[] = [];
        const callOrder: string[] = [];

        // MemoryNeighborService 모듈 mock 설정
        const originalModule = await import('../../services/memory-neighbor-service.js');
        const mockGetNeighbors = vi.fn().mockImplementation(async (memoryId: string) => {
          const timestamp = Date.now();
          callTimestamps.push(timestamp);
          callOrder.push(memoryId);

          // 각 호출에 약간의 지연 추가 (병렬 처리 확인용)
          await new Promise(resolve => setTimeout(resolve, 50));

          return {
            memory_id: memoryId,
            neighbors: [],
            total_count: 0,
            query_time: 5
          };
        });

        vi.spyOn(originalModule, 'MemoryNeighborService').mockImplementation(() => ({
          setDatabase: vi.fn(),
          getNeighbors: mockGetNeighbors
        } as any));

        const params = {
          query: 'test',
          limit: 10,
          include_neighbors: true,
          neighbors_limit: 3,
          neighbors_per_item: 5,
          neighbors_similarity_threshold: 0.8
        };

        // When: recall Tool 실행
        const startTime = Date.now();
        const result = await tool.handle(params, context);
        const endTime = Date.now();
        const resultData = JSON.parse(result.content[0].text);

        // Then: 모든 이웃 기억이 병렬로 조회되었는지 확인
        // 병렬 처리 시 모든 호출이 거의 동시에 시작되어야 함
        expect(mockGetNeighbors).toHaveBeenCalledTimes(3);

        // 호출 시간 차이가 작아야 함 (병렬 처리)
        if (callTimestamps.length >= 2) {
          const timeDiff = Math.max(...callTimestamps) - Math.min(...callTimestamps);
          // 병렬 처리 시 시간 차이는 100ms 이하여야 함 (각 호출 지연 50ms + 오버헤드)
          expect(timeDiff).toBeLessThan(200);
        }

        // Then: 모든 검색 결과에 neighbors 필드가 포함되어야 함
        expect(resultData.items).toBeDefined();
        expect(resultData.items.length).toBe(3);
        expect(resultData.items[0].neighbors).toBeDefined();
        expect(resultData.items[1].neighbors).toBeDefined();
        expect(resultData.items[2].neighbors).toBeDefined();

        // 전체 처리 시간이 순차 처리보다 짧아야 함 (병렬 처리)
        // 순차 처리 시: 3 * 50ms = 150ms 이상
        // 병렬 처리 시: 약 50ms + 오버헤드
        const totalTime = endTime - startTime;
        expect(totalTime).toBeLessThan(300); // 병렬 처리 시 300ms 이하여야 함
      });
    });

    describe('이웃 기억 조회 개별 타임아웃', () => {
      it('given: 느린 이웃 기억 조회, when: include_neighbors=true, then: 개별 조회 타임아웃 내에 응답 반환, 타임아웃된 항목은 빈 배열', async () => {
        // Given: 느린 이웃 기억 조회가 있는 상황
        const memoryId1 = 'mem_test_001';
        const memoryId2 = 'mem_test_002';
        const memoryId3 = 'mem_test_003';

        // 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES (?, 'episodic', 'Test memory 1', 0.8, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Test memory 2', 0.7, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Test memory 3', 0.6, CURRENT_TIMESTAMP)
        `).run(memoryId1, memoryId2, memoryId3);

        // Mock 검색 결과
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: memoryId1,
              content: 'Test memory 1',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            },
            {
              id: memoryId2,
              content: 'Test memory 2',
              type: 'episodic',
              importance: 0.7,
              created_at: new Date().toISOString(),
              finalScore: 0.85
            },
            {
              id: memoryId3,
              content: 'Test memory 3',
              type: 'episodic',
              importance: 0.6,
              created_at: new Date().toISOString(),
              finalScore: 0.75
            }
          ],
          total_count: 3,
          query_time: 10
        });

        // logWarning spy 설정 (타임아웃 경고 확인용)
        const logWarningSpy = vi.spyOn(tool as any, 'logWarning');

        // MemoryNeighborService 모듈 mock 설정
        // memoryId1: 빠른 응답 (500ms)
        // memoryId2: 느린 응답 (2500ms, 타임아웃 발생)
        // memoryId3: 빠른 응답 (800ms)
        const originalModule = await import('../../services/memory-neighbor-service.js');
        const mockGetNeighbors = vi.fn().mockImplementation(async (memoryId: string) => {
          if (memoryId === memoryId1) {
            // 빠른 응답
            await new Promise(resolve => setTimeout(resolve, 500));
            return {
              memory_id: memoryId,
              neighbors: [{ id: 'neighbor_1', content: 'Neighbor 1', similarity: 0.85 }],
              total_count: 1,
              query_time: 5
            };
          } else if (memoryId === memoryId2) {
            // 느린 응답 (2초 이상, 타임아웃 발생)
            await new Promise(resolve => setTimeout(resolve, 2500));
            return {
              memory_id: memoryId,
              neighbors: [{ id: 'neighbor_2', content: 'Neighbor 2', similarity: 0.82 }],
              total_count: 1,
              query_time: 5
            };
          } else {
            // 빠른 응답
            await new Promise(resolve => setTimeout(resolve, 800));
            return {
              memory_id: memoryId,
              neighbors: [{ id: 'neighbor_3', content: 'Neighbor 3', similarity: 0.80 }],
              total_count: 1,
              query_time: 5
            };
          }
        });

        vi.spyOn(originalModule, 'MemoryNeighborService').mockImplementation(() => ({
          setDatabase: vi.fn(),
          getNeighbors: mockGetNeighbors
        } as any));

        const params = {
          query: 'test',
          limit: 10,
          include_neighbors: true,
          neighbors_limit: 3,
          neighbors_per_item: 5,
          neighbors_similarity_threshold: 0.8
        };

        // When: recall Tool 실행
        const startTime = Date.now();
        const result = await tool.handle(params, context);
        const endTime = Date.now();
        const resultData = JSON.parse(result.content[0].text);
        const totalTime = endTime - startTime;

        // Then: 개별 조회 타임아웃(2초) 내에 응답 반환
        // 전체 응답은 2.5초 이내에 반환되어야 함 (가장 느린 빠른 응답 + 오버헤드)
        expect(totalTime).toBeLessThan(2500);

        // Then: 타임아웃된 항목은 빈 배열
        expect(resultData.items).toBeDefined();
        expect(resultData.items.length).toBe(3);

        // memoryId1: 빠른 응답, neighbors 포함
        expect(resultData.items[0].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[0].neighbors)).toBe(true);
        expect(resultData.items[0].neighbors.length).toBeGreaterThan(0);

        // memoryId2: 타임아웃 발생, 빈 배열
        expect(resultData.items[1].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[1].neighbors)).toBe(true);
        expect(resultData.items[1].neighbors.length).toBe(0);

        // memoryId3: 빠른 응답, neighbors 포함
        expect(resultData.items[2].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[2].neighbors)).toBe(true);
        expect(resultData.items[2].neighbors.length).toBeGreaterThan(0);

        // Then: 타임아웃 경고 로그가 기록되었는지 확인
        expect(logWarningSpy).toHaveBeenCalledWith(
          '이웃 기억 조회 타임아웃',
          expect.objectContaining({
            memoryId: memoryId2,
            index: 1
          })
        );
      });
    });

    describe('이웃 기억 조회 전체 타임아웃', () => {
      it('given: 전체 요청이 2.5초 초과, when: include_neighbors=true, then: 완료된 조회 결과만 반환, 미완료 항목은 빈 배열, 로그/메타데이터 정상', async () => {
        // Given: 전체 요청이 2.5초 초과하는 상황
        const memoryId1 = 'mem_test_001';
        const memoryId2 = 'mem_test_002';
        const memoryId3 = 'mem_test_003';
        const memoryId4 = 'mem_test_004';

        // 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES (?, 'episodic', 'Test memory 1', 0.8, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Test memory 2', 0.7, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Test memory 3', 0.6, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Test memory 4', 0.5, CURRENT_TIMESTAMP)
        `).run(memoryId1, memoryId2, memoryId3, memoryId4);

        // Mock 검색 결과
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: memoryId1,
              content: 'Test memory 1',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            },
            {
              id: memoryId2,
              content: 'Test memory 2',
              type: 'episodic',
              importance: 0.7,
              created_at: new Date().toISOString(),
              finalScore: 0.85
            },
            {
              id: memoryId3,
              content: 'Test memory 3',
              type: 'episodic',
              importance: 0.6,
              created_at: new Date().toISOString(),
              finalScore: 0.75
            },
            {
              id: memoryId4,
              content: 'Test memory 4',
              type: 'episodic',
              importance: 0.5,
              created_at: new Date().toISOString(),
              finalScore: 0.65
            }
          ],
          total_count: 4,
          query_time: 10
        });

        // MemoryNeighborService 모듈 mock 설정
        // memoryId1: 빠른 응답 (1초)
        // memoryId2: 빠른 응답 (1.5초)
        // memoryId3: 느린 응답 (3초, 전체 타임아웃 발생)
        // memoryId4: 느린 응답 (3초, 전체 타임아웃 발생)
        const originalModule = await import('../../services/memory-neighbor-service.js');
        const mockGetNeighbors = vi.fn().mockImplementation(async (memoryId: string) => {
          if (memoryId === memoryId1) {
            // 빠른 응답 (1초)
            await new Promise(resolve => setTimeout(resolve, 1000));
            return {
              memory_id: memoryId,
              neighbors: [{ id: 'neighbor_1', content: 'Neighbor 1', similarity: 0.85 }],
              total_count: 1,
              query_time: 5
            };
          } else if (memoryId === memoryId2) {
            // 빠른 응답 (1.5초)
            await new Promise(resolve => setTimeout(resolve, 1500));
            return {
              memory_id: memoryId,
              neighbors: [{ id: 'neighbor_2', content: 'Neighbor 2', similarity: 0.82 }],
              total_count: 1,
              query_time: 5
            };
          } else {
            // 느린 응답 (3초, 전체 타임아웃 발생)
            await new Promise(resolve => setTimeout(resolve, 3000));
            return {
              memory_id: memoryId,
              neighbors: [{ id: 'neighbor_3', content: 'Neighbor 3', similarity: 0.80 }],
              total_count: 1,
              query_time: 5
            };
          }
        });

        vi.spyOn(originalModule, 'MemoryNeighborService').mockImplementation(() => ({
          setDatabase: vi.fn(),
          getNeighbors: mockGetNeighbors
        } as any));

        const params = {
          query: 'test',
          limit: 10,
          include_neighbors: true,
          neighbors_limit: 4,
          neighbors_per_item: 5,
          neighbors_similarity_threshold: 0.8
        };

        // When: recall Tool 실행
        const startTime = Date.now();
        const result = await tool.handle(params, context);
        const endTime = Date.now();
        const resultData = JSON.parse(result.content[0].text);
        const totalTime = endTime - startTime;

        // Then: 전체 타임아웃(2.5초) 내에 응답 반환
        // 완료된 조회 결과만 반환되어야 하므로 2.5초 이내에 응답
        expect(totalTime).toBeLessThan(2600); // 2.5초 + 약간의 오버헤드

        // Then: 완료된 조회 결과만 반환, 미완료 항목은 빈 배열
        expect(resultData.items).toBeDefined();
        expect(resultData.items.length).toBe(4);

        // memoryId1: 빠른 응답 (1초), neighbors 포함
        expect(resultData.items[0].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[0].neighbors)).toBe(true);
        expect(resultData.items[0].neighbors.length).toBeGreaterThan(0);

        // memoryId2: 빠른 응답 (1.5초), neighbors 포함
        expect(resultData.items[1].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[1].neighbors)).toBe(true);
        expect(resultData.items[1].neighbors.length).toBeGreaterThan(0);

        // memoryId3: 느린 응답 (3초), 전체 타임아웃으로 빈 배열
        expect(resultData.items[2].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[2].neighbors)).toBe(true);
        expect(resultData.items[2].neighbors.length).toBe(0);

        // memoryId4: 느린 응답 (3초), 전체 타임아웃으로 빈 배열
        expect(resultData.items[3].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[3].neighbors)).toBe(true);
        expect(resultData.items[3].neighbors.length).toBe(0);

        // Then: 로그/메타데이터 정상
        // 검색 결과는 정상 반환되어야 함
        expect(resultData.total_count).toBe(4);
        expect(resultData.query_time).toBeDefined();
      });
    });

    describe('이웃 기억 조회 실패 시 에러 처리', () => {
      it('given: 이웃 기억 조회 실패, when: include_neighbors=true, then: 해당 항목의 neighbors는 빈 배열, 다른 항목은 정상', async () => {
        // Given: 이웃 기억 조회가 실패하는 상황
        const memoryId1 = 'mem_test_001';
        const memoryId2 = 'mem_test_002';
        const memoryId3 = 'mem_test_003';

        // 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES (?, 'episodic', 'Test memory 1', 0.8, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Test memory 2', 0.7, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Test memory 3', 0.6, CURRENT_TIMESTAMP)
        `).run(memoryId1, memoryId2, memoryId3);

        // Mock 검색 결과
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: memoryId1,
              content: 'Test memory 1',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            },
            {
              id: memoryId2,
              content: 'Test memory 2',
              type: 'episodic',
              importance: 0.7,
              created_at: new Date().toISOString(),
              finalScore: 0.85
            },
            {
              id: memoryId3,
              content: 'Test memory 3',
              type: 'episodic',
              importance: 0.6,
              created_at: new Date().toISOString(),
              finalScore: 0.75
            }
          ],
          total_count: 3,
          query_time: 10
        });

        // logError spy 설정 (에러 로그 확인용)
        const logErrorSpy = vi.spyOn(tool as any, 'logError');

        // MemoryNeighborService 모듈 mock 설정
        // memoryId1: 성공
        // memoryId2: 에러 발생
        // memoryId3: 성공
        const originalModule = await import('../../services/memory-neighbor-service.js');
        const mockGetNeighbors = vi.fn().mockImplementation(async (memoryId: string) => {
          if (memoryId === memoryId1) {
            // 성공
            return {
              memory_id: memoryId,
              neighbors: [{ id: 'neighbor_1', content: 'Neighbor 1', similarity: 0.85 }],
              total_count: 1,
              query_time: 5
            };
          } else if (memoryId === memoryId2) {
            // 에러 발생
            throw new Error('이웃 기억 조회 실패');
          } else {
            // 성공
            return {
              memory_id: memoryId,
              neighbors: [{ id: 'neighbor_3', content: 'Neighbor 3', similarity: 0.80 }],
              total_count: 1,
              query_time: 5
            };
          }
        });

        vi.spyOn(originalModule, 'MemoryNeighborService').mockImplementation(() => ({
          setDatabase: vi.fn(),
          getNeighbors: mockGetNeighbors
        } as any));

        const params = {
          query: 'test',
          limit: 10,
          include_neighbors: true,
          neighbors_limit: 3,
          neighbors_per_item: 5,
          neighbors_similarity_threshold: 0.8
        };

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: 해당 항목의 neighbors는 빈 배열, 다른 항목은 정상
        expect(resultData.items).toBeDefined();
        expect(resultData.items.length).toBe(3);

        // memoryId1: 성공, neighbors 포함
        expect(resultData.items[0].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[0].neighbors)).toBe(true);
        expect(resultData.items[0].neighbors.length).toBeGreaterThan(0);

        // memoryId2: 에러 발생, 빈 배열
        expect(resultData.items[1].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[1].neighbors)).toBe(true);
        expect(resultData.items[1].neighbors.length).toBe(0);

        // memoryId3: 성공, neighbors 포함
        expect(resultData.items[2].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[2].neighbors)).toBe(true);
        expect(resultData.items[2].neighbors.length).toBeGreaterThan(0);

        // Then: 에러 로그가 기록되었는지 확인
        expect(logErrorSpy).toHaveBeenCalledWith(
          expect.any(Error),
          '이웃 기억 조회 실패',
          expect.objectContaining({
            memoryId: memoryId2,
            index: 1
          })
        );

        // Then: 검색 결과는 정상 반환되어야 함
        expect(resultData.total_count).toBe(3);
        expect(resultData.query_time).toBeDefined();
      });
    });

    describe('이웃 기억 순서 보존', () => {
      it('given: 검색 결과 5개(역순 ID 등), neighbors_limit=3, when: include_neighbors=true, then: 상위 3개 결과가 원본 검색 결과 순서대로 neighbors 필드를 포함', async () => {
        // Given: 검색 결과 5개(역순 ID 등으로 순서 명확히)
        const memoryId1 = 'mem_001';
        const memoryId2 = 'mem_002';
        const memoryId3 = 'mem_003';
        const memoryId4 = 'mem_004';
        const memoryId5 = 'mem_005';

        // 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES (?, 'episodic', 'Test memory 1', 0.8, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Test memory 2', 0.7, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Test memory 3', 0.6, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Test memory 4', 0.5, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Test memory 5', 0.4, CURRENT_TIMESTAMP)
        `).run(memoryId1, memoryId2, memoryId3, memoryId4, memoryId5);

        // Mock 검색 결과 (5개 항목, 순서 명확히)
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: memoryId1,
              content: 'Test memory 1',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            },
            {
              id: memoryId2,
              content: 'Test memory 2',
              type: 'episodic',
              importance: 0.7,
              created_at: new Date().toISOString(),
              finalScore: 0.85
            },
            {
              id: memoryId3,
              content: 'Test memory 3',
              type: 'episodic',
              importance: 0.6,
              created_at: new Date().toISOString(),
              finalScore: 0.75
            },
            {
              id: memoryId4,
              content: 'Test memory 4',
              type: 'episodic',
              importance: 0.5,
              created_at: new Date().toISOString(),
              finalScore: 0.65
            },
            {
              id: memoryId5,
              content: 'Test memory 5',
              type: 'episodic',
              importance: 0.4,
              created_at: new Date().toISOString(),
              finalScore: 0.55
            }
          ],
          total_count: 5,
          query_time: 10
        });

        // 이웃 기억 조회 호출 순서 추적 (순서 보존 확인용)
        const callOrder: string[] = [];

        // MemoryNeighborService 모듈 mock 설정
        // 각 항목에 대해 다른 지연 시간 적용 (순서 보존 확인용)
        // memoryId1: 가장 느린 응답 (1.5초)
        // memoryId2: 중간 응답 (1초)
        // memoryId3: 가장 빠른 응답 (0.5초)
        const originalModule = await import('../../services/memory-neighbor-service.js');
        const mockGetNeighbors = vi.fn().mockImplementation(async (memoryId: string) => {
          callOrder.push(memoryId);

          let delay = 500;
          if (memoryId === memoryId1) {
            delay = 1500; // 가장 느린 응답
          } else if (memoryId === memoryId2) {
            delay = 1000; // 중간 응답
          } else if (memoryId === memoryId3) {
            delay = 500; // 가장 빠른 응답
          }

          await new Promise(resolve => setTimeout(resolve, delay));

          return {
            memory_id: memoryId,
            neighbors: [{ id: `neighbor_${memoryId}`, content: `Neighbor ${memoryId}`, similarity: 0.85 }],
            total_count: 1,
            query_time: 5
          };
        });

        vi.spyOn(originalModule, 'MemoryNeighborService').mockImplementation(() => ({
          setDatabase: vi.fn(),
          getNeighbors: mockGetNeighbors
        } as any));

        const params = {
          query: 'test',
          limit: 10,
          include_neighbors: true,
          neighbors_limit: 3, // 상위 3개만
          neighbors_per_item: 5,
          neighbors_similarity_threshold: 0.8
        };

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: 상위 3개 결과가 원본 검색 결과 순서대로 neighbors 필드를 포함
        expect(resultData.items).toBeDefined();
        expect(resultData.items.length).toBe(5);

        // 상위 3개 결과에 neighbors 필드가 포함되어야 함
        expect(resultData.items[0].neighbors).toBeDefined();
        expect(resultData.items[1].neighbors).toBeDefined();
        expect(resultData.items[2].neighbors).toBeDefined();

        // 4번째, 5번째 결과에는 neighbors 필드가 없어야 함 (neighbors_limit=3)
        expect(resultData.items[3].neighbors).toBeUndefined();
        expect(resultData.items[4].neighbors).toBeUndefined();

        // 원본 검색 결과 순서 확인
        expect(resultData.items[0].id).toBe(memoryId1);
        expect(resultData.items[1].id).toBe(memoryId2);
        expect(resultData.items[2].id).toBe(memoryId3);
        expect(resultData.items[3].id).toBe(memoryId4);
        expect(resultData.items[4].id).toBe(memoryId5);

        // neighbors 필드의 순서도 원본 검색 결과 순서와 일치해야 함
        // (병렬 처리로 완료 순서가 다를 수 있지만, 최종 결과는 원본 순서 유지)
        expect(resultData.items[0].neighbors[0].id).toBe(`neighbor_${memoryId1}`);
        expect(resultData.items[1].neighbors[0].id).toBe(`neighbor_${memoryId2}`);
        expect(resultData.items[2].neighbors[0].id).toBe(`neighbor_${memoryId3}`);
      });
    });

    describe('neighbors_limit 적용', () => {
      it('given: 검색 결과 10개, neighbors_limit=3, when: include_neighbors=true, then: 상위 3개 결과만 neighbors 필드 포함', async () => {
        // Given: 검색 결과 10개
        const memoryIds = Array.from({ length: 10 }, (_, i) => `mem_test_${String(i + 1).padStart(3, '0')}`);

        // 메모리 아이템 생성
        const insertStmt = db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES (?, 'episodic', ?, 0.8, CURRENT_TIMESTAMP)
        `);

        for (let i = 0; i < 10; i++) {
          insertStmt.run(memoryIds[i], `Test memory ${i + 1}`);
        }

        // Mock 검색 결과 (10개 항목)
        const searchItems = memoryIds.map((id, index) => ({
          id,
          content: `Test memory ${index + 1}`,
          type: 'episodic',
          importance: 0.8,
          created_at: new Date().toISOString(),
          finalScore: 0.95 - index * 0.05
        }));

        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: searchItems,
          total_count: 10,
          query_time: 10
        });

        // MemoryNeighborService 모듈 mock 설정
        // 모든 항목에 대해 이웃 기억 반환
        const originalModule = await import('../../services/memory-neighbor-service.js');
        const mockGetNeighbors = vi.fn().mockImplementation(async (memoryId: string) => {
          return {
            memory_id: memoryId,
            neighbors: [{ id: `neighbor_${memoryId}`, content: `Neighbor ${memoryId}`, similarity: 0.85 }],
            total_count: 1,
            query_time: 5
          };
        });

        vi.spyOn(originalModule, 'MemoryNeighborService').mockImplementation(() => ({
          setDatabase: vi.fn(),
          getNeighbors: mockGetNeighbors
        } as any));

        const params = {
          query: 'test',
          limit: 10,
          include_neighbors: true,
          neighbors_limit: 3, // 상위 3개만
          neighbors_per_item: 5,
          neighbors_similarity_threshold: 0.8
        };

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: 상위 3개 결과만 neighbors 필드 포함
        expect(resultData.items).toBeDefined();
        expect(resultData.items.length).toBe(10);

        // 상위 3개 결과에 neighbors 필드 포함 확인
        expect(resultData.items[0].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[0].neighbors)).toBe(true);
        expect(resultData.items[0].neighbors.length).toBeGreaterThan(0);

        expect(resultData.items[1].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[1].neighbors)).toBe(true);
        expect(resultData.items[1].neighbors.length).toBeGreaterThan(0);

        expect(resultData.items[2].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[2].neighbors)).toBe(true);
        expect(resultData.items[2].neighbors.length).toBeGreaterThan(0);

        // 4번째부터 10번째 결과에는 neighbors 필드가 없어야 함
        for (let i = 3; i < 10; i++) {
          expect(resultData.items[i].neighbors).toBeUndefined();
        }

        // Then: getNeighbors가 3번만 호출되었는지 확인 (neighbors_limit=3)
        expect(mockGetNeighbors).toHaveBeenCalledTimes(3);
        expect(mockGetNeighbors).toHaveBeenCalledWith(memoryIds[0], expect.any(Object));
        expect(mockGetNeighbors).toHaveBeenCalledWith(memoryIds[1], expect.any(Object));
        expect(mockGetNeighbors).toHaveBeenCalledWith(memoryIds[2], expect.any(Object));
      });
    });

    describe('neighbors_per_item 적용', () => {
      it('given: neighbors_per_item=2, when: include_neighbors=true, then: 각 항목의 neighbors 배열이 최대 2개', async () => {
        // Given: neighbors_per_item=2
        const memoryId1 = 'mem_test_001';
        const memoryId2 = 'mem_test_002';
        const memoryId3 = 'mem_test_003';

        // 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES (?, 'episodic', 'Test memory 1', 0.8, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Test memory 2', 0.7, CURRENT_TIMESTAMP),
            (?, 'episodic', 'Test memory 3', 0.6, CURRENT_TIMESTAMP)
        `).run(memoryId1, memoryId2, memoryId3);

        // Mock 검색 결과
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: memoryId1,
              content: 'Test memory 1',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            },
            {
              id: memoryId2,
              content: 'Test memory 2',
              type: 'episodic',
              importance: 0.7,
              created_at: new Date().toISOString(),
              finalScore: 0.85
            },
            {
              id: memoryId3,
              content: 'Test memory 3',
              type: 'episodic',
              importance: 0.6,
              created_at: new Date().toISOString(),
              finalScore: 0.75
            }
          ],
          total_count: 3,
          query_time: 10
        });

        // MemoryNeighborService 모듈 mock 설정
        // neighbors_per_item=2이므로 각 항목당 최대 2개의 이웃 기억 반환
        const originalModule = await import('../../services/memory-neighbor-service.js');
        const mockGetNeighbors = vi.fn().mockImplementation(async (memoryId: string, options: any) => {
          // limit 파라미터가 neighbors_per_item과 일치하는지 확인
          expect(options.limit).toBe(2);

          // 각 항목에 대해 2개의 이웃 기억 반환
          return {
            memory_id: memoryId,
            neighbors: [
              { id: `neighbor_${memoryId}_1`, content: `Neighbor 1 of ${memoryId}`, similarity: 0.85 },
              { id: `neighbor_${memoryId}_2`, content: `Neighbor 2 of ${memoryId}`, similarity: 0.82 }
            ],
            total_count: 2,
            query_time: 5
          };
        });

        vi.spyOn(originalModule, 'MemoryNeighborService').mockImplementation(() => ({
          setDatabase: vi.fn(),
          getNeighbors: mockGetNeighbors
        } as any));

        const params = {
          query: 'test',
          limit: 10,
          include_neighbors: true,
          neighbors_limit: 3,
          neighbors_per_item: 2, // 각 항목당 최대 2개
          neighbors_similarity_threshold: 0.8
        };

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: 각 항목의 neighbors 배열이 최대 2개
        expect(resultData.items).toBeDefined();
        expect(resultData.items.length).toBe(3);

        // 모든 항목의 neighbors 배열이 최대 2개인지 확인
        expect(resultData.items[0].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[0].neighbors)).toBe(true);
        expect(resultData.items[0].neighbors.length).toBeLessThanOrEqual(2);
        expect(resultData.items[0].neighbors.length).toBe(2);

        expect(resultData.items[1].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[1].neighbors)).toBe(true);
        expect(resultData.items[1].neighbors.length).toBeLessThanOrEqual(2);
        expect(resultData.items[1].neighbors.length).toBe(2);

        expect(resultData.items[2].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[2].neighbors)).toBe(true);
        expect(resultData.items[2].neighbors.length).toBeLessThanOrEqual(2);
        expect(resultData.items[2].neighbors.length).toBe(2);

        // Then: getNeighbors가 limit=2로 호출되었는지 확인
        expect(mockGetNeighbors).toHaveBeenCalledTimes(3);
        expect(mockGetNeighbors).toHaveBeenCalledWith(memoryId1, expect.objectContaining({ limit: 2 }));
        expect(mockGetNeighbors).toHaveBeenCalledWith(memoryId2, expect.objectContaining({ limit: 2 }));
        expect(mockGetNeighbors).toHaveBeenCalledWith(memoryId3, expect.objectContaining({ limit: 2 }));
      });
    });

    describe('neighbors_similarity_threshold 필터링', () => {
      it('given: 유사도 0.7, 0.8, 0.9인 이웃 기억, neighbors_similarity_threshold=0.8, when: include_neighbors=true, then: 0.8 이상만 포함', async () => {
        // Given: 유사도 0.7, 0.8, 0.9인 이웃 기억
        const memoryId = 'mem_test_001';

        // 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES (?, 'episodic', 'Test memory', 0.8, CURRENT_TIMESTAMP)
        `).run(memoryId);

        // Mock 검색 결과
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: memoryId,
              content: 'Test memory',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            }
          ],
          total_count: 1,
          query_time: 10
        });

        // MemoryNeighborService 모듈 mock 설정
        // neighbors_similarity_threshold=0.8이므로 0.8 이상의 유사도를 가진 이웃 기억만 반환
        const originalModule = await import('../../services/memory-neighbor-service.js');
        const mockGetNeighbors = vi.fn().mockImplementation(async (memoryId: string, options: any) => {
          // similarity_threshold 파라미터가 neighbors_similarity_threshold와 일치하는지 확인
          expect(options.similarity_threshold).toBe(0.8);

          // 유사도 0.7, 0.8, 0.9인 이웃 기억 반환
          // MemoryNeighborService는 similarity_threshold 이상인 것만 반환해야 함
          return {
            memory_id: memoryId,
            neighbors: [
              { id: 'neighbor_0.9', content: 'Neighbor with similarity 0.9', similarity: 0.9 },
              { id: 'neighbor_0.8', content: 'Neighbor with similarity 0.8', similarity: 0.8 }
              // 유사도 0.7은 similarity_threshold=0.8 미만이므로 제외됨
            ],
            total_count: 2,
            query_time: 5
          };
        });

        vi.spyOn(originalModule, 'MemoryNeighborService').mockImplementation(() => ({
          setDatabase: vi.fn(),
          getNeighbors: mockGetNeighbors
        } as any));

        const params = {
          query: 'test',
          limit: 10,
          include_neighbors: true,
          neighbors_limit: 1,
          neighbors_per_item: 5,
          neighbors_similarity_threshold: 0.8 // 유사도 임계값 0.8
        };

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: 0.8 이상만 포함
        expect(resultData.items).toBeDefined();
        expect(resultData.items.length).toBe(1);
        expect(resultData.items[0].neighbors).toBeDefined();
        expect(Array.isArray(resultData.items[0].neighbors)).toBe(true);

        // 반환된 neighbors 배열의 모든 항목이 0.8 이상의 유사도를 가져야 함
        resultData.items[0].neighbors.forEach((neighbor: any) => {
          expect(neighbor.similarity).toBeGreaterThanOrEqual(0.8);
        });

        // 유사도 0.9와 0.8인 이웃 기억이 포함되어야 함
        expect(resultData.items[0].neighbors.length).toBe(2);
        expect(resultData.items[0].neighbors.some((n: any) => n.similarity === 0.9)).toBe(true);
        expect(resultData.items[0].neighbors.some((n: any) => n.similarity === 0.8)).toBe(true);
        // 유사도 0.7인 이웃 기억은 포함되지 않아야 함
        expect(resultData.items[0].neighbors.some((n: any) => n.similarity === 0.7)).toBe(false);

        // Then: getNeighbors가 similarity_threshold=0.8로 호출되었는지 확인
        expect(mockGetNeighbors).toHaveBeenCalledTimes(1);
        expect(mockGetNeighbors).toHaveBeenCalledWith(memoryId, expect.objectContaining({
          similarity_threshold: 0.8
        }));
      });
    });

    describe('하위 호환성', () => {
      it('given: 새 파라미터 없음, when: recall 호출, then: 기존 동작과 동일하게 동작, metadata.anchor_set=null, neighbors 필드 없음', async () => {
        // Given: 새 파라미터 없음
        const memoryId = 'mem_test_001';

        // 메모리 아이템 생성
        db.prepare(`
          INSERT INTO memory_item (id, type, content, importance, created_at) VALUES (?, 'episodic', 'Test memory', 0.8, CURRENT_TIMESTAMP)
        `).run(memoryId);

        // Mock 검색 결과
        vi.spyOn(hybridSearchEngine, 'search').mockResolvedValue({
          items: [
            {
              id: memoryId,
              content: 'Test memory',
              type: 'episodic',
              importance: 0.8,
              created_at: new Date().toISOString(),
              finalScore: 0.95
            }
          ],
          total_count: 1,
          query_time: 10
        });

        // 새 파라미터 없이 recall 호출 (기존 파라미터만 사용)
        const params = {
          query: 'test',
          limit: 10
          // auto_set_anchor, include_neighbors 등 새 파라미터 없음
        };

        // When: recall Tool 실행
        const result = await tool.handle(params, context);
        const resultData = JSON.parse(result.content[0].text);

        // Then: 기존 동작과 동일하게 동작
        expect(resultData.items).toBeDefined();
        expect(resultData.items.length).toBe(1);
        expect(resultData.items[0].id).toBe(memoryId);
        expect(resultData.items[0].content).toBe('Test memory');
        expect(resultData.total_count).toBe(1);
        expect(resultData.query_time).toBeDefined();

        // Then: metadata.anchor_set=null
        expect(resultData.metadata).toBeDefined();
        expect(resultData.metadata.anchor_set).toBeNull();
        expect(resultData.metadata.anchor_set_error).toBeUndefined();
        expect(resultData.metadata.anchor_set_skipped).toBeUndefined();

        // Then: neighbors 필드 없음
        expect(resultData.items[0].neighbors).toBeUndefined();
      });
    });
  });

});
