#!/usr/bin/env node
/**
 * 품질 리포트 생성 CLI 스크립트
 * 
 * 사용법:
 *   npm run quality:report
 *   npm run quality:report -- --format json
 *   npm run quality:report -- --namespace search
 *   npm run quality:report -- --from 2024-01-01T00:00:00Z --to 2024-12-31T23:59:59Z
 *   npm run quality:report -- --output report.md
 *   npm run quality:report -- --format html --output report.html
 * 
 * 예제:
 *   npm run quality:report
 *   npm run quality:report -- --format json
 *   npm run quality:report -- --namespace search --format markdown
 *   npm run quality:report -- --from 2024-01-01T00:00:00Z --to 2024-12-31T23:59:59Z --output report.md
 *   npm run quality:report -- --format html --output report.html --context ci
 */

import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';
import { QualityAssuranceService } from '../src/services/quality-assurance/quality-assurance-service.js';
import { initializeDatabase } from '../src/infrastructure/database/database/init.js';
import type { ReportFormat, ReportOptions } from '../src/services/quality-assurance/quality-reporter.js';

/**
 * CLI 옵션
 */
interface CliOptions {
  format?: ReportFormat;
  namespace?: string;
  context?: string;
  from?: string;
  to?: string;
  output?: string;
}

/**
 * 명령줄 인자 파싱
 */
function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--format' && args[i + 1]) {
      const format = args[i + 1] as ReportFormat;
      if (['markdown', 'json', 'html'].includes(format)) {
        options.format = format;
      }
      i++;
    } else if (arg === '--namespace' && args[i + 1]) {
      options.namespace = args[i + 1];
      i++;
    } else if (arg === '--context' && args[i + 1]) {
      options.context = args[i + 1];
      i++;
    } else if (arg === '--from' && args[i + 1]) {
      options.from = args[i + 1];
      i++;
    } else if (arg === '--to' && args[i + 1]) {
      options.to = args[i + 1];
      i++;
    } else if (arg === '--output' && args[i + 1]) {
      options.output = args[i + 1];
      i++;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  return options;
}

/**
 * 도움말 출력
 */
function printHelp(): void {
  console.log(`
품질 리포트 생성 CLI

사용법:
  npm run quality:report [options]

옵션:
  --format <format>        리포트 형식 (markdown, json, html, 기본값: markdown)
  --namespace <namespace>  네임스페이스 필터 (예: search, relation, consolidation, storage)
  --context <context>      컨텍스트 필터 (기본값: default)
  --from <iso8601>         시작 시간 (ISO 8601 형식, 예: 2024-01-01T00:00:00Z)
  --to <iso8601>           종료 시간 (ISO 8601 형식, 예: 2024-12-31T23:59:59Z)
  --output <file>          출력 파일 경로 (지정하지 않으면 콘솔에 출력)
  --help, -h                도움말 출력

예제:
  npm run quality:report
  npm run quality:report -- --format json
  npm run quality:report -- --namespace search --format markdown
  npm run quality:report -- --from 2024-01-01T00:00:00Z --to 2024-12-31T23:59:59Z --output report.md
  npm run quality:report -- --format html --output report.html --context ci
`);
}

/**
 * 메인 함수
 */
async function main(): Promise<void> {
  const options = parseArgs();

  try {
    // 데이터베이스 초기화
    const db = await initializeDatabase();
    const qualityService = new QualityAssuranceService(db);

    // 리포트 옵션 구성
    const reportOptions: ReportOptions = {
      format: options.format || 'markdown',
      namespace: options.namespace,
      context: options.context || 'default',
      from: options.from,
      to: options.to
    };

    // 리포트 생성
    console.log('📊 품질 리포트 생성 중...');
    const report = await qualityService.generateReport(reportOptions);

    // 출력 처리
    if (options.output) {
      // 파일로 저장
      const outputPath = join(process.cwd(), options.output);
      const outputDir = join(outputPath, '..');
      
      // 디렉토리가 없으면 생성
      if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
      }

      writeFileSync(outputPath, report, 'utf-8');
      console.log(`✅ 리포트가 저장되었습니다: ${outputPath}`);
    } else {
      // 콘솔에 출력
      console.log('\n' + report);
    }

    db.close();
  } catch (error) {
    console.error('❌ 오류 발생:', error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// 스크립트 직접 실행 시
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1])) {
  main().catch(error => {
    console.error('❌ 치명적 오류:', error);
    process.exit(1);
  });
}

