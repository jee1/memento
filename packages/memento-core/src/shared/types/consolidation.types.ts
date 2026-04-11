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
  /** 기존 시맨틱 행을 재요약·UPDATE한 횟수 */
  semanticsMerged: number;
  episodicsConsolidated: number;
  errors: Array<{ clusterId: string; error: string }>;
  /** 이전 run이 끝나기 전에 호출되어 처리하지 않고 반환한 경우 */
  skippedDueToConcurrentRun?: boolean;
}
