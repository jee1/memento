/**
 * Recall neighbor fetch (recall-tool-envelope.ts에서 분리, #507).
 */

import type { ToolContext } from '../../../tools/types.js';
import { getVectorSearchEngine } from '../../search/algorithms/vector-search-engine.js';
import type { NeighborMemory } from '../services/memory-neighbor-service.js';
import { MemoryEmbeddingService } from '../services/memory-embedding-service.js';
import { MemoryNeighborService } from '../services/memory-neighbor-service.js';
import type { RecallToolHost } from './recall-tool-host.js';
import type { RecallSearchItem } from './recall-tool-types.js';

/**
 * 자동 이웃 기억 포함 처리
 */
export async function handleIncludeNeighbors(
  host: RecallToolHost,
  searchItems: RecallSearchItem[],
  neighborsLimit: number,
  neighborsPerItem: number,
  neighborsSimilarityThreshold: number,
  context: ToolContext
): Promise<NeighborMemory[][]> {
  if (!searchItems || searchItems.length === 0) {
    return [];
  }

  const topResults = searchItems.slice(0, Math.min(neighborsLimit, searchItems.length));

  let neighborService: MemoryNeighborService;
  try {
    const vectorSearchEngine = context.services?.vectorSearchEngine ?? getVectorSearchEngine();
    const embeddingService = context.services.embeddingService || new MemoryEmbeddingService();
    neighborService = new MemoryNeighborService(vectorSearchEngine, embeddingService, context.db!);
  } catch (error) {
    host.logError(error as Error, 'MemoryNeighborService 초기화 실패', {});
    return Array.from({ length: topResults.length }, () => []);
  }

  const neighborPromises = topResults.map(async (item, index) => {
    const memoryId = item.id || item.memory_id;

    if (!memoryId) {
      host.logWarning('검색 결과에 memory_id가 없어 이웃 기억 조회를 건너뜁니다', { item });
      return { index, neighbors: [] };
    }

    try {
      const timeoutPromise = new Promise<{ index: number; neighbors: NeighborMemory[] }>((_, reject) => {
        setTimeout(() => reject(new Error('Timeout')), 2000);
      });

      const neighborPromise = neighborService.getNeighbors(memoryId, {
        limit: neighborsPerItem,
        similarity_threshold: neighborsSimilarityThreshold
      }).then(result => ({
        index,
        neighbors: result.neighbors
      }));

      const result = await Promise.race([neighborPromise, timeoutPromise]);
      return result;
    } catch (error) {
      if (error instanceof Error && error.message === 'Timeout') {
        host.logWarning('이웃 기억 조회 타임아웃', { memoryId, index });
      } else {
        host.logError(error as Error, '이웃 기억 조회 실패', { memoryId, index });
      }
      return { index, neighbors: [] };
    }
  });

  const completedResults = new Map<number, { index: number; neighbors: NeighborMemory[] }>();

  neighborPromises.forEach((promise, idx) => {
    promise
      .then(result => {
        completedResults.set(idx, result);
      })
      .catch(() => {
        completedResults.set(idx, { index: idx, neighbors: [] });
      });
  });

  let timeoutId: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<Array<{ index: number; neighbors: NeighborMemory[] }>>((resolve) => {
    timeoutId = setTimeout(() => {
      const partialResults: Array<{ index: number; neighbors: NeighborMemory[] }> = [];

      for (let i = 0; i < topResults.length; i++) {
        if (completedResults.has(i)) {
          partialResults.push(completedResults.get(i)!);
        } else {
          partialResults.push({ index: i, neighbors: [] });
        }
      }

      resolve(partialResults.sort((a, b) => a.index - b.index));
    }, 2500);
  });

  try {
    const allNeighbors = await Promise.race([
      Promise.all(neighborPromises),
      timeoutPromise
    ]);

    if (timeoutId) clearTimeout(timeoutId);

    const sortedNeighbors = allNeighbors
      .sort((a, b) => a.index - b.index)
      .map(r => r.neighbors);

    return sortedNeighbors;
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);

    const settledResults = await Promise.allSettled(neighborPromises);
    return settledResults.map((r, _idx) =>
      r.status === 'fulfilled'
        ? r.value.neighbors
        : []
    );
  }
}
