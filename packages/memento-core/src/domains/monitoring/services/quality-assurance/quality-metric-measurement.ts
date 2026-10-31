export const QUALITY_METRIC_STATE = {
  MEASURED: 'measured',
  UNMEASURED_NO_GROUND_TRUTH: 'unmeasured_no_ground_truth',
  UNMEASURED_INSUFFICIENT_SAMPLE: 'unmeasured_insufficient_sample',
  MEASUREMENT_ERROR: 'measurement_error',
  DENOMINATOR_ZERO: 'denominator_zero',
  UNKNOWN_LEGACY: 'unknown_legacy',
} as const;

export type QualityMetricState = (typeof QUALITY_METRIC_STATE)[keyof typeof QUALITY_METRIC_STATE];

export type MetricStates = Record<string, QualityMetricState>;
export type MetricDenominators = Record<string, number | null>;

export const RELATION_QUALITY_METRIC_KEYS = [
  'precision',
  'recall',
  'f1_score',
  'true_positives',
  'false_positives',
  'false_negatives',
  'confidence_compliance_rate',
] as const;

export const SEARCH_QUALITY_METRIC_KEYS = [
  'precision_at_5',
  'precision_at_10',
  'recall_at_5',
  'recall_at_10',
  'ndcg_at_5',
  'ndcg_at_10',
  'mrr',
  'kendalls_tau',
  'top_5_retention',
  'top_10_retention',
] as const;

export function isEvaluableMetricState(state: QualityMetricState | undefined): boolean {
  return state === QUALITY_METRIC_STATE.MEASURED;
}

export function buildUniformMetricStates(
  keys: readonly string[],
  state: QualityMetricState
): MetricStates {
  return Object.fromEntries(keys.map((key) => [key, state]));
}

export function mergeMeasuredStates(
  metrics: Record<string, number>,
  overrides: MetricStates = {}
): MetricStates {
  const states: MetricStates = { ...overrides };
  for (const key of Object.keys(metrics)) {
    states[key] = overrides[key] ?? QUALITY_METRIC_STATE.MEASURED;
  }
  return states;
}
