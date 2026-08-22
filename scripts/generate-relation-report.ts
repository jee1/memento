#!/usr/bin/env node
import { parseArgs as parseCliArgs, openDb, type CliDatabase } from './lib/cli.js';
/**
 * 관계 추출 품질 리포트 생성 스크립트
 * PR 리뷰 시 "Relation Extraction Report" 자동 생성
 * 
 * 사용법:
 *   npm run generate-relation-report
 *   npm run generate-relation-report -- --output report.md
 *   npm run generate-relation-report -- --method hybrid
 *   npm run generate-relation-report -- --sample 50
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  RelationExtractor,
  RelationQualityValidator,
  DatabaseUtils,
  RelationEngineSchemaMigration,
  type ExpectedRelation,
  type ExtractedRelation,
  type MemoryItem,
} from '@memento/core';

/**
 * 명령줄 인자 파싱
 */
interface CliOptions {
  output?: string;
  method?: 'rule' | 'llm' | 'hybrid';
  sample?: number;
  minConfidence?: number;
  ci?: boolean;
  allowSoftFail?: boolean;
}

function parseArgs(): CliOptions {
  const args = parseCliArgs().args;
  const options: CliOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--output' && args[i + 1]) {
      options.output = args[i + 1];
      i++;
    } else if (arg === '--method' && args[i + 1]) {
      const method = args[i + 1] as 'rule' | 'llm' | 'hybrid';
      if (['rule', 'llm', 'hybrid'].includes(method)) {
        options.method = method;
      }
      i++;
    } else if (arg === '--sample' && args[i + 1]) {
      options.sample = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--min-confidence' && args[i + 1]) {
      options.minConfidence = parseFloat(args[i + 1]);
      i++;
    } else if (arg === '--ci') {
      options.ci = true;
    } else if (arg === '--allow-soft-fail') {
      options.allowSoftFail = true;
    }
  }

  return options;
}

/**
 * 테스트 데이터셋 로드
 */
function loadTestDataset(sampleSize?: number): ExpectedRelation[] {
  const testsetPath = join(process.cwd(), 'tests', 'fixtures', 'relation_testset.json');
  const testsetContent = readFileSync(testsetPath, 'utf-8');
  const testset = JSON.parse(testsetContent) as Array<{
    source_id: string;
    target_id: string;
    expected_relation_type: string;
    expected_confidence_range: [number, number];
    source_content: string;
    target_content: string;
  }>;

  const relations = testset.map(item => ({
    source_id: item.source_id,
    target_id: item.target_id,
    expected_relation_type: item.expected_relation_type as any,
    expected_confidence_range: item.expected_confidence_range,
    source_content: item.source_content,
    target_content: item.target_content
  }));

  // 샘플링이 요청된 경우 랜덤 샘플링
  if (sampleSize && sampleSize < relations.length) {
    const shuffled = [...relations].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, sampleSize);
  }

  return relations;
}

/**
 * 테스트용 기본 스키마 생성
 */
