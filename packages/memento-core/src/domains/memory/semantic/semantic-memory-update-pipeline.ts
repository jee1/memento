/**
 * Semantic Memory 업데이트 파이프라인
 */

import Database from 'better-sqlite3';
import type { ExtractionInfo, Triple } from '../../../shared/types/triple-extraction.js';
import { logger } from '../../../shared/utils/logger.js';
import { KgTripleRepositorySqlite as KgTripleRepository } from '../../../infrastructure/database/repositories/kg-triple-repository-sqlite.impl.js';
import { SemanticMemoryStatisticsService } from './semantic-memory-statistics.js';
import type {
  PreparedEvidenceOccurrence,
  SemanticMemoryCrud
} from './semantic-memory-crud.js';
import type { SemanticMemoryRelations } from './semantic-memory-relations.js';
import type { SemanticMemoryScoring } from './semantic-memory-scoring.js';
import type {
  CandidateDecision,
  SemanticMemorySimilarity
} from './semantic-memory-similarity.js';
import {
  DEFAULT_CONFIDENCE_THRESHOLD,
  DEFAULT_SIMILARITY_THRESHOLD,
  type EpisodicSourceSnapshot,
  type InvocationInputPosition,
  type InvocationPolicySnapshot,
  type NormalizedTripleSnapshot,
  type PreparedUpdateData,
  type ProcessingOutcomeKind,
  type SemanticMemoryUpdateRequestSnapshot,
  type SemanticMemoryUpdateResult
} from './semantic-memory-update-types.js';

