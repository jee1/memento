/**
 * Semantic Memory 업데이트 파이프라인
 */

import Database from 'better-sqlite3';
import type { ExtractionInfo, Triple } from '../../../shared/types/triple-extraction.js';
import { logger } from '../../../shared/utils/logger.js';
import { KgTripleRepositorySqlite as KgTripleRepository } from '../../../infrastructure/database/repositories/kg-triple-repository-sqlite.impl.js';
import { SemanticMemoryStatisticsService } from './semantic-memory-statistics.js';
import type { SemanticMemoryCrud } from './semantic-memory-crud.js';
import type { SemanticMemoryRelations } from './semantic-memory-relations.js';
import type { SemanticMemoryScoring } from './semantic-memory-scoring.js';
import type { SemanticMemorySimilarity } from './semantic-memory-similarity.js';
import {
  DEFAULT_CONFIDENCE_THRESHOLD,
  DEFAULT_SIMILARITY_THRESHOLD,
  type EpisodicSourceSnapshot,
  type InvocationInputPosition,
  type InvocationPolicySnapshot,
  type NormalizedTripleSnapshot,
  type PreparedUpdateData,
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

export class SemanticMemoryUpdatePipeline {
  constructor(
    private db: Database.Database,
    private scoring: SemanticMemoryScoring,
    private similarity: SemanticMemorySimilarity,
    private crud: SemanticMemoryCrud,
    private relations: SemanticMemoryRelations,
    private kgTripleRepo: KgTripleRepository,
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

    for (const position of positions) {
      if (!position.triple) {
        result.skipped++;
        continue;
      }

      try {
        const snapshot = this.scoring.prepareNormalizedTriple(position.triple, position.index);
        if (!this.isProcessableSnapshot(snapshot)) {
          result.skipped++;
          continue;
        }

        const processed = await this.processSingleTriple(
          snapshot,
          source,
          policy,
          confidenceThreshold,
          similarityThreshold,
          result
        );
        confidences.push(processed.confidence);
      } catch (error) {
        hasError = true;
        safeLog('error', 'SemanticMemoryUpdateService: Triple 처리 실패', {
          reason: error instanceof Error ? error.name : typeof error,
          index: position.index
        });
        result.skipped++;
      }
    }

    return { result, confidences, hasError };
  }

  async processSingleTriple(
    snapshot: NormalizedTripleSnapshot,
    source: EpisodicSourceSnapshot,
    policy: InvocationPolicySnapshot,
    confidenceThreshold: number,
    similarityThreshold: number,
    result: SemanticMemoryUpdateResult
  ): Promise<{ confidence: number }> {
    const confidence = snapshot.confidence;

    if (!this.scoring.passesConfidenceThreshold(confidence, confidenceThreshold)) {
      result.skipped++;
      safeLog('debug', 'SemanticMemoryUpdateService: Confidence가 임계값 미만', {
        index: snapshot.index,
        confidence,
        threshold: confidenceThreshold,
        reason: 'confidence_below_threshold'
      });
      return { confidence };
    }

    const existingKg = this.kgTripleRepo.getBySubjectPredicateObject(
      snapshot.subject,
      snapshot.predicate,
      snapshot.object
    );
    if (existingKg?.representative_memory_id) {
      const target = this.similarity.findEligibleSemanticMemoryById(
        existingKg.representative_memory_id,
        snapshot,
        source
      );
      if (target) {
        this.db.prepare(
          'UPDATE memory_item SET num_times = num_times + 1, last_mentioned_at = ?, recall_count = recall_count + 1 WHERE id = ?'
        ).run(new Date().toISOString(), existingKg.representative_memory_id);
        result.updated++;
        result.semanticMemoryIds.push(existingKg.representative_memory_id);
        await this.settlePostCommit(this.relationIntents(
          policy.episodicMemoryId,
          existingKg.representative_memory_id,
          confidence
        ));
        return { confidence };
      }
    }

    const duplicate = await this.similarity.findDuplicateSemanticMemory(
      snapshot,
      source,
      similarityThreshold
    );

    if (duplicate) {
      await this.crud.updateExistingSemanticMemory(duplicate.id, policy, confidence);
      result.updated++;
      result.semanticMemoryIds.push(duplicate.id);
    } else {
      const created = await this.crud.createSemanticMemory(
        snapshot,
        source,
        policy.episodicImportance
      );
      result.created++;
      result.semanticMemoryIds.push(created.id);
      await this.settlePostCommit([
        ...this.relationIntents(policy.episodicMemoryId, created.id, confidence),
        { kind: 'embedding', memoryId: created.id, content: created.content }
      ]);
      return { confidence };
    }

    await this.settlePostCommit(this.relationIntents(
      policy.episodicMemoryId,
      duplicate.id,
      confidence
    ));
    return { confidence };
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

  private async settlePostCommit(intents: readonly PostCommitIntent[]): Promise<void> {
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
