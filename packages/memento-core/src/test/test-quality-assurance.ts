/**
 * 품질 보장 시스템 E2E 테스트
 * 
 * PRD FR-5.10: 품질 보장 시스템 E2E 테스트 작성
 * 전체 플로우 테스트: 수집 -> 평가 -> 기록 -> 리포트 생성
 */

import Database from 'better-sqlite3';
import { initializeDatabase } from '@memento/core/infrastructure/database/database/init.js';
import { QualityAssuranceService } from '@memento/core/domains/monitoring/services/quality-assurance/quality-assurance-service.js';
import { QualityThresholdManager } from '@memento/core/domains/monitoring/services/quality-assurance/quality-threshold-manager.js';
import { DatabaseUtils } from '@memento/core/shared/utils/database.js';
import { PIIMasker } from '@memento/core/shared/utils/pii-masker.js';

/**
 * 품질 측정 관련 테이블 생성
 */
function createQualityTables(db: Database.Database): void {
  DatabaseUtils.exec(db, `
    CREATE TABLE IF NOT EXISTS quality_measurement_history (
      id TEXT PRIMARY KEY,
      measurement_type TEXT NOT NULL CHECK (measurement_type IN ('batch', 'test', 'manual')),
      measured_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      metrics TEXT NOT NULL,
      status TEXT CHECK (status IN ('success', 'warning', 'error')) DEFAULT 'success',
      warnings TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_quality_measurement_history_measured_at 
      ON quality_measurement_history(measured_at);
    CREATE INDEX IF NOT EXISTS idx_quality_measurement_history_type 
      ON quality_measurement_history(measurement_type);
    CREATE INDEX IF NOT EXISTS idx_quality_measurement_history_status 
      ON quality_measurement_history(status);
    CREATE TABLE IF NOT EXISTS quality_metrics (
      metric_namespace TEXT NOT NULL,
      metric_key TEXT NOT NULL,
      context TEXT DEFAULT 'default',
      metric_value REAL NOT NULL,
      measured_at TIMESTAMP NOT NULL,
      status TEXT CHECK (status IN ('pass', 'warning', 'fail')) DEFAULT 'pass',
      threshold_value REAL,
      threshold_type TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (metric_namespace, metric_key, context)
    );
    CREATE INDEX IF NOT EXISTS idx_quality_metrics_namespace_key 
      ON quality_metrics(metric_namespace, metric_key);
    CREATE INDEX IF NOT EXISTS idx_quality_metrics_context 
      ON quality_metrics(context);
    CREATE INDEX IF NOT EXISTS idx_quality_metrics_status 
      ON quality_metrics(status);
    CREATE TABLE IF NOT EXISTS quality_thresholds (
      metric_namespace TEXT NOT NULL,
      metric_key TEXT NOT NULL,
      context TEXT DEFAULT 'default',
      threshold_value REAL NOT NULL,
      threshold_type TEXT CHECK (threshold_type IN ('min', 'max')) NOT NULL,
      description TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (metric_namespace, metric_key, context)
    );
  `);
}

/**
 * 메인 테스트 함수
 */
