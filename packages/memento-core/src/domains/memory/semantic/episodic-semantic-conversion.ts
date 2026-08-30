/**
 * Episodic → Semantic 변환 공유 coordinator (#805 T013)
 *
 * remember 백그라운드 증강, ConvertEpisodicToSemanticTool, TripleExtractionBatchJob이 공통으로 쓰는
 * source snapshot/commit/failure 전이 단일 지점. package root에서 export하지 않으며 공개
 * SemanticMemoryUpdateResult/MCP 필드를 바꾸지 않는다 (contracts/conversion-state.md).
 *
 * 처리 경계:
 *  1) active episodic source snapshot을 value-copy한다.
 *  2) extractor/semantic 준비는 write transaction 밖에서 수행한다 (SemanticMemoryUpdateService 내부는
 *     기존 T005-T011 per-occurrence 조건부 commit을 그대로 사용한다).
 *  3) source tuple(triple_extracted/status/metadata)까지 포함한 conditional CAS UPDATE로 commit 시점에
 *     snapshot을 재검증한다 — 단일 statement라 원자적이고 no mutex/lease로 single-winner를 보장한다.
 *  4) genuine pre-commit failure만 failed/abandoned metadata 전체 교체 conditional write를 시도한다.
 *  5) stale/loser/forced-prior-success 실패는 source state를 쓰지 않는다.
 */

import type Database from 'better-sqlite3';
import type { TripleExtractionService } from '../../relation/services/triple-extraction/triple-extraction-service.js';
import type {
  TripleExtractionFailureReason,
  TripleExtractionResult
} from '../../../shared/types/triple-extraction.js';
import type { SemanticMemoryUpdateService } from './semantic-memory-update-service.js';
import type { SemanticMemoryUpdateResult } from './semantic-memory-update-types.js';
import {
  buildTripleExtractionAbandonedMetadata,
  buildTripleExtractionFailedMetadata,
  buildTripleExtractionSuccessMetadata
} from './triple-extraction-metadata.js';

export interface EpisodicSemanticConversionOptions {
  sourceId: string;
  skipConverted: boolean;
  maxRetries: number;
  retryBackoffDays: readonly number[];
  now: () => Date;
}

export interface EpisodicSemanticConversionDependencies {
  db: Database.Database;
  tripleExtractionService: Pick<TripleExtractionService, 'extractTriples'>;
  semanticMemoryUpdateService: SemanticMemoryUpdateService;
}

export type EpisodicSemanticConversionOutcome =
  | { kind: 'success'; update: SemanticMemoryUpdateResult }
  | { kind: 'failed'; retryCount?: number }
  | { kind: 'skipped' };

interface ConversionSourceSnapshot {
  id: string;
  content: string;
  importance: number | null;
  ownerId: string | null;
  projectId: string | null;
  tripleExtracted: number | null;
  tripleExtractedStatus: string | null;
  tripleExtractionMetadata: string | null;
}

const KNOWN_FAILURE_REASONS = new Set<TripleExtractionFailureReason>([
  'no_triple',
  'ambiguous_structure',
  'llm_parse_fail',
  'llm_api_error',
  'llm_unavailable',
  'db_connection_error',
  'relation_graph_unavailable',
  'semantic_update_failed',
  'conversion_error'
]);

function readSourceSnapshot(db: Database.Database, sourceId: string): ConversionSourceSnapshot | null {
  const row = db.prepare(`
    SELECT
      id, content, importance, type,
      owner_id AS ownerId, project_id AS projectId, is_deleted AS isDeleted,
      triple_extracted AS tripleExtracted,
      triple_extracted_status AS tripleExtractedStatus,
      triple_extraction_metadata AS tripleExtractionMetadata
    FROM memory_item
    WHERE id = ?
  `).get(sourceId) as {
    id: string;
    content: string;
    importance: number | null;
    type: string;
    ownerId: string | null;
    projectId: string | null;
    isDeleted: number | null;
    tripleExtracted: number | null;
    tripleExtractedStatus: string | null;
    tripleExtractionMetadata: string | null;
  } | undefined;

  if (!row || row.type !== 'episodic' || row.isDeleted !== 0) {
    return null;
  }

  return {
    id: row.id,
    content: row.content,
    importance: row.importance,
    ownerId: row.ownerId,
    projectId: row.projectId,
    tripleExtracted: row.tripleExtracted,
    tripleExtractedStatus: row.tripleExtractedStatus,
    tripleExtractionMetadata: row.tripleExtractionMetadata
  };
}

