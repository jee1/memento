/**
 * 벡터 호환성 유틸리티
 * - 차원이 다른 임베딩 벡터를 안전하게 변환
 * - 패딩/축소 전략과 정규화를 일관되게 적용
 */

import type {
  EmbeddingProvider,
  ProjectionType,
  VectorCompatibilityAssessment,
  VectorCompatibilityIssue,
  VectorExpansionStrategy,
  VectorNormalization,
  VectorProjectionOptions,
  VectorProjectionResult,
  VectorReductionStrategy
} from '../../../../../shared/types/embedding.types.js';

interface ProjectionInternalResult {
  vector: number[];
  projectionType: ProjectionType;
  expansionStrategy?: VectorExpansionStrategy;
  reductionStrategy?: VectorReductionStrategy;
}

export class VectorCompatibilityService {
  private readonly defaultExpansion: VectorExpansionStrategy = 'zero-pad';
  private readonly defaultReduction: VectorReductionStrategy = 'average-pool';
  private readonly epsilon = 1e-9;
  private readonly defaultDimensions = 384;
  private providerDimensionMap: Record<EmbeddingProvider, number> = {
    tfidf: 512, // LightweightEmbeddingService는 512차원을 생성
    lightweight: 384,
    minilm: 384,
    openai: 1536,
    gemini: 768
  };

  /**
   * 목표 차원에 맞게 벡터를 변환
   */
  project(vector: number[], options: VectorProjectionOptions): VectorProjectionResult {
    this.assertValidOptions(vector, options);
    const sanitized = this.sanitizeVector(vector);
    return this.performProjection(sanitized, options);
  }

  /**
   * 벡터 호환성을 분석하고 필요한 투영 정보를 제공
   */
  assessCompatibility(vector: number[], options: VectorProjectionOptions): VectorCompatibilityAssessment {
    this.assertValidOptions(vector, options);
    const sanitized = this.sanitizeVector(vector);
    const expectedDimensions = options.targetDimensions;
    const issues: VectorCompatibilityIssue[] = [];

    if (sanitized.length === 0) {
      issues.push({
        code: 'empty_vector',
        message: '벡터가 비어 있습니다',
        severity: 'error'
      });
    }

    const hasNonFinite = vector.some(value => !Number.isFinite(value));
    if (hasNonFinite) {
      issues.push({
        code: 'non_finite_values',
        message: '비유한 값이 포함되어 0으로 보정되었습니다',
        severity: 'warning'
      });
    }

    const projection = this.performProjection(sanitized, options);
    const needsProjection =
      projection.projectionType !== 'native' ||
      projection.sourceDimensions !== projection.targetDimensions;

    if (needsProjection) {
      issues.push({
        code: 'dimension_mismatch',
        message: `벡터 차원(${projection.sourceDimensions})이 기대 차원(${expectedDimensions})과 일치하지 않습니다`,
        severity: 'error'
      });
    }

    const isZeroVector = projection.vector.every(value => Math.abs(value) <= this.epsilon);
    if (!needsProjection && sanitized.length > 0 && isZeroVector) {
      issues.push({
        code: 'zero_vector',
        message: '모든 요소가 0에 가까워 유사도 계산에 영향을 줄 수 있습니다',
        severity: 'warning'
      });
    }

    const blockingIssues = issues.filter(issue => {
      if (issue.severity !== 'error') {
        return false;
      }
      return issue.code !== 'dimension_mismatch';
    });

    const isCompatible = !needsProjection && blockingIssues.length === 0;

    return {
      isCompatible,
      needsProjection,
      issues,
      actualDimensions: projection.sourceDimensions,
      expectedDimensions,
      projection
    };
  }

  /**
   * 호환성 검증 (필요 시 예외 발생)
   */
  validateCompatibility(
    vector: number[],
    options: VectorProjectionOptions,
    allowProjection: boolean = true
  ): VectorCompatibilityAssessment {
    const assessment = this.assessCompatibility(vector, options);

    const blockingIssues = assessment.issues.filter(issue => {
      if (issue.severity !== 'error') {
        return false;
      }
      if (issue.code === 'dimension_mismatch') {
        return !allowProjection;
      }
      return true;
    });

    if (blockingIssues.length > 0) {
      const messages = blockingIssues.map(issue => issue.message).join(', ');
      throw new Error(`벡터 호환성 검증 실패: ${messages}`);
    }

    return assessment;
  }