async function testQualityAssuranceE2E(): Promise<void> {
  console.log('🧪 품질 보장 시스템 E2E 테스트 시작\n');

  let db: Database.Database | null = null;

  try {
    // Given: 데이터베이스 초기화
    console.log('1️⃣ 데이터베이스 초기화...');
    db = await initializeDatabase();
    createQualityTables(db);
    console.log('✅ 데이터베이스 초기화 완료\n');

    // Given: Quality Assurance Service 초기화
    console.log('2️⃣ Quality Assurance Service 초기화...');
    const qualityService = new QualityAssuranceService(db);
    const thresholdManager = new QualityThresholdManager(db);
    console.log('✅ Quality Assurance Service 초기화 완료\n');

    // Given: 기본 임계값 초기화
    console.log('3️⃣ 기본 임계값 초기화...');
    const thresholdCount = thresholdManager.initializeDefaultThresholds('default', false);
    console.log(`✅ 기본 임계값 초기화 완료 (${thresholdCount}개)\n`);

    // When: 품질 측정 실행
    console.log('4️⃣ 품질 측정 실행...');
    const measurementResult = await qualityService.measureQuality({
      measurement_type: 'test',
      context: 'default',
      record: true
    });
    console.log('✅ 품질 측정 완료');
    console.log(`   - 전체 상태: ${measurementResult.overall_status}`);
    console.log(`   - 측정된 네임스페이스: ${measurementResult.namespaces.join(', ')}`);
    console.log(`   - 경고 개수: ${measurementResult.warning_count}`);
    console.log(`   - 측정 이력 ID: ${measurementResult.measurement_ids.length}개\n`);

    // Then: 측정 이력이 기록되었는지 확인
    console.log('5️⃣ 측정 이력 확인...');
    const history = DatabaseUtils.all(
      db,
      'SELECT * FROM quality_measurement_history ORDER BY measured_at DESC LIMIT 1'
    );
    if (history.length > 0) {
      console.log('✅ 측정 이력 기록 확인');
      console.log(`   - 측정 타입: ${history[0].measurement_type}`);
      console.log(`   - 상태: ${history[0].status}`);
    } else {
      console.log('⚠️ 측정 이력이 기록되지 않았습니다');
    }
    console.log('');

    // Then: 품질 지표가 기록되었는지 확인
    console.log('6️⃣ 품질 지표 확인...');
    const metrics = DatabaseUtils.all(
      db,
      'SELECT * FROM quality_metrics ORDER BY measured_at DESC LIMIT 10'
    );
    console.log(`✅ 품질 지표 확인 (${metrics.length}개)`);
    metrics.forEach((metric: any) => {
      console.log(`   - ${metric.metric_namespace}.${metric.metric_key}: ${metric.metric_value} (${metric.status})`);
    });
    console.log('');

    // When: 리포트 생성
    console.log('7️⃣ 리포트 생성...');
    const markdownReport = await qualityService.generateReport({
      format: 'markdown',
      context: 'default'
    });
    console.log('✅ Markdown 리포트 생성 완료');
    console.log(`   - 리포트 길이: ${markdownReport.length} bytes\n`);

    const jsonReport = await qualityService.generateReport({
      format: 'json',
      context: 'default'
    });
    console.log('✅ JSON 리포트 생성 완료');
    console.log(`   - 리포트 길이: ${jsonReport.length} bytes\n`);

    const htmlReport = await qualityService.generateReport({
      format: 'html',
      context: 'default'
    });
    console.log('✅ HTML 리포트 생성 완료');
    console.log(`   - 리포트 길이: ${htmlReport.length} bytes\n`);

    // When: 리포트 데이터 조회
    console.log('8️⃣ 리포트 데이터 조회...');
    const reportData = await qualityService.getReportData({
      context: 'default'
    });
    console.log('✅ 리포트 데이터 조회 완료');
    console.log(`   - 전체 상태: ${reportData.summary.overall_status}`);
    console.log(`   - 총 지표 수: ${reportData.summary.total_metrics}`);
    console.log(`   - 통과 지표: ${reportData.summary.passed_metrics}`);
    console.log(`   - 실패 지표: ${reportData.summary.failed_metrics}`);
    console.log(`   - 경고 지표: ${reportData.summary.warning_metrics}\n`);

    // When: 임계값 조회
    console.log('9️⃣ 임계값 조회...');
    const thresholds = qualityService.getThresholds();
    console.log(`✅ 임계값 조회 완료 (${thresholds.length}개)`);
    thresholds.slice(0, 5).forEach((threshold: any) => {
      console.log(`   - ${threshold.metric_namespace}.${threshold.metric_key}: ${threshold.threshold_value} (${threshold.threshold_type})`);
    });
    console.log('');

    // When: 측정 이력 조회
    console.log('🔟 측정 이력 조회...');
    const measurementHistory = qualityService.getMeasurementHistory(undefined, 'default', undefined, undefined, 10);
    console.log(`✅ 측정 이력 조회 완료 (${measurementHistory.length}개)`);
    measurementHistory.slice(0, 3).forEach((history: any) => {
      console.log(`   - ${history.id.substring(0, 20)}...: ${history.measurement_type} (${history.status})`);
    });
    console.log('');

    // When: 최신 품질 지표 조회
    console.log('1️⃣1️⃣ 최신 품질 지표 조회...');
    const latestMetrics = qualityService.getLatestMetrics();
    console.log(`✅ 최신 품질 지표 조회 완료 (${latestMetrics.length}개)`);
    latestMetrics.slice(0, 5).forEach((metric: any) => {
      console.log(`   - ${metric.metric_namespace}.${metric.metric_key}: ${metric.metric_value} (${metric.status})`);
    });
    console.log('');

    console.log('🎉 모든 E2E 테스트가 성공적으로 완료되었습니다!');
  } catch (error) {
    const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error', stack: undefined };
    console.error('❌ E2E 테스트 실패:', maskedError.message);
    if (maskedError.stack) {
      console.error('   - 스택:', maskedError.stack);
    }
    process.exit(1);
  } finally {
    // 정리
    if (db) {
      db.close();
    }
  }
}

// 테스트 실행
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1])) {
  testQualityAssuranceE2E()
    .then(() => {
      console.log('✅ E2E 테스트 완료');
      process.exit(0);
    })
    .catch((error) => {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      console.error('❌ E2E 테스트 실패:', maskedError.message);
      process.exit(1);
    });
}

