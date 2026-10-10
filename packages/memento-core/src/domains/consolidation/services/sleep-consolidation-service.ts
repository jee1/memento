/**
 * Sleep consolidation 오케스트레이터
 */

import type Database from 'better-sqlite3';
import type { AddRelationOptions, IRelationGraph } from '../../../shared/types/relation-graph.js';
import type {
  ConsolidationCluster,
  SleepConsolidationRunResult
} from '../../../shared/types/consolidation.types.js';
import type { RelationType } from '../../../shared/types/relation.js';
import type { MemoryType } from '../../../shared/types/memory.types.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { cosineSimilarity } from '../../../shared/utils/vector-math.js';
import { mcpLogger } from '../../../server/mcp-logger.js';
import { MemoryEmbeddingService } from '../../memory/services/memory-embedding-service.js';
import { ConsolidationRepository, type EpisodicCandidateRow } from '../repositories/consolidation-repository.js';
import { ClusteringService } from './clustering-service.js';
import { SummarizationService } from './summarization-service.js';
import { stripMemoryTemplateLabels } from './template-label-normalizer.js';
import { getClusterJudgeThreshold, type ClusterJudgePair, type IClusterJudge } from './cluster-judge.js';
import type { TelemetryService } from '../../telemetry/services/telemetry-service.js';
import type { Outcome } from '../../telemetry/types/telemetry.types.js';

interface SleepConsolidationRunOptions {
  dryRun?: boolean;
  ownerIdFilter?: string | null;
  lookbackDays?: number;
}

/** 부트스트랩에서 `createRelationGraph(db)` 등으로 주입 (domains → infrastructure 직접 의존 금지) */
export interface SleepConsolidationServiceDeps {
  relationGraph: IRelationGraph;
  /** remember/검색과 동일 인스턴스를 넘기면 쿼리·저장 임베딩 정책이 일치한다. 미지정 시 내부에서 새로 생성. */
  memoryEmbeddingService?: MemoryEmbeddingService;
  consolidationRepository?: ConsolidationRepository;
  clusteringService?: ClusteringService;
  summarizationService?: SummarizationService;
  /** 006: consolidation.performed 텔레메트리 */
  telemetryService?: TelemetryService;
  /** #1225: verifies cluster members and merge targets. null/undefined = cosine only. */
  clusterJudge?: IClusterJudge | null;
}

function newSemanticId(): string {
  return `mem_${crypto.randomUUID().replace(/-/g, '')}`;
}

const REL_EXTRACTED_FROM: RelationType = 'extracted_from';
const REL_SUPPORTED_BY: RelationType = 'supported_by';

function getMergeSimilarityThreshold(): number {
  const raw = process.env.CONSOLIDATION_MERGE_SIMILARITY_THRESHOLD;
  const n = raw ? parseFloat(raw) : 0.85;
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.85;
}

function mergeOriginSourceJson(existingJson: string, clusterIds: string[]): string {
  let o: Record<string, unknown> = {};
  try {
    o = JSON.parse(existingJson || '{}') as Record<string, unknown>;
  } catch {
    o = {};
  }
  const rawCtx = o.context;
  const ctx =
    rawCtx && typeof rawCtx === 'object'
      ? ({ ...(rawCtx as Record<string, unknown>) } as Record<string, unknown>)
      : ({} as Record<string, unknown>);
  const prev = Array.isArray(ctx.source_episodic_ids)
    ? (ctx.source_episodic_ids as string[])
    : [];
  const mergedIds = [...new Set([...prev, ...clusterIds])];
  return JSON.stringify({
    ...o,
    tool: o.tool ?? 'sleep-consolidation',
    context: {
      ...ctx,
      source_episodic_ids: mergedIds,
      merge_resummarize: true
    }
  });
}

export class SleepConsolidationService {
  /** 프로세스당 단일 인스턴스(bootstrap) 기준 동시 실행 방지 — static이면 테스트 간 상태가 오염된다 */
  private activeRun: Promise<void> | null = null;

  private readonly repo: ConsolidationRepository;
  private readonly clustering: ClusteringService;
  private readonly summarization: SummarizationService;
  private readonly relationGraph: IRelationGraph;
  private readonly memoryEmbedding: MemoryEmbeddingService;
  private readonly telemetryService?: TelemetryService;
  private readonly clusterJudge: IClusterJudge | null;

  constructor(
    private readonly db: Database.Database,
    deps: SleepConsolidationServiceDeps
  ) {
    this.repo = deps.consolidationRepository ?? new ConsolidationRepository(db);
    this.clustering = deps.clusteringService ?? new ClusteringService();
    this.summarization = deps.summarizationService ?? new SummarizationService();
    this.relationGraph = deps.relationGraph;
    this.memoryEmbedding = deps.memoryEmbeddingService ?? new MemoryEmbeddingService();
    this.telemetryService = deps.telemetryService;
    this.clusterJudge = deps.clusterJudge ?? null;
  }