/** 진짜로 source가 변경/삭제되어 stale해졌는지만 확인한다 (conversion tuple은 보지 않는다). */
function sourceStillMatches(db: Database.Database, snapshot: ConversionSourceSnapshot): boolean {
  return db.prepare(`
    SELECT 1 FROM memory_item
    WHERE id = ? AND type = 'episodic' AND is_deleted = 0
      AND content IS ? AND importance IS ? AND owner_id IS ? AND project_id IS ?
  `).get(
    snapshot.id, snapshot.content, snapshot.importance, snapshot.ownerId, snapshot.projectId
  ) !== undefined;
}

/**
 * source 전체 snapshot(conversion tuple 포함)을 조건으로 하는 단일 UPDATE — 없어진 mutex/lease 대신
 * conditional SQL 한 문장으로 single-winner를 결정한다. 한 statement는 SQLite에서 원자적이다.
 */
function commitTuple(
  db: Database.Database,
  snapshot: ConversionSourceSnapshot,
  tripleExtracted: 0 | 1,
  status: 'success' | 'failed' | 'abandoned',
  metadata: Record<string, unknown>
): boolean {
  const result = db.prepare(`
    UPDATE memory_item
    SET triple_extracted = ?, triple_extracted_status = ?, triple_extraction_metadata = ?
    WHERE id = ? AND type = 'episodic' AND is_deleted = 0
      AND content IS ? AND importance IS ? AND owner_id IS ? AND project_id IS ?
      AND triple_extracted IS ? AND triple_extracted_status IS ? AND triple_extraction_metadata IS ?
  `).run(
    tripleExtracted,
    status,
    JSON.stringify(metadata),
    snapshot.id, snapshot.content, snapshot.importance, snapshot.ownerId, snapshot.projectId,
    snapshot.tripleExtracted, snapshot.tripleExtractedStatus, snapshot.tripleExtractionMetadata
  );
  return result.changes > 0;
}

function parseRetryCount(metadataJson: string | null): number {
  if (!metadataJson) return 0;
  try {
    const parsed: unknown = JSON.parse(metadataJson);
    const retryCount = (parsed as { retry_count?: unknown } | null)?.retry_count;
    return Number.isSafeInteger(retryCount) && (retryCount as number) >= 0 ? (retryCount as number) : 0;
  } catch {
    return 0;
  }
}

function backoffDaysFor(newRetryCount: number, backoff: readonly number[]): number {
  if (backoff.length === 0) return 0;
  const index = Math.min(Math.max(newRetryCount - 1, 0), backoff.length - 1);
  return backoff[index]!;
}

function normalizeFailureReason(reason: string | undefined): TripleExtractionFailureReason {
  if (reason && KNOWN_FAILURE_REASONS.has(reason as TripleExtractionFailureReason)) {
    return reason as TripleExtractionFailureReason;
  }
  return 'no_triple';
}

function isValidExtractionResult(value: unknown): value is TripleExtractionResult {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { triples?: unknown; extractionInfo?: unknown };
  if (!Array.isArray(candidate.triples)) return false;
  const info = candidate.extractionInfo as { steps?: unknown } | undefined;
  if (typeof info !== 'object' || info === null) return false;
  const steps = info.steps as { canonicalization?: unknown; entityLinking?: unknown } | undefined;
  return typeof steps === 'object' && steps !== null &&
    typeof steps.canonicalization === 'boolean' && typeof steps.entityLinking === 'boolean';
}

function malformedExtractionResult(): TripleExtractionResult {
  return {
    triples: [],
    extractionInfo: {
      steps: { canonicalization: false, entityLinking: false },
      failureReason: 'llm_parse_fail'
    }
  };
}