const KNOWN_FAILURE_REASONS = new Set([
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnitNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

function optionalUnitNumber(value: unknown, fallback: number, fieldName: string): number {
  if (value === undefined) {
    return fallback;
  }
  if (isUnitNumber(value)) {
    return value;
  }
  throw new TypeError(`Invalid semantic update ${fieldName}`);
}

function emptyResult(): SemanticMemoryUpdateResult {
  return {
    created: 0,
    updated: 0,
    skipped: 0,
    semanticMemoryIds: []
  };
}

type PostCommitIntent =
  | {
      kind: 'extracted_from' | 'supported_by';
      sourceId: string;
      targetId: string;
      confidence: number;
    }
  | { kind: 'embedding'; memoryId: string; content: string };

function safeLog(
  level: 'debug' | 'warn' | 'error',
  message: string,
  details: Record<string, unknown>
): void {
  try {
    logger[level](message, details);
  } catch {
    // Observability cannot replace the operation outcome.
  }
}

export function coalescePreparedOccurrences(
  occurrences: readonly PreparedEvidenceOccurrence[]
): PreparedEvidenceOccurrence[] {
  const matched = new Map<string, PreparedEvidenceOccurrence[]>();
  const independent: PreparedEvidenceOccurrence[] = [];

  for (const occurrence of occurrences) {
    if (occurrence.decision.kind !== 'exact' && occurrence.decision.kind !== 'similar') {
      independent.push(occurrence);
      continue;
    }
    const targetId = occurrence.decision.candidate.id;
    const group = matched.get(targetId);
    if (group) {
      group.push(occurrence);
    } else {
      matched.set(targetId, [occurrence]);
    }
  }

  const coalesced = [...independent];
  for (const group of matched.values()) {
    const representative = group.reduce((best, occurrence) =>
      occurrence.confidence > best.confidence ||
      (occurrence.confidence === best.confidence &&
        occurrence.representativeIndex < best.representativeIndex)
        ? occurrence
        : best
    );
    const indexes = new Set(group.flatMap((occurrence) => [
      occurrence.representativeIndex,
      ...occurrence.duplicateIndexes
    ]));
    indexes.delete(representative.representativeIndex);
    coalesced.push({
      ...representative,
      firstIndex: Math.min(...group.map((occurrence) => occurrence.firstIndex)),
      duplicateIndexes: [...indexes].sort((left, right) => left - right)
    });
  }

  return coalesced.sort((left, right) => left.firstIndex - right.firstIndex);
}

export class SemanticMemoryUpdatePipeline {
  constructor(
    _db: Database.Database,
    private scoring: SemanticMemoryScoring,
    private similarity: SemanticMemorySimilarity,
    private crud: SemanticMemoryCrud,
    private relations: SemanticMemoryRelations,
    _kgTripleRepo: KgTripleRepository,
    private statistics: SemanticMemoryStatisticsService
  ) {}

  validateAndSnapshotRequest(
    extractionResult: unknown,
    options: unknown
  ): SemanticMemoryUpdateRequestSnapshot {
    if (!isRecord(extractionResult)) {
      throw new TypeError('Invalid semantic update extractionResult');
    }

    const triples = extractionResult.triples;
    if (!Array.isArray(triples)) {
      throw new TypeError('Invalid semantic update triples');
    }
    if (triples.length === 0) {
      return { kind: 'empty', result: emptyResult() };
    }

    const extractionInfo = this.snapshotExtractionInfo(extractionResult.extractionInfo);
    const policy = this.snapshotPolicy(options);
    const positions = Array.from({ length: triples.length }, (_, index) => ({
      index,
      triple: this.snapshotTriple(triples[index])
    }));

    return { kind: 'ready', policy, positions, extractionInfo };
  }

  prepareUpdateData(policy: InvocationPolicySnapshot): PreparedUpdateData {
    return {
      confidenceThreshold: policy.confidenceThreshold,
      similarityThreshold: policy.similarityThreshold,
      result: emptyResult(),
      confidences: [],
      hasError: false
    };
  }

  async applyUpdates(
    positions: InvocationInputPosition[],
    _extractionInfo: ExtractionInfo,
    source: EpisodicSourceSnapshot,
    policy: InvocationPolicySnapshot,
    preparedData: PreparedUpdateData
  ): Promise<{
    result: SemanticMemoryUpdateResult;
    confidences: number[];
    hasError: boolean;
  }> {
    const { confidenceThreshold, similarityThreshold, result, confidences } = preparedData;
    let hasError = false;
    this.relations.validateRelationContract(source);

    const outcomes: Array<ProcessingOutcomeKind | undefined> = Array(positions.length);
    const snapshotsByIndex = new Map<number, NormalizedTripleSnapshot>();
    const normalizedGroups = new Map<string, NormalizedTripleSnapshot[]>();

    for (const position of positions) {
      if (!position.triple) {
        outcomes[position.index] = 'skipped';
        continue;
      }

      try {
        const snapshot = this.scoring.prepareNormalizedTriple(position.triple, position.index);
        if (!this.isProcessableSnapshot(snapshot) || !isUnitNumber(snapshot.confidence)) {
          outcomes[position.index] = 'skipped';
          continue;
        }
        confidences.push(snapshot.confidence);

        if (!this.scoring.passesConfidenceThreshold(snapshot.confidence, confidenceThreshold)) {
          outcomes[position.index] = 'skipped';
          safeLog('debug', 'SemanticMemoryUpdateService: Confidence가 임계값 미만', {
            index: snapshot.index,
            confidence: snapshot.confidence,
            threshold: confidenceThreshold,
            reason: 'confidence_below_threshold'
          });
          continue;
        }

        snapshotsByIndex.set(snapshot.index, snapshot);
        const key = JSON.stringify([snapshot.subject, snapshot.predicate, snapshot.object]);
        const group = normalizedGroups.get(key);
        if (group) {
          group.push(snapshot);
        } else {
          normalizedGroups.set(key, [snapshot]);
        }
      } catch (error) {
        hasError = true;
        safeLog('error', 'SemanticMemoryUpdateService: Triple 처리 실패', {
          sourceId: source.id,
          reason: error instanceof Error ? error.name : typeof error,
          index: position.index
        });
        outcomes[position.index] = 'skipped';
      }
    }

    const occurrences: PreparedEvidenceOccurrence[] = [];
    for (const group of normalizedGroups.values()) {
      const representative = group.reduce((best, snapshot) =>
        snapshot.confidence > best.confidence ||
        (snapshot.confidence === best.confidence && snapshot.index < best.index)
          ? snapshot
          : best
      );
      let decision: CandidateDecision;
      try {
        decision = await this.similarity.findDuplicateSemanticMemory(
          representative,
          source,
          similarityThreshold
        );
      } catch (error) {
        decision = {
          kind: 'indeterminate',
          reason: error instanceof Error ? error.name : 'candidate_lookup_failed'
        };
      }
      occurrences.push({
        firstIndex: Math.min(...group.map((snapshot) => snapshot.index)),
        representativeIndex: representative.index,
        confidence: representative.confidence,
        episodicImportance: policy.episodicImportance,
        duplicateIndexes: group
          .map((snapshot) => snapshot.index)
          .filter((index) => index !== representative.index)
          .sort((left, right) => left - right),
        decision
      });
    }

    const semanticMemoryIds = new Set<string>();
    for (const occurrence of coalescePreparedOccurrences(occurrences)) {
      occurrence.duplicateIndexes.forEach((index) => {
        outcomes[index] = 'duplicate';
      });
      const snapshot = snapshotsByIndex.get(occurrence.representativeIndex)!;
      try {
        const processed = await this.processPreparedOccurrence(
          snapshot,
          occurrence,
          source,
          policy,
          similarityThreshold
        );
        outcomes[occurrence.representativeIndex] = processed.kind;
        if (!semanticMemoryIds.has(processed.id)) {
          semanticMemoryIds.add(processed.id);
          result.semanticMemoryIds.push(processed.id);
        }
      } catch (error) {
        hasError = true;
        outcomes[occurrence.representativeIndex] = 'skipped';
        safeLog('error', 'SemanticMemoryUpdateService: Triple 처리 실패', {
          sourceId: source.id,
          reason: error instanceof Error ? error.name : typeof error,
          index: occurrence.representativeIndex
        });
      }
    }

    result.created = outcomes.filter((outcome) => outcome === 'created').length;
    result.updated = outcomes.filter((outcome) => outcome === 'updated').length;
    result.skipped = outcomes.filter((outcome) => outcome === 'skipped').length;
    return { result, confidences, hasError };
  }

  private async processPreparedOccurrence(
    snapshot: NormalizedTripleSnapshot,
    evidence: PreparedEvidenceOccurrence,
    source: EpisodicSourceSnapshot,
    policy: InvocationPolicySnapshot,
    similarityThreshold: number
  ): Promise<{ id: string; kind: 'created' | 'updated' }> {
    const { confidence, decision } = evidence;
    if (decision.kind === 'indeterminate') {
      const error = new Error(decision.reason);
      error.name = decision.reason;
      throw error;
    }
    let duplicate = decision.kind === 'none' ? null : decision.candidate;

    if (duplicate) {
      let updated = await this.crud.updateExistingSemanticMemory(duplicate, evidence);
      if (!updated) {
        const reevaluated = await this.similarity.findDuplicateSemanticMemory(
          snapshot,
          source,
          similarityThreshold
        );
        if (reevaluated.kind === 'indeterminate') {
          const error = new Error(reevaluated.reason);
          error.name = reevaluated.reason;
          throw error;
        }
        if (reevaluated.kind === 'none') {
          const error = new Error('candidate_stale');
          error.name = 'candidate_stale';
          throw error;
        }

        duplicate = reevaluated.candidate;
        evidence = { ...evidence, decision: reevaluated };
        updated = await this.crud.updateReevaluatedSemanticMemory(duplicate, evidence);
        if (!updated) {
          const error = new Error('candidate_stale');
          error.name = 'candidate_stale';
          throw error;
        }
      }
      await this.settlePostCommit(this.relationIntents(
        policy.episodicMemoryId,
        duplicate.id,
        confidence
      ), source.id, snapshot.index);
      return { id: updated.id, kind: 'updated' };
    } else {
      const created = await this.crud.createSemanticMemory(
        snapshot,
        source,
        policy.episodicImportance
      );
      await this.settlePostCommit([
        ...this.relationIntents(policy.episodicMemoryId, created.id, confidence),
        { kind: 'embedding', memoryId: created.id, content: created.content }
      ], source.id, snapshot.index);
      return { id: created.id, kind: 'created' };
    }
  }

  notifyListeners(
    result: SemanticMemoryUpdateResult,
    totalTriples: number,
    confidences: number[],
    processingStartTime: number,
    hasError: boolean
  ): void {
    const processingTime = Date.now() - processingStartTime;
    const duplicates = totalTriples - (result.created + result.updated + result.skipped);
    try {
      this.statistics.recordUpdate(
        result.created,
        result.updated,
        result.skipped,
        duplicates,
        confidences,
        processingTime,
        hasError
      );
    } catch (error) {
      safeLog('warn', 'SemanticMemoryUpdateService: 통계 기록 실패 (무시)', {
        reason: error instanceof Error ? error.name : typeof error
      });
    }
  }

  private relationIntents(
    episodicMemoryId: string,
    semanticMemoryId: string,
    confidence: number
  ): PostCommitIntent[] {
    return [
      {
        kind: 'extracted_from',
        sourceId: semanticMemoryId,
        targetId: episodicMemoryId,
        confidence
      },
      {
        kind: 'supported_by',
        sourceId: episodicMemoryId,
        targetId: semanticMemoryId,
        confidence
      }
    ];
  }

  private async settlePostCommit(
    intents: readonly PostCommitIntent[],
    sourceId: string,
    inputIndex: number
  ): Promise<void> {
    const settled = await Promise.allSettled(intents.map(async (intent) => {
      if (intent.kind === 'embedding') {
        await this.crud.createSemanticEmbedding(intent.memoryId, intent.content);
        return;
      }
      await this.relations.createEpisodicRelation(
        intent.kind,
        intent.sourceId,
        intent.targetId,
        intent.confidence
      );
    }));

    settled.forEach((outcome, index) => {
      if (outcome.status === 'rejected') {
        safeLog('warn', 'SemanticMemoryUpdateService: post-commit 작업 실패 (무시)', {
          sourceId,
          index: inputIndex,
          kind: intents[index]?.kind ?? 'unknown',
          reason: outcome.reason instanceof Error ? outcome.reason.name : typeof outcome.reason
        });
      }
    });
  }

  private snapshotExtractionInfo(value: unknown): ExtractionInfo {
    if (!isRecord(value) || !isRecord(value.steps)) {
      throw new TypeError('Invalid semantic update extractionInfo');
    }
    if (typeof value.steps.canonicalization !== 'boolean' || typeof value.steps.entityLinking !== 'boolean') {
      throw new TypeError('Invalid semantic update extractionInfo.steps');
    }
    if (
      value.failureReason !== undefined &&
      (typeof value.failureReason !== 'string' || !KNOWN_FAILURE_REASONS.has(value.failureReason))
    ) {
      throw new TypeError('Invalid semantic update failureReason');
    }

    const extractionInfo: ExtractionInfo = {
      steps: {
        canonicalization: value.steps.canonicalization,
        entityLinking: value.steps.entityLinking
      }
    };
    if (value.failureReason !== undefined) {
      extractionInfo.failureReason = value.failureReason as ExtractionInfo['failureReason'];
    }
    return extractionInfo;
  }

  private snapshotPolicy(options: unknown): InvocationPolicySnapshot {
    if (!isRecord(options) || typeof options.episodicMemoryId !== 'string' || options.episodicMemoryId.trim() === '') {
      throw new TypeError('Invalid semantic update episodicMemoryId');
    }

    return {
      episodicMemoryId: options.episodicMemoryId,
      episodicImportance: optionalUnitNumber(options.episodicImportance, 0.5, 'episodicImportance'),
      episodicImportanceProvided: options.episodicImportance !== undefined,
      confidenceThreshold: optionalUnitNumber(
        options.confidenceThreshold,
        DEFAULT_CONFIDENCE_THRESHOLD,
        'confidenceThreshold'
      ),
      similarityThreshold: optionalUnitNumber(
        options.similarityThreshold,
        DEFAULT_SIMILARITY_THRESHOLD,
        'similarityThreshold'
      )
    };
  }

  private snapshotTriple(value: unknown): Triple | null {
    if (!isRecord(value)) {
      return null;
    }
    if (
      typeof value.subject !== 'string' ||
      typeof value.predicate !== 'string' ||
      typeof value.object !== 'string' ||
      value.subject.trim() === '' ||
      value.predicate.trim() === '' ||
      value.object.trim() === ''
    ) {
      return null;
    }
    return {
      subject: value.subject,
      predicate: value.predicate,
      object: value.object
    };
  }

  private isProcessableSnapshot(snapshot: NormalizedTripleSnapshot): boolean {
    return snapshot.subject.trim() !== '' &&
      snapshot.predicate.trim() !== '' &&
      snapshot.object.trim() !== '';
  }
}
