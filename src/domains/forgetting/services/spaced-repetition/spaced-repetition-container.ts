/**
 * 간격 반복 컨테이너
 * 의존성 주입 컨테이너
 */

import type { 
  SpacedRepetitionConfig,
  SpacedRepetitionWeights 
} from '../../../../../shared/types/spaced-repetition.types.js';
import type { SpacedRepetitionService } from '../../../../../shared/interfaces/spaced-repetition.interface.js';
import { SpacedRepetitionFactory } from '../../factories/spaced-repetition.factory.js';

/**
 * 간격 반복 컨테이너
 * 싱글톤 패턴으로 전역 상태 관리
 */
export class SpacedRepetitionContainer {
  private static instance: SpacedRepetitionContainer | null = null;
  private service: SpacedRepetitionService | null = null;
  private config: SpacedRepetitionConfig | null = null;

  private constructor() {}

  /**
   * 싱글톤 인스턴스 반환
   */
  static getInstance(): SpacedRepetitionContainer {
    if (!SpacedRepetitionContainer.instance) {
      SpacedRepetitionContainer.instance = new SpacedRepetitionContainer();
    }
    return SpacedRepetitionContainer.instance;
  }

  /**
   * 설정 초기화
   */
  initialize(config: SpacedRepetitionConfig): void {
    this.config = config;
    this.service = SpacedRepetitionFactory.createService(config);
  }

  /**
   * 기본 설정으로 초기화
   */
  initializeWithDefaults(weights?: Partial<SpacedRepetitionWeights>): void {
    const defaultConfig: SpacedRepetitionConfig = {
      weights: {
        importance: 0.6,
        usage: 0.4,
        helpful_feedback: 0.5,
        bad_feedback: 0.7,
        ...weights
      },
      recallThreshold: 0.7,
      defaultInterval: 7
    };
    
    this.initialize(defaultConfig);
  }

  /**
   * 서비스 반환
   */
  getService(): SpacedRepetitionService {
    if (!this.service) {
      throw new Error('SpacedRepetitionContainer가 초기화되지 않았습니다. initialize()를 먼저 호출하세요.');
    }
    return this.service;
  }

  /**
   * 설정 반환
   */
  getConfig(): SpacedRepetitionConfig {
    if (!this.config) {
      throw new Error('SpacedRepetitionContainer가 초기화되지 않았습니다. initialize()를 먼저 호출하세요.');
    }
    return this.config;
  }

  /**
   * 초기화 여부 확인
   */
  isInitialized(): boolean {
    return this.service !== null && this.config !== null;
  }

  /**
   * 컨테이너 리셋
   */
  reset(): void {
    this.service = null;
    this.config = null;
  }

  /**
   * 설정 업데이트
   */
  updateConfig(newConfig: Partial<SpacedRepetitionConfig>): void {
    if (!this.config) {
      throw new Error('컨테이너가 초기화되지 않았습니다.');
    }

    const updatedConfig: SpacedRepetitionConfig = {
      ...this.config,
      ...newConfig
    };

    this.initialize(updatedConfig);
  }

  /**
   * 가중치 업데이트
   */
  updateWeights(newWeights: Partial<SpacedRepetitionWeights>): void {
    if (!this.config) {
      throw new Error('컨테이너가 초기화되지 않았습니다.');
    }

    const updatedWeights: SpacedRepetitionWeights = {
      ...this.config.weights,
      ...newWeights
    };

    this.updateConfig({ weights: updatedWeights });
  }

  /**
   * 임계값 업데이트
   */
  updateThreshold(newThreshold: number): void {
    this.updateConfig({ recallThreshold: newThreshold });
  }

  /**
   * 기본 간격 업데이트
   */
  updateDefaultInterval(newInterval: number): void {
    this.updateConfig({ defaultInterval: newInterval });
  }
}

/**
 * 전역 컨테이너 접근 함수들
 */
export function getSpacedRepetitionService(): SpacedRepetitionService {
  return SpacedRepetitionContainer.getInstance().getService();
}

export function initializeSpacedRepetition(config: SpacedRepetitionConfig): void {
  SpacedRepetitionContainer.getInstance().initialize(config);
}

export function initializeSpacedRepetitionWithDefaults(weights?: Partial<SpacedRepetitionWeights>): void {
  SpacedRepetitionContainer.getInstance().initializeWithDefaults(weights);
}

export function isSpacedRepetitionInitialized(): boolean {
  return SpacedRepetitionContainer.getInstance().isInitialized();
}

export function resetSpacedRepetition(): void {
  SpacedRepetitionContainer.getInstance().reset();
}
