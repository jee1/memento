/* eslint-disable no-console */
/**
 * CI/CD 통합을 위한 품질 측정 테스트 훅
 * 
 * PRD FR-5.9: CI/CD 통합을 위한 품질 측정 테스트 훅 구현
 * - 테스트 실행 시 자동 품질 측정
 * - warning 시 빌드 성공+로그 기록
 * - fail 시 빌드 실패
 */

import { afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { initializeDatabase } from '../../infrastructure/database/database/init.js';
import { QualityAssuranceService } from '../../services/quality-assurance/quality-assurance-service.js';
import { logger } from '../../shared/utils/logger.js';
import { PIIMasker } from '../../shared/utils/pii-masker.js';
import { existsSync, mkdirSync } from 'fs';
import { writeFileSync } from 'fs';
import path from 'path';

let qualityService: QualityAssuranceService | null = null;
let db: Database.Database | null = null;

/**
 * 품질 측정 초기화
 */
async function initializeQualityMeasurement(): Promise<void> {
  try {
    // CI 환경에서만 실행
    if (!process.env.CI) {
      return;
    }

    // 데이터베이스 초기화
    db = await initializeDatabase();
    qualityService = new QualityAssuranceService(db);

    logger.info('CI 품질 측정 초기화 완료');
  } catch (error) {
    logger.error('CI 품질 측정 초기화 실패', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/**
 * 테스트 후 품질 측정 실행
 */
async function runQualityMeasurement(): Promise<void> {
  try {
    // CI 환경에서만 실행
    if (!process.env.CI || !qualityService || !db) {
      return;
    }

    logger.info('CI 품질 측정 시작');

    // 품질 측정 실행
    const measurementResult = await qualityService.measureQuality({
      measurement_type: 'test',
      context: 'ci',
      record: true
    });

    // 리포트 생성
    const report = await qualityService.generateReport({
      format: 'markdown',
      context: 'ci'
    });

    // 리포트 파일 저장
    const reportDir = path.join(process.cwd(), 'test-results');
    if (!existsSync(reportDir)) {
      mkdirSync(reportDir, { recursive: true });
    }
    const reportPath = path.join(reportDir, 'quality-report-ci.md');
    writeFileSync(reportPath, report, 'utf-8');

    // JSON 리포트도 저장
    const jsonReport = await qualityService.generateReport({
      format: 'json',
      context: 'ci'
    });
    const jsonReportPath = path.join(reportDir, 'quality-report-ci.json');
    writeFileSync(jsonReportPath, jsonReport, 'utf-8');

    // 상태에 따른 처리
    if (measurementResult.overall_status === 'fail') {
      // fail 시 빌드 실패
      logger.error('❌ 품질 측정 실패: 빌드 실패', {
        overall_status: measurementResult.overall_status,
        warning_count: measurementResult.warning_count,
        namespaces: measurementResult.namespaces
      });

      // 콘솔에 리포트 요약 출력
      console.error('\n❌ 품질 측정 실패');
      console.error('='.repeat(80));
      console.error(`전체 상태: ${measurementResult.overall_status.toUpperCase()}`);
      console.error(`경고 개수: ${measurementResult.warning_count}`);
      console.error(`측정된 네임스페이스: ${measurementResult.namespaces.join(', ')}`);
      console.error(`리포트 파일: ${reportPath}`);
      console.error('='.repeat(80));

      // 빌드 실패
      process.exit(1);
    } else if (measurementResult.overall_status === 'warning') {
      // warning 시 빌드 성공+로그 기록
      logger.warn('⚠️ 품질 측정 경고: 빌드 성공 (로그 기록)', {
        overall_status: measurementResult.overall_status,
        warning_count: measurementResult.warning_count,
        namespaces: measurementResult.namespaces
      });

      // 콘솔에 리포트 요약 출력
      console.warn('\n⚠️ 품질 측정 경고');
      console.warn('='.repeat(80));
      console.warn(`전체 상태: ${measurementResult.overall_status.toUpperCase()}`);
      console.warn(`경고 개수: ${measurementResult.warning_count}`);
      console.warn(`측정된 네임스페이스: ${measurementResult.namespaces.join(', ')}`);
      console.warn(`리포트 파일: ${reportPath}`);
      console.warn('='.repeat(80));
    } else {
      // pass 시 정상 로그
      logger.info('✅ 품질 측정 통과', {
        overall_status: measurementResult.overall_status,
        warning_count: measurementResult.warning_count,
        namespaces: measurementResult.namespaces
      });

      console.log('\n✅ 품질 측정 통과');
      console.log(`전체 상태: ${measurementResult.overall_status.toUpperCase()}`);
      console.log(`리포트 파일: ${reportPath}`);
    }

    // 데이터베이스 정리
    if (db) {
      db.close();
    }
  } catch (error) {
    logger.error('CI 품질 측정 실행 실패', {
      error: error instanceof Error ? error.message : String(error)
    });

    // 에러 발생 시에도 빌드는 성공 (품질 측정 자체의 실패는 빌드 실패로 이어지지 않음)
    // 단, 로그는 기록
    const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
    console.error('\n⚠️ 품질 측정 실행 실패 (빌드는 계속 진행)');
    console.error(maskedError.message);
  }
}

// 초기화 및 후크 등록
if (process.env.CI) {
  // 초기화는 비동기이므로 즉시 실행
  initializeQualityMeasurement().catch(error => {
    logger.error('CI 품질 측정 초기화 실패', {
      error: error instanceof Error ? error.message : String(error)
    });
  });

  // 테스트 완료 후 품질 측정 실행
  afterAll(async () => {
    await runQualityMeasurement();
  });
}

