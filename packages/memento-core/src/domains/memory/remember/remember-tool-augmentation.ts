/**
 * Remember Tool — 백그라운드 증강 파이프라인 (remember-tool.ts에서 분리, #582).
 *
 * fire-and-forget: 임베딩·인접기억·관계추출을 비동기로 수행.
 * 메모리 저장 성공 여부와 독립적.
 */

import type Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { getVectorSearchEngine } from '../../search/algorithms/vector-search-engine.js';
import { MemoryNeighborService } from '../services/memory-neighbor-service.js';
import { RelationExtractor } from '../../relation/services/relation-extractor.js';
import type { RelationCandidate } from '../../../shared/types/relation.js';
import type { ToolContext } from '../../../tools/types.js';
import type { RememberToolHost } from './remember-tool-host.js';
import { getExistingMemoriesForRelationExtraction, getMemoryById } from './remember-tool-db-helpers.js';

export interface AugmentationParams {
  dbRef: Database.Database;
  savedMemoryId: string;
  savedMemoryType: string;
  content: string;
  importance: number;
}

async function checkDbConnection(dbRef: Database.Database): Promise<boolean> {
  try {
    await new Promise<void>((resolve, reject) => {
      try { DatabaseUtils.get(dbRef, 'SELECT 1'); resolve(); }
      catch (error) { reject(error); }
    });
    return true;
  } catch {
    return false;
  }
}

async function runEmbeddingAndNeighbors(
  params: AugmentationParams,
  context: ToolContext,
  host: RememberToolHost
): Promise<void> {
  const { dbRef, savedMemoryId, savedMemoryType, content } = params;
  const embeddingServiceRef = context.services.embeddingService;

  if (!embeddingServiceRef?.isAvailable()) return;

  let embeddingResult = null;
  try {
    embeddingResult = await embeddingServiceRef.createAndStoreEmbedding(dbRef, savedMemoryId, content, savedMemoryType as import('../../../shared/types/memory.types.js').MemoryType);
  } catch (error) {
    host.logWarning(`임베딩 생성 실패 (${savedMemoryId})`, {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  if (!embeddingResult) return;

  try {
    const dbValid = await checkDbConnection(dbRef);
    if (!dbValid) {
      host.logWarning('데이터베이스 연결이 유효하지 않아 인접 기억 갱신을 건너뜁니다', { memory_id: savedMemoryId });
      return;
    }

    const vectorSearchEngine = context.services?.vectorSearchEngine ?? getVectorSearchEngine();
    const neighborService = new MemoryNeighborService(vectorSearchEngine, embeddingServiceRef, dbRef);
    const neighborIds = await neighborService.updateNeighborsForNewMemory(savedMemoryId, 0.8);

    if (neighborIds.length > 0) {
      host.logInfo('인접 기억 갱신 완료', { memory_id: savedMemoryId, neighbor_count: neighborIds.length });
    }
  } catch (error) {
    host.logWarning(`인접 기억 갱신 실패 (${savedMemoryId})`, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function persistRelationCandidates(
  candidates: RelationCandidate[],
  context: ToolContext,
  host: RememberToolHost,
  savedMemoryId: string
): Promise<void> {
  const relationGraph = context.services.relationGraph;
  if (!relationGraph) {
    host.logWarning('관계 그래프를 사용할 수 없어 추출된 관계를 저장하지 않습니다', { memory_id: savedMemoryId });
    return;
  }

  try {
    const extractedAt = new Date().toISOString();
    const batchResult = await relationGraph.addRelationsBatch(
      candidates.map(candidate => ({
        source_id: candidate.source_id,
        target_id: candidate.target_id,
        relation_type: candidate.relation_type,
        confidence: candidate.confidence,
        metadata: {
          method: candidate.method,
          evidence: candidate.evidence,
          extracted_at: extractedAt
        }
      }))
    );

    if (batchResult.failedCount > 0) {
      host.logWarning('추출된 관계 중 일부 저장 실패', {
        memory_id: savedMemoryId,
        failed_count: batchResult.failedCount,
        success_count: batchResult.success
      });
    }
  } catch (error) {
    host.logWarning(`추출된 관계 저장 실패 (${savedMemoryId})`, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function runRelationExtraction(
  params: AugmentationParams,
  context: ToolContext,
  host: RememberToolHost
): Promise<void> {
  const { dbRef, savedMemoryId } = params;

  try {
    const dbValid = await checkDbConnection(dbRef);
    if (!dbValid) {
      host.logWarning('데이터베이스 연결이 유효하지 않아 관계 추출을 건너뜁니다', { memory_id: savedMemoryId });
      return;
    }

    const existingMemories = await getExistingMemoriesForRelationExtraction(dbRef, savedMemoryId, 100, host);
    if (existingMemories.length === 0) return;

    const newMemory = await getMemoryById(dbRef, savedMemoryId, host);
    if (!newMemory) return;

    const relationExtractor = new RelationExtractor();
    const candidates = await relationExtractor.extractRelations(
      newMemory,
      existingMemories,
      { method: 'hybrid', minConfidence: 0.5, candidateLimit: 30, immediate: true }
    );

    if (candidates.length > 0) {
      host.logInfo('관계 추출 완료', {
        memory_id: savedMemoryId,
        relation_count: candidates.length,
        relations: candidates.map(c => ({
          target_id: c.target_id,
          relation_type: c.relation_type,
          confidence: c.confidence,
          method: c.method
        }))
      });

      await persistRelationCandidates(candidates, context, host, savedMemoryId);
    } else {
      host.logInfo('관계 추출 완료 (관계 없음)', { memory_id: savedMemoryId });
    }
  } catch (error) {
    host.logWarning(`관계 추출 실패 (${savedMemoryId})`, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/** 메모리 저장 후 비동기 증강 파이프라인 시작 (fire-and-forget). */
export function launchBackgroundAugmentation(
  params: AugmentationParams,
  context: ToolContext,
  host: RememberToolHost
): void {
  const { dbRef, savedMemoryId } = params;

  (async () => {
    try {
      const dbValid = await checkDbConnection(dbRef);
      if (!dbValid) {
        host.logWarning('데이터베이스 연결이 유효하지 않아 백그라운드 작업을 건너뜁니다', { memory_id: savedMemoryId });
        return;
      }

      await runEmbeddingAndNeighbors(params, context, host);
      await runRelationExtraction(params, context, host);
    } catch (error) {
      host.logWarning(`백그라운드 작업 실패 (${savedMemoryId})`, {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  })().catch((error) => {
    host.logWarning(`백그라운드 작업 실패 (${savedMemoryId})`, {
      error: error instanceof Error ? error.message : String(error)
    });
  });
}
