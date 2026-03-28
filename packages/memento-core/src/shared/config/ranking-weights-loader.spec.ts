/**
 * 검색 랭킹 가중치 설정 로더 테스트
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import {
  loadRankingWeights,
  getRankingWeights,
  resetRankingWeightsCache,
  type RankingWeightsConfig
} from './ranking-weights-loader.js';

describe('ranking-weights-loader', () => {
  let tempDir: string;
  let tempConfigPath: string;

  beforeEach(() => {
    tempDir = tmpdir();
    tempConfigPath = join(tempDir, `ranking-weights-${randomUUID()}.toml`);
    resetRankingWeightsCache();
  });

  afterEach(() => {
    if (existsSync(tempConfigPath)) {
      unlinkSync(tempConfigPath);
    }
    resetRankingWeightsCache();
  });

  describe('loadRankingWeights', () => {
    it('should load valid TOML config file', () => {
      // Given: 유효한 TOML 설정 파일
      const validConfig = `[ranking_weights]
alpha = 0.45
beta = 0.20
gamma = 0.20
delta = 0.10
zeta = 0.15
epsilon = 0.10

[relation_weights]
max_relations = 5
`;
      writeFileSync(tempConfigPath, validConfig, 'utf-8');

      // When: 설정 파일을 로드
      const config = loadRankingWeights(tempConfigPath);

      // Then: 올바른 값이 로드되어야 함
      expect(config.ranking_weights.alpha).toBe(0.45);
      expect(config.ranking_weights.beta).toBe(0.20);
      expect(config.ranking_weights.gamma).toBe(0.20);
      expect(config.ranking_weights.delta).toBe(0.10);
      expect(config.ranking_weights.zeta).toBe(0.15);
      expect(config.ranking_weights.epsilon).toBe(0.10);
      expect(config.relation_weights.max_relations).toBe(5);
    });

    it('should use default values when config file does not exist', () => {
      // Given: 존재하지 않는 설정 파일 경로
      const nonExistentPath = join(tempDir, 'non-existent.toml');

      // When: 설정 파일을 로드
      const config = loadRankingWeights(nonExistentPath);

      // Then: 기본값이 반환되어야 함
      expect(config.ranking_weights.alpha).toBe(0.45);
      expect(config.ranking_weights.beta).toBe(0.20);
      expect(config.ranking_weights.gamma).toBe(0.20);
      expect(config.ranking_weights.delta).toBe(0.10);
      expect(config.ranking_weights.zeta).toBe(0.15);
      expect(config.ranking_weights.epsilon).toBe(0.10);
      expect(config.relation_weights.max_relations).toBe(5);
    });

    it('should merge partial config with defaults', () => {
      // Given: 일부 값만 포함된 TOML 설정 파일
      const partialConfig = `[ranking_weights]
alpha = 0.50
zeta = 0.20
`;
      writeFileSync(tempConfigPath, partialConfig, 'utf-8');

      // When: 설정 파일을 로드
      const config = loadRankingWeights(tempConfigPath);

      // Then: 지정된 값은 사용하고 나머지는 기본값 사용
      expect(config.ranking_weights.alpha).toBe(0.50);
      expect(config.ranking_weights.zeta).toBe(0.20);
      expect(config.ranking_weights.beta).toBe(0.20); // 기본값
      expect(config.ranking_weights.gamma).toBe(0.20); // 기본값
      expect(config.ranking_weights.delta).toBe(0.10); // 기본값
      expect(config.ranking_weights.epsilon).toBe(0.10); // 기본값
      expect(config.relation_weights.max_relations).toBe(5); // 기본값
    });

    it('should throw error when weight value is out of range', () => {
      // Given: 범위를 벗어난 가중치 값을 가진 TOML 파일
      const invalidConfig = `[ranking_weights]
alpha = 1.5
beta = 0.20
gamma = 0.20
delta = 0.10
zeta = 0.15
epsilon = 0.10
`;
      writeFileSync(tempConfigPath, invalidConfig, 'utf-8');

      // When/Then: 에러가 발생해야 함
      expect(() => loadRankingWeights(tempConfigPath)).toThrow(/alpha.*최대값.*1/);
    });

    it('should throw error when weight value is negative', () => {
      // Given: 음수 가중치 값을 가진 TOML 파일
      const invalidConfig = `[ranking_weights]
alpha = -0.1
beta = 0.20
gamma = 0.20
delta = 0.10
zeta = 0.15
epsilon = 0.10
`;
      writeFileSync(tempConfigPath, invalidConfig, 'utf-8');

      // When/Then: 에러가 발생해야 함 (음수이므로 최소값 에러)
      expect(() => loadRankingWeights(tempConfigPath)).toThrow(/alpha.*최소값.*0/);
    });

    it('should throw error when max_relations is not positive', () => {
      // Given: max_relations가 0 이하인 TOML 파일
      const invalidConfig = `[ranking_weights]
alpha = 0.45
beta = 0.20
gamma = 0.20
delta = 0.10
zeta = 0.15
epsilon = 0.10

[relation_weights]
max_relations = 0
`;
      writeFileSync(tempConfigPath, invalidConfig, 'utf-8');

      // When/Then: 에러가 발생해야 함
      expect(() => loadRankingWeights(tempConfigPath)).toThrow(/max_relations.*최소값.*1/);
    });

    it('should throw error when config file is invalid TOML', () => {
      // Given: 잘못된 TOML 형식의 파일
      const invalidToml = `[ranking_weights
alpha = 0.45
`;
      writeFileSync(tempConfigPath, invalidToml, 'utf-8');

      // When/Then: 에러가 발생해야 함
      expect(() => loadRankingWeights(tempConfigPath)).toThrow(/설정 로드 실패/);
    });
  });

  describe('getRankingWeights', () => {
    it('should cache loaded config', () => {
      // Given: 유효한 TOML 설정 파일
      const validConfig = `[ranking_weights]
alpha = 0.50
beta = 0.20
gamma = 0.20
delta = 0.10
zeta = 0.15
epsilon = 0.10

[relation_weights]
max_relations = 10
`;
      writeFileSync(tempConfigPath, validConfig, 'utf-8');

      // When: 첫 번째 호출
      const config1 = getRankingWeights(tempConfigPath);

      // Then: 올바른 값이 반환되어야 함
      expect(config1.ranking_weights.alpha).toBe(0.50);
      expect(config1.relation_weights.max_relations).toBe(10);

      // When: 파일을 변경하고 두 번째 호출
      const modifiedConfig = `[ranking_weights]
alpha = 0.60
beta = 0.20
gamma = 0.20
delta = 0.10
zeta = 0.15
epsilon = 0.10

[relation_weights]
max_relations = 15
`;
      writeFileSync(tempConfigPath, modifiedConfig, 'utf-8');
      const config2 = getRankingWeights(tempConfigPath);

      // Then: 캐시된 값이 반환되어야 함 (변경되지 않음)
      expect(config2.ranking_weights.alpha).toBe(0.50);
      expect(config2.relation_weights.max_relations).toBe(10);
    });

    it('should reload config after cache reset', () => {
      // Given: 유효한 TOML 설정 파일
      const validConfig = `[ranking_weights]
alpha = 0.50
beta = 0.20
gamma = 0.20
delta = 0.10
zeta = 0.15
epsilon = 0.10

[relation_weights]
max_relations = 10
`;
      writeFileSync(tempConfigPath, validConfig, 'utf-8');

      // When: 첫 번째 호출
      const config1 = getRankingWeights(tempConfigPath);
      expect(config1.ranking_weights.alpha).toBe(0.50);

      // When: 캐시 초기화 후 파일 변경
      resetRankingWeightsCache();
      const modifiedConfig = `[ranking_weights]
alpha = 0.60
beta = 0.20
gamma = 0.20
delta = 0.10
zeta = 0.15
epsilon = 0.10

[relation_weights]
max_relations = 15
`;
      writeFileSync(tempConfigPath, modifiedConfig, 'utf-8');
      const config2 = getRankingWeights(tempConfigPath);

      // Then: 새로운 값이 로드되어야 함
      expect(config2.ranking_weights.alpha).toBe(0.60);
      expect(config2.relation_weights.max_relations).toBe(15);
    });

    it('should cache per config path (multi-profile)', () => {
      const pathA = join(tempDir, `profile-a-${randomUUID()}.toml`);
      const pathB = join(tempDir, `profile-b-${randomUUID()}.toml`);
      writeFileSync(
        pathA,
        `[ranking_weights]
alpha = 0.11
beta = 0.20
gamma = 0.20
delta = 0.10
zeta = 0.15
epsilon = 0.10

[relation_weights]
max_relations = 10
`,
        'utf-8'
      );
      writeFileSync(
        pathB,
        `[ranking_weights]
alpha = 0.46
beta = 0.20
gamma = 0.20
delta = 0.10
zeta = 0.15
epsilon = 0.10

[relation_weights]
max_relations = 10
`,
        'utf-8'
      );

      const a = getRankingWeights(pathA);
      const b = getRankingWeights(pathB);
      expect(a.ranking_weights.alpha).toBe(0.11);
      expect(b.ranking_weights.alpha).toBe(0.46);
    });
  });
});
