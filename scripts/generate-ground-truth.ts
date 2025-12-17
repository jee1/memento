#!/usr/bin/env node
/**
 * Ground Truth 데이터 생성 CLI 스크립트
 * 
 * 사용법:
 *   npm run quality:ground-truth:generate
 *   npm run quality:ground-truth:generate -- --seed 12345
 *   npm run quality:ground-truth:generate -- --queries "React,TypeScript,database"
 *   npm run quality:ground-truth:generate -- --relevant-count 10
 *   npm run quality:ground-truth:generate -- --strategy random
 *   npm run quality:ground-truth:generate -- --output custom-path.json
 * 
 * 예제:
 *   npm run quality:ground-truth:generate
 *   npm run quality:ground-truth:generate -- --seed 12345 --queries "React,TypeScript" --relevant-count 5
 *   npm run quality:ground-truth:generate -- --strategy pattern --output data/my-ground-truth.json
 */

import { existsSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';
import { initializeDatabase } from '../src/infrastructure/database/database/init.js';
import { DatabaseUtils } from '../src/shared/utils/database.js';
import {
  generateGroundTruth,
  saveGroundTruth,
  loadGroundTruth,
  type GroundTruthGenerationOptions,
  type GroundTruth
} from '../src/test/helpers/vector-search-quality-metrics.js';
import { HybridSearchFactory } from '../src/domains/search/factories/hybrid-search.factory.js';
import type { HybridSearchQuery } from '../src/domains/search/algorithms/hybrid-search-engine.js';
import { getStopWords } from '../src/shared/utils/stopwords.js';

/**
 * CLI 옵션
 */
interface CliOptions {
  seed?: number;
  queries?: string;
  relevantCount?: number;
  strategy?: 'random' | 'first' | 'pattern' | 'search';
  output?: string;
  force?: boolean;
  help?: boolean;
  autoQueries?: boolean; // 메모리 내용에서 쿼리 자동 생성
  queryCount?: number; // 자동 생성할 쿼리 수 (기본값: 5)
}

/**
 * 명령줄 인자 파싱
 */
function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const options: CliOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--seed' && args[i + 1]) {
      options.seed = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--queries' && args[i + 1]) {
      options.queries = args[i + 1];
      i++;
    } else if (arg === '--relevant-count' && args[i + 1]) {
      options.relevantCount = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--strategy' && args[i + 1]) {
      options.strategy = args[i + 1] as 'random' | 'first' | 'pattern';
      i++;
    } else if (arg === '--output' && args[i + 1]) {
      options.output = args[i + 1];
      i++;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--auto-queries') {
      options.autoQueries = true;
    } else if (arg === '--query-count' && args[i + 1]) {
      options.queryCount = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }

  return options;
}

/**
 * 도움말 출력
 */
function printHelp(): void {
  console.log(`
Ground Truth 데이터 생성 CLI

사용법:
  npm run quality:ground-truth:generate [options]

옵션:
  --seed <number>              시드 값 (재현성을 위해 사용, 기본값: 12345)
  --queries <string>           쿼리 목록 (쉼표로 구분, 기본값: "React,TypeScript,database,MCP,optimization")
  --relevant-count <number>    각 쿼리당 관련 결과 수 (기본값: 5)
  --strategy <strategy>        관련 결과 선택 전략 (random|first|pattern|search, 기본값: random)
  --auto-queries               메모리 내용에서 쿼리 자동 생성 (권장)
  --query-count <number>       자동 생성할 쿼리 수 (기본값: 5, --auto-queries 사용 시)
  --output <file>              출력 파일 경로 (기본값: data/vector-search-quality-ground-truth.json)
  --force                      기존 파일이 있어도 덮어쓰기
  --help, -h                   도움말 출력

전략 설명:
  random:  랜덤 선택 (시드 기반, 재현 가능)
  first:   처음 N개 선택
  pattern: 패턴 기반 선택 (쿼리별로 다른 패턴)
  search:  실제 검색을 수행하여 관련 메모리 찾기 (--auto-queries와 함께 사용 권장)

예제:
  npm run quality:ground-truth:generate
  npm run quality:ground-truth:generate -- --auto-queries --strategy search
  npm run quality:ground-truth:generate -- --seed 12345 --queries "React,TypeScript" --relevant-count 5
  npm run quality:ground-truth:generate -- --auto-queries --query-count 10 --strategy search
  npm run quality:ground-truth:generate -- --strategy pattern --output data/my-ground-truth.json
  npm run quality:ground-truth:generate -- --force
`);
}

