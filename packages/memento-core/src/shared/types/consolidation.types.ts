/**
 * Sleep consolidation (005) — 런타임/응답 타입 (DB 테이블 아님)
 */

export interface ConsolidationCluster {
  ownerId: string | null;
  episodicIds: string[];
  representativeId: string;
  averageSimilarity: number;
}

export interface SleepConsolidationRunResult {
  runAt: string;
  durationMs: number;
  clustersFound: number;
  clustersProcessed: number;
  clustersSkipped: number;
  semanticsCreated: number;
  episodicsConsolidated: number;
  errors: Array<{ clusterId: string; error: string }>;
}
