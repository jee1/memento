import Database from 'better-sqlite3';
import { logger } from '../../../../shared/utils/logger.js';
import {
  RelationQualityValidator,
} from '../../../relation/services/relation-quality-validator.js';
import { ALL_RELATION_TYPES, type RelationType } from '../../../../shared/types/relation.js';
import type { CollectedMetrics, RelationMetricsOptions } from './quality-metrics-types.js';
import {
  QUALITY_METRIC_STATE,
  RELATION_QUALITY_METRIC_KEYS,
  buildUniformMetricStates,
  mergeMeasuredStates,
  type MetricDenominators,
} from './quality-metric-measurement.js';

function isRelationType(value: string): value is RelationType {
  return (ALL_RELATION_TYPES as readonly string[]).includes(value);
}

type ExtractedRelations = NonNullable<RelationMetricsOptions['extractedRelations']>;
type ExpectedRelations = NonNullable<RelationMetricsOptions['expectedRelations']>;

const SELECT_RELATIONS_SQL = `
  SELECT source_id, target_id, relation_type, confidence
  FROM memory_relation
  ORDER BY rowid
  LIMIT 1000
`;

/** 측정할 수 없을 때 쓰는 지표 키 (숫자 0 으로 채우지 않음) */
const UNMEASURED_RELATION_METRIC_STATES = buildUniformMetricStates(
  RELATION_QUALITY_METRIC_KEYS,
  QUALITY_METRIC_STATE.UNMEASURED_NO_GROUND_TRUTH
);

function defaultRelationNote(hasExtracted: boolean, hasExpected: boolean): string {
  if (hasExtracted && !hasExpected) {
    return '추출된 관계는 있지만 Ground Truth가 없어 precision/recall을 계산할 수 없습니다.';
  }
  if (!hasExtracted && hasExpected) {
    return 'Ground Truth는 있지만 추출된 관계가 없어 측정할 수 없습니다.';
  }
  return '예상 관계나 추출된 관계가 없어 기본값을 반환했습니다. 실제 측정을 위해서는 예상 관계와 추출된 관계가 필요합니다.';
}

function measureRelations(
  context: string,
  expectedRelations: ExpectedRelations,
  extractedRelations: ExtractedRelations
): CollectedMetrics {
  const qualityMetrics = new RelationQualityValidator().calculateQualityMetrics(
    expectedRelations,
    extractedRelations
  );

  const metrics: Record<string, number> = {
    precision: qualityMetrics.precision,
    recall: qualityMetrics.recall,
    f1_score: qualityMetrics.f1Score,
    true_positives: qualityMetrics.truePositives,
    false_positives: qualityMetrics.falsePositives,
    false_negatives: qualityMetrics.falseNegatives,
    confidence_compliance_rate: qualityMetrics.confidenceComplianceRate
  };

  // 관계 유형별 정확도 (Precision, Recall, F1-Score)
  const typePrecision: Record<string, number> = {};
  const typeRecall: Record<string, number> = {};
  const typeF1Score: Record<string, number> = {};
  for (const [relationType, typeMetric] of Object.entries(qualityMetrics.typeMetrics)) {
    typePrecision[relationType] = typeMetric.precision;
    typeRecall[relationType] = typeMetric.recall;
    typeF1Score[relationType] = typeMetric.f1Score;
  }

  logger.info('관계 추출 품질 지표 수집 완료', {
    context,
    precision: qualityMetrics.precision,
    recall: qualityMetrics.recall,
    f1_score: qualityMetrics.f1Score,
    expected_count: expectedRelations.length,
    extracted_count: extractedRelations.length
  });

  const precisionDenominator = qualityMetrics.truePositives + qualityMetrics.falsePositives;
  const recallDenominator = qualityMetrics.truePositives + qualityMetrics.falseNegatives;
  const metricDenominators: MetricDenominators = {
    precision: precisionDenominator,
    recall: recallDenominator,
    f1_score: null,
    true_positives: precisionDenominator,
    false_positives: precisionDenominator,
    false_negatives: recallDenominator,
    confidence_compliance_rate: qualityMetrics.truePositives,
  };
  const metricStateOverrides: Record<string, typeof QUALITY_METRIC_STATE[keyof typeof QUALITY_METRIC_STATE]> = {};
  if (precisionDenominator === 0) {
    metricStateOverrides.precision = QUALITY_METRIC_STATE.DENOMINATOR_ZERO;
    metricStateOverrides.f1_score = QUALITY_METRIC_STATE.DENOMINATOR_ZERO;
  }
  if (recallDenominator === 0) {
    metricStateOverrides.recall = QUALITY_METRIC_STATE.DENOMINATOR_ZERO;
  }

  return {
    namespace: 'relation',
    context,
    measured_at: new Date().toISOString(),
    metrics,
    metric_states: mergeMeasuredStates(metrics, metricStateOverrides),
    metric_denominators: metricDenominators,
    metadata: {
      has_ground_truth: true,
      expected_relations_count: expectedRelations.length,
      extracted_relations_count: extractedRelations.length,
      type_precision: typePrecision,
      type_recall: typeRecall,
      type_f1_score: typeF1Score
    }
  };
}

