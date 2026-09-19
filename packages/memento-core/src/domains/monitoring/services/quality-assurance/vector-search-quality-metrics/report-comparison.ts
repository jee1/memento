/**
 * 벡터 검색 품질 검증 리포트 및 비교 로직 — 공개 표면
 *
 * 구현은 아래 형제 모듈에 있다. 이 파일은 기존 import 경로를 그대로 유지하기
 * 위한 재export 지점이다 (#910).
 *
 * `export *` 로 바꾸지 말 것. measureConsolidationQuality 와
 * calculateQualityDegradation 은 모듈 사이에서만 쓰는 내부 함수인데,
 * `export *` 를 쓰면 그 둘까지 공개 표면에 실린다.
 */

export {
  generateVectorOnlySearchResults,
  generateConsolidationSearchResults,
  generateOrderPreservationReport,
} from './report-search-results.js';

export {
  compareQualityWithGroundTruth,
  generateQualityComparisonReport,
  visualizeQualityComparison,
} from './report-quality-comparison.js';
export type {
  QualityMetrics,
  QualityDegradation,
  QualityThresholdValidation,
  QualityComparison,
  QualityComparisonReport,
} from './report-quality-comparison.js';

export {
  validateLowVectorHighConsolidation,
  validateHighVectorLowConsolidation,
  validateW2UpperBound,
  generateExtremeScenarioReport,
} from './report-extreme-scenarios.js';
export type {
  ExtremeScenarioValidation,
  W2UpperBoundValidation,
  ExtremeScenarioReport,
} from './report-extreme-scenarios.js';

export {
  saveBaselineSnapshot,
  loadBaselineSnapshot,
  compareWithBaseline,
} from './report-baseline.js';
export type {
  BaselineSnapshot,
  BaselineComparisonResult,
} from './report-baseline.js';

export {
  detectQualityDegradation,
  printQualityAlert,
  detectAndAlertQualityDegradation,
} from './report-degradation-alerts.js';
export type {
  QualityDegradationDetection,
  QualityAlertOptions,
} from './report-degradation-alerts.js';

export {
  generateGroundTruth,
  saveGroundTruth,
  loadGroundTruth,
  generateOrLoadGroundTruth,
} from './report-ground-truth.js';
export type { GroundTruthGenerationOptions } from './report-ground-truth.js';

export {
  saveOrderPreservationReport,
  saveQualityComparisonReport,
  saveExtremeScenarioReport,
  saveIntegratedReport,
} from './report-files.js';
export type {
  ReportSaveOptions,
  IntegratedReports,
} from './report-files.js';
