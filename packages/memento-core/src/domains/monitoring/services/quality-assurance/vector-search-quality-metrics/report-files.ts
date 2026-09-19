/**
 * 벡터 검색 품질 검증 — 리포트 파일 저장
 * (#910: report-comparison.ts 에서 분리)
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import type { OrderPreservationReport } from './types.js';
import { reportOutputRoot } from './report-paths.js';
import { visualizeQualityComparison } from './report-quality-comparison.js';
import type { QualityComparisonReport } from './report-quality-comparison.js';
import type { ExtremeScenarioReport } from './report-extreme-scenarios.js';
import type { BaselineComparisonResult } from './report-baseline.js';
import type { QualityDegradationDetection } from './report-degradation-alerts.js';

const __dirname = reportOutputRoot;

/**
 * 리포트 저장 옵션
 */
export interface ReportSaveOptions {
  /**
   * 저장할 파일 경로 (기본값: 리포트 타입에 따라 자동 생성)
   */
  filePath?: string;
  
  /**
   * 저장 형식 ('json' | 'markdown' | 'both')
   */
  format?: 'json' | 'markdown' | 'both';
  
  /**
   * 파일명에 타임스탬프 포함 여부 (기본값: true)
   */
  includeTimestamp?: boolean;
}

/**
 * 순서 보존 리포트 저장
 * 순서 보존 리포트를 JSON 또는 Markdown 형식으로 파일에 저장합니다.
 * 
 * @param report 저장할 순서 보존 리포트
 * @param options 저장 옵션
 * 
 * @example
 * ```typescript
 * const report = generateOrderPreservationReport(pair);
 * saveOrderPreservationReport(report, { format: 'markdown' });
 * ```
 */
