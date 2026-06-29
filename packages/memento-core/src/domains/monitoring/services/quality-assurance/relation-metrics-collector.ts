import Database from 'better-sqlite3';
import { logger } from '../../../../shared/utils/logger.js';
import {
  RelationQualityValidator,
} from '../../../relation/services/relation-quality-validator.js';
import type { CollectedMetrics, RelationMetricsOptions } from './quality-metrics-types.js';

export class RelationMetricsCollector {
  constructor(private db: Database.Database) {}

  async collect(
    context: string = 'default',
    options?: RelationMetricsOptions
  ): Promise<CollectedMetrics> {
    const metrics: Record<string, number> = {};

    // extractedRelations 자동 조회 (제공되지 않은 경우)
    let extractedRelations = options?.extractedRelations;
    if (!extractedRelations || extractedRelations.length === 0) {
      try {
        const relationsResult = this.db.prepare(`
          SELECT source_id, target_id, relation_type, confidence
          FROM memory_relation
          LIMIT 1000
        `).all() as Array<{
          source_id: string;
          target_id: string;
          relation_type: string;
          confidence: number | null;
        }>;

        extractedRelations = relationsResult.map(r => ({
          source_id: r.source_id,
          target_id: r.target_id,
          relation_type: r.relation_type as any,
          confidence: r.confidence || 0
        }));

        if (extractedRelations.length > 0) {
          logger.info('추출된 관계 자동 조회 완료', {
            context,
            count: extractedRelations.length
          });
        }
      } catch (error) {
        logger.warn('추출된 관계 조회 실패', {
          context,
          error: error instanceof Error ? error.message : String(error)
        });
        extractedRelations = [];
      }
    }

    // 예상 관계와 추출된 관계가 제공된 경우 실제 측정 수행
    if (options?.expectedRelations && extractedRelations && extractedRelations.length > 0) {
      const expectedRelations = options.expectedRelations;
      const validator = new RelationQualityValidator();

      // 전체 품질 메트릭 계산
      const qualityMetrics = validator.calculateQualityMetrics(
        expectedRelations,
        extractedRelations
      );

      // 전체 메트릭
      metrics.precision = qualityMetrics.precision;
      metrics.recall = qualityMetrics.recall;
      metrics.f1_score = qualityMetrics.f1Score;
      metrics.true_positives = qualityMetrics.truePositives;
      metrics.false_positives = qualityMetrics.falsePositives;
      metrics.false_negatives = qualityMetrics.falseNegatives;
      metrics.confidence_compliance_rate = qualityMetrics.confidenceComplianceRate;

      // 관계 유형별 정확도 (Precision, Recall, F1-Score)
      const typePrecision: Record<string, number> = {};
      const typeRecall: Record<string, number> = {};
      const typeF1Score: Record<string, number> = {};

      for (const [relationType, typeMetric] of Object.entries(qualityMetrics.typeMetrics)) {
        typePrecision[relationType] = typeMetric.precision;
        typeRecall[relationType] = typeMetric.recall;
        typeF1Score[relationType] = typeMetric.f1Score;
      }

      // 메타데이터에 관계 유형별 정확도 포함
      const metadata: Record<string, any> = {
        has_ground_truth: true,
        expected_relations_count: expectedRelations.length,
        extracted_relations_count: extractedRelations.length,
        type_precision: typePrecision,
        type_recall: typeRecall,
        type_f1_score: typeF1Score
      };

      logger.info('관계 추출 품질 지표 수집 완료', {
        context,
        precision: qualityMetrics.precision,
        recall: qualityMetrics.recall,
        f1_score: qualityMetrics.f1Score,
        expected_count: expectedRelations.length,
        extracted_count: extractedRelations.length
      });

      return {
        namespace: 'relation',
        context,
        measured_at: new Date().toISOString(),
        metrics,
        metadata
      };
    } else {
      // 예상 관계나 추출된 관계가 없으면 기본값 반환
      metrics.precision = 0;
      metrics.recall = 0;
      metrics.f1_score = 0;
      metrics.true_positives = 0;
      metrics.false_positives = 0;
      metrics.false_negatives = 0;
      metrics.confidence_compliance_rate = 0;

      const hasExtractedRelations = extractedRelations && extractedRelations.length > 0;
      const hasExpectedRelations = options?.expectedRelations && options.expectedRelations.length > 0;

      logger.info('관계 추출 품질 지표 수집 완료 (기본값)', {
        context,
        extracted_relations_count: extractedRelations?.length || 0,
        expected_relations_count: options?.expectedRelations?.length || 0,
        note: hasExtractedRelations && !hasExpectedRelations
          ? '추출된 관계는 있지만 Ground Truth가 없어 precision/recall을 계산할 수 없습니다.'
          : !hasExtractedRelations && hasExpectedRelations
          ? 'Ground Truth는 있지만 추출된 관계가 없어 측정할 수 없습니다.'
          : '예상 관계나 추출된 관계가 없어 기본값을 반환했습니다. 실제 측정을 위해서는 예상 관계와 추출된 관계가 필요합니다.'
      });

      return {
        namespace: 'relation',
        context,
        measured_at: new Date().toISOString(),
        metrics,
        metadata: {
          has_ground_truth: hasExpectedRelations || false,
          extracted_relations_count: extractedRelations?.length || 0,
          expected_relations_count: options?.expectedRelations?.length || 0,
          note: hasExtractedRelations && !hasExpectedRelations
            ? '추출된 관계는 있지만 Ground Truth가 없어 precision/recall을 계산할 수 없습니다.'
            : !hasExtractedRelations && hasExpectedRelations
            ? 'Ground Truth는 있지만 추출된 관계가 없어 측정할 수 없습니다.'
            : '예상 관계나 추출된 관계가 없어 기본값을 반환했습니다. 실제 측정을 위해서는 예상 관계와 추출된 관계가 필요합니다.'
        }
      };
    }
  }
}