  /**
   * 제공자별 기본 차원을 적용한 호환성 분석
   */
  assessProviderCompatibility(
    vector: number[],
    provider: EmbeddingProvider,
    overrides: Partial<VectorProjectionOptions> = {}
  ): VectorCompatibilityAssessment {
    const targetDimensions =
      overrides.targetDimensions ?? this.getNativeDimensions(provider);
    const options: VectorProjectionOptions = {
      targetDimensions,
      expansionStrategy: overrides.expansionStrategy,
      reductionStrategy: overrides.reductionStrategy,
      normalization: overrides.normalization
    };

    const assessment = this.assessCompatibility(vector, options);
    return {
      ...assessment,
      provider
    };
  }

  /**
   * 제공자별 차원 검증
   */
  validateProviderCompatibility(
    vector: number[],
    provider: EmbeddingProvider,
    overrides: Partial<VectorProjectionOptions> = {},
    allowProjection: boolean = true
  ): VectorCompatibilityAssessment {
    const targetDimensions =
      overrides.targetDimensions ?? this.getNativeDimensions(provider);
    const options: VectorProjectionOptions = {
      targetDimensions,
      expansionStrategy: overrides.expansionStrategy,
      reductionStrategy: overrides.reductionStrategy,
      normalization: overrides.normalization
    };

    const assessment = this.validateCompatibility(vector, options, allowProjection);
    return {
      ...assessment,
      provider
    };
  }

  /**
   * 제공자의 기본 차원을 조회
   */
  getNativeDimensions(provider: EmbeddingProvider): number {
    return this.providerDimensionMap[provider] ?? this.defaultDimensions;
  }

  /**
   * 제공자의 기본 차원을 갱신
   */
  setNativeDimensions(provider: EmbeddingProvider, dimensions: number): void {
    if (!Number.isInteger(dimensions) || dimensions <= 0) {
      throw new Error('차원은 0보다 큰 정수여야 합니다');
    }
    this.providerDimensionMap[provider] = dimensions;
  }

  private performProjection(
    sanitized: number[],
    options: VectorProjectionOptions
  ): VectorProjectionResult {
    const targetDim = options.targetDimensions;
    const sourceDim = sanitized.length;

    let transformed: ProjectionInternalResult = {
      vector: sanitized.slice(),
      projectionType: 'native'
    };

    if (sourceDim < targetDim) {
      transformed = this.expandVector(
        sanitized,
        targetDim,
        options.expansionStrategy ?? this.defaultExpansion
      );
    } else if (sourceDim > targetDim) {
      transformed = this.reduceVector(
        sanitized,
        targetDim,
        options.reductionStrategy ?? this.defaultReduction
      );
    }

    const normalizedVector = this.applyNormalization(
      transformed.vector,
      options.normalization ?? 'none'
    );

    return {
      vector: normalizedVector,
      sourceDimensions: sourceDim,
      targetDimensions: targetDim,
      projectionType: transformed.projectionType,
      normalized: (options.normalization ?? 'none') !== 'none',
      expansionStrategy: transformed.expansionStrategy,
      reductionStrategy: transformed.reductionStrategy
    };
  }

  /**
   * 지정한 전략으로 벡터 차원을 확장
   */
  expandVector(
    vector: number[],
    targetDim: number,
    strategy: VectorExpansionStrategy
  ): ProjectionInternalResult {
    if (vector.length >= targetDim) {
      return {
        vector: vector.slice(0, targetDim),
        projectionType: vector.length === targetDim ? 'native' : 'truncate'
      };
    }

    switch (strategy) {
      case 'repeat':
        return {
          vector: this.repeatUpsample(vector, targetDim),
          projectionType: 'repeat_upsample',
          expansionStrategy: strategy
        };
      case 'interpolate':
        return {
          vector: this.interpolate(vector, targetDim),
          projectionType: 'interpolate',
          expansionStrategy: strategy
        };
      case 'zero-pad':
      default:
        return {
          vector: this.zeroPad(vector, targetDim),
          projectionType: 'zero_pad',
          expansionStrategy: 'zero-pad'
        };
    }
  }

  /**
   * 지정한 전략으로 벡터 차원을 축소
   */
  reduceVector(
    vector: number[],
    targetDim: number,
    strategy: VectorReductionStrategy
  ): ProjectionInternalResult {
    if (vector.length <= targetDim) {
      return {
        vector: vector.slice(),
        projectionType: vector.length === targetDim ? 'native' : 'zero_pad'
      };
    }

    switch (strategy) {
      case 'truncate':
        return {
          vector: vector.slice(0, targetDim),
          projectionType: 'truncate',
          reductionStrategy: strategy
        };
      case 'average-pool':
      default:
        return {
          vector: this.averagePool(vector, targetDim),
          projectionType: 'average_pool',
          reductionStrategy: 'average-pool'
        };
    }
  }

