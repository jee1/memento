/**
 * 랭킹 가중치 프로파일·A/B 비교 리포트 (specs/004 data-model.md §2.5)
 */

export interface WeightProfile {
  name: string;
  version?: string;
  weights: {
    alpha: number;
    beta: number;
    gamma: number;
    delta: number;
    epsilon: number;
    zeta_fb: number;
    [key: string]: number;
  };
}

export type ABVerdict = 'a_better' | 'b_better' | 'inconclusive';

export interface ABComparisonReport {
  profile_a: string;
  profile_b: string;
  profile_a_mrr: number;
  profile_b_mrr: number;
  profile_a_ndcg_at_5: number;
  profile_b_ndcg_at_5: number;
  profile_a_ndcg_at_10: number;
  profile_b_ndcg_at_10: number;
  /** profile_b_mrr - profile_a_mrr (양수면 B가 MRR 우위) */
  mrr_delta: number;
  p_value: number;
  significant: boolean;
  verdict: ABVerdict;
}
