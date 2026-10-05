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