  /**
   * 동시 실행 방지 (배치 + admin 공용)
   */
  isRunning(): boolean {
    return this.activeRun !== null;
  }

  async run(options: SleepConsolidationRunOptions = {}): Promise<SleepConsolidationRunResult> {
    if (this.activeRun) {
      return {
        runAt: new Date().toISOString(),
        durationMs: 0,
        clustersFound: 0,
        clustersProcessed: 0,
        clustersSkipped: 0,
        semanticsCreated: 0,
        semanticsMerged: 0,
        episodicsConsolidated: 0,
        errors: [],
        skippedDueToConcurrentRun: true
      };
    }
    let release!: () => void;
    const done = new Promise<void>(resolve => {
      release = resolve;
    });
    this.activeRun = done;

    const started = Date.now();
    const runAt = new Date().toISOString();
    const result: SleepConsolidationRunResult = {
      runAt,
      durationMs: 0,
      clustersFound: 0,
      clustersProcessed: 0,
      clustersSkipped: 0,
      semanticsCreated: 0,
      semanticsMerged: 0,
      episodicsConsolidated: 0,
      errors: []
    };

    let runThrew = false;
    try {
      const lookback = options.lookbackDays ?? this.repo.getLookbackDays();
      const ownerFilter = options.ownerIdFilter ?? null;
      const candidates = this.repo.findEpisodicCandidates(ownerFilter, lookback);
      const provider = this.memoryEmbedding.getUnifiedEmbeddingService?.()?.getCurrentProviderName?.() ?? undefined;
      const embMap = this.repo.loadEmbeddingsMap(candidates.map(c => c.id), provider ? { provider } : {});
      await this.useLabelFreeEmbeddings(candidates, embMap, provider);
      const clusters = await this.verifyClustersWithJudge(
        this.clustering.buildClusters(candidates, embMap),
        candidates
      );
      result.clustersFound = clusters.length;

      if (options.dryRun) {
        result.clustersSkipped = clusters.length;
        result.durationMs = Date.now() - started;
        return result;
      }

      const byId = new Map(candidates.map(c => [c.id, c]));

      for (const cluster of clusters) {
        const clusterId = `cluster-${cluster.representativeId}`;
        try {
          const episodes: EpisodicCandidateRow[] = cluster.episodicIds
            .map(id => byId.get(id))
            .filter((e): e is EpisodicCandidateRow => e != null);

          if (episodes.length < this.clustering.getMinClusterSize()) {
            result.clustersSkipped++;
            continue;
          }

          const { content: summaryText, method } = await this.summarization.summarizeCluster({
            clusterEpisodes: episodes
          });

          if (!summaryText.trim()) {
            result.clustersSkipped++;
            result.errors.push({ clusterId, error: 'Empty summary' });
            continue;
          }

          const mergeTh = getMergeSimilarityThreshold();
          const uni = this.memoryEmbedding.getUnifiedEmbeddingService();
          let mergeTarget: { id: string; content: string; originSource: string } | null = null;
          const sumEmbRes = await uni.generateEmbedding(summaryText);
          if (sumEmbRes?.embedding && Array.isArray(sumEmbRes.embedding)) {
            const sumVec = sumEmbRes.embedding as number[];
            // 후보 벡터는 저장된 것을 읽는다. 예전에는 후보마다 generateEmbedding 을 다시
            // 호출했는데, 모든 후보는 저장 시점에 이미 임베딩된 상태라 결과가 같으면서
            // 클러스터 하나에 시맨틱 수만큼 모델 추론이 돌았다 (#917).
            const semantics = this.repo.findSemanticsByOwner(cluster.ownerId, {
              provider: sumEmbRes.provider,
              model: sumEmbRes.model
            });
            let bestSim = -1;
            let withoutEmbedding = 0;
            for (const sem of semantics) {
              if (!sem.embedding) {
                withoutEmbedding++;
                continue;
              }
              const sim = cosineSimilarity(sumVec, sem.embedding);
              if (sim >= mergeTh && sim > bestSim) {
                bestSim = sim;
                mergeTarget = sem;
              }
            }
            if (withoutEmbedding > 0) {
              // 현재 모델 벡터가 없는 후보는 비교할 수 없어 병합에서 빠진다. 모델을 바꾸고
              // 재색인이 끝나지 않은 상태면 여기서 조용히 중복 시맨틱이 쌓이므로 남긴다.
              mcpLogger.logServer('warn', '현재 모델 임베딩이 없는 시맨틱은 병합 후보에서 제외', {
                clusterId,
                ownerId: cluster.ownerId,
                provider: sumEmbRes.provider ?? null,
                model: sumEmbRes.model ?? null,
                withoutEmbedding,
                candidateCount: semantics.length
              });
            }
          }

          if (mergeTarget && this.clusterJudge) {
            const [score] = await this.clusterJudge.scorePairs([{ a: summaryText, b: mergeTarget.content }]);
            const accepted = typeof score === 'number' && score >= getClusterJudgeThreshold();
            mcpLogger.logServer('info', 'Consolidation judge: merge target', {
              clusterId,
              mergeTargetId: mergeTarget.id,
              score: Number.isFinite(score) ? score : null,
              accepted
            });
            if (!accepted) {
              mergeTarget = null;
            }
          }

          if (mergeTarget) {
            const merged = await this.summarization.summarizeMergeForConsolidation({
              existingSemanticContent: mergeTarget.content,
              clusterEpisodes: episodes
            });
            if (merged.content.trim()) {
              const newOrigin = mergeOriginSourceJson(mergeTarget.originSource, cluster.episodicIds);
              await DatabaseUtils.runTransaction(this.db, async () => {
                this.repo.updateSemanticMemory({
                  id: mergeTarget!.id,
                  content: merged.content.trim(),
                  originSourceJson: newOrigin
                });
                for (const eid of cluster.episodicIds) {
                  await this.addRelationIfAbsent(
                    mergeTarget!.id,
                    eid,
                    REL_EXTRACTED_FROM,
                    { confidence: 0.75, allowCyclic: true }
                  );
                  await this.addRelationIfAbsent(
                    eid,
                    mergeTarget!.id,
                    REL_SUPPORTED_BY,
                    { confidence: 0.75, allowCyclic: true }
                  );
                }
                this.repo.markEpisodicsConsolidated(cluster.episodicIds);
              });
              const semanticType: MemoryType = 'semantic';
              const storedEmbM = await this.memoryEmbedding.createAndStoreEmbedding(
                this.db,
                mergeTarget.id,
                merged.content.trim(),
                semanticType
              );
              if (!storedEmbM) {
                result.errors.push({
                  clusterId,
                  error:
                    'Semantic embedding not stored — hybrid vector recall may miss this consolidated memory'
                });
              }
              result.clustersProcessed++;
              result.semanticsMerged++;
              result.episodicsConsolidated += cluster.episodicIds.length;
              continue;
            }
          }

          const semanticId = newSemanticId();
          const threshold = this.clustering.getSimilarityThreshold();
          const originSource = {
            tool: 'sleep-consolidation',
            caller: 'system',
            timestamp: new Date().toISOString(),
            context: {
              source_episodic_ids: cluster.episodicIds,
              cluster_size: cluster.episodicIds.length,
              similarity_threshold: threshold,
              summarization_method: method
            }
          };

          await DatabaseUtils.runTransaction(this.db, async () => {
            this.repo.insertSemanticMemory({
              id: semanticId,
              content: summaryText,
              importance: 0.55,
              originSourceJson: JSON.stringify(originSource),
              ownerId: cluster.ownerId,
              privacyScope: 'private'
            });

            for (const eid of cluster.episodicIds) {
              // data-model: semantic ─[extracted_from]→ episodic, episodic ─[supported_by]→ semantic
              await this.addRelationIfAbsent(
                semanticId,
                eid,
                REL_EXTRACTED_FROM,
                { confidence: 0.75, allowCyclic: true }
              );
              await this.addRelationIfAbsent(
                eid,
                semanticId,
                REL_SUPPORTED_BY,
                { confidence: 0.75, allowCyclic: true }
              );
            }

            this.repo.markEpisodicsConsolidated(cluster.episodicIds);
          });

          // 임베딩은 트랜잭션 밖: DB 커밋 후 실패 시 시맨틱 행·is_consolidated는 유지되고 벡터만 비는 경우가 있다.
          // 운영: `/admin/embeddings/migrate` 등 기존 백필 경로로 재시도하거나, run 결과 errors에 기록된 클러스터를 조사.
          const semanticType: MemoryType = 'semantic';
          const storedEmb = await this.memoryEmbedding.createAndStoreEmbedding(
            this.db,
            semanticId,
            summaryText,
            semanticType
          );
          if (!storedEmb) {
            result.errors.push({
              clusterId,
              error:
                'Semantic embedding not stored — hybrid vector recall may miss this consolidated memory'
            });
          }

          result.clustersProcessed++;
          result.semanticsCreated++;
          result.episodicsConsolidated += cluster.episodicIds.length;
        } catch (e) {
          result.clustersSkipped++;
          result.errors.push({
            clusterId,
            error: e instanceof Error ? e.message : String(e)
          });
        }
      }

      result.durationMs = Date.now() - started;
      return result;
    } catch (e) {
      runThrew = true;
      result.durationMs = Date.now() - started;
      throw e;
    } finally {
      const outcome: Outcome =
        runThrew || result.errors.length > 0 ? 'failure' : 'success';
      // owner_id 미설정: 시스템 배치로 한 실행에 owner가 섞일 수 있어 이벤트는 전역(집계) 관측용이다.
      this.telemetryService?.record({
        eventType: 'consolidation.performed',
        outcome,
        latencyMs: result.durationMs,
        extraData: {
          clusters_found: result.clustersFound,
          clusters_processed: result.clustersProcessed,
          semantics_created: result.semanticsCreated,
          semantics_merged: result.semanticsMerged,
          duration_ms: result.durationMs,
          error_count: result.errors.length
        }
      });
      this.activeRun = null;
      release();
    }
  }

