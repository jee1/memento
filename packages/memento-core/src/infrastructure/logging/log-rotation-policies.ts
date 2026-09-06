/**
 * log_rotation family defaults + LOG_ROTATION_* env overrides (#852).
 */

export const DEFAULT_MIGRATION_KEEP_COUNT = 500;
export const DEFAULT_DOCKER_DIAGNOSTICS_MAX_BYTES = 268_435_456; // 256 MiB
export const DEFAULT_MONITOR_JSONL_MAX_BYTES = 33_554_432; // 32 MiB
export const DEFAULT_TRIPLE_EXTRACTION_DAYS = 30;

export interface LogRotationPolicies {
  migrationKeepCount: number;
  dockerDiagnosticsMaxBytes: number;
  monitorJsonlMaxBytes: number;
  tripleExtractionDays: number;
}

function parseEnvInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') {
    return fallback;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function resolveLogRotationPolicies(
  overrides?: Partial<LogRotationPolicies>
): LogRotationPolicies {
  return {
    migrationKeepCount:
      overrides?.migrationKeepCount ??
      parseEnvInt('LOG_ROTATION_MIGRATION_KEEP_COUNT', DEFAULT_MIGRATION_KEEP_COUNT),
    dockerDiagnosticsMaxBytes:
      overrides?.dockerDiagnosticsMaxBytes ??
      parseEnvInt(
        'LOG_ROTATION_DOCKER_DIAGNOSTICS_MAX_BYTES',
        DEFAULT_DOCKER_DIAGNOSTICS_MAX_BYTES
      ),
    monitorJsonlMaxBytes:
      overrides?.monitorJsonlMaxBytes ??
      parseEnvInt('LOG_ROTATION_MONITOR_JSONL_MAX_BYTES', DEFAULT_MONITOR_JSONL_MAX_BYTES),
    tripleExtractionDays:
      overrides?.tripleExtractionDays ??
      parseEnvInt('LOG_ROTATION_TRIPLE_EXTRACTION_DAYS', DEFAULT_TRIPLE_EXTRACTION_DAYS),
  };
}
