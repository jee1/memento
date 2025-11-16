/**
 * 검색 랭킹 가중치 설정 로더
 * TOML 파일에서 검색 랭킹 가중치를 로드하고 검증합니다.
 */

import { parse } from '@iarna/toml';
import { readFileSync } from 'fs';
import { join } from 'path';

export interface RankingWeights {
  alpha: number; // relevance 가중치
  beta: number; // recency 가중치
  gamma: number; // importance 가중치
  delta: number; // usage 가중치
  zeta: number; // relation_weight 가중치
  epsilon: number; // duplication_penalty 가중치
}

export interface RelationWeights {
  max_relations: number; // 관계 가중치 계산 시 정규화를 위한 최대 관계 수
}

export interface RankingWeightsConfig {
  ranking_weights: RankingWeights;
  relation_weights: RelationWeights;
}

const DEFAULT_CONFIG: RankingWeightsConfig = {
  ranking_weights: {
    alpha: 0.45,
    beta: 0.20,
    gamma: 0.20,
    delta: 0.10,
    zeta: 0.15,
    epsilon: 0.10
  },
  relation_weights: {
    max_relations: 5
  }
};

/**
 * TOML 파일에서 검색 랭킹 가중치 설정을 로드합니다.
 * @param configPath TOML 설정 파일 경로 (기본값: config/ranking-weights.toml)
 * @returns 검색 랭킹 가중치 설정 객체
 * @throws 설정 파일을 읽을 수 없거나 파싱에 실패한 경우
 */
export function loadRankingWeights(configPath?: string): RankingWeightsConfig {
  const defaultPath = join(process.cwd(), 'config', 'ranking-weights.toml');
  const path = configPath ?? defaultPath;

  try {
    const fileContent = readFileSync(path, 'utf-8');
    const parsed = parse(fileContent) as Partial<RankingWeightsConfig>;

    // 기본값과 병합
    const config: RankingWeightsConfig = {
      ranking_weights: {
        ...DEFAULT_CONFIG.ranking_weights,
        ...(parsed.ranking_weights || {})
      },
      relation_weights: {
        ...DEFAULT_CONFIG.relation_weights,
        ...(parsed.relation_weights || {})
      }
    };

    // 값 검증
    validateRankingWeights(config);

    return config;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      // 파일이 없으면 기본값 반환
      console.warn(`[ranking-weights] 설정 파일을 찾을 수 없습니다: ${path}. 기본값을 사용합니다.`);
      return DEFAULT_CONFIG;
    }
    throw new Error(`검색 랭킹 가중치 설정 로드 실패: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 검색 랭킹 가중치 설정을 검증합니다.
 * @param config 검증할 설정 객체
 * @throws 설정 값이 유효하지 않은 경우
 */
function validateRankingWeights(config: RankingWeightsConfig): void {
  const { ranking_weights, relation_weights } = config;

  // 가중치 값 검증 (0 이상 1 이하)
  const weights = [
    { name: 'alpha', value: ranking_weights.alpha },
    { name: 'beta', value: ranking_weights.beta },
    { name: 'gamma', value: ranking_weights.gamma },
    { name: 'delta', value: ranking_weights.delta },
    { name: 'zeta', value: ranking_weights.zeta },
    { name: 'epsilon', value: ranking_weights.epsilon }
  ];

  for (const { name, value } of weights) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`가중치 ${name}는 0 이상 1 이하의 숫자여야 합니다. 현재 값: ${value}`);
    }
  }

  // max_relations 검증 (양수)
  if (!Number.isFinite(relation_weights.max_relations) || relation_weights.max_relations <= 0) {
    throw new Error(
      `max_relations는 양수여야 합니다. 현재 값: ${relation_weights.max_relations}`
    );
  }

  // 가중치 합계 검증 (선택적: 합계가 1.0에 가까운지 확인)
  const sum = weights.reduce((acc, { value }) => acc + value, 0);
  if (sum > 1.5) {
    console.warn(
      `[ranking-weights] 가중치 합계(${sum.toFixed(2)})가 1.5를 초과합니다. 정규화를 권장합니다.`
    );
  }
}

/**
 * 싱글톤 인스턴스로 설정을 캐싱합니다.
 */
let cachedConfig: RankingWeightsConfig | null = null;

/**
 * 검색 랭킹 가중치 설정을 가져옵니다 (캐싱됨).
 * @param configPath TOML 설정 파일 경로
 * @returns 검색 랭킹 가중치 설정 객체
 */
export function getRankingWeights(configPath?: string): RankingWeightsConfig {
  if (!cachedConfig) {
    cachedConfig = loadRankingWeights(configPath);
  }
  return cachedConfig;
}

/**
 * 캐시된 설정을 초기화합니다 (테스트용).
 */
export function resetRankingWeightsCache(): void {
  cachedConfig = null;
}