  /**
   * #1225: replace the stored vector of template-format candidates with a vector of the
   * label-stripped text, for clustering only. Stored embeddings are not modified.
   * A candidate keeps its stored vector when re-embedding fails or yields another provider
   * or dimension, so clustering never compares vectors from different spaces.
   */
  private async useLabelFreeEmbeddings(
    candidates: Array<{ id: string; content: string }>,
    embMap: Map<string, number[]>,
    provider: string | undefined
  ): Promise<void> {
    const uni = this.memoryEmbedding.getUnifiedEmbeddingService?.();
    if (!uni) {
      return;
    }
    for (const candidate of candidates) {
      const stored = embMap.get(candidate.id);
      if (!stored) {
        continue;
      }
      const stripped = stripMemoryTemplateLabels(candidate.content);
      if (stripped === candidate.content || stripped.trim() === '') {
        continue;
      }
      try {
        const res = await uni.generateEmbedding(stripped);
        const vec = res?.embedding;
        if (
          Array.isArray(vec) &&
          vec.length === stored.length &&
          (!provider || res?.provider === provider)
        ) {
          embMap.set(candidate.id, vec as number[]);
        }
      } catch {
        // keep the stored vector
      }
    }
  }

  /**
   * #1225: when a judge is configured, each member must be judged on-topic with its cluster
   * seed (episodicIds[0]). Rejected or unjudged members stay unconsolidated for a later run
   * (fail-closed); a cluster that falls below the minimum size is dropped.
   */
  private async verifyClustersWithJudge(
    clusters: ConsolidationCluster[],
    candidates: EpisodicCandidateRow[]
  ): Promise<ConsolidationCluster[]> {
    const judge = this.clusterJudge;
    if (!judge || clusters.length === 0) {
      return clusters;
    }
    const contentById = new Map(candidates.map(c => [c.id, c.content]));
    const pairs: ClusterJudgePair[] = [];
    for (const cluster of clusters) {
      const [seedId, ...memberIds] = cluster.episodicIds;
      for (const memberId of memberIds) {
        pairs.push({ a: contentById.get(seedId!) ?? '', b: contentById.get(memberId) ?? '' });
      }
    }
    const scores = await judge.scorePairs(pairs);
    const threshold = getClusterJudgeThreshold();
    const verified: ConsolidationCluster[] = [];
    let k = 0;
    for (const cluster of clusters) {
      const [seedId, ...memberIds] = cluster.episodicIds;
      const kept = [seedId!];
      for (const memberId of memberIds) {
        const score = scores[k++];
        const accepted = typeof score === 'number' && score >= threshold;
        if (accepted) {
          kept.push(memberId);
        }
        mcpLogger.logServer('info', 'Consolidation judge: cluster member', {
          seedId,
          memberId,
          score: Number.isFinite(score) ? score : null,
          accepted
        });
      }
      if (kept.length < this.clustering.getMinClusterSize()) {
        continue;
      }
      verified.push(
        kept.length === cluster.episodicIds.length
          ? cluster
          : {
              ...cluster,
              episodicIds: kept,
              representativeId: kept.includes(cluster.representativeId) ? cluster.representativeId : seedId!
            }
      );
    }
    return verified;
  }

  /**
   * #1231: an existing relation (e.g. left by an earlier merge) is not a failure; any other
   * error still aborts the cluster's transaction.
   */
  private async addRelationIfAbsent(
    sourceId: string,
    targetId: string,
    relationType: RelationType,
    options: AddRelationOptions
  ): Promise<void> {
    try {
      await this.relationGraph.addRelation(sourceId, targetId, relationType, options);
    } catch (error) {
      if (error instanceof Error && error.name === 'DuplicateRelationError') {
        return;
      }
      throw error;
    }
  }
}
