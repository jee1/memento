/**
 * 벡터 검색 품질 검증 헬퍼
 * 벡터 검색 결과 순서 보존 검증 및 품질 지표 비교
 * Consolidation 점수 반영 전/후 비교를 위한 지표 계산
 */

export { calculateKendallTau } from './vector-search-quality-metrics/kendall-tau.js';
export { calculateSpearmanRho } from './vector-search-quality-metrics/spearman.js';
export { calculateTopKRetention } from './vector-search-quality-metrics/top-k-retention.js';
export type {
  SearchResultPair,
  OrderPreservationMetrics,
  OrderPreservationReport,
} from './vector-search-quality-metrics/types.js';
export {
  generateVectorOnlySearchResults,
  generateConsolidationSearchResults,
  generateOrderPreservationReport,
  measureVectorOnlyQuality,
  measureConsolidationQuality,
  calculateQualityDegradation,
  validateQualityThresholds,
  compareQualityWithGroundTruth,
  generateQualityComparisonReport,
  visualizeQualityComparison,
  validateLowVectorHighConsolidation,
  validateHighVectorLowConsolidation,
  validateW2UpperBound,
  generateExtremeScenarioReport,
  saveBaselineSnapshot,
  loadBaselineSnapshot,
  compareWithBaseline,
  detectQualityDegradation,
  printQualityAlert,
  detectAndAlertQualityDegradation,
  generateGroundTruth,
  saveGroundTruth,
  loadGroundTruth,
  generateOrLoadGroundTruth,
  loadStrictBenchmarkGroundTruth,
  saveOrderPreservationReport,
  saveQualityComparisonReport,
  saveExtremeScenarioReport,
  saveIntegratedReport,
} from './vector-search-quality-metrics/report-comparison.js';
export type {
  QualityMetrics,
  QualityDegradation,
  QualityThresholdValidation,
  QualityComparison,
  QualityComparisonReport,
  ExtremeScenarioValidation,
  W2UpperBoundValidation,
  ExtremeScenarioReport,
  BaselineSnapshot,
  BaselineComparisonResult,
  QualityDegradationDetection,
  QualityAlertOptions,
  GroundTruthGenerationOptions,
  ReportSaveOptions,
  IntegratedReports,
} from './vector-search-quality-metrics/report-comparison.js';
export type { HybridSearchResult } from '../../domains/search/algorithms/hybrid-search-engine.js';
