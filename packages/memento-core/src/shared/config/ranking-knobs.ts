/**
 * 랭킹 가중치 knob 스펙. tune-weights 탐색과 대시보드 제안(#1584)이 같은 범위를 쓴다.
 */

import type { RankingWeightsConfig } from './ranking-weights-loader.js';

export type KnobKey =
  | 'ranking_weights.alpha'
  | 'ranking_weights.beta'
  | 'ranking_weights.gamma'
  | 'ranking_weights.delta'
  | 'ranking_weights.epsilon'
  | 'ranking_weights.theta'
  | 'ranking_weights.zeta_fb'
  | 'relevance_signal.scale'
  | 'recency_signal.scale'
  | 'importance_signal.scale'
  | 'fts_relevance.temperature'
  | 'vector_length_decay.characteristic_length'
  | 'vector_length_decay.saturation_length';

/** perturb: 기준값 × U[0.8,1.2] 후 [min,max] 로 clamp. uniform: [min,max] 균등 추출(경계가 탐색 범위 상한). */
export interface KnobSpec {
  sample: 'perturb' | 'uniform';
  min: number;
  max: number;
}

const WEIGHT: KnobSpec = { sample: 'perturb', min: 0, max: 1 };

export const TUNABLE_KNOBS: Record<KnobKey, KnobSpec> = {
  'ranking_weights.alpha': WEIGHT,
  'ranking_weights.beta': WEIGHT,
  'ranking_weights.gamma': WEIGHT,
  'ranking_weights.delta': WEIGHT,
  'ranking_weights.epsilon': WEIGHT,
  'ranking_weights.theta': WEIGHT,
  'ranking_weights.zeta_fb': WEIGHT,
  'relevance_signal.scale': { sample: 'uniform', min: 0.5, max: 3.0 },
  'recency_signal.scale': { sample: 'uniform', min: 0.05, max: 1 },
  'importance_signal.scale': { sample: 'uniform', min: 0.05, max: 1 },
  'fts_relevance.temperature': { sample: 'uniform', min: 2, max: 30 },
  'vector_length_decay.characteristic_length': { sample: 'uniform', min: 10, max: 120 },
  'vector_length_decay.saturation_length': { sample: 'uniform', min: 20, max: 300 },
};

export function isKnobKey(key: string): key is KnobKey {
  return Object.hasOwn(TUNABLE_KNOBS, key);
}

/** 로더가 theta·zeta_fb 가 없을 때 쓰는 기본값과 같다. */
export const OPTIONAL_WEIGHT_DEFAULTS: Partial<Record<KnobKey, number>> = {
  'ranking_weights.theta': 0.1,
  'ranking_weights.zeta_fb': 0.05,
};

type NumericSections = Record<string, Record<string, number | undefined>>;

export function readKnob(config: RankingWeightsConfig, key: KnobKey): number {
  const [section, field] = key.split('.') as [string, string];
  return (config as unknown as NumericSections)[section]![field] ?? OPTIONAL_WEIGHT_DEFAULTS[key] ?? 0;
}

export function writeKnob(config: RankingWeightsConfig, key: KnobKey, value: number): void {
  const [section, field] = key.split('.') as [string, string];
  (config as unknown as NumericSections)[section]![field] = value;
}

export interface KnobChangeError {
  code: 'UNKNOWN_KNOB' | 'INVALID_VALUE';
  key: string;
  message: string;
}

/**
 * 제안 변경이 knob 범위 안인지, 바꾼 뒤에도 saturation_length >= characteristic_length 인지 본다.
 * 첫 오류만 돌려준다. 현재 값과 같은 변경은 오류가 아니다(호출자가 NO_CHANGE 로 거른다).
 */
export function validateKnobChanges(
  changes: Record<string, unknown>,
  current: RankingWeightsConfig,
): KnobChangeError | null {
  const next = JSON.parse(JSON.stringify(current)) as RankingWeightsConfig;
  for (const [key, value] of Object.entries(changes)) {
    if (!isKnobKey(key)) return { code: 'UNKNOWN_KNOB', key, message: `알 수 없는 knob: ${key}` };
    const { min, max } = TUNABLE_KNOBS[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
      return { code: 'INVALID_VALUE', key, message: `${key} 는 ${min} 이상 ${max} 이하의 숫자여야 합니다` };
    }
    writeKnob(next, key, value);
  }
  const charKey = 'vector_length_decay.characteristic_length';
  const satKey = 'vector_length_decay.saturation_length';
  if (readKnob(next, satKey) < readKnob(next, charKey)) {
    return { code: 'INVALID_VALUE', key: satKey, message: `${satKey} 는 ${charKey} 이상이어야 합니다` };
  }
  return null;
}
