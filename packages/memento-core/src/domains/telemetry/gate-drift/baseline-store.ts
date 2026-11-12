import type Database from 'better-sqlite3';
import type {
  RejectionGateBaseline,
  RejectionGateBaselineSource,
  RejectionGateDriftSummary,
  RejectionGateDriftVerdict,
} from './types.js';

interface BaselineRow {
  id: number;
  threshold: number;
  n_items: number;
  measured_at: string;
  judge_model: string;
  label_set_id: string | null;
  source: RejectionGateBaselineSource;
  reference_window_start: string | null;
  reference_window_end: string | null;
  reference_decided_n: number | null;
  reference_rejection_rate: number | null;
  reference_knee_mass: number | null;
  captured_at: string;
}

function toBaseline(row: BaselineRow): RejectionGateBaseline {
  const hasReference = row.reference_window_start !== null;
  return {
    id: row.id,
    threshold: row.threshold,
    n_items: row.n_items,
    measured_at: row.measured_at,
    judge_model: row.judge_model,
    label_set_id: row.label_set_id,
    source: row.source,
    reference: hasReference
      ? {
          window_start: row.reference_window_start!,
          window_end: row.reference_window_end!,
          decided_n: row.reference_decided_n!,
          rejection_rate: row.reference_rejection_rate!,
          knee_mass: row.reference_knee_mass!,
        }
      : null,
    captured_at: row.captured_at,
  };
}

/** 활성 기준은 MAX(id) 행이다. */
export function readActiveBaseline(db: Database.Database): RejectionGateBaseline | null {
  const row = db
    .prepare('SELECT * FROM rejection_gate_baseline ORDER BY id DESC LIMIT 1')
    .get() as BaselineRow | undefined;
  return row ? toBaseline(row) : null;
}

export function appendBaseline(
  db: Database.Database,
  row: Omit<RejectionGateBaseline, 'id'>,
): RejectionGateBaseline {
  const reference = row.reference;
  const result = db
    .prepare(
      `INSERT INTO rejection_gate_baseline
         (threshold, n_items, measured_at, judge_model, label_set_id, source,
          reference_window_start, reference_window_end, reference_decided_n,
          reference_rejection_rate, reference_knee_mass, captured_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.threshold,
      row.n_items,
      row.measured_at,
      row.judge_model,
      row.label_set_id,
      row.source,
      reference?.window_start ?? null,
      reference?.window_end ?? null,
      reference?.decided_n ?? null,
      reference?.rejection_rate ?? null,
      reference?.knee_mass ?? null,
      row.captured_at,
    );
  return { ...row, id: Number(result.lastInsertRowid) };
}

export function queryRejectionGateDriftSummary(db: Database.Database): RejectionGateDriftSummary {
  const event = db
    .prepare(
      `SELECT extra_data FROM telemetry_events
       WHERE event_type = 'memory.search.gate_drift' AND extra_data IS NOT NULL
       ORDER BY created_at DESC LIMIT 1`,
    )
    .get() as { extra_data: string } | undefined;
  let latest: RejectionGateDriftVerdict | null = null;
  if (event) {
    try {
      latest = JSON.parse(event.extra_data) as RejectionGateDriftVerdict;
    } catch {
      latest = null;
    }
  }
  return { latest_verdict: latest, active_baseline: readActiveBaseline(db) };
}