export function saveOrderPreservationReport(
  report: OrderPreservationReport,
  options: ReportSaveOptions = {}
): void {
  const {
    format = 'both',
    includeTimestamp = true
  } = options;
  
  const timestamp = includeTimestamp 
    ? `_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)}`
    : '';
  
  const defaultJsonPath = join(__dirname, `../../../data/order-preservation-report${timestamp}.json`);
  const defaultMarkdownPath = join(__dirname, `../../../data/order-preservation-report${timestamp}.md`);
  
  const jsonPath = options.filePath && format === 'json' 
    ? options.filePath 
    : format === 'both' 
      ? defaultJsonPath.replace('.md', '.json')
      : format === 'json'
        ? defaultJsonPath
        : undefined;
  
  const markdownPath = options.filePath && format === 'markdown'
    ? options.filePath
    : format === 'both'
      ? defaultMarkdownPath
      : format === 'markdown'
        ? defaultMarkdownPath
        : undefined;
  
  // 디렉토리 생성
  if (jsonPath) {
    const dir = dirname(jsonPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  
  if (markdownPath) {
    const dir = dirname(markdownPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  
  try {
    // JSON 형식 저장
    if (jsonPath) {
      const jsonContent = JSON.stringify(report, null, 2);
      writeFileSync(jsonPath, jsonContent, 'utf-8');
    }
    
    // Markdown 형식 저장
    if (markdownPath) {
      const markdownLines: string[] = [];
      markdownLines.push('# 순서 보존 검증 리포트');
      markdownLines.push('');
      markdownLines.push(`**생성 시간**: ${report.timestamp}`);
      markdownLines.push(`**검증 통과**: ${report.passed ? '[PASS] 통과' : '[FAIL] 실패'}`);
      markdownLines.push('');
      
      markdownLines.push('## 순서 보존 지표');
      markdownLines.push('');
      markdownLines.push('| 지표 | 값 |');
      markdownLines.push('|------|-----|');
      markdownLines.push(`| Kendall's Tau | ${report.metrics.kendallTau.toFixed(3)} |`);
      markdownLines.push(`| Top10 유지율 | ${(report.metrics.top10Retention * 100).toFixed(2)}% |`);
      markdownLines.push(`| Top5 유지율 | ${(report.metrics.top5Retention * 100).toFixed(2)}% |`);
      
      if (report.metrics.spearmanRho !== undefined) {
        markdownLines.push(`| Spearman's Rho | ${report.metrics.spearmanRho.toFixed(3)} |`);
      }
      
      markdownLines.push('');
      
      // 검증 결과
      markdownLines.push('## 검증 결과');
      markdownLines.push('');
      markdownLines.push('| 항목 | 임계값 | 실제 값 | 상태 |');
      markdownLines.push('|------|--------|---------|------|');
      
      const kendallTauStatus = report.metrics.kendallTau >= (report.thresholds?.kendallTauThreshold || 0.7)
        ? '[PASS] 통과'
        : '[FAIL] 실패';
      const top10Status = report.metrics.top10Retention >= (report.thresholds?.top10RetentionThreshold || 0.8)
        ? '[PASS] 통과'
        : '[FAIL] 실패';
      const top5Status = report.metrics.top5Retention >= (report.thresholds?.top5RetentionThreshold || 0.9)
        ? '[PASS] 통과'
        : '[FAIL] 실패';
      
      markdownLines.push(`| Kendall's Tau | ≥ ${(report.thresholds?.kendallTauThreshold || 0.7).toFixed(1)} | ${report.metrics.kendallTau.toFixed(3)} | ${kendallTauStatus} |`);
      markdownLines.push(`| Top10 유지율 | ≥ ${((report.thresholds?.top10RetentionThreshold || 0.8) * 100).toFixed(0)}% | ${(report.metrics.top10Retention * 100).toFixed(2)}% | ${top10Status} |`);
      markdownLines.push(`| Top5 유지율 | ≥ ${((report.thresholds?.top5RetentionThreshold || 0.9) * 100).toFixed(0)}% | ${(report.metrics.top5Retention * 100).toFixed(2)}% | ${top5Status} |`);
      markdownLines.push('');
      
      // 실패 사유
      if (report.failureReasons && report.failureReasons.length > 0) {
        markdownLines.push('### 실패 사유');
        markdownLines.push('');
        report.failureReasons.forEach(reason => {
          markdownLines.push(`- [FAIL] ${reason}`);
        });
        markdownLines.push('');
      }
      
      const markdownContent = markdownLines.join('\n');
      writeFileSync(markdownPath, markdownContent, 'utf-8');
    }
  } catch (error) {
    throw new Error(
      `순서 보존 리포트 저장 실패: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * 품질 비교 리포트 저장
 * 품질 비교 리포트를 JSON 또는 Markdown 형식으로 파일에 저장합니다.
 * 
 * @param report 저장할 품질 비교 리포트
 * @param options 저장 옵션
 * 
 * @example
 * ```typescript
 * const report = generateQualityComparisonReport(comparison, groundTruth);
 * saveQualityComparisonReport(report, { format: 'markdown' });
 * ```
 */
export function saveQualityComparisonReport(
  report: QualityComparisonReport,
  options: ReportSaveOptions = {}
): void {
  const {
    format = 'both',
    includeTimestamp = true
  } = options;
  
  const timestamp = includeTimestamp 
    ? `_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)}`
    : '';
  
  const defaultJsonPath = join(__dirname, `../../../data/quality-comparison-report${timestamp}.json`);
  const defaultMarkdownPath = join(__dirname, `../../../data/quality-comparison-report${timestamp}.md`);
  
  const jsonPath = options.filePath && format === 'json' 
    ? options.filePath 
    : format === 'both' 
      ? defaultJsonPath.replace('.md', '.json')
      : format === 'json'
        ? defaultJsonPath
        : undefined;
  
  const markdownPath = options.filePath && format === 'markdown'
    ? options.filePath
    : format === 'both'
      ? defaultMarkdownPath
      : format === 'markdown'
        ? defaultMarkdownPath
        : undefined;
  
  // 디렉토리 생성
  if (jsonPath) {
    const dir = dirname(jsonPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  
  if (markdownPath) {
    const dir = dirname(markdownPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  
  try {
    // JSON 형식 저장
    if (jsonPath) {
      const jsonContent = JSON.stringify(report, null, 2);
      writeFileSync(jsonPath, jsonContent, 'utf-8');
    }
    
    // Markdown 형식 저장 (기존 visualizeQualityComparison 함수 활용)
    if (markdownPath) {
      const markdownContent = visualizeQualityComparison(report);
      writeFileSync(markdownPath, markdownContent, 'utf-8');
    }
  } catch (error) {
    throw new Error(
      `품질 비교 리포트 저장 실패: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * 극단적 시나리오 리포트 저장
 * 극단적 시나리오 리포트를 JSON 또는 Markdown 형식으로 파일에 저장합니다.
 * 
 * @param report 저장할 극단적 시나리오 리포트
 * @param options 저장 옵션
 * 
 * @example
 * ```typescript
 * const report = generateExtremeScenarioReport(lowVectorHigh, highVectorLow, w2Validation);
 * saveExtremeScenarioReport(report, { format: 'markdown' });
 * ```
 */
export function saveExtremeScenarioReport(
  report: ExtremeScenarioReport,
  options: ReportSaveOptions = {}
): void {
  const {
    format = 'both',
    includeTimestamp = true
  } = options;
  
  const timestamp = includeTimestamp 
    ? `_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)}`
    : '';
  
  const defaultJsonPath = join(__dirname, `../../../data/extreme-scenario-report${timestamp}.json`);
  const defaultMarkdownPath = join(__dirname, `../../../data/extreme-scenario-report${timestamp}.md`);
  
  const jsonPath = options.filePath && format === 'json' 
    ? options.filePath 
    : format === 'both' 
      ? defaultJsonPath.replace('.md', '.json')
      : format === 'json'
        ? defaultJsonPath
        : undefined;
  
  const markdownPath = options.filePath && format === 'markdown'
    ? options.filePath
    : format === 'both'
      ? defaultMarkdownPath
      : format === 'markdown'
        ? defaultMarkdownPath
        : undefined;
  
  // 디렉토리 생성
  if (jsonPath) {
    const dir = dirname(jsonPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  
  if (markdownPath) {
    const dir = dirname(markdownPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  
  try {
    // JSON 형식 저장
    if (jsonPath) {
      const jsonContent = JSON.stringify(report, null, 2);
      writeFileSync(jsonPath, jsonContent, 'utf-8');
    }
    
    // Markdown 형식 저장
    if (markdownPath) {
      const markdownLines: string[] = [];
      markdownLines.push('# 극단적 시나리오 검증 리포트');
      markdownLines.push('');
      markdownLines.push(`**생성 시간**: ${report.timestamp}`);
      markdownLines.push(`**전체 검증 통과**: ${report.overallPassed ? '[PASS] 통과' : '[FAIL] 실패'}`);
      markdownLines.push('');
      
      markdownLines.push('## 검증 결과 요약');
      markdownLines.push('');
      markdownLines.push(`- **통과한 시나리오**: ${report.summary.passedCount} / ${report.summary.totalCount}`);
      markdownLines.push(`- **실패한 시나리오**: ${report.summary.failedScenarios.length}`);
      markdownLines.push('');
      
      if (report.summary.failedScenarios.length > 0) {
        markdownLines.push('### 실패한 시나리오');
        markdownLines.push('');
        report.summary.failedScenarios.forEach(scenario => {
          markdownLines.push(`- [FAIL] ${scenario}`);
        });
        markdownLines.push('');
      }
      
      // 저벡터 유사도 + 고 consolidation 점수 검증
      markdownLines.push('## 저벡터 유사도 + 고 consolidation 점수 검증');
      markdownLines.push('');
      markdownLines.push(`**검증 통과**: ${report.lowVectorHighConsolidation.passed ? '[PASS] 통과' : '[FAIL] 실패'}`);
      markdownLines.push('');
      markdownLines.push('| 지표 | 값 |');
      markdownLines.push('|------|-----|');
      markdownLines.push(`| 최종 점수 범위 | ${report.lowVectorHighConsolidation.finalScoreRange.min.toFixed(3)} ~ ${report.lowVectorHighConsolidation.finalScoreRange.max.toFixed(3)} |`);
      markdownLines.push(`| 최종 점수 평균 | ${report.lowVectorHighConsolidation.finalScoreRange.average.toFixed(3)} |`);
      markdownLines.push(`| 벡터 유사도 평균 | ${report.lowVectorHighConsolidation.vectorSimilarityStats.average.toFixed(3)} |`);
      markdownLines.push(`| Consolidation 점수 평균 | ${report.lowVectorHighConsolidation.consolidationScoreStats.average.toFixed(3)} |`);
      markdownLines.push('');
      
      if (report.lowVectorHighConsolidation.failureReasons && report.lowVectorHighConsolidation.failureReasons.length > 0) {
        markdownLines.push('### 실패 사유');
        markdownLines.push('');
        report.lowVectorHighConsolidation.failureReasons.forEach(reason => {
          markdownLines.push(`- [FAIL] ${reason}`);
        });
        markdownLines.push('');
      }
      
      // 고벡터 유사도 + 저 consolidation 점수 검증
      markdownLines.push('## 고벡터 유사도 + 저 consolidation 점수 검증');
      markdownLines.push('');
      markdownLines.push(`**검증 통과**: ${report.highVectorLowConsolidation.passed ? '[PASS] 통과' : '[FAIL] 실패'}`);
      markdownLines.push('');
      markdownLines.push('| 지표 | 값 |');
      markdownLines.push('|------|-----|');
      markdownLines.push(`| 최종 점수 범위 | ${report.highVectorLowConsolidation.finalScoreRange.min.toFixed(3)} ~ ${report.highVectorLowConsolidation.finalScoreRange.max.toFixed(3)} |`);
      markdownLines.push(`| 최종 점수 평균 | ${report.highVectorLowConsolidation.finalScoreRange.average.toFixed(3)} |`);
      markdownLines.push(`| 벡터 유사도 평균 | ${report.highVectorLowConsolidation.vectorSimilarityStats.average.toFixed(3)} |`);
      markdownLines.push(`| Consolidation 점수 평균 | ${report.highVectorLowConsolidation.consolidationScoreStats.average.toFixed(3)} |`);
      markdownLines.push('');
      
      if (report.highVectorLowConsolidation.failureReasons && report.highVectorLowConsolidation.failureReasons.length > 0) {
        markdownLines.push('### 실패 사유');
        markdownLines.push('');
        report.highVectorLowConsolidation.failureReasons.forEach(reason => {
          markdownLines.push(`- [FAIL] ${reason}`);
        });
        markdownLines.push('');
      }
      
      // w2 상한 검증
      markdownLines.push('## w2 상한 검증');
      markdownLines.push('');
      markdownLines.push(`**검증 통과**: ${report.w2UpperBound.passed ? '[PASS] 통과' : '[FAIL] 실패'}`);
      markdownLines.push('');
      
      if (report.w2UpperBound.w2_04 && report.w2UpperBound.w2_06) {
        markdownLines.push('| 지표 | w2=0.4 | w2=0.6 | 품질 저하 |');
        markdownLines.push('|------|--------|--------|----------|');
        
        const kValues = Object.keys(report.w2UpperBound.w2_04.ndcg || {}).map(Number);
        kValues.forEach(k => {
          const ndcg4 = report.w2UpperBound.w2_04.ndcg[k] || 0;
          const ndcg6 = report.w2UpperBound.w2_06.ndcg[k] || 0;
          const degradation = report.w2UpperBound.degradation?.ndcg?.[k] || 0;
          markdownLines.push(`| NDCG@${k} | ${ndcg4.toFixed(3)} | ${ndcg6.toFixed(3)} | ${(degradation * 100).toFixed(2)}% |`);
        });
        markdownLines.push('');
      }
      
      if (report.w2UpperBound.failureReasons && report.w2UpperBound.failureReasons.length > 0) {
        markdownLines.push('### 실패 사유');
        markdownLines.push('');
        report.w2UpperBound.failureReasons.forEach(reason => {
          markdownLines.push(`- [FAIL] ${reason}`);
        });
        markdownLines.push('');
      }
      
      const markdownContent = markdownLines.join('\n');
      writeFileSync(markdownPath, markdownContent, 'utf-8');
    }
  } catch (error) {
    throw new Error(
      `극단적 시나리오 리포트 저장 실패: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * 통합 리포트 저장
 * 모든 리포트(순서 보존, 품질 비교, 극단적 시나리오)를 하나의 파일로 저장합니다.
 * 
 * @param reports 저장할 리포트들
 * @param options 저장 옵션
 * 
 * @example
 * ```typescript
 * const orderReport = generateOrderPreservationReport(pair);
 * const qualityReport = generateQualityComparisonReport(comparison, groundTruth);
 * const extremeReport = generateExtremeScenarioReport(lowVectorHigh, highVectorLow, w2Validation);
 * saveIntegratedReport({ orderReport, qualityReport, extremeReport }, { format: 'markdown' });
 * ```
 */
export interface IntegratedReports {
  orderReport?: OrderPreservationReport;
  qualityReport?: QualityComparisonReport;
  extremeReport?: ExtremeScenarioReport;
  baselineComparison?: BaselineComparisonResult;
  qualityDegradation?: QualityDegradationDetection;
}

export function saveIntegratedReport(
  reports: IntegratedReports,
  options: ReportSaveOptions = {}
): void {
  const {
    format = 'both',
    includeTimestamp = true
  } = options;
  
  const timestamp = includeTimestamp 
    ? `_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)}`
    : '';
  
  const defaultJsonPath = join(__dirname, `../../../data/vector-search-quality-report${timestamp}.json`);
  const defaultMarkdownPath = join(__dirname, `../../../data/vector-search-quality-report${timestamp}.md`);
  
  const jsonPath = options.filePath && format === 'json' 
    ? options.filePath 
    : format === 'both' 
      ? defaultJsonPath.replace('.md', '.json')
      : format === 'json'
        ? defaultJsonPath
        : undefined;
  
  const markdownPath = options.filePath && format === 'markdown'
    ? options.filePath
    : format === 'both'
      ? defaultMarkdownPath
      : format === 'markdown'
        ? defaultMarkdownPath
        : undefined;
  
  // 디렉토리 생성
  if (jsonPath) {
    const dir = dirname(jsonPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  
  if (markdownPath) {
    const dir = dirname(markdownPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  
  try {
    // JSON 형식 저장
    if (jsonPath) {
      const jsonContent = JSON.stringify(reports, null, 2);
      writeFileSync(jsonPath, jsonContent, 'utf-8');
    }
    
    // Markdown 형식 저장
    if (markdownPath) {
      const markdownLines: string[] = [];
      markdownLines.push('# 벡터 검색 품질 검증 통합 리포트');
      markdownLines.push('');
      markdownLines.push(`**생성 시간**: ${new Date().toISOString()}`);
      markdownLines.push('');
      
      // 순서 보존 리포트
      if (reports.orderReport) {
        markdownLines.push('## 1. 순서 보존 검증');
        markdownLines.push('');
        markdownLines.push(`**검증 통과**: ${reports.orderReport.passed ? '[PASS] 통과' : '[FAIL] 실패'}`);
        markdownLines.push('');
        markdownLines.push('| 지표 | 값 |');
        markdownLines.push('|------|-----|');
        markdownLines.push(`| Kendall's Tau | ${reports.orderReport.metrics.kendallTau.toFixed(3)} |`);
        markdownLines.push(`| Top10 유지율 | ${(reports.orderReport.metrics.top10Retention * 100).toFixed(2)}% |`);
        markdownLines.push(`| Top5 유지율 | ${(reports.orderReport.metrics.top5Retention * 100).toFixed(2)}% |`);
        markdownLines.push('');
      }
      
      // 품질 비교 리포트
      if (reports.qualityReport) {
        markdownLines.push('## 2. 품질 지표 비교');
        markdownLines.push('');
        const qualityMarkdown = visualizeQualityComparison(reports.qualityReport);
        // 헤더 제거하고 내용만 추가
        const qualityContent = qualityMarkdown.split('\n').slice(1).join('\n');
        markdownLines.push(qualityContent);
        markdownLines.push('');
      }
      
      // 극단적 시나리오 리포트
      if (reports.extremeReport) {
        markdownLines.push('## 3. 극단적 시나리오 검증');
        markdownLines.push('');
        markdownLines.push(`**전체 검증 통과**: ${reports.extremeReport.overallPassed ? '[PASS] 통과' : '[FAIL] 실패'}`);
        markdownLines.push('');
        markdownLines.push(`- **통과한 시나리오**: ${reports.extremeReport.summary.passedCount} / ${reports.extremeReport.summary.totalCount}`);
        if (reports.extremeReport.summary.failedScenarios.length > 0) {
          markdownLines.push(`- **실패한 시나리오**: ${reports.extremeReport.summary.failedScenarios.join(', ')}`);
        }
        markdownLines.push('');
      }
      
      // Baseline 비교 결과
      if (reports.baselineComparison) {
        markdownLines.push('## 4. Baseline 비교');
        markdownLines.push('');
        markdownLines.push(`**Baseline 버전**: ${reports.baselineComparison.baseline.version}`);
        markdownLines.push(`**Baseline 생성 시간**: ${reports.baselineComparison.baseline.timestamp}`);
        markdownLines.push(`**품질 저하 감지**: ${reports.baselineComparison.hasDegradation ? '[WARNING] 감지됨' : '[PASS] 없음'}`);
        markdownLines.push('');
        
        if (reports.baselineComparison.degradationDetails.length > 0) {
          markdownLines.push('### 저하 상세');
          markdownLines.push('');
          reports.baselineComparison.degradationDetails.forEach(detail => {
            markdownLines.push(`- [WARNING] ${detail}`);
          });
          markdownLines.push('');
        }
      }
      
      // 품질 저하 감지 결과
      if (reports.qualityDegradation) {
        markdownLines.push('## 5. 품질 저하 감지');
        markdownLines.push('');
        markdownLines.push(`**감지 여부**: ${reports.qualityDegradation.detected ? '[WARNING] 감지됨' : '[PASS] 없음'}`);
        markdownLines.push(`**심각도**: ${reports.qualityDegradation.severity}`);
        markdownLines.push('');
        
        if (reports.qualityDegradation.messages.length > 0) {
          markdownLines.push('### 경고 메시지');
          markdownLines.push('');
          reports.qualityDegradation.messages.forEach(message => {
            markdownLines.push(`- ${message}`);
          });
          markdownLines.push('');
        }
        
        if (reports.qualityDegradation.recommendations.length > 0) {
          markdownLines.push('### 권장사항');
          markdownLines.push('');
          reports.qualityDegradation.recommendations.forEach(recommendation => {
            markdownLines.push(`- ${recommendation}`);
          });
          markdownLines.push('');
        }
      }
      
      const markdownContent = markdownLines.join('\n');
      writeFileSync(markdownPath, markdownContent, 'utf-8');
    }
  } catch (error) {
    throw new Error(
      `통합 리포트 저장 실패: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