function createBaseSchema(db: CliDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_item (
      id TEXT PRIMARY KEY,
      type TEXT CHECK (type IN ('working','episodic','semantic','procedural')) NOT NULL,
      content TEXT NOT NULL,
      importance REAL CHECK (importance >= 0 AND importance <= 1) DEFAULT 0.5,
      privacy_scope TEXT CHECK (privacy_scope IN ('private','team','public')) DEFAULT 'private',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_accessed TIMESTAMP,
      pinned BOOLEAN DEFAULT FALSE,
      tags TEXT,
      source TEXT,
      view_count INTEGER DEFAULT 0,
      cite_count INTEGER DEFAULT 0,
      edit_count INTEGER DEFAULT 0
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memento_schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/**
 * 테스트용 메모리 생성
 */
function createTestMemory(
  db: CliDatabase,
  id: string,
  content: string,
  type: string = 'episodic'
): void {
  DatabaseUtils.run(db, `
    INSERT INTO memory_item (id, type, content)
    VALUES (?, ?, ?)
  `, [id, type, content]);
}

/**
 * 관계 추출 수행
 */
async function extractRelations(
  testDataset: ExpectedRelation[],
  relationExtractor: RelationExtractor,
  method: 'rule' | 'llm' | 'hybrid',
  minConfidence: number
): Promise<ExtractedRelation[]> {
  const memoryMap = new Map<string, MemoryItem>();
  
  // 모든 메모리 생성
  for (const testCase of testDataset) {
    if (!memoryMap.has(testCase.source_id)) {
      memoryMap.set(testCase.source_id, {
        id: testCase.source_id,
        type: 'episodic',
        content: testCase.source_content,
        importance: 0.5,
        privacy_scope: 'private',
        created_at: new Date().toISOString()
      });
    }
    
    if (!memoryMap.has(testCase.target_id)) {
      memoryMap.set(testCase.target_id, {
        id: testCase.target_id,
        type: 'episodic',
        content: testCase.target_content,
        importance: 0.5,
        privacy_scope: 'private',
        created_at: new Date().toISOString()
      });
    }
  }

  // 소스 메모리별로 그룹화
  const sourceGroups = new Map<string, ExpectedRelation[]>();
  for (const testCase of testDataset) {
    if (!sourceGroups.has(testCase.source_id)) {
      sourceGroups.set(testCase.source_id, []);
    }
    sourceGroups.get(testCase.source_id)!.push(testCase);
  }

  // 관계 추출 수행
  const extractedRelations: ExtractedRelation[] = [];
  
  for (const [sourceId, testCases] of sourceGroups.entries()) {
    const sourceMemory = memoryMap.get(sourceId)!;
    const targetMemories = testCases.map(tc => memoryMap.get(tc.target_id)!).filter(Boolean);
    
    if (targetMemories.length > 0) {
      try {
        const candidates = await relationExtractor.extractRelations(
          sourceMemory,
          targetMemories,
          { method, minConfidence }
        );

        for (const candidate of candidates) {
          extractedRelations.push({
            source_id: candidate.source_id,
            target_id: candidate.target_id,
            relation_type: candidate.relation_type,
            confidence: candidate.confidence
          });
        }
      } catch (error) {
        console.warn(`관계 추출 실패: ${sourceId}`, error);
      }
    }
  }

  return extractedRelations;
}

/**
 * Markdown 리포트 생성
 */
function generateMarkdownReport(
  metrics: any,
  options: CliOptions,
  qualityValidator: RelationQualityValidator
): string {
  const timestamp = new Date().toISOString();
  const method = options.method || 'hybrid';
  const sampleSize = options.sample || '전체';
  
  let report = `# Relation Extraction Quality Report\n\n`;
  report += `**생성 일시**: ${timestamp}\n`;
  report += `**추출 방법**: ${method}\n`;
  report += `**샘플 크기**: ${sampleSize}\n`;
  report += `**최소 신뢰도**: ${options.minConfidence || 0.5}\n\n`;
  report += `---\n\n`;

  // 전체 메트릭
  report += `## 전체 메트릭\n\n`;
  report += `| 메트릭 | 값 |\n`;
  report += `|--------|-----|\n`;
  report += `| **Precision** | ${(metrics.precision * 100).toFixed(2)}% |\n`;
  report += `| **Recall** | ${(metrics.recall * 100).toFixed(2)}% |\n`;
  report += `| **F1-Score** | ${(metrics.f1Score * 100).toFixed(2)}% |\n`;
  report += `| **신뢰도 준수율** | ${(metrics.confidenceComplianceRate * 100).toFixed(2)}% |\n`;
  report += `| **예상 관계 수** | ${metrics.totalExpected} |\n`;
  report += `| **추출된 관계 수** | ${metrics.totalExtracted} |\n`;
  report += `| **True Positives** | ${metrics.truePositives} |\n`;
  report += `| **False Positives** | ${metrics.falsePositives} |\n`;
  report += `| **False Negatives** | ${metrics.falseNegatives} |\n\n`;

  // 관계 유형별 메트릭
  report += `## 관계 유형별 메트릭\n\n`;
  report += `| 관계 유형 | Precision | Recall | F1-Score | TP | FP | FN |\n`;
  report += `|----------|-----------|--------|----------|----|----|----|\n`;
  
  const relationTypes = ['CAUSES', 'DEPENDS_ON', 'FOLLOWS', 'CONTRASTS_WITH', 'REFERENCES', 'BELONGS_TO'] as const;
  for (const type of relationTypes) {
    const typeMetrics = metrics.typeMetrics[type];
    if (typeMetrics) {
      report += `| **${type}** | ${(typeMetrics.precision * 100).toFixed(2)}% | ${(typeMetrics.recall * 100).toFixed(2)}% | ${(typeMetrics.f1Score * 100).toFixed(2)}% | ${typeMetrics.truePositives} | ${typeMetrics.falsePositives} | ${typeMetrics.falseNegatives} |\n`;
    } else {
      report += `| **${type}** | - | - | - | - | - | - |\n`;
    }
  }
  report += `\n`;

  // 상세 분석이 있는 경우
  if (metrics.typeAnalysis) {
    report += `## 관계 유형별 상세 분석\n\n`;
    
    for (const type of relationTypes) {
      const analysis = metrics.typeAnalysis[type];
      if (analysis) {
        report += `### ${type}\n\n`;
        report += `- **Precision**: ${(analysis.precision * 100).toFixed(2)}%\n`;
        report += `- **Recall**: ${(analysis.recall * 100).toFixed(2)}%\n`;
        report += `- **F1-Score**: ${(analysis.f1Score * 100).toFixed(2)}%\n`;
        report += `- **평균 신뢰도**: ${analysis.averageConfidence.toFixed(3)}\n`;
        report += `- **최소 신뢰도**: ${analysis.minConfidence.toFixed(3)}\n`;
        report += `- **최대 신뢰도**: ${analysis.maxConfidence.toFixed(3)}\n`;
        report += `- **신뢰도 표준편차**: ${analysis.confidenceStdDev.toFixed(3)}\n`;
        
        if (analysis.mostConfusedWith !== null) {
          report += `- **가장 많이 혼동되는 유형**: ${analysis.mostConfusedWith}\n`;
          report += `- **혼동률**: ${(analysis.confusionRate * 100).toFixed(2)}%\n`;
        }
        
        report += `\n`;
      }
    }
  }

  // 혼동 행렬이 있는 경우
  if (metrics.confusionMatrix) {
    report += `## 혼동 행렬\n\n`;
    report += `**전체 정확도**: ${(metrics.confusionMatrix.overallAccuracy * 100).toFixed(2)}%\n\n`;
    
    report += `### 관계 유형별 정확도\n\n`;
    report += `| 관계 유형 | 정확도 |\n`;
    report += `|----------|--------|\n`;
    for (const type of relationTypes) {
      const accuracy = metrics.confusionMatrix.typeAccuracy[type];
      if (accuracy !== undefined) {
        report += `| **${type}** | ${(accuracy * 100).toFixed(2)}% |\n`;
      }
    }
    report += `\n`;
  }

  // 임계값 검증
  const thresholds = {
    precision: 0.70,
    recall: 0.65,
    f1Score: 0.68
  };
  
  report += `## 임계값 검증\n\n`;
  report += `| 메트릭 | 임계값 | 실제 값 | 상태 |\n`;
  report += `|--------|--------|---------|------|\n`;
  report += `| **Precision** | ${(thresholds.precision * 100).toFixed(2)}% | ${(metrics.precision * 100).toFixed(2)}% | ${metrics.precision >= thresholds.precision ? '✅ 통과' : '❌ 실패'} |\n`;
  report += `| **Recall** | ${(thresholds.recall * 100).toFixed(2)}% | ${(metrics.recall * 100).toFixed(2)}% | ${metrics.recall >= thresholds.recall ? '✅ 통과' : '❌ 실패'} |\n`;
  report += `| **F1-Score** | ${(thresholds.f1Score * 100).toFixed(2)}% | ${(metrics.f1Score * 100).toFixed(2)}% | ${metrics.f1Score >= thresholds.f1Score ? '✅ 통과' : '❌ 실패'} |\n\n`;
  
  const failedMetrics: string[] = [];
  if (metrics.precision < thresholds.precision) {
    failedMetrics.push(`Precision: 예상 ${(thresholds.precision * 100).toFixed(2)}%, 실제 ${(metrics.precision * 100).toFixed(2)}%`);
  }
  if (metrics.recall < thresholds.recall) {
    failedMetrics.push(`Recall: 예상 ${(thresholds.recall * 100).toFixed(2)}%, 실제 ${(metrics.recall * 100).toFixed(2)}%`);
  }
  if (metrics.f1Score < thresholds.f1Score) {
    failedMetrics.push(`F1-Score: 예상 ${(thresholds.f1Score * 100).toFixed(2)}%, 실제 ${(metrics.f1Score * 100).toFixed(2)}%`);
  }
  
  if (failedMetrics.length > 0) {
    report += `### 실패한 메트릭\n\n`;
    for (const failure of failedMetrics) {
      report += `- **${failure}**\n`;
    }
    report += `\n`;
  }

  report += `---\n\n`;
  report += `*이 리포트는 자동으로 생성되었습니다.*\n`;

  return report;
}

/**
 * 메인 함수
 */
async function main() {
  const options = parseArgs();
  
  console.log('📊 관계 추출 품질 리포트 생성 시작...\n');
  console.log(`옵션:`, options);

  // Given: 데이터베이스 및 서비스 초기화
  const db = openDb(':memory:');
  createBaseSchema(db);
  
  const migration = new RelationEngineSchemaMigration();
  migration.up(db);
  
  const relationExtractor = new RelationExtractor();
  const qualityValidator = new RelationQualityValidator();

  // 테스트 데이터셋 로드
  console.log('📂 테스트 데이터셋 로드 중...');
  const testDataset = loadTestDataset(options.sample);
  console.log(`✅ ${testDataset.length}건의 테스트 케이스 로드 완료\n`);

  // 메모리 생성
  console.log('💾 테스트 메모리 생성 중...');
  for (const testCase of testDataset) {
    if (!db.prepare('SELECT id FROM memory_item WHERE id = ?').get(testCase.source_id)) {
      createTestMemory(db, testCase.source_id, testCase.source_content);
    }
    if (!db.prepare('SELECT id FROM memory_item WHERE id = ?').get(testCase.target_id)) {
      createTestMemory(db, testCase.target_id, testCase.target_content);
    }
  }
  console.log('✅ 메모리 생성 완료\n');

  // 관계 추출
  const method = options.method || 'hybrid';
  const minConfidence = options.minConfidence || 0.5;
  console.log(`🔍 관계 추출 수행 중... (방법: ${method}, 최소 신뢰도: ${minConfidence})`);
  const extractedRelations = await extractRelations(
    testDataset,
    relationExtractor,
    method,
    minConfidence
  );
  console.log(`✅ ${extractedRelations.length}건의 관계 추출 완료\n`);

  // 품질 메트릭 계산
  console.log('📈 품질 메트릭 계산 중...');
  const metrics = qualityValidator.calculateQualityMetricsWithAnalysis(
    testDataset,
    extractedRelations
  );
  console.log('✅ 메트릭 계산 완료\n');

  // 리포트 생성
  console.log('📝 리포트 생성 중...');
  const report = generateMarkdownReport(metrics, options, qualityValidator);
  
  // 리포트 출력 또는 파일 저장
  if (options.output) {
    writeFileSync(options.output, report, 'utf-8');
    console.log(`✅ 리포트가 ${options.output}에 저장되었습니다.\n`);
  } else {
    console.log(report);
  }

  // 데이터베이스 정리
  db.close();

  // CI 모드: 임계값 검증 및 exit code 처리
  if (options.ci) {
    const thresholds = {
      precision: 0.70,
      recall: 0.65,
      f1Score: 0.68
    };

    const failedMetrics: Array<{ metric: string; expected: number; actual: number }> = [];
    
    if (metrics.precision < thresholds.precision) {
      failedMetrics.push({
        metric: 'Precision',
        expected: thresholds.precision,
        actual: metrics.precision
      });
    }
    if (metrics.recall < thresholds.recall) {
      failedMetrics.push({
        metric: 'Recall',
        expected: thresholds.recall,
        actual: metrics.recall
      });
    }
    if (metrics.f1Score < thresholds.f1Score) {
      failedMetrics.push({
        metric: 'F1-Score',
        expected: thresholds.f1Score,
        actual: metrics.f1Score
      });
    }

    if (failedMetrics.length > 0) {
      console.log('\n❌ 정확도 임계값 미달:\n');
      for (const failure of failedMetrics) {
        console.log(`  - ${failure.metric}: 예상 ${(failure.expected * 100).toFixed(2)}%, 실제 ${(failure.actual * 100).toFixed(2)}%`);
      }

      if (options.allowSoftFail) {
        console.log('\n⚠️  allow_soft_fail=true 옵션으로 인해 CI는 통과하지만 경고를 출력합니다.\n');
        process.exit(0); // 경고만 출력하고 CI 통과
      } else {
        console.log('\n❌ CI 실패: 정확도 임계값을 충족하지 못했습니다.\n');
        process.exit(1); // CI 실패
      }
    } else {
      console.log('\n✅ 모든 정확도 임계값을 충족했습니다.\n');
      process.exit(0);
    }
  } else {
    console.log('✨ 리포트 생성 완료!');
  }
}

// 스크립트 실행
main().catch(error => {
  console.error('❌ 오류 발생:', error);
  process.exit(1);
});
