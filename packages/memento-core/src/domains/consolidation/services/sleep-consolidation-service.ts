/**
 * Sleep consolidation 오케스트레이터
 */

import type Database from 'better-sqlite3';
import type { IRelationGraph } from '../../../shared/types/relation-graph.js';
import type { SleepConsolidationRunResult } from '../../../shared/types/consolidation.types.js';
import type { RelationType } from '../../../shared/types/relation.js';
import type { MemoryType } from '../../../shared/types/index.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { MemoryEmbeddingService } from '../../memory/services/memory-embedding-service.js';
import { ConsolidationRepository, type EpisodicCandidateRow } from '../repositories/consolidation-repository.js';
import { ClusteringService } from './clustering-service.js';
import { SummarizationService } from './summarization-service.js';
import type { TelemetryService } from '../../telemetry/services/telemetry-service.js';
import type { Outcome } from '../../telemetry/types/telemetry.types.js';

export interface SleepConsolidationRunOptions {
  dryRun?: boolean;
  ownerIdFilter?: string | null;
  lookbackDays?: number;
}

export class ConsolidationAlreadyRunningError extends Error {
  constructor() {
    super('Consolidation already running');
    this.name = 'ConsolidationAlreadyRunningError';
  }
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
}

function newSemanticId(): string {
  return `mem_${crypto.randomUUID().replace(/-/g, '')}`;
}

const REL_EXTRACTED_FROM: RelationType = 'extracted_from';
const REL_SUPPORTED_BY: RelationType = 'supported_by';

export class SleepConsolidationService {
  /** 프로세스당 단일 인스턴스(bootstrap) 기준 동시 실행 방지 — static이면 테스트 간 상태가 오염된다 */
  private activeRun: Promise<void> | null = null;

  private readonly repo: ConsolidationRepository;
  private readonly clustering: ClusteringService;
  private readonly summarization: SummarizationService;
  private readonly relationGraph: IRelationGraph;
  private readonly memoryEmbedding: MemoryEmbeddingService;
  private readonly telemetryService?: TelemetryService;

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
  }

  /**
   * 동시 실행 방지 (배치 + admin 공용)
   */
  isRunning(): boolean {
    return this.activeRun !== null;
  }

  async run(options: SleepConsolidationRunOptions = {}): Promise<SleepConsolidationRunResult> {
    if (this.activeRun) {
      throw new ConsolidationAlreadyRunningError();
    }
    let release!: () => void;
    const done = new Promise<void>(resolve => {
      release = resolve;
    });
    this.activeRun = done;

    const started = Date.now();
    const runAt = new Date().toISOString();
    let result: SleepConsolidationRunResult = {
      runAt,
      durationMs: 0,
      clustersFound: 0,
      clustersProcessed: 0,
      clustersSkipped: 0,
      semanticsCreated: 0,
      episodicsConsolidated: 0,
      errors: []
    };

    let runThrew = false;
    try {
      const lookback = options.lookbackDays ?? this.repo.getLookbackDays();
      const ownerFilter = options.ownerIdFilter ?? null;
      const candidates = this.repo.findEpisodicCandidates(ownerFilter, lookback);
      const embMap = this.repo.loadEmbeddingsMap(candidates.map(c => c.id));
      const clusters = this.clustering.buildClusters(candidates, embMap);
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
              await this.relationGraph.addRelation(
                semanticId,
                eid,
                REL_EXTRACTED_FROM,
                { confidence: 0.75, allowCyclic: true }
              );
              await this.relationGraph.addRelation(
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
          duration_ms: result.durationMs,
          error_count: result.errors.length
        }
      });
      this.activeRun = null;
      release();
    }
  }
}
