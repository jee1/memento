import type Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../../shared/utils/database.js';
import { logger } from '../../../../shared/utils/logger.js';
import { DAY_MS } from '../../../../shared/utils/date.js';
import type {
  ResolvedTripleExtractionBatchJobConfig,
  TripleExtractionBatchJobConfig,
  TripleExtractionRetryEligibility,
  TripleExtractionTargetMemory
} from './triple-extraction-batch-job.types.js';

const DEFAULT_BATCH_SIZE = 10;
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BACKOFF_DAYS: readonly number[] = [1, 2, 4];
const DEFAULT_CHUNK_SIZE = 5;
const DEFAULT_CHUNK_DELAY_MS = 100;
const REQUIRED_PARALLELISM = 1;

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isDenseArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && Object.keys(value).length === value.length;
}

function resolvePositiveSafeInteger(
  value: unknown,
  field: string,
  defaultValue: number
): number {
  if (value === undefined) {
    return defaultValue;
  }
  if (!isPositiveSafeInteger(value)) {
    throw new Error(`Invalid triple extraction batch policy: ${field} must be a positive safe integer`);
  }
  return value;
}

function resolveNonNegativeFiniteNumber(
  value: unknown,
  field: string,
  defaultValue: number
): number {
  if (value === undefined) {
    return defaultValue;
  }
  if (!isNonNegativeFiniteNumber(value)) {
    throw new Error(`Invalid triple extraction batch policy: ${field} must be a non-negative finite number`);
  }
  return value;
}

function resolveRetryBackoffDays(value: unknown): number[] {
  if (value === undefined) {
    return [...DEFAULT_RETRY_BACKOFF_DAYS];
  }
  if (!isDenseArray(value) || value.length === 0 || !value.every(isNonNegativeFiniteNumber)) {
    throw new Error(
      'Invalid triple extraction batch policy: retryBackoffDays must be a dense non-empty array of non-negative finite numbers'
    );
  }
  return value as number[];
}

function resolveParallelism(value: unknown): number {
  if (value === undefined) {
    return REQUIRED_PARALLELISM;
  }
  if (value !== REQUIRED_PARALLELISM) {
    throw new Error('Invalid triple extraction batch policy: parallelism must be exactly 1');
  }
  return REQUIRED_PARALLELISM;
}

/**
 * Triple 추출 배치 실행 정책을 해석한다.
 *
 * 순수 함수: DB 접근 없음. `undefined` 필드에만 기본값을 적용하고,
 * 명시적으로 전달된 값(NULL, boolean, 숫자 문자열, sparse 배열, 유효하지 않은 숫자 포함)은
 * DB 접근 전에 즉시 예외를 던진다.
 */
export function resolveTripleExtractionBatchPolicy(
  config: TripleExtractionBatchJobConfig | undefined
): ResolvedTripleExtractionBatchJobConfig {
  const source: TripleExtractionBatchJobConfig = config ?? {};

  return {
    batchSize: resolvePositiveSafeInteger(source.batchSize, 'batchSize', DEFAULT_BATCH_SIZE),
    timeout: resolveNonNegativeFiniteNumber(source.timeout, 'timeout', DEFAULT_TIMEOUT_MS),
    maxRetries: resolvePositiveSafeInteger(source.maxRetries, 'maxRetries', DEFAULT_MAX_RETRIES),
    retryBackoffDays: resolveRetryBackoffDays(source.retryBackoffDays),
    chunkSize: resolvePositiveSafeInteger(source.chunkSize, 'chunkSize', DEFAULT_CHUNK_SIZE),
    chunkDelayMs: resolveNonNegativeFiniteNumber(source.chunkDelayMs, 'chunkDelayMs', DEFAULT_CHUNK_DELAY_MS),
    parallelism: resolveParallelism(source.parallelism)
  };
}

/**
 * 새 재시도 횟수(`newRetryCount`, 1부터 시작)에 대응하는 백오프 일수를 조회한다.
 * 배열 소진 후에는 마지막 값을 반복한다.
 */
export function resolveTripleExtractionBackoffDays(
  policy: ResolvedTripleExtractionBatchJobConfig,
  newRetryCount: number
): number {
  const index = Math.max(0, newRetryCount - 1);
  const clampedIndex = Math.min(index, policy.retryBackoffDays.length - 1);
  return policy.retryBackoffDays[clampedIndex] ?? 0;
}

interface ParsedFailedRetryMetadata {
  retryCount: number;
  lastAttempt: Date;
  nextRetryAfterDays: number;
}

const ZONED_UTC_TIMESTAMP_PATTERN = /(?:Z|[+-]\d{2}:?\d{2})$/;

/**
 * failed 상태 memory의 재시도 metadata를 해석한다.
 * 손상되거나 불완전한 metadata는 절대 보정/기본값 대체하지 않고 제외 사유를 반환한다.
 */
