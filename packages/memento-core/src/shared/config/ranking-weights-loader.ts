/* eslint-disable security/detect-non-literal-fs-filename -- 설정 파일 경로는 env 설정과 패키지 루트 기준 고정 경로에서 온다. HTTP·MCP 입력이 닿지 않는다. */
/**
 * 검색 랭킹 가중치 설정 로더
 * TOML 파일에서 검색 랭킹 가중치를 로드하고 검증합니다.
 */

import { join, resolve } from 'path';
import fs from 'fs';
import { createHash } from 'crypto';
import {
  loadTOMLConfig,
  mergeWithDefaults,
  validateConfig,
  getCachedConfig,
  clearConfigCacheByPrefix,
  findProjectRoot
} from './config-loader-utils.js';
import { HYBRID_SEARCH, SEARCH_RANKING } from './constants.js';

export interface RankingWeights {
  alpha: number; // relevance 가중치
  beta: number; // recency 가중치
  gamma: number; // importance 가중치
  delta: number; // usage 가중치
  epsilon: number; // duplication_penalty 가중치
  theta?: number; // process_attribute_fit 가중치 (Issue #91, 기본 0.1)
  zeta_fb?: number; // 피드백 신호 가중치 (Recall Quality Feedback Loop, 기본 0.05)
}

export interface VectorLengthDecayConfig {
  /** When false, raw cosine similarity is used unchanged. */
  enabled: boolean;
  /** k in len/(len+k) (#921). */
  characteristic_length: number;
  /** #921: length at which the decay factor saturates to 1. */
  saturation_length: number;
}

export interface FtsRelevanceConfig {
  /** T in 1/(1+exp(bm25_rank/T)) (#1079). */
  temperature: number;
}

export interface ImportanceSignalConfig {
  /** Multiplier on (raw - 0.5) after calculateImportance (#1082). */
  scale: number;
}

export interface RecencySignalConfig {
  /** Multiplier on (raw - 0.5) after calculateRecency (#1175). */
  scale: number;
}

export interface RelevanceSignalConfig {
  /** Multiplier on (raw - 0.5) after hybridFusionRelevance; may exceed 1 (#1180). */
  scale: number;
}

export interface RankingWeightsConfig {
  ranking_weights: RankingWeights;
  vector_length_decay: VectorLengthDecayConfig;
  fts_relevance: FtsRelevanceConfig;
  importance_signal: ImportanceSignalConfig;
  recency_signal: RecencySignalConfig;
  relevance_signal: RelevanceSignalConfig;
}

const DEFAULT_CONFIG: RankingWeightsConfig = {
  ranking_weights: {
    alpha: 0.45,
    beta: 0.20,
    gamma: 0.20,
    delta: 0.10,
    epsilon: 0.10,
    theta: 0.1,
    zeta_fb: 0.05
  },
  vector_length_decay: {
    enabled: true,
    characteristic_length: 40,
    saturation_length: 80
  },
  fts_relevance: {
    temperature: 10
  },
  importance_signal: {
    scale: 0.35
  },
  recency_signal: {
    scale: 0.30
  },
  relevance_signal: {
    scale: 2.0
  }
};

/**
 * 로드에 사용할 TOML 경로 (캐시 키와 동일 규칙).
 */
function resolveRankingWeightsFilePath(configPath?: string): string {
  if (configPath !== undefined) {
    return resolve(configPath);
  }
  const projectRoot = findProjectRoot();
  let defaultPath = join(projectRoot, 'config', 'ranking-weights.toml');
  const distConfigPath = join(projectRoot, 'dist', 'config', 'ranking-weights.toml');
  const envPath = process.env.MEMENTO_RANKING_WEIGHTS_PATH;
  if (envPath && fs.existsSync(envPath)) {
    defaultPath = envPath;
  } else if (!fs.existsSync(defaultPath) && fs.existsSync(distConfigPath)) {
    defaultPath = distConfigPath;
  }
  return resolve(defaultPath);
}

/** 지금 서버가 읽는 TOML 경로. overridden 은 MEMENTO_RANKING_WEIGHTS_PATH 로 저장소 기본 사본을 바꿨다는 뜻이다. */
export function getRankingWeightsSource(): { path: string; overridden: boolean } {
  const envPath = process.env.MEMENTO_RANKING_WEIGHTS_PATH;
  return {
    path: resolveRankingWeightsFilePath(undefined),
    overridden: Boolean(envPath && fs.existsSync(envPath)),
  };
}