export class RelationMetricsCollector {
  constructor(private db: Database.Database) {}

  async collect(
    context: string = 'default',
    options?: RelationMetricsOptions
  ): Promise<CollectedMetrics> {
    // extractedRelations 자동 조회 (제공되지 않은 경우)
    let extractedRelations = options?.extractedRelations;
    if (!extractedRelations || extractedRelations.length === 0) {
      extractedRelations = this.loadExtractedRelations(context);
    }

    // 예상 관계와 추출된 관계가 제공된 경우 실제 측정 수행
    const expectedRelations = options?.expectedRelations;
    if (expectedRelations !== undefined && expectedRelations.length > 0) {
      return measureRelations(context, expectedRelations, extractedRelations ?? []);
    }

    const hasExtractedRelations = extractedRelations.length > 0;
    const hasExpectedRelations = expectedRelations !== undefined && expectedRelations.length > 0;

    if (hasExtractedRelations && !hasExpectedRelations) {
      const falsePositives = extractedRelations.length;
      const countMetrics: Record<string, number> = {
        true_positives: 0,
        false_positives: falsePositives,
        false_negatives: 0,
      };
      const metricStates = buildUniformMetricStates(
        RELATION_QUALITY_METRIC_KEYS,
        QUALITY_METRIC_STATE.UNMEASURED_NO_GROUND_TRUTH
      );
      metricStates.true_positives = QUALITY_METRIC_STATE.MEASURED;
      metricStates.false_positives = QUALITY_METRIC_STATE.MEASURED;
      metricStates.false_negatives = QUALITY_METRIC_STATE.MEASURED;
      metricStates.precision = QUALITY_METRIC_STATE.DENOMINATOR_ZERO;
      metricStates.recall = QUALITY_METRIC_STATE.UNMEASURED_NO_GROUND_TRUTH;
      metricStates.f1_score = QUALITY_METRIC_STATE.DENOMINATOR_ZERO;
      metricStates.confidence_compliance_rate = QUALITY_METRIC_STATE.UNMEASURED_NO_GROUND_TRUTH;

      logger.info('관계 추출 품질 지표 수집 완료 (Ground Truth 없음, FP 만 집계)', {
        context,
        extracted_relations_count: extractedRelations.length,
        false_positives: falsePositives,
      });

      return {
        namespace: 'relation',
        context,
        measured_at: new Date().toISOString(),
        metrics: countMetrics,
        metric_states: metricStates,
        metric_denominators: {
          false_positives: falsePositives,
          true_positives: falsePositives,
          false_negatives: 0,
          precision: falsePositives,
          recall: 0,
        },
        metadata: {
          has_ground_truth: false,
          extracted_relations_count: extractedRelations.length,
          expected_relations_count: 0,
          note: 'Ground Truth 없이 추출만 있어 precision/recall 은 미측정 또는 분모 0 으로 표시합니다.',
        },
      };
    }

    const note = defaultRelationNote(hasExtractedRelations, hasExpectedRelations);
    const expectedCount = expectedRelations?.length || 0;

    logger.info('관계 추출 품질 지표 수집 완료 (기본값)', {
      context,
      extracted_relations_count: extractedRelations.length,
      expected_relations_count: expectedCount,
      note
    });

    return {
      namespace: 'relation',
      context,
      measured_at: new Date().toISOString(),
      metrics: {},
      metric_states: { ...UNMEASURED_RELATION_METRIC_STATES },
      metadata: {
        has_ground_truth: hasExpectedRelations,
        extracted_relations_count: extractedRelations.length,
        expected_relations_count: expectedCount,
        note
      }
    };
  }

  /** memory_relation 에서 최대 1000건을 읽는다. 알 수 없는 relation_type 은 버리고, 실패하면 빈 배열. */
  private loadExtractedRelations(context: string): ExtractedRelations {
    try {
      const rows = this.db.prepare(SELECT_RELATIONS_SQL).all() as Array<{
        source_id: string;
        target_id: string;
        relation_type: string;
        confidence: number | null;
      }>;

      const relations = rows.flatMap(r => isRelationType(r.relation_type) ? [{
        source_id: r.source_id,
        target_id: r.target_id,
        relation_type: r.relation_type,
        confidence: r.confidence || 0
      }] : []);

      if (relations.length > 0) {
        logger.info('추출된 관계 자동 조회 완료', {
          context,
          count: relations.length
        });
      }
      return relations;
    } catch (error) {
      logger.warn('추출된 관계 조회 실패', {
        context,
        error: error instanceof Error ? error.message : String(error)
      });
      return [];
    }
  }
}
