/**
 * Job name → BatchSchedulerConfig interval field (#832, #1698).
 * Shared by admin-batch.routes and ops-summary zones so new jobs stay in sync.
 */
const JOB_INTERVAL_CONFIG_KEY: Record<string, string> = {
  cleanup: 'cleanupInterval',
  monitoring: 'monitoringInterval',
  healthcheck: 'healthCheckInterval',
  wal_checkpoint: 'walCheckpointInterval',
  lock_monitor: 'lockMonitorInterval',
  reflexion_cleanup: 'reflexionCleanupInterval',
  reflexion_healthcheck: 'reflexionHealthCheckInterval',
  log_rotation: 'logRotationInterval',
  quality_measurement_batch: 'qualityMeasurementInterval',
  meta_memory_introspection: 'metaMemoryIntrospectionInterval',
  memory_review_candidates: 'memoryReviewCandidatesInterval',
  sleep_consolidation_batch: 'sleepConsolidationInterval',
  telemetry_cleanup_batch: 'telemetryCleanupInterval',
  forgetting_event_cleanup_batch: 'forgettingEventCleanupInterval',
  job_run_cleanup_batch: 'jobRunCleanupInterval',
  anchor_auto_refresh: 'anchorAutoRefreshInterval',
  supersede_candidate_scan: 'supersedeCandidateScanInterval',
  rejection_gate_drift_check: 'rejectionGateDriftCheckInterval',
};

export function resolveJobIntervalMs(name: string, config: Record<string, unknown>): number | null {
  const key = JOB_INTERVAL_CONFIG_KEY[name];
  if (!key) return null;
  const value = config[key];
  return typeof value === 'number' ? value : null;
}
