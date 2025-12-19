#!/usr/bin/env node
/**
 * 품질 임계값 관리 CLI 스크립트
 * 
 * 사용법:
 *   npm run quality:thresholds list [--namespace <namespace>] [--context <context>]
 *   npm run quality:thresholds set <namespace> <key> <value> <type> [--context <context>] [--description <description>]
 *   npm run quality:thresholds delete <namespace> <key> [--context <context>]
 *   npm run quality:thresholds init [--context <context>] [--overwrite]
 *   npm run quality:thresholds get <namespace> <key> [--context <context>]
 * 
 * 예제:
 *   npm run quality:thresholds list
 *   npm run quality:thresholds list --namespace search
 *   npm run quality:thresholds set search precision_at_5 0.75 min --context default --description "Updated threshold"
 *   npm run quality:thresholds delete search precision_at_5 --context default
 *   npm run quality:thresholds init
 *   npm run quality:thresholds init --overwrite
 *   npm run quality:thresholds get search precision_at_5
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { QualityThresholdManager } from '../src/services/quality-assurance/quality-threshold-manager.js';
import { initializeDatabase } from '../src/infrastructure/database/database/init.js';

/**
 * CLI 옵션
 */
interface CliOptions {
  namespace?: string;
  key?: string;
  value?: number;
  type?: 'min' | 'max';
  context?: string;
  description?: string;
  overwrite?: boolean;
}

/**
 * 명령줄 인자 파싱
 */
function parseArgs(): { command: string; options: CliOptions } {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  const options: CliOptions = {};

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--namespace' && args[i + 1]) {
      options.namespace = args[i + 1];
      i++;
    } else if (arg === '--context' && args[i + 1]) {
      options.context = args[i + 1];
      i++;
    } else if (arg === '--description' && args[i + 1]) {
      options.description = args[i + 1];
      i++;
    } else if (arg === '--overwrite') {
      options.overwrite = true;
    } else if (arg === '--value' && args[i + 1]) {
      options.value = parseFloat(args[i + 1]);
      i++;
    } else if (arg === '--type' && args[i + 1]) {
      const type = args[i + 1] as 'min' | 'max';
      if (['min', 'max'].includes(type)) {
        options.type = type;
      }
      i++;
    } else if (!options.namespace && !arg.startsWith('--')) {
      options.namespace = arg;
    } else if (!options.key && !arg.startsWith('--') && options.namespace) {
      options.key = arg;
    } else if (!options.value && !arg.startsWith('--') && options.key && !isNaN(parseFloat(arg))) {
      options.value = parseFloat(arg);
    } else if (!options.type && !arg.startsWith('--') && options.value && ['min', 'max'].includes(arg)) {
      options.type = arg as 'min' | 'max';
    }
  }

  return { command, options };
}

/**
 * 도움말 출력
 */
function printHelp(): void {
  console.log(`
품질 임계값 관리 CLI

사용법:
  npm run quality:thresholds <command> [options]

명령어:
  list                    모든 임계값 조회
  get <namespace> <key>   특정 임계값 조회
  set <namespace> <key> <value> <type>   임계값 설정
  delete <namespace> <key>   임계값 삭제
  init                    기본 임계값 초기화
  help                    도움말 출력

옵션:
  --namespace <namespace>   네임스페이스 필터 (예: search, relation, consolidation, storage)
  --context <context>       컨텍스트 (기본값: default)
  --description <text>      설명 (set 명령어에서만 사용)
  --overwrite               기존 임계값 덮어쓰기 (init 명령어에서만 사용)
  --value <number>          임계값 (set 명령어에서 사용, 위치 인자로도 가능)
  --type <min|max>          임계값 타입 (set 명령어에서 사용, 위치 인자로도 가능)

예제:
  npm run quality:thresholds list
  npm run quality:thresholds list --namespace search
  npm run quality:thresholds get search precision_at_5
  npm run quality:thresholds set search precision_at_5 0.75 min
  npm run quality:thresholds set search precision_at_5 0.75 min --context ci --description "CI threshold"
  npm run quality:thresholds delete search precision_at_5
  npm run quality:thresholds init
  npm run quality:thresholds init --overwrite
`);
}

/**
 * 임계값 목록 출력
 */
