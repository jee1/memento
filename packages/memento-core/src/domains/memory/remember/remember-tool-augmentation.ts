/**
 * Remember Tool — 백그라운드 증강 파이프라인 (remember-tool.ts에서 분리, #582).
 *
 * fire-and-forget: 임베딩·인접기억·관계추출·Triple 추출을 비동기로 수행.
 * 메모리 저장 성공 여부와 독립적.
 */

import type Database from 'better-sqlite3';
import { isTestEnvironment } from '../../../shared/utils/environment-check.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { getVectorSearchEngine } from '../../search/algorithms/vector-search-engine.js';
import { MemoryNeighborService } from '../services/memory-neighbor-service.js';
import { RelationExtractor } from '../../relation/services/relation-extractor.js';
import type { RelationCandidate } from '../../../shared/types/relation.js';
import { UnifiedEmbeddingService } from '../../embedding/services/unified-embedding-service.js';
import { TripleExtractionService } from '../../relation/services/triple-extraction/triple-extraction-service.js';
import type { RelationGraphPort } from '../../relation/ports/relation-graph.port.js';
import { SemanticMemoryUpdateService } from '../semantic/semantic-memory-update-service.js';
import { convertEpisodicSource } from '../semantic/episodic-semantic-conversion.js';
import type { ToolContext } from '../../../tools/types.js';
import type { RememberToolHost } from './remember-tool-host.js';
import { getExistingMemoriesForRelationExtraction, getMemoryById } from './remember-tool-db-helpers.js';

const TRIPLE_CONVERSION_MAX_RETRIES = 3;
const TRIPLE_CONVERSION_RETRY_BACKOFF_DAYS = [1, 2, 4];

