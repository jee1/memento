import { judgeRelevanceGate } from '../../packages/memento-core/src/domains/search/ports/relevance-gate-port.js';

export type SweepGroup = 'relevant' | 'unrelated';

export interface ScoredQuery {
  group: SweepGroup;
  /** null = 게이트가 점수를 주지 못했거나(fail-open) 후보가 0건 */
  top_score: number | null;
}

export interface GateScoreCache {
  schema_version: 1;
  benchmark_version: string;
  gate: { provider: 'typesafe'; model: string; doc_chars: number };
  rows: Array<{ query_id: string; group: SweepGroup; top_score: number | null }>;
}

export interface SweepRate {
  n: number;
  rejected: number;
  rate: number;
  wilson95: [number, number];
}

export interface SweepPoint {
  threshold: number;
  relevant_false_rejection: SweepRate;
  unrelated_rejection: SweepRate;
}

export interface RejectionSweepReport {
  schema_version: 1;
  source:
    | { kind: 'fixture'; benchmark_version: string; gate: GateScoreCache['gate'] }
    | { kind: 'label-pack' };
  counts: {
    relevant: number;
    unrelated: number;
    excluded: number;
    unscored: { relevant: number; unrelated: number };
  };
  curve: SweepPoint[];
  notes: string[];
}

const WILSON_Z = 1.96;

/** 정수 격자(20..60 step 5)를 100으로 나눠 0.35 같은 값이 부동소수 누적 오차 없이 나오게 한다. */
export function rejectionSweepThresholds(): number[] {
  const out: number[] = [];
  for (let i = 20; i <= 60; i += 5) {
    out.push(i / 100);
  }
  return out;
}

export function wilson95(k: number, n: number): [number, number] {
  if (n === 0) {
    return [0, 1];
  }
  const p = k / n;
  const z2 = WILSON_Z * WILSON_Z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const half = (WILSON_Z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
}

function rateAt(scores: Array<number | null>, threshold: number): SweepRate {
  const rejected = scores.filter(
    (s) => judgeRelevanceGate([s ?? Number.NaN], threshold).rejected
  ).length;
  const n = scores.length;
  return { n, rejected, rate: n === 0 ? 0 : rejected / n, wilson95: wilson95(rejected, n) };
}

export function sweepRejectionThresholds(
  rows: ScoredQuery[]
): Pick<RejectionSweepReport, 'curve'> & { counts: Omit<RejectionSweepReport['counts'], 'excluded'> } {
  const relevant = rows.filter((r) => r.group === 'relevant').map((r) => r.top_score);
  const unrelated = rows.filter((r) => r.group === 'unrelated').map((r) => r.top_score);
  return {
    counts: {
      relevant: relevant.length,
      unrelated: unrelated.length,
      unscored: {
        relevant: relevant.filter((s) => s === null).length,
        unrelated: unrelated.filter((s) => s === null).length,
      },
    },
    curve: rejectionSweepThresholds().map((threshold) => ({
      threshold,
      relevant_false_rejection: rateAt(relevant, threshold),
      unrelated_rejection: rateAt(unrelated, threshold),
    })),
  };
}

const LABEL_TO_GROUP = { false_reject: 'relevant', true_reject: 'unrelated' } as const;

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${what}: 객체여야 합니다`);
  }
  return value as Record<string, unknown>;
}

export function parseLabelPack(raw: unknown): { rows: ScoredQuery[]; excluded: number } {
  if (!Array.isArray(raw)) {
    throw new Error('label pack: 배열이어야 합니다');
  }
  const rows: ScoredQuery[] = [];
  let excluded = 0;
  raw.forEach((entry, i) => {
    const rec = asRecord(entry, `label pack[${i}]`);
    const { label, top_score: score } = rec;
    if (typeof score !== 'number' || !Number.isFinite(score)) {
      throw new Error(`label pack[${i}]: top_score 는 유한한 숫자여야 합니다`);
    }
    if (label === 'unclear') {
      excluded++;
    } else if (label === 'false_reject' || label === 'true_reject') {
      rows.push({ group: LABEL_TO_GROUP[label], top_score: score });
    } else {
      throw new Error(`label pack[${i}]: 알 수 없는 label (${String(label)})`);
    }
  });
  return { rows, excluded };
}

export function parseGateScoreCache(raw: unknown): GateScoreCache {
  const rec = asRecord(raw, 'gate score cache');
  if (rec.schema_version !== 1) {
    throw new Error('gate score cache: schema_version 1 이 아닙니다');
  }
  const gate = asRecord(rec.gate, 'gate score cache.gate');
  if (
    typeof rec.benchmark_version !== 'string' ||
    gate.provider !== 'typesafe' ||
    typeof gate.model !== 'string' ||
    typeof gate.doc_chars !== 'number' ||
    !Array.isArray(rec.rows)
  ) {
    throw new Error('gate score cache: 필드 형식이 맞지 않습니다');
  }
  const rows = rec.rows.map((entry, i): GateScoreCache['rows'][number] => {
    const row = asRecord(entry, `gate score cache.rows[${i}]`);
    const { query_id, group, top_score: score } = row;
    if (
      typeof query_id !== 'string' ||
      (group !== 'relevant' && group !== 'unrelated') ||
      (score !== null && (typeof score !== 'number' || !Number.isFinite(score)))
    ) {
      throw new Error(`gate score cache.rows[${i}]: 형식이 맞지 않습니다`);
    }
    return { query_id, group, top_score: score };
  });
  return {
    schema_version: 1,
    benchmark_version: rec.benchmark_version,
    gate: { provider: 'typesafe', model: gate.model, doc_chars: gate.doc_chars },
    rows,
  };
}

export function isGateScoreCacheCurrent(
  cache: GateScoreCache,
  current: Pick<GateScoreCache, 'benchmark_version' | 'gate'>
): boolean {
  return (
    cache.benchmark_version === current.benchmark_version &&
    cache.gate.model === current.gate.model &&
    cache.gate.doc_chars === current.gate.doc_chars
  );
}
