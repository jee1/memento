/**
 * #1681 기각 게이트 드리프트 모니터의 데이터 모양과 판정 상수.
 * 드리프트 판정은 재측정 알림이지 임계값 변경이 아니다.
 */

export type RejectionGateBaselineSource = 'measurement' | 'setting_change' | 'startup' | 'reference_fill';

export type RejectionGateReference = {
  window_start: string;
  window_end: string;
  decided_n: number;
  rejection_rate: number;
  knee_mass: number;
};

export type RejectionGateBaseline = {
  id: number;
  threshold: number;
  n_items: number;
  measured_at: string;
  judge_model: string;
  label_set_id: string | null;
  source: RejectionGateBaselineSource;
  reference: RejectionGateReference | null;
  captured_at: string;
};

export type RejectionBandOutcome = 'ok' | 'alert' | 'insufficient_n' | 'reference_pending';

export type RejectionScaleStatus = 'active' | 'disabled_zero_baseline';

export type RejectionGateDriftVerdict = {
  checked_at: string;
  baseline_id: number;
  threshold: number;
  alert: boolean;
  /** disabled_zero_baseline: 빈 DB 에서 캡처한 기준(n_items 0)이라 규칙 (a) 를 이 기준 동안 끈다 */
  scale: { n_items: number; baseline_n_items: number; status: RejectionScaleStatus; alert: boolean };
  band: {
    week_start: string;
    week_end: string;
    decided_n: number;
    rejection_rate: number | null;
    reference_rate: number | null;
    half_width: number | null;
    lower: number | null;
    upper: number | null;
    outcome: RejectionBandOutcome;
    /** 활성 기준의 참조 창이 닫혔는가. false 면 reference_pending 은 일시적이고, true 인데 참조가 없으면 영구다 */
    reference_window_closed: boolean;
  };
};

export type RejectionGateDriftSummary = {
  latest_verdict: RejectionGateDriftVerdict | null;
  active_baseline: RejectionGateBaseline | null;
};

/** 주간 판정과 참조 분포가 믿을 수 있는 최소 decided 건수 */
export const MIN_DECIDED_N = 100;
/** 밴드 반폭의 표본오차 배수(3 시그마) */
export const SAMPLING_ERROR_MULTIPLIER = 3;
/** 활성 메모리 수가 기준의 이 배수 이상이면 규모 알림 */
export const SCALE_ALERT_RATIO = 2;
/** 무릎 구간 폭: 임계값 바로 위 [threshold, threshold + 0.1) */
export const KNEE_WIDTH = 0.1;
export const REFERENCE_WINDOW_MS = 7 * 86_400_000;