/**
 * 데이터베이스에서 메모리 ID 목록 조회
 */
async function getMemoryIds(db: Database.Database, limit: number = 1000): Promise<string[]> {
  const memories = await DatabaseUtils.all(
    db,
    'SELECT id FROM memory_item ORDER BY created_at DESC LIMIT ?',
    [limit]
  );
  
  return memories.map((memory: any) => memory.id);
}

/**
 * 메모리 내용에서 키워드 추출
 * 빈도 기반으로 주요 키워드를 추출합니다.
 */
function extractKeywordsFromMemories(
  memories: Array<{ content: string }>,
  maxKeywords: number = 10
): string[] {
  const stopWords = getStopWords();
  const wordFreq = new Map<string, number>();

  // 각 메모리에서 단어 추출 및 빈도 계산
  for (const memory of memories) {
    const words = memory.content
      .toLowerCase()
      .replace(/[^\w\s가-힣]/g, ' ') // 특수문자 제거, 한글 유지
      .split(/\s+/)
      .filter(word => {
        // 불용어 제거 및 최소 길이 체크
        return word.length >= 2 && 
               word.length <= 20 && 
               !stopWords.has(word) &&
               !/^\d+$/.test(word); // 숫자만 있는 단어 제외
      });

    for (const word of words) {
      wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
    }
  }

  // 빈도순으로 정렬하고 상위 키워드 선택
  const sortedKeywords = Array.from(wordFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxKeywords * 2) // 더 많이 선택하여 필터링
    .map(([word]) => word)
    .filter(word => word.length >= 2); // 최소 길이 재확인

  // 최종 키워드 선택 (중복 제거 및 길이 제한)
  const uniqueKeywords = Array.from(new Set(sortedKeywords))
    .slice(0, maxKeywords);

  return uniqueKeywords;
}

/**
 * 실제 검색을 수행하여 관련 메모리 찾기
 */
async function generateGroundTruthFromSearch(
  db: Database.Database,
  queries: string[],
  relevantCount: number = 5
): Promise<GroundTruth[]> {
  const groundTruths: GroundTruth[] = [];
  const searchEngine = HybridSearchFactory.createDefaultEngine(db);

  for (const query of queries) {
    try {
      const searchQuery: HybridSearchQuery = {
        query: query,
        limit: relevantCount * 2 // 더 많은 결과를 가져와서 필터링
      };

      const searchResult = await searchEngine.search(db, searchQuery);
      
      // 검색 결과에서 상위 N개를 관련 메모리로 선택
      const relevantIds = searchResult.items
        .slice(0, relevantCount)
        .map(item => item.id);

      if (relevantIds.length > 0) {
        groundTruths.push({
          queryId: query,
          relevantIds
        });
      }
    } catch (error) {
      console.warn(`⚠️  쿼리 "${query}" 검색 실패:`, error instanceof Error ? error.message : String(error));
      // 검색 실패 시 빈 Ground Truth 추가하지 않음
    }
  }

  return groundTruths;
}

/**
 * 메인 함수
 */