async function safeExtract(
  tripleExtractionService: Pick<TripleExtractionService, 'extractTriples'>,
  content: string,
  sourceId: string
): Promise<TripleExtractionResult> {
  try {
    const raw = await tripleExtractionService.extractTriples(content, {}, sourceId);
    return isValidExtractionResult(raw) ? raw : malformedExtractionResult();
  } catch {
    return malformedExtractionResult();
  }
}

/**
 * genuine pre-commit failure만 처리한다.
 * - 이미 success인 snapshot(강제 재처리 실패): source 불변, retryCount 없이 `failed`
 * - stale/unconfirmed 또는 failure-state write 실패: source 불변, `skipped` (batch는 none)
 */
function buildFailureOutcome(
  db: Database.Database,
  snapshot: ConversionSourceSnapshot,
  options: EpisodicSemanticConversionOptions,
  failureReason: TripleExtractionFailureReason
): EpisodicSemanticConversionOutcome {
  if (snapshot.tripleExtractedStatus === 'success') {
    return { kind: 'failed' };
  }
  if (!sourceStillMatches(db, snapshot)) {
    return { kind: 'skipped' };
  }

  const retryCount = parseRetryCount(snapshot.tripleExtractionMetadata) + 1;
  const now = options.now();
  const abandoned = retryCount >= options.maxRetries;

  const metadata = abandoned
    ? buildTripleExtractionAbandonedMetadata(now, failureReason, retryCount)
    : buildTripleExtractionFailedMetadata(
      now,
      failureReason,
      retryCount,
      backoffDaysFor(retryCount, options.retryBackoffDays)
    );

  const committed = commitTuple(db, snapshot, 0, abandoned ? 'abandoned' : 'failed', metadata);
  return committed ? { kind: 'failed', retryCount } : { kind: 'skipped' };
}

export async function convertEpisodicSource(
  dependencies: EpisodicSemanticConversionDependencies,
  options: EpisodicSemanticConversionOptions
): Promise<EpisodicSemanticConversionOutcome> {
  const { db, tripleExtractionService, semanticMemoryUpdateService } = dependencies;

  const snapshot = readSourceSnapshot(db, options.sourceId);
  if (!snapshot) {
    return { kind: 'skipped' };
  }
  if (options.skipConverted && snapshot.tripleExtracted === 1 && snapshot.tripleExtractedStatus === 'success') {
    return { kind: 'skipped' };
  }

  const extractionResult = await safeExtract(tripleExtractionService, snapshot.content, options.sourceId);

  if (extractionResult.triples.length === 0) {
    const failureReason = normalizeFailureReason(extractionResult.extractionInfo.failureReason);
    return buildFailureOutcome(db, snapshot, options, failureReason);
  }

  let evidence: { result: SemanticMemoryUpdateResult; hasError: boolean; committedConfidences: number[] };
  try {
    evidence = await semanticMemoryUpdateService.updateSemanticMemoryWithEvidence(extractionResult, {
      episodicMemoryId: snapshot.id,
      episodicImportance: snapshot.importance ?? 0.5
    });
  } catch (error) {
    if (!sourceStillMatches(db, snapshot)) {
      return { kind: 'skipped' };
    }
    const failureReason = error instanceof Error && KNOWN_FAILURE_REASONS.has(error.message as TripleExtractionFailureReason)
      ? (error.message as TripleExtractionFailureReason)
      : 'semantic_update_failed';
    return buildFailureOutcome(db, snapshot, options, failureReason);
  }

  const { result, hasError, committedConfidences } = evidence;
  const committedCount = result.created + result.updated;

  if (committedCount === 0 && hasError) {
    return buildFailureOutcome(db, snapshot, options, 'semantic_update_failed');
  }

  const confidenceAvg = committedConfidences.length > 0
    ? committedConfidences.reduce((sum, value) => sum + value, 0) / committedConfidences.length
    : undefined;
  const metadata = buildTripleExtractionSuccessMetadata(
    options.now(),
    extractionResult.triples.length,
    confidenceAvg
  );

  const committed = commitTuple(db, snapshot, 1, 'success', metadata);
  if (!committed) {
    return { kind: 'skipped' };
  }

  return { kind: 'success', update: result };
}