export interface AugmentationParams {
  dbRef: Database.Database;
  savedMemoryId: string;
  savedMemoryType: string;
  content: string;
  importance: number;
  enable_triple_extraction: boolean | undefined;
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

/**
 * 관계 추출 후보를 RelationGraph에 배치로 영속화한다 (#711).
 * 실패는 warning으로만 남기고 remember 흐름에 영향을 주지 않는다 (isolate).
 */
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

/**
 * relationGraph를 사용할 수 없을 때 주입하는 no-op 대체물.
 * `SemanticMemoryUpdateService`의 관계 생성은 primary commit 뒤 post-commit intent로 독립 정산되므로
 * (episodic-semantic-conversion.ts 계약), 이 stub이 던지는 에러는 로그로만 남고 semantic 저장 성공을
 * 되돌리지 않는다 (contracts/conversion-state.md §Post-commit intents).
 */
function createUnavailableRelationGraphStub(): RelationGraphPort {
  return {
    addRelation: () => Promise.reject(new Error('relation_graph_unavailable'))
  } as unknown as RelationGraphPort;
}

/**
 * remember 백그라운드 증강의 Triple 추출/변환은 공유 conversion coordinator(#805 T013)에 위임한다.
 * source 상태 전이(진행중/성공/실패/재시도)는 coordinator의 조건부 CAS commit이 단일 지점에서 처리하며,
 * 이 함수는 dependency 조립과 결과 로깅만 담당한다 — 기존 scheduler 등록/fallback과 remember 사용자 결과는
 * 그대로 유지된다.
 */
export async function runTripleExtractionJob(
  params: AugmentationParams,
  context: ToolContext,
  host: RememberToolHost
): Promise<void> {
  const { dbRef, savedMemoryId } = params;

  try {
    const dbValid = await checkDbConnection(dbRef);
    if (!dbValid) {
      host.logWarning('데이터베이스 연결이 유효하지 않아 Triple 추출을 건너뜁니다', { memory_id: savedMemoryId });
      return;
    }

    const embeddingServiceRef = context.services.embeddingService;
    const unifiedEmbeddingService: UnifiedEmbeddingService = embeddingServiceRef
      ? embeddingServiceRef.getUnifiedEmbeddingService()
      : new UnifiedEmbeddingService();

    const relationGraph = context.services.relationGraph;
    if (!relationGraph) {
      host.logWarning('관계 그래프를 사용할 수 없어 Triple 추출 관계 정산을 생략합니다', { memory_id: savedMemoryId });
    }

    const semanticMemoryUpdateService = new SemanticMemoryUpdateService(
      dbRef,
      relationGraph ?? createUnavailableRelationGraphStub(),
      unifiedEmbeddingService,
      undefined,
      embeddingServiceRef
    );

    const outcome = await convertEpisodicSource(
      {
        db: dbRef,
        tripleExtractionService: new TripleExtractionService(),
        semanticMemoryUpdateService
      },
      {
        sourceId: savedMemoryId,
        skipConverted: true,
        maxRetries: TRIPLE_CONVERSION_MAX_RETRIES,
        retryBackoffDays: TRIPLE_CONVERSION_RETRY_BACKOFF_DAYS,
        now: () => new Date()
      }
    );

    if (outcome.kind === 'success') {
      host.logInfo('Triple 추출 및 Semantic Memory 생성 완료', {
        memory_id: savedMemoryId,
        semantic_memory_count: outcome.update.semanticMemoryIds.length
      });
    } else if (outcome.kind === 'failed') {
      host.logInfo('Triple 추출 완료 (Triple 없음 또는 실패)', {
        memory_id: savedMemoryId,
        retry_count: outcome.retryCount
      });
    } else {
      host.logInfo('Triple 추출 작업을 건너뜁니다 (이미 처리되었거나 대상이 유효하지 않음)', {
        memory_id: savedMemoryId
      });
    }
  } catch (error) {
    host.logWarning(`Triple 추출 실패 (${savedMemoryId})`, {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function runTripleExtraction(
  params: AugmentationParams,
  context: ToolContext,
  host: RememberToolHost
): Promise<void> {
  const { savedMemoryId, savedMemoryType, enable_triple_extraction } = params;

  if (savedMemoryType !== 'episodic' || enable_triple_extraction === false) return;

  try {
    const batchScheduler = context.services?.batchScheduler;
    if (!batchScheduler) {
      host.logWarning('배치 스케줄러를 사용할 수 없어 Triple 추출 작업을 등록하지 않습니다.', { memory_id: savedMemoryId });
      return;
    }

    const jobName = `triple_extraction_${savedMemoryId}`;
    const tripleJob = () => runTripleExtractionJob(params, context, host);

    if (isTestEnvironment()) {
      host.logInfo('테스트 환경: Triple 추출 작업을 즉시 실행합니다', { memory_id: savedMemoryId, job_name: jobName });
      try { await tripleJob(); } catch (directError) {
        host.logWarning('Triple 추출 작업 즉시 실행 실패', {
          memory_id: savedMemoryId,
          error: directError instanceof Error ? directError.message : String(directError)
        });
      }
      return;
    }

    const added = batchScheduler.addJob(jobName, tripleJob, 5, 0);
    if (added) {
      host.logInfo('Triple 추출 작업이 JobQueue에 등록되었습니다', { memory_id: savedMemoryId, job_name: jobName });
    } else {
      const alreadyQueued = batchScheduler.isJobQueued(jobName);
      const alreadyRunning = batchScheduler.isJobRunning(jobName);
      const status = batchScheduler.getStatus();
      host.logWarning('Triple 추출 작업이 JobQueue에 등록되지 않았습니다 (중복 또는 큐 가득참)', {
        memory_id: savedMemoryId,
        job_name: jobName,
        scheduler_running: status.isRunning,
        already_queued: Boolean(alreadyQueued),
        already_running: Boolean(alreadyRunning)
      });

      if (!alreadyQueued && !alreadyRunning) {
        try { await tripleJob(); } catch (fallbackError) {
          host.logWarning('Triple 추출 작업 직접 실행 실패', {
            memory_id: savedMemoryId,
            error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
          });
        }
      }
    }
  } catch (error) {
    host.logWarning(`Triple 추출 작업 등록 실패 (${savedMemoryId})`, {
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
      await runTripleExtraction(params, context, host);
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