async function main(): Promise<void> {
  const options = parseArgs();

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  try {
    // 데이터베이스 초기화
    console.log('🗄️  SQLite 데이터베이스 초기화 중...');
    const db = await initializeDatabase();

    // 메모리 ID 목록 조회
    console.log('📋 메모리 ID 목록 조회 중...');
    const memoryIds = await getMemoryIds(db);

    if (memoryIds.length === 0) {
      console.error('❌ 데이터베이스에 메모리가 없습니다. 먼저 메모리를 저장해주세요.');
      db.close();
      process.exit(1);
    }

    console.log(`✅ ${memoryIds.length}개의 메모리 ID를 찾았습니다.`);

    // 출력 파일 경로 결정
    const defaultPath = join(process.cwd(), 'data', 'vector-search-quality-ground-truth.json');
    const outputPath = options.output || defaultPath;

    // 기존 파일 확인
    if (existsSync(outputPath) && !options.force) {
      console.log(`⚠️  기존 Ground Truth 파일이 존재합니다: ${outputPath}`);
      console.log('   --force 옵션을 사용하여 덮어쓸 수 있습니다.');
      const loaded = loadGroundTruth(outputPath);
      if (loaded) {
        console.log(`   현재 파일에는 ${loaded.length}개의 Ground Truth가 있습니다.`);
      }
      db.close();
      process.exit(0);
    }

    // 쿼리 목록 결정
    let queries: string[] | undefined;
    
    if (options.autoQueries) {
      // 메모리 내용에서 키워드 자동 추출
      console.log('🔍 메모리 내용에서 키워드 추출 중...');
      const memories = await DatabaseUtils.all(
        db,
        'SELECT content FROM memory_item ORDER BY created_at DESC LIMIT 100'
      );
      
      const queryCount = options.queryCount || 5;
      const extractedKeywords = extractKeywordsFromMemories(memories, queryCount);
      queries = extractedKeywords;
      
      console.log(`✅ ${queries.length}개의 키워드 추출 완료:`, queries.join(', '));
    } else if (options.queries) {
      // 수동으로 지정된 쿼리 사용
      queries = options.queries.split(',').map(q => q.trim()).filter(q => q.length > 0);
    }

    // Ground Truth 생성
    let groundTruths: GroundTruth[];
    
    if (options.strategy === 'search' && queries && queries.length > 0) {
      // 실제 검색을 수행하여 관련 메모리 찾기
      console.log('🔧 실제 검색을 수행하여 Ground Truth 생성 중...');
      console.log(`   쿼리 수: ${queries.length}`);
      console.log(`   쿼리당 관련 결과 수: ${options.relevantCount || 5}`);
      
      groundTruths = await generateGroundTruthFromSearch(
        db,
        queries,
        options.relevantCount || 5
      );
    } else {
      // 기존 방식 (랜덤/패턴 선택)
      const generationOptions: GroundTruthGenerationOptions = {
        seed: options.seed,
        queries: queries,
        relevantCountPerQuery: options.relevantCount,
        selectionStrategy: options.strategy
      };

      console.log('🔧 Ground Truth 생성 중...');
      console.log(`   시드: ${generationOptions.seed || 12345}`);
      console.log(`   쿼리 수: ${queries?.length || 5}`);
      console.log(`   쿼리당 관련 결과 수: ${generationOptions.relevantCountPerQuery || 5}`);
      console.log(`   선택 전략: ${generationOptions.selectionStrategy || 'random'}`);

      groundTruths = generateGroundTruth(memoryIds, generationOptions);
    }

    // Ground Truth 저장
    console.log(`💾 Ground Truth 저장 중: ${outputPath}`);
    saveGroundTruth(groundTruths, outputPath);

    console.log(`✅ Ground Truth 생성 완료!`);
    console.log(`   생성된 Ground Truth 수: ${groundTruths.length}`);
    console.log(`   저장 위치: ${outputPath}`);
    console.log(`\n📊 생성된 Ground Truth 요약:`);
    groundTruths.forEach((gt, index) => {
      console.log(`   ${index + 1}. 쿼리: "${gt.queryId}", 관련 결과: ${gt.relevantIds.length}개`);
    });

    console.log(`\n💡 다음 단계:`);
    console.log(`   1. 품질 리포트 생성: npm run quality:report`);
    console.log(`   2. Ground Truth 확인: cat ${outputPath}`);

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
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('예상치 못한 오류:', error);
    process.exit(1);
  });
}