function printThresholds(thresholds: any[], options: CliOptions): void {
  if (thresholds.length === 0) {
    console.log('임계값이 설정되지 않았습니다.');
    return;
  }

  console.log(`\n총 ${thresholds.length}개의 임계값:\n`);
  console.log('Namespace | Key | Value | Type | Context | Description');
  console.log('----------|-----|-------|------|---------|------------');

  for (const threshold of thresholds) {
    const namespace = threshold.metric_namespace.padEnd(9);
    const key = threshold.metric_key.padEnd(20);
    const value = threshold.threshold_value.toFixed(3).padStart(5);
    const type = threshold.threshold_type.padEnd(4);
    const context = (threshold.context || 'default').padEnd(7);
    const description = threshold.description || '-';

    console.log(`${namespace} | ${key} | ${value} | ${type} | ${context} | ${description}`);
  }
  console.log('');
}

/**
 * 메인 함수
 */
async function main(): Promise<void> {
  const { command, options } = parseArgs();

  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    process.exit(0);
  }

  try {
    // 데이터베이스 초기화
    const db = await initializeDatabase();
    const thresholdManager = new QualityThresholdManager(db);

    const context = options.context || 'default';

    switch (command) {
      case 'list': {
        const thresholds = thresholdManager.getAllThresholds(options.namespace, context);
        printThresholds(thresholds, options);
        break;
      }

      case 'get': {
        if (!options.namespace || !options.key) {
          console.error('❌ 오류: namespace와 key를 지정해야 합니다.');
          console.error('사용법: npm run quality:thresholds get <namespace> <key> [--context <context>]');
          process.exit(1);
        }

        const threshold = thresholdManager.getThreshold(options.namespace, options.key, context);
        if (!threshold) {
          console.log(`임계값이 설정되지 않았습니다: ${options.namespace}.${options.key} (${context})`);
        } else {
          console.log('\n임계값 정보:');
          console.log(`  Namespace: ${threshold.metric_namespace}`);
          console.log(`  Key: ${threshold.metric_key}`);
          console.log(`  Value: ${threshold.threshold_value}`);
          console.log(`  Type: ${threshold.threshold_type}`);
          console.log(`  Context: ${threshold.context}`);
          console.log(`  Description: ${threshold.description || '-'}`);
          console.log(`  Updated: ${threshold.updated_at}`);
          console.log('');
        }
        break;
      }

      case 'set': {
        if (!options.namespace || !options.key || options.value === undefined || !options.type) {
          console.error('❌ 오류: namespace, key, value, type을 모두 지정해야 합니다.');
          console.error('사용법: npm run quality:thresholds set <namespace> <key> <value> <type> [--context <context>] [--description <description>]');
          process.exit(1);
        }

        if (options.value < 0 || options.value > 1) {
          console.error('❌ 오류: 임계값은 0과 1 사이의 값이어야 합니다.');
          process.exit(1);
        }

        const threshold = thresholdManager.setThreshold(
          options.namespace,
          options.key,
          {
            threshold_value: options.value,
            threshold_type: options.type,
            description: options.description
          },
          context
        );

        console.log(`✅ 임계값 설정 완료: ${threshold.metric_namespace}.${threshold.metric_key} (${threshold.context})`);
        console.log(`   Value: ${threshold.threshold_value}`);
        console.log(`   Type: ${threshold.threshold_type}`);
        if (threshold.description) {
          console.log(`   Description: ${threshold.description}`);
        }
        break;
      }

      case 'delete': {
        if (!options.namespace || !options.key) {
          console.error('❌ 오류: namespace와 key를 지정해야 합니다.');
          console.error('사용법: npm run quality:thresholds delete <namespace> <key> [--context <context>]');
          process.exit(1);
        }

        const deleted = thresholdManager.deleteThreshold(options.namespace, options.key, context);
        if (deleted) {
          console.log(`✅ 임계값 삭제 완료: ${options.namespace}.${options.key} (${context})`);
        } else {
          console.log(`⚠️  임계값이 존재하지 않습니다: ${options.namespace}.${options.key} (${context})`);
        }
        break;
      }

      case 'init': {
        const count = thresholdManager.initializeDefaultThresholds(context, options.overwrite || false);
        console.log(`✅ 기본 임계값 초기화 완료: ${count}개 (context: ${context})`);
        if (options.overwrite) {
          console.log('   기존 임계값을 덮어썼습니다.');
        } else {
          console.log('   기존 임계값은 유지되었습니다.');
        }
        break;
      }

      default:
        console.error(`❌ 알 수 없는 명령어: ${command}`);
        printHelp();
        process.exit(1);
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