  private zeroPad(vector: number[], targetDim: number): number[] {
    if (targetDim <= 0) {
      return [];
    }
    const result = new Array<number>(targetDim);
    for (let i = 0; i < targetDim; i++) {
      result[i] = i < vector.length ? (vector[i] ?? 0) : 0;
    }
    return result;
  }

  private repeatUpsample(vector: number[], targetDim: number): number[] {
    if (targetDim <= 0) {
      return [];
    }
    if (vector.length === 0) {
      return new Array(targetDim).fill(0);
    }
    const result = new Array<number>(targetDim);
    for (let i = 0; i < targetDim; i++) {
      const value = vector[i % vector.length];
      result[i] = value !== undefined ? value : 0;
    }
    return result;
  }

  private interpolate(vector: number[], targetDim: number): number[] {
    if (vector.length === 0) {
      return new Array(targetDim).fill(0);
    }
    if (vector.length === 1) {
      return new Array(targetDim).fill(vector[0] ?? 0);
    }

    const result = new Array<number>(targetDim);
    const lastIndex = vector.length - 1;

    for (let i = 0; i < targetDim; i++) {
      if (targetDim === 1) {
        result[i] = vector[0] ?? 0;
        continue;
      }
      const position = (i * lastIndex) / (targetDim - 1);
      const leftIndex = Math.floor(position);
      const rightIndex = Math.min(leftIndex + 1, lastIndex);
      const ratio = position - leftIndex;
      if (rightIndex === leftIndex) {
        result[i] = vector[leftIndex] ?? 0;
      } else {
        const left = vector[leftIndex] ?? 0;
        const right = vector[rightIndex] ?? 0;
        result[i] = left + (right - left) * ratio;
      }
    }

    return result;
  }

  private averagePool(vector: number[], targetDim: number): number[] {
    if (targetDim <= 0) {
      return [];
    }
    if (vector.length === 0) {
      return new Array(targetDim).fill(0);
    }

    const result = new Array<number>(targetDim);
    const ratio = vector.length / targetDim;

    for (let i = 0; i < targetDim; i++) {
      const start = i * ratio;
      const end = (i + 1) * ratio;
      const startIndex = Math.floor(start);
      const endIndex = Math.min(Math.ceil(end), vector.length);

      if (endIndex <= startIndex) {
        result[i] = vector[Math.min(startIndex, vector.length - 1)] ?? 0;
        continue;
      }

      let sum = 0;
      let weight = 0;

      for (let idx = startIndex; idx < endIndex; idx++) {
        const segmentStart = Math.max(start, idx);
        const segmentEnd = Math.min(end, idx + 1);
        const segmentWeight = segmentEnd - segmentStart;
        const value = vector[idx] ?? 0;
        sum += value * segmentWeight;
        weight += segmentWeight;
      }

      result[i] = weight > this.epsilon ? sum / weight : 0;
    }

    return result;
  }

  private applyNormalization(vector: number[], mode: VectorNormalization): number[] {
    switch (mode) {
      case 'l2':
        return this.l2Normalize(vector);
      case 'min-max':
        return this.minMaxNormalize(vector);
      case 'none':
      default:
        return vector.slice();
    }
  }

  private l2Normalize(vector: number[]): number[] {
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (norm <= this.epsilon) {
      return vector.slice();
    }
    return vector.map(value => value / norm);
  }

  private minMaxNormalize(vector: number[]): number[] {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;

    for (const value of vector) {
      if (value < min) {
        min = value;
      }
      if (value > max) {
        max = value;
      }
    }

    const range = max - min;
    if (Math.abs(range) <= this.epsilon) {
      return new Array(vector.length).fill(0);
    }

    return vector.map(value => (value - min) / range);
  }

  private sanitizeVector(vector: number[]): number[] {
    if (!Array.isArray(vector)) {
      throw new Error('벡터는 배열이어야 합니다');
    }
    return vector.map(value => (Number.isFinite(value) ? value : 0));
  }

  private assertValidOptions(vector: number[], options: VectorProjectionOptions): void {
    if (!Array.isArray(vector)) {
      throw new Error('벡터는 배열이어야 합니다');
    }
    if (!options || !Number.isInteger(options.targetDimensions)) {
      throw new Error('targetDimensions는 정수여야 합니다');
    }
    if (options.targetDimensions <= 0) {
      throw new Error('targetDimensions는 0보다 커야 합니다');
    }
  }
}

export const vectorCompatibilityService = new VectorCompatibilityService();
