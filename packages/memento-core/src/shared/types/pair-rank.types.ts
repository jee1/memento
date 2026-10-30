export type PairRankOutcome =
  | { readonly kind: 'fresh_strictly_above'; readonly freshIndex: number; readonly staleIndex: number }
  | { readonly kind: 'stale_strictly_above'; readonly freshIndex: number; readonly staleIndex: number }
  | { readonly kind: 'tied'; readonly index: number }
  | { readonly kind: 'fresh_only_in_window'; readonly freshIndex: number }
  | { readonly kind: 'stale_only_in_window'; readonly staleIndex: number }
  | { readonly kind: 'neither_in_window' };

export interface PairRankMacroSummary {
  readonly judged: number;
  readonly numerator: number;
  readonly fresh_strictly_above_rate: number;
  readonly outcome_histogram: Readonly<Record<PairRankOutcome['kind'], number>>;
}
