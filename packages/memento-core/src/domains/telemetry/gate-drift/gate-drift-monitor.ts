import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { mementoConfig } from '../../../shared/config/index.js';
import { logger } from '../../../shared/utils/logger.js';
import {
  queryRejectionGateKneeMass,
  queryRejectionGateRate,
} from '../repositories/telemetry-search-quality-query.js';
import { TelemetryRepository } from '../repositories/telemetry-repository.js';
import { appendBaseline, readActiveBaseline } from './baseline-store.js';
import {
  KNEE_WIDTH,
  MIN_DECIDED_N,
  REFERENCE_WINDOW_MS,
  SAMPLING_ERROR_MULTIPLIER,
  SCALE_ALERT_RATIO,
  type RejectionBandOutcome,
  type RejectionGateBaseline,
  type RejectionGateDriftVerdict,
  type RejectionGateReference,
} from './types.js';

/**
 * 활성 기억 수 공급자. memory 도메인이 telemetry 를 이미 부르므로(memory→telemetry) 도메인 방향이 순환하지 않게
 * 호출부(bootstrap, 배치 핸들러)가 `countActiveMemoryItems` 를 넘긴다.
 */
export type ActiveItemCounter = (db: Database.Database) => number;

const DAY_MS = 86_400_000;
const FALLBACK_JUDGE_MODEL = 'jev-latest';

interface BandJudgment {
  outcome: RejectionBandOutcome;
  half_width: number | null;
  lower: number | null;
  upper: number | null;
}

/**
 * 참조 기각률 p 를 중심으로 반폭 h = max(3 시그마, 무릎 질량) 밴드 밖이면 alert.
 * 무릎 질량은 임계값 근처 점수가 한 칸 움직여도 흔들리는 폭이라 표본이 커져도 밴드가 그 아래로 좁아지지 않는다.
 * 경계값은 안쪽이다.
 */
export function judgeRejectionBand(
  reference: RejectionGateReference | null,
  decidedN: number,
  rejectedN: number,
): BandJudgment {
  if (reference === null) return { outcome: 'reference_pending', half_width: null, lower: null, upper: null };
  if (decidedN < MIN_DECIDED_N) return { outcome: 'insufficient_n', half_width: null, lower: null, upper: null };
  const p = reference.rejection_rate;
  const halfWidth = Math.max(
    SAMPLING_ERROR_MULTIPLIER * Math.sqrt((p * (1 - p)) / decidedN),
    reference.knee_mass,
  );
  const lower = p - halfWidth;
  const upper = p + halfWidth;
  const rate = rejectedN / decidedN;
  return { outcome: rate < lower || rate > upper ? 'alert' : 'ok', half_width: halfWidth, lower, upper };
}

/** now 가 속한 ISO 주(월요일 00:00Z 시작) 바로 앞의 완결된 주 */
export function lastCompletedIsoWeek(now: Date): { start: string; end: string } {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const sinceMonday = (new Date(midnight).getUTCDay() + 6) % 7;
  const endMs = midnight - sinceMonday * DAY_MS;
  return { start: new Date(endMs - 7 * DAY_MS).toISOString(), end: new Date(endMs).toISOString() };
}

/**
 * 실효 임계값이 활성 기준과 다르면 새 행을 덧붙인다. 같으면 아무것도 하지 않아 기동마다 불러도 멱등이다.
 * 게이트가 꺼져 있으면 임계값이 쓰이지 않으므로 기록하지 않는다.
 */
export function captureRejectionGateBaselineIfChanged(
  db: Database.Database,
  source: 'setting_change' | 'startup',
  countActiveItems: ActiveItemCounter,
  now: Date = new Date(),
): RejectionGateBaseline | null {
  if (mementoConfig.searchRejectionGate === 'off') return null;
  const threshold = mementoConfig.searchRejectionGateThreshold;
  if (readActiveBaseline(db)?.threshold === threshold) return null;
  const stamp = now.toISOString();
  return appendBaseline(db, {
    threshold,
    n_items: countActiveItems(db),
    measured_at: stamp,
    judge_model: mementoConfig.typesafeModel || FALLBACK_JUDGE_MODEL,
    label_set_id: null,
    source,
    reference: null,
    captured_at: stamp,
  });
}

/**
 * 새 임계값 기준은 측정 시각부터 7일의 실제 판정 분포를 참조로 삼는다. 창이 닫히고 decided 가 충분할 때 한 번만
 * 값을 복사한 새 행으로 채운다. 부족하면 채우지 않고 다음 실행이 다시 본다.
 */
export function fillReferenceIfDue(
  db: Database.Database,
  active: RejectionGateBaseline,
  now: Date,
): RejectionGateBaseline {
  if (active.reference !== null) return active;
  const startMs = Date.parse(active.measured_at);
  if (now.getTime() < startMs + REFERENCE_WINDOW_MS) return active;
  const window = { start: active.measured_at, end: new Date(startMs + REFERENCE_WINDOW_MS).toISOString() };
  const rate = queryRejectionGateRate(db, window);
  if (rate.rejection_decided_count < MIN_DECIDED_N || rate.rejection_rate === null) return active;
  const knee = queryRejectionGateKneeMass(db, window, active.threshold, KNEE_WIDTH) ?? 0;
  return appendBaseline(db, {
    ...active,
    source: 'reference_fill',
    reference: {
      window_start: window.start,
      window_end: window.end,
      decided_n: rate.rejection_decided_count,
      rejection_rate: rate.rejection_rate,
      knee_mass: knee,
    },
    captured_at: now.toISOString(),
  });
}

export function checkRejectionGateDrift(
  db: Database.Database,
  now: Date,
  countActiveItems: ActiveItemCounter,
): RejectionGateDriftVerdict | null {
  const loaded = readActiveBaseline(db);
  if (!loaded) return null;
  const baseline = fillReferenceIfDue(db, loaded, now);

  const nItems = countActiveItems(db);
  // 빈 DB 에서 잰 기준(n_items 0)은 비교할 규모가 없다. 0 배는 항상 참이라 상시 알림이 되므로 제외한다.
  const scaleAlert = baseline.n_items > 0 && nItems >= SCALE_ALERT_RATIO * baseline.n_items;

  const week = lastCompletedIsoWeek(now);
  const weekly = queryRejectionGateRate(db, { start: week.start, end: week.end });
  const judged = judgeRejectionBand(baseline.reference, weekly.rejection_decided_count, weekly.rejected_count);

  return {
    checked_at: now.toISOString(),
    baseline_id: baseline.id,
    threshold: baseline.threshold,
    alert: scaleAlert || judged.outcome === 'alert',
    scale: { n_items: nItems, baseline_n_items: baseline.n_items, alert: scaleAlert },
    band: {
      week_start: week.start,
      week_end: week.end,
      decided_n: weekly.rejection_decided_count,
      rejection_rate: weekly.rejection_rate,
      reference_rate: baseline.reference?.rejection_rate ?? null,
      half_width: judged.half_width,
      lower: judged.lower,
      upper: judged.upper,
      outcome: judged.outcome,
    },
  };
}

export function recordRejectionGateDriftVerdict(db: Database.Database, verdict: RejectionGateDriftVerdict): void {
  new TelemetryRepository(db).insertEventSync({
    eventType: 'memory.search.gate_drift',
    requestId: randomUUID(),
    ownerId: null,
    outcome: 'success',
    extraData: verdict,
  });
  if (verdict.alert) {
    logger.warn('rejection gate drift alert: 기각 게이트 재측정이 필요하다(판정기 드리프트 확정 아님)', verdict);
  }
}