const RANKING_WEIGHTS_SCHEMA = {
  'ranking_weights.alpha': { type: 'number' as const, min: 0, max: 1 },
  'ranking_weights.beta': { type: 'number' as const, min: 0, max: 1 },
  'ranking_weights.gamma': { type: 'number' as const, min: 0, max: 1 },
  'ranking_weights.delta': { type: 'number' as const, min: 0, max: 1 },
  'ranking_weights.epsilon': { type: 'number' as const, min: 0, max: 1 },
  'ranking_weights.theta': { type: 'number' as const, min: 0, max: 1 },
  'ranking_weights.zeta_fb': { type: 'number' as const, min: 0, max: 1 },
  'vector_length_decay.characteristic_length': { type: 'number' as const, min: 0 },
  'vector_length_decay.saturation_length': { type: 'number' as const, min: 0 },
  'fts_relevance.temperature': { type: 'number' as const, min: 0.1 },
  'importance_signal.scale': { type: 'number' as const, min: 0, max: 1 },
  'recency_signal.scale': { type: 'number' as const, min: 0, max: 1 },
  'relevance_signal.scale': { type: 'number' as const, min: 0, max: SEARCH_RANKING.RELEVANCE_SIGNAL_SCALE_MAX }
};

/** 중첩 객체를 평탄화하여 검증. 섹션 정규화 전 값을 보므로 숫자가 아닌 값도 검증에 걸린다 */
function flattenRankingWeightsForValidation(config: RankingWeightsConfig): Record<string, unknown> {
  return {
    'ranking_weights.alpha': config.ranking_weights.alpha,
    'ranking_weights.beta': config.ranking_weights.beta,
    'ranking_weights.gamma': config.ranking_weights.gamma,
    'ranking_weights.delta': config.ranking_weights.delta,
    'ranking_weights.epsilon': config.ranking_weights.epsilon,
    'ranking_weights.theta': config.ranking_weights.theta ?? 0.1,
    'ranking_weights.zeta_fb': config.ranking_weights.zeta_fb ?? 0.05,
    'vector_length_decay.characteristic_length':
      config.vector_length_decay?.characteristic_length ??
      DEFAULT_CONFIG.vector_length_decay.characteristic_length,
    'vector_length_decay.saturation_length':
      config.vector_length_decay?.saturation_length ??
      DEFAULT_CONFIG.vector_length_decay.saturation_length,
    'fts_relevance.temperature':
      config.fts_relevance?.temperature ??
      DEFAULT_CONFIG.fts_relevance.temperature,
    'importance_signal.scale':
      config.importance_signal?.scale ??
      DEFAULT_CONFIG.importance_signal.scale,
    'recency_signal.scale':
      config.recency_signal?.scale ??
      DEFAULT_CONFIG.recency_signal.scale,
    'relevance_signal.scale':
      config.relevance_signal?.scale ??
      DEFAULT_CONFIG.relevance_signal.scale
  };
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** mergeWithDefaults may omit nested section when TOML lacks it */
function normalizeRankingWeightsSections(config: RankingWeightsConfig): void {
  const decay = config.vector_length_decay;
  const defaults = DEFAULT_CONFIG.vector_length_decay;
  config.vector_length_decay = {
    enabled: typeof decay?.enabled === 'boolean' ? decay.enabled : defaults.enabled,
    characteristic_length: finiteOr(decay?.characteristic_length, defaults.characteristic_length),
    saturation_length: finiteOr(decay?.saturation_length, defaults.saturation_length)
  };
  config.fts_relevance = {
    temperature: finiteOr(config.fts_relevance?.temperature, DEFAULT_CONFIG.fts_relevance.temperature)
  };
  config.importance_signal = {
    scale: finiteOr(config.importance_signal?.scale, DEFAULT_CONFIG.importance_signal.scale)
  };
}

/**
 * TOML 파일에서 검색 랭킹 가중치 설정을 로드합니다.
 * @param configPath TOML 설정 파일 경로 (기본값: config/ranking-weights.toml)
 * @returns 검색 랭킹 가중치 설정 객체
 * @throws 설정 파일을 읽을 수 없거나 파싱에 실패한 경우
 */
export function loadRankingWeights(configPath?: string): RankingWeightsConfig {
  const path = resolveRankingWeightsFilePath(configPath);

  try {
    // 공통 로더 유틸리티 사용
    const parsed = loadTOMLConfig<Partial<RankingWeightsConfig>>(path, DEFAULT_CONFIG);

    // 기본값과 병합
    const config = mergeWithDefaults(parsed as unknown as Record<string, unknown>, DEFAULT_CONFIG as unknown as Record<string, unknown>) as unknown as RankingWeightsConfig;

    const flatConfig = flattenRankingWeightsForValidation(config);
    normalizeRankingWeightsSections(config);

    const validationResult = validateConfig(flatConfig, RANKING_WEIGHTS_SCHEMA);
    if (!validationResult.valid) {
      throw new Error(`검색 랭킹 가중치 설정 검증 실패: ${validationResult.errors.join(', ')}`);
    }

    // 기존 검증 로직도 유지 (가중치 합계 경고 등)
    validateRankingWeights(config);

    return config;
  } catch (error) {
    if (error instanceof Error && error.message.includes('설정 파일을 찾을 수 없습니다')) {
      // 파일이 없으면 기본값 반환
      console.warn(`[ranking-weights] 설정 파일을 찾을 수 없습니다: ${path}. 기본값을 사용합니다.`);
      return DEFAULT_CONFIG;
    }
    throw new Error(`검색 랭킹 가중치 설정 로드 실패: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

/**
 * 검색 랭킹 가중치 설정을 검증합니다.
 * @param config 검증할 설정 객체
 * @throws 설정 값이 유효하지 않은 경우
 */
function validateRankingWeights(config: RankingWeightsConfig): void {
  const { ranking_weights } = config;

  // 가중치 값 검증 (0 이상 1 이하)
  const theta = ranking_weights.theta ?? 0.1;
  const zetaFb = ranking_weights.zeta_fb ?? 0.05;
  const weights = [
    { name: 'alpha', value: ranking_weights.alpha },
    { name: 'beta', value: ranking_weights.beta },
    { name: 'gamma', value: ranking_weights.gamma },
    { name: 'delta', value: ranking_weights.delta },
    { name: 'epsilon', value: ranking_weights.epsilon },
    { name: 'theta', value: theta },
    { name: 'zeta_fb', value: zetaFb }
  ];

  for (const { name, value } of weights) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`가중치 ${name}는 0 이상 1 이하의 숫자여야 합니다. 현재 값: ${value}`);
    }
  }

  // 가중치 합계 검증 (선택적: 합계가 1.0에 가까운지 확인)
  const sum = weights.reduce((acc, { value }) => acc + value, 0);
  if (sum > 1.5) {
    console.warn(
      `[ranking-weights] 가중치 합계(${sum.toFixed(2)})가 1.5를 초과합니다. 정규화를 권장합니다.`
    );
  }
}

let defaultRankingWeightsCache: {
  envPath: string | undefined;
  config: RankingWeightsConfig;
} | null = null;

/**
 * 검색 랭킹 가중치 설정을 가져옵니다 (캐싱됨).
 * @param configPath TOML 설정 파일 경로
 * @returns 검색 랭킹 가중치 설정 객체
 */
export function getRankingWeights(configPath?: string): RankingWeightsConfig {
  if (configPath === undefined) {
    const envPath = process.env.MEMENTO_RANKING_WEIGHTS_PATH;
    if (defaultRankingWeightsCache && defaultRankingWeightsCache.envPath === envPath) {
      return defaultRankingWeightsCache.config;
    }
    const cacheKey = `ranking-weights:${resolveRankingWeightsFilePath(undefined)}`;
    const config = getCachedConfig(cacheKey, () => loadRankingWeights(undefined));
    defaultRankingWeightsCache = { envPath, config };
    return config;
  }
  const cacheKey = `ranking-weights:${resolveRankingWeightsFilePath(configPath)}`;
  return getCachedConfig(cacheKey, () => loadRankingWeights(configPath));
}

export function getRankingVersionPayload(configPath?: string): {
  weights: RankingWeightsConfig;
  hybrid_vector_threshold: number;
  vector_prefetch_multiplier: number;
  vector_underfill_fill: boolean;
  vector_score_scale: string;
  vector_length_decay_enabled: boolean;
  vector_length_decay_characteristic_length: number;
  text_lane_score: 'relevance_only';
} {
  const weights = getRankingWeights(configPath);
  return {
    weights,
    hybrid_vector_threshold: HYBRID_SEARCH.HYBRID_VECTOR_THRESHOLD,
    vector_prefetch_multiplier: HYBRID_SEARCH.VECTOR_SEARCH_LIMIT_MULTIPLIER,
    vector_underfill_fill: HYBRID_SEARCH.VECTOR_UNDERFILL_FILL,
    vector_score_scale: HYBRID_SEARCH.VECTOR_SCORE_SCALE,
    vector_length_decay_enabled: weights.vector_length_decay.enabled,
    vector_length_decay_characteristic_length: weights.vector_length_decay.characteristic_length,
    text_lane_score: 'relevance_only',
  };
}

export function getRankingVersion(configPath?: string): string {
  const hash = createHash('sha256')
    .update(JSON.stringify(getRankingVersionPayload(configPath)))
    .digest('hex')
    .slice(0, 12);
  return `ranking-sha256:${hash}`;
}

/**
 * 캐시된 설정을 초기화합니다 (테스트용).
 */
export function resetRankingWeightsCache(): void {
  defaultRankingWeightsCache = null;
  clearConfigCacheByPrefix('ranking-weights:');
}
