/**
 * RelationQualityValidator 단위 테스트
 * 관계 추출 품질 검증 서비스 테스트
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { RelationQualityValidator } from './relation-quality-validator.js';
import type { ExpectedRelation, ExtractedRelation } from './relation-quality-validator.js';
import type { RelationType } from '../../../shared/types/relation.js';

describe('RelationQualityValidator', () => {
  let validator: RelationQualityValidator;

  beforeEach(() => {
    // Given: RelationQualityValidator 인스턴스 생성
    validator = new RelationQualityValidator();
  });

  describe('matchRelations', () => {
    it('예상 관계와 추출된 관계를 올바르게 매칭해야 함', () => {
      // Given: 예상 관계와 추출된 관계
      const expectedRelations: ExpectedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          expected_relation_type: 'CAUSES',
          expected_confidence_range: [0.7, 0.9],
          source_content: '버그 발생',
          target_content: '시스템 오류'
        },
        {
          source_id: 'mem3',
          target_id: 'mem4',
          expected_relation_type: 'FOLLOWS',
          expected_confidence_range: [0.8, 0.95],
          source_content: '설계 완료',
          target_content: '개발 시작'
        }
      ];

      const extractedRelations: ExtractedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          relation_type: 'CAUSES',
          confidence: 0.85
        },
        {
          source_id: 'mem3',
          target_id: 'mem4',
          relation_type: 'FOLLOWS',
          confidence: 0.9
        }
      ];

      // When: 관계 매칭 수행
      const matches = validator.matchRelations(expectedRelations, extractedRelations);

      // Then: 모든 관계가 올바르게 매칭되어야 함
      expect(matches).toHaveLength(2);
      expect(matches[0].isMatch).toBe(true);
      expect(matches[0].isTypeMatch).toBe(true);
      expect(matches[0].isConfidenceInRange).toBe(true);
      expect(matches[1].isMatch).toBe(true);
      expect(matches[1].isTypeMatch).toBe(true);
      expect(matches[1].isConfidenceInRange).toBe(true);
    });

    it('관계 유형이 일치하지 않으면 isTypeMatch가 false여야 함', () => {
      // Given: 관계 유형이 다른 경우
      const expectedRelations: ExpectedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          expected_relation_type: 'CAUSES',
          expected_confidence_range: [0.7, 0.9],
          source_content: '버그 발생',
          target_content: '시스템 오류'
        }
      ];

      const extractedRelations: ExtractedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          relation_type: 'FOLLOWS', // 다른 관계 유형
          confidence: 0.85
        }
      ];

      // When: 관계 매칭 수행
      const matches = validator.matchRelations(expectedRelations, extractedRelations);

      // Then: 관계 유형이 일치하지 않아야 함
      expect(matches[0].isTypeMatch).toBe(false);
      expect(matches[0].isMatch).toBe(false);
    });

    it('신뢰도가 범위를 벗어나면 isConfidenceInRange가 false여야 함', () => {
      // Given: 신뢰도가 범위를 벗어난 경우
      const expectedRelations: ExpectedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          expected_relation_type: 'CAUSES',
          expected_confidence_range: [0.7, 0.9],
          source_content: '버그 발생',
          target_content: '시스템 오류'
        }
      ];

      const extractedRelations: ExtractedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          relation_type: 'CAUSES',
          confidence: 0.5 // 범위를 벗어남
        }
      ];

      // When: 관계 매칭 수행
      const matches = validator.matchRelations(expectedRelations, extractedRelations);

      // Then: 신뢰도가 범위를 벗어나야 함
      expect(matches[0].isConfidenceInRange).toBe(false);
      expect(matches[0].isMatch).toBe(false);
    });

    it('추출되지 않은 관계는 extracted가 null이어야 함', () => {
      // Given: 추출되지 않은 관계
      const expectedRelations: ExpectedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          expected_relation_type: 'CAUSES',
          expected_confidence_range: [0.7, 0.9],
          source_content: '버그 발생',
          target_content: '시스템 오류'
        }
      ];

      const extractedRelations: ExtractedRelation[] = [];

      // When: 관계 매칭 수행
      const matches = validator.matchRelations(expectedRelations, extractedRelations);

      // Then: extracted가 null이어야 함
      expect(matches[0].extracted).toBeNull();
      expect(matches[0].isMatch).toBe(false);
    });
  });

  describe('calculatePrecision', () => {
    it('올바른 Precision을 계산해야 함', () => {
      // Given: 매칭 결과와 추출된 관계
      const expectedRelations: ExpectedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          expected_relation_type: 'CAUSES',
          expected_confidence_range: [0.7, 0.9],
          source_content: '버그 발생',
          target_content: '시스템 오류'
        },
        {
          source_id: 'mem3',
          target_id: 'mem4',
          expected_relation_type: 'FOLLOWS',
          expected_confidence_range: [0.8, 0.95],
          source_content: '설계 완료',
          target_content: '개발 시작'
        }
      ];

      const extractedRelations: ExtractedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          relation_type: 'CAUSES',
          confidence: 0.85
        },
        {
          source_id: 'mem3',
          target_id: 'mem4',
          relation_type: 'FOLLOWS',
          confidence: 0.9
        },
        {
          source_id: 'mem5',
          target_id: 'mem6',
          relation_type: 'CAUSES',
          confidence: 0.8 // False Positive
        }
      ];

      const matches = validator.matchRelations(expectedRelations, extractedRelations);

      // When: Precision 계산
      const precision = validator.calculatePrecision(matches, extractedRelations);

      // Then: Precision = TP / (TP + FP) = 2 / (2 + 1) = 0.667
      expect(precision).toBeCloseTo(2 / 3, 2);
    });

    it('추출된 관계가 없으면 Precision은 0이어야 함', () => {
      // Given: 추출된 관계가 없는 경우
      const expectedRelations: ExpectedRelation[] = [];
      const extractedRelations: ExtractedRelation[] = [];
      const matches = validator.matchRelations(expectedRelations, extractedRelations);

      // When: Precision 계산
      const precision = validator.calculatePrecision(matches, extractedRelations);

      // Then: Precision은 0
      expect(precision).toBe(0);
    });
  });

  describe('calculateRecall', () => {
    it('올바른 Recall을 계산해야 함', () => {
      // Given: 매칭 결과와 예상 관계
      const expectedRelations: ExpectedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          expected_relation_type: 'CAUSES',
          expected_confidence_range: [0.7, 0.9],
          source_content: '버그 발생',
          target_content: '시스템 오류'
        },
        {
          source_id: 'mem3',
          target_id: 'mem4',
          expected_relation_type: 'FOLLOWS',
          expected_confidence_range: [0.8, 0.95],
          source_content: '설계 완료',
          target_content: '개발 시작'
        },
        {
          source_id: 'mem5',
          target_id: 'mem6',
          expected_relation_type: 'CAUSES',
          expected_confidence_range: [0.7, 0.9],
          source_content: '오류 발생',
          target_content: '복구 작업'
        }
      ];

      const extractedRelations: ExtractedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          relation_type: 'CAUSES',
          confidence: 0.85
        },
        {
          source_id: 'mem3',
          target_id: 'mem4',
          relation_type: 'FOLLOWS',
          confidence: 0.9
        }
        // mem5 -> mem6은 추출되지 않음 (False Negative)
      ];

      const matches = validator.matchRelations(expectedRelations, extractedRelations);

      // When: Recall 계산
      const recall = validator.calculateRecall(matches, expectedRelations);

      // Then: Recall = TP / (TP + FN) = 2 / (2 + 1) = 0.667
      expect(recall).toBeCloseTo(2 / 3, 2);
    });

    it('예상 관계가 없으면 Recall은 0이어야 함', () => {
      // Given: 예상 관계가 없는 경우
      const expectedRelations: ExpectedRelation[] = [];
      const extractedRelations: ExtractedRelation[] = [];
      const matches = validator.matchRelations(expectedRelations, extractedRelations);

      // When: Recall 계산
      const recall = validator.calculateRecall(matches, expectedRelations);

      // Then: Recall은 0
      expect(recall).toBe(0);
    });
  });

  describe('calculateF1Score', () => {
    it('올바른 F1-Score를 계산해야 함', () => {
      // Given: Precision과 Recall
      const precision = 0.8;
      const recall = 0.75;

      // When: F1-Score 계산
      const f1Score = validator.calculateF1Score(precision, recall);

      // Then: F1 = 2 * (0.8 * 0.75) / (0.8 + 0.75) = 0.774
      expect(f1Score).toBeCloseTo(0.774, 2);
    });

    it('Precision과 Recall이 모두 0이면 F1-Score는 0이어야 함', () => {
      // Given: Precision과 Recall이 모두 0
      const precision = 0;
      const recall = 0;

      // When: F1-Score 계산
      const f1Score = validator.calculateF1Score(precision, recall);

      // Then: F1-Score는 0
      expect(f1Score).toBe(0);
    });
  });

  describe('calculateTypeMetrics', () => {
    it('관계 유형별 메트릭을 올바르게 계산해야 함', () => {
      // Given: 여러 관계 유형이 포함된 데이터
      const expectedRelations: ExpectedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          expected_relation_type: 'CAUSES',
          expected_confidence_range: [0.7, 0.9],
          source_content: '버그 발생',
          target_content: '시스템 오류'
        },
        {
          source_id: 'mem3',
          target_id: 'mem4',
          expected_relation_type: 'CAUSES',
          expected_confidence_range: [0.7, 0.9],
          source_content: '오류 발생',
          target_content: '복구 작업'
        },
        {
          source_id: 'mem5',
          target_id: 'mem6',
          expected_relation_type: 'FOLLOWS',
          expected_confidence_range: [0.8, 0.95],
          source_content: '설계 완료',
          target_content: '개발 시작'
        }
      ];

      const extractedRelations: ExtractedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          relation_type: 'CAUSES',
          confidence: 0.85
        },
        {
          source_id: 'mem3',
          target_id: 'mem4',
          relation_type: 'CAUSES',
          confidence: 0.75
        },
        {
          source_id: 'mem7',
          target_id: 'mem8',
          relation_type: 'CAUSES',
          confidence: 0.8 // False Positive
        }
      ];

      const matches = validator.matchRelations(expectedRelations, extractedRelations);

      // When: CAUSES 관계 유형별 메트릭 계산
      const typeMetrics = validator.calculateTypeMetrics(
        matches,
        extractedRelations,
        expectedRelations,
        'CAUSES'
      );

      // Then: CAUSES 관계 유형별 메트릭이 올바르게 계산되어야 함
      expect(typeMetrics.truePositives).toBe(2);
      expect(typeMetrics.falsePositives).toBe(1);
      expect(typeMetrics.falseNegatives).toBe(0);
      expect(typeMetrics.precision).toBeCloseTo(2 / 3, 2);
      expect(typeMetrics.recall).toBe(1.0);
      expect(typeMetrics.f1Score).toBeCloseTo(0.8, 2);
    });
  });

  describe('calculateConfidenceComplianceRate', () => {
    it('신뢰도 범위 준수율을 올바르게 계산해야 함', () => {
      // Given: 신뢰도 범위 준수/비준수 혼합
      const expectedRelations: ExpectedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          expected_relation_type: 'CAUSES',
          expected_confidence_range: [0.7, 0.9],
          source_content: '버그 발생',
          target_content: '시스템 오류'
        },
        {
          source_id: 'mem3',
          target_id: 'mem4',
          expected_relation_type: 'FOLLOWS',
          expected_confidence_range: [0.8, 0.95],
          source_content: '설계 완료',
          target_content: '개발 시작'
        }
      ];

      const extractedRelations: ExtractedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          relation_type: 'CAUSES',
          confidence: 0.85 // 범위 내
        },
        {
          source_id: 'mem3',
          target_id: 'mem4',
          relation_type: 'FOLLOWS',
          confidence: 0.5 // 범위 밖
        }
      ];

      const matches = validator.matchRelations(expectedRelations, extractedRelations);

      // When: 신뢰도 범위 준수율 계산
      const complianceRate = validator.calculateConfidenceComplianceRate(matches);

      // Then: 준수율 = 1 / 2 = 0.5
      expect(complianceRate).toBe(0.5);
    });
  });

  describe('calculateQualityMetrics', () => {
    it('전체 품질 메트릭을 올바르게 계산해야 함', () => {
      // Given: 복합적인 관계 데이터
      const expectedRelations: ExpectedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          expected_relation_type: 'CAUSES',
          expected_confidence_range: [0.7, 0.9],
          source_content: '버그 발생',
          target_content: '시스템 오류'
        },
        {
          source_id: 'mem3',
          target_id: 'mem4',
          expected_relation_type: 'FOLLOWS',
          expected_confidence_range: [0.8, 0.95],
          source_content: '설계 완료',
          target_content: '개발 시작'
        },
        {
          source_id: 'mem5',
          target_id: 'mem6',
          expected_relation_type: 'CAUSES',
          expected_confidence_range: [0.7, 0.9],
          source_content: '오류 발생',
          target_content: '복구 작업'
        }
      ];

      const extractedRelations: ExtractedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          relation_type: 'CAUSES',
          confidence: 0.85
        },
        {
          source_id: 'mem3',
          target_id: 'mem4',
          relation_type: 'FOLLOWS',
          confidence: 0.9
        },
        {
          source_id: 'mem7',
          target_id: 'mem8',
          relation_type: 'CAUSES',
          confidence: 0.8 // False Positive
        }
      ];

      // When: 전체 품질 메트릭 계산
      const metrics = validator.calculateQualityMetrics(expectedRelations, extractedRelations);

      // Then: 모든 메트릭이 올바르게 계산되어야 함
      expect(metrics.totalExpected).toBe(3);
      expect(metrics.totalExtracted).toBe(3);
      expect(metrics.truePositives).toBe(2);
      expect(metrics.falsePositives).toBe(1);
      expect(metrics.falseNegatives).toBe(1);
      expect(metrics.precision).toBeCloseTo(2 / 3, 2);
      expect(metrics.recall).toBeCloseTo(2 / 3, 2);
      expect(metrics.f1Score).toBeCloseTo(0.667, 2);
      
      // 관계 유형별 메트릭 확인
      expect(metrics.typeMetrics.CAUSES).toBeDefined();
      expect(metrics.typeMetrics.FOLLOWS).toBeDefined();
      expect(metrics.typeMetrics.DEPENDS_ON).toBeDefined();
      expect(metrics.typeMetrics.CONTRASTS_WITH).toBeDefined();
      expect(metrics.typeMetrics.REFERENCES).toBeDefined();
      expect(metrics.typeMetrics.BELONGS_TO).toBeDefined();
    });
  });

  describe('validateThresholds', () => {
    it('임계값을 만족하면 passed가 true여야 함', () => {
      // Given: 임계값을 만족하는 메트릭
      const metrics = {
        precision: 0.8,
        recall: 0.75,
        f1Score: 0.77,
        truePositives: 10,
        falsePositives: 2,
        falseNegatives: 3,
        typeMetrics: {} as any,
        confidenceComplianceRate: 0.9,
        totalExpected: 13,
        totalExtracted: 12
      };

      const thresholds = {
        precision: 0.7,
        recall: 0.65,
        f1Score: 0.68
      };

      // When: 임계값 검증
      const result = validator.validateThresholds(metrics, thresholds);

      // Then: passed가 true
      expect(result.passed).toBe(true);
      expect(result.failures).toHaveLength(0);
    });

    it('임계값을 만족하지 않으면 failures에 포함되어야 함', () => {
      // Given: 임계값을 만족하지 않는 메트릭
      const metrics = {
        precision: 0.6, // 임계값 0.7 미만
        recall: 0.75,
        f1Score: 0.65, // 임계값 0.68 미만
        truePositives: 10,
        falsePositives: 2,
        falseNegatives: 3,
        typeMetrics: {} as any,
        confidenceComplianceRate: 0.9,
        totalExpected: 13,
        totalExtracted: 12
      };

      const thresholds = {
        precision: 0.7,
        recall: 0.65,
        f1Score: 0.68
      };

      // When: 임계값 검증
      const result = validator.validateThresholds(metrics, thresholds);

      // Then: passed가 false이고 failures에 포함
      expect(result.passed).toBe(false);
      expect(result.failures).toHaveLength(2);
      expect(result.failures.some(f => f.metric === 'precision')).toBe(true);
      expect(result.failures.some(f => f.metric === 'f1Score')).toBe(true);
    });
  });

  describe('관계 유형별 정확도 분석', () => {
    it('혼동 행렬을 올바르게 계산해야 함', () => {
      // Given: 혼동이 있는 매칭 결과
      const expectedRelations: ExpectedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          expected_relation_type: 'CAUSES',
          expected_confidence_range: [0.7, 0.9],
          source_content: '버그 발생',
          target_content: '시스템 오류'
        },
        {
          source_id: 'mem3',
          target_id: 'mem4',
          expected_relation_type: 'CAUSES',
          expected_confidence_range: [0.7, 0.9],
          source_content: '오류 발생',
          target_content: '복구 작업'
        },
        {
          source_id: 'mem5',
          target_id: 'mem6',
          expected_relation_type: 'FOLLOWS',
          expected_confidence_range: [0.8, 0.95],
          source_content: '설계 완료',
          target_content: '개발 시작'
        }
      ];

      const extractedRelations: ExtractedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          relation_type: 'CAUSES', // 올바른 분류
          confidence: 0.85
        },
        {
          source_id: 'mem3',
          target_id: 'mem4',
          relation_type: 'FOLLOWS', // 잘못된 분류 (CAUSES -> FOLLOWS)
          confidence: 0.8
        },
        {
          source_id: 'mem5',
          target_id: 'mem6',
          relation_type: 'FOLLOWS', // 올바른 분류
          confidence: 0.9
        }
      ];

      const matches = validator.matchRelations(expectedRelations, extractedRelations);

      // When: 혼동 행렬 계산
      const confusionMatrix = validator.calculateConfusionMatrix(matches);

      // Then: 혼동 행렬이 올바르게 계산되어야 함
      expect(confusionMatrix.matrix.CAUSES.CAUSES).toBe(1); // CAUSES -> CAUSES (올바름)
      expect(confusionMatrix.matrix.CAUSES.FOLLOWS).toBe(1); // CAUSES -> FOLLOWS (혼동)
      expect(confusionMatrix.matrix.FOLLOWS.FOLLOWS).toBe(1); // FOLLOWS -> FOLLOWS (올바름)
      
      // 전체 정확도 = 2 / 3 = 0.667
      expect(confusionMatrix.overallAccuracy).toBeCloseTo(2 / 3, 2);
      
      // CAUSES 정확도 = 1 / 2 = 0.5
      expect(confusionMatrix.typeAccuracy.CAUSES).toBeCloseTo(0.5, 2);
      
      // FOLLOWS 정확도 = 1 / 1 = 1.0
      expect(confusionMatrix.typeAccuracy.FOLLOWS).toBe(1.0);
    });

    it('관계 유형별 상세 분석을 올바르게 수행해야 함', () => {
      // Given: 복합적인 관계 데이터
      const expectedRelations: ExpectedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          expected_relation_type: 'CAUSES',
          expected_confidence_range: [0.7, 0.9],
          source_content: '버그 발생',
          target_content: '시스템 오류'
        },
        {
          source_id: 'mem3',
          target_id: 'mem4',
          expected_relation_type: 'CAUSES',
          expected_confidence_range: [0.7, 0.9],
          source_content: '오류 발생',
          target_content: '복구 작업'
        },
        {
          source_id: 'mem5',
          target_id: 'mem6',
          expected_relation_type: 'FOLLOWS',
          expected_confidence_range: [0.8, 0.95],
          source_content: '설계 완료',
          target_content: '개발 시작'
        }
      ];

      const extractedRelations: ExtractedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          relation_type: 'CAUSES',
          confidence: 0.85
        },
        {
          source_id: 'mem3',
          target_id: 'mem4',
          relation_type: 'FOLLOWS', // 잘못된 분류
          confidence: 0.8
        },
        {
          source_id: 'mem5',
          target_id: 'mem6',
          relation_type: 'FOLLOWS',
          confidence: 0.9
        },
        {
          source_id: 'mem7',
          target_id: 'mem8',
          relation_type: 'CAUSES', // False Positive
          confidence: 0.75
        }
      ];

      const matches = validator.matchRelations(expectedRelations, extractedRelations);

      // When: CAUSES 관계 유형별 상세 분석
      const analysis = validator.analyzeRelationType(
        matches,
        extractedRelations,
        expectedRelations,
        'CAUSES'
      );

      // Then: 상세 분석이 올바르게 수행되어야 함
      expect(analysis.relationType).toBe('CAUSES');
      expect(analysis.truePositives).toBe(1);
      expect(analysis.falsePositives).toBe(1);
      expect(analysis.falseNegatives).toBe(1);
      
      // 신뢰도 통계
      expect(analysis.averageConfidence).toBeCloseTo(0.8, 2); // (0.85 + 0.75) / 2
      expect(analysis.minConfidence).toBe(0.75);
      expect(analysis.maxConfidence).toBe(0.85);
      
      // 혼동 행렬: CAUSES가 FOLLOWS로 잘못 분류된 경우
      expect(analysis.confusionMatrix.FOLLOWS).toBe(1);
      expect(analysis.mostConfusedWith).toBe('FOLLOWS');
      expect(analysis.confusionRate).toBeGreaterThan(0);
    });

    it('모든 관계 유형별 상세 분석을 수행해야 함', () => {
      // Given: 다양한 관계 유형이 포함된 데이터
      const expectedRelations: ExpectedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          expected_relation_type: 'CAUSES',
          expected_confidence_range: [0.7, 0.9],
          source_content: '버그 발생',
          target_content: '시스템 오류'
        },
        {
          source_id: 'mem3',
          target_id: 'mem4',
          expected_relation_type: 'DEPENDS_ON',
          expected_confidence_range: [0.8, 0.95],
          source_content: 'API 개발',
          target_content: '스키마 설계'
        }
      ];

      const extractedRelations: ExtractedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          relation_type: 'CAUSES',
          confidence: 0.85
        },
        {
          source_id: 'mem3',
          target_id: 'mem4',
          relation_type: 'DEPENDS_ON',
          confidence: 0.9
        }
      ];

      const matches = validator.matchRelations(expectedRelations, extractedRelations);

      // When: 모든 관계 유형별 상세 분석
      const allAnalysis = validator.analyzeAllRelationTypes(
        matches,
        extractedRelations,
        expectedRelations
      );

      // Then: 모든 관계 유형에 대한 분석이 있어야 함
      expect(allAnalysis.CAUSES).toBeDefined();
      expect(allAnalysis.DEPENDS_ON).toBeDefined();
      expect(allAnalysis.FOLLOWS).toBeDefined();
      expect(allAnalysis.CONTRASTS_WITH).toBeDefined();
      expect(allAnalysis.REFERENCES).toBeDefined();
      expect(allAnalysis.BELONGS_TO).toBeDefined();

      // CAUSES 분석 확인
      expect(allAnalysis.CAUSES.relationType).toBe('CAUSES');
      expect(allAnalysis.CAUSES.truePositives).toBe(1);
    });

    it('calculateQualityMetricsWithAnalysis가 상세 분석을 포함해야 함', () => {
      // Given: 관계 데이터
      const expectedRelations: ExpectedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          expected_relation_type: 'CAUSES',
          expected_confidence_range: [0.7, 0.9],
          source_content: '버그 발생',
          target_content: '시스템 오류'
        },
        {
          source_id: 'mem3',
          target_id: 'mem4',
          expected_relation_type: 'FOLLOWS',
          expected_confidence_range: [0.8, 0.95],
          source_content: '설계 완료',
          target_content: '개발 시작'
        }
      ];

      const extractedRelations: ExtractedRelation[] = [
        {
          source_id: 'mem1',
          target_id: 'mem2',
          relation_type: 'CAUSES',
          confidence: 0.85
        },
        {
          source_id: 'mem3',
          target_id: 'mem4',
          relation_type: 'FOLLOWS',
          confidence: 0.9
        }
      ];

      // When: 상세 분석 포함 메트릭 계산
      const metrics = validator.calculateQualityMetricsWithAnalysis(
        expectedRelations,
        extractedRelations
      );

      // Then: 상세 분석이 포함되어야 함
      expect(metrics.typeAnalysis).toBeDefined();
      expect(metrics.confusionMatrix).toBeDefined();
      
      // 관계 유형별 분석 확인
      expect(metrics.typeAnalysis?.CAUSES).toBeDefined();
      expect(metrics.typeAnalysis?.FOLLOWS).toBeDefined();
      
      // 혼동 행렬 확인
      expect(metrics.confusionMatrix?.matrix).toBeDefined();
      expect(metrics.confusionMatrix?.overallAccuracy).toBeDefined();
      expect(metrics.confusionMatrix?.typeAccuracy).toBeDefined();
    });
  });
});