function parseFailedRetryMetadata(
  memory: TripleExtractionTargetMemory
): ParsedFailedRetryMetadata | { reason: string } {
  const raw = memory.triple_extraction_metadata;
  if (!raw) {
    return { reason: 'missing_retry_metadata' };
  }

  let metadata: unknown;
  try {
    metadata = JSON.parse(raw);
  } catch {
    return { reason: 'invalid_retry_metadata_json' };
  }

  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    return { reason: 'invalid_retry_metadata_shape' };
  }

  const record = metadata as Record<string, unknown>;

  const retryCount = record.retry_count;
  if (!(typeof retryCount === 'number' && Number.isSafeInteger(retryCount) && retryCount >= 0)) {
    return { reason: 'invalid_retry_count' };
  }

  const lastAttemptRaw = record.last_attempt;
  if (typeof lastAttemptRaw !== 'string' || !ZONED_UTC_TIMESTAMP_PATTERN.test(lastAttemptRaw)) {
    return { reason: 'invalid_last_attempt' };
  }
  const lastAttempt = new Date(lastAttemptRaw);
  if (Number.isNaN(lastAttempt.getTime())) {
    return { reason: 'invalid_last_attempt' };
  }

  const nextRetryAfterDays = record.next_retry_after_days;
  if (!isNonNegativeFiniteNumber(nextRetryAfterDays)) {
    return { reason: 'invalid_next_retry_after_days' };
  }

  return { retryCount, lastAttempt, nextRetryAfterDays };
}

/**
 * memory의 재시도 자격을 판정한다 (순수 함수, DB 접근 없음).
 *
 * - 미처리(unprocessed) 튜플은 항상 자격 있음(retryCount=0)
 * - failed 튜플은 metadata가 유효할 때만 마감 시각(`last_attempt + next_retry_after_days*24h`,
 *   동일 시각 포함)이 지나야 자격 있음
 * - triple_extracted/status 조합이 일관되지 않으면 자격 없음
 * - maxRetries는 최초 시도를 포함한다 (저장된 retryCount >= maxRetries면 자격 없음)
 */
export function parseRetryEligibility(
  memory: TripleExtractionTargetMemory,
  policy: ResolvedTripleExtractionBatchJobConfig,
  now: Date
): TripleExtractionRetryEligibility {
  const status = memory.triple_extracted_status;
  const extracted = memory.triple_extracted;

  const isUnprocessed = (status === null || status === '') && (extracted === null || extracted === 0);
  const isFailed = status === 'failed' && extracted === 0;

  if (!isUnprocessed && !isFailed) {
    return { eligible: false, reason: 'inconsistent_status_tuple' };
  }

  if (isUnprocessed) {
    return { eligible: true, retryCount: 0 };
  }

  const parsed = parseFailedRetryMetadata(memory);
  if ('reason' in parsed) {
    return { eligible: false, reason: parsed.reason };
  }

  const { retryCount, lastAttempt, nextRetryAfterDays } = parsed;

  if (retryCount >= policy.maxRetries) {
    return { eligible: false, reason: 'max_retries_reached' };
  }

  const dueAt = lastAttempt.getTime() + nextRetryAfterDays * DAY_MS;
  if (now.getTime() < dueAt) {
    return { eligible: false, reason: 'retry_not_due' };
  }

  return { eligible: true, retryCount };
}

const REPORTABLE_EXCLUSION_REASONS = new Set([
  'missing_retry_metadata',
  'invalid_retry_metadata_json',
  'invalid_retry_metadata_shape',
  'invalid_retry_count',
  'invalid_last_attempt',
  'invalid_next_retry_after_days',
  'inconsistent_status_tuple'
]);

/**
 * `created_at ASC, id ASC` 고정 정렬 스냅샷 위에서, eligibility를 batchSize 제한보다
 * 먼저 적용해 대상 memory를 선택한다 (순수 조회, 손상 metadata는 격리/제외만 한다).
 */
export function selectTripleExtractionCandidates(
  db: Database.Database,
  policy: ResolvedTripleExtractionBatchJobConfig,
  now: Date
): TripleExtractionTargetMemory[] {
  const rows = DatabaseUtils.all(db, `
      SELECT
        id,
        content,
        importance,
        triple_extracted,
        triple_extracted_status,
        triple_extraction_metadata
      FROM memory_item
      WHERE type = 'episodic'
        AND COALESCE(is_deleted, 0) = 0
        AND (
          triple_extracted_status IS NULL
          OR triple_extracted_status = ''
          OR triple_extracted_status = 'failed'
        )
      ORDER BY created_at ASC, id ASC
    `, []) as TripleExtractionTargetMemory[];

  const selected: TripleExtractionTargetMemory[] = [];

  for (const row of rows) {
    if (selected.length >= policy.batchSize) {
      break;
    }

    const eligibility = parseRetryEligibility(row, policy, now);
    // eligible === false 로 좁혀야 experimental-example(strictNullChecks:false)에서도
    // discriminated union의 reason 필드가 보인다 (TS2339).
    if (eligibility.eligible === false) {
      if (REPORTABLE_EXCLUSION_REASONS.has(eligibility.reason)) {
        logger.warn('Excluding triple extraction candidate due to invalid retry state', {
          memory_id: row.id,
          reason: eligibility.reason
        });
      }
      continue;
    }

    selected.push(row);
  }

  return selected;
}
