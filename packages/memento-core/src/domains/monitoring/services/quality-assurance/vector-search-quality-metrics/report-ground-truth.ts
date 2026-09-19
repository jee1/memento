/**
 * 벡터 검색 품질 검증 — Ground Truth 생성·저장·로드
 * (#910: report-comparison.ts 에서 분리)
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import type { GroundTruth } from '../search-quality-metrics.js';
import { reportOutputRoot } from './report-paths.js';

const __dirname = reportOutputRoot;

/**
 * 시드 기반 랜덤 생성기 (Ground Truth 생성용)
 * 재현 가능한 랜덤 값 생성
 */
class GroundTruthSeededRandom {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed;
  }

  /**
   * 0과 1 사이의 랜덤 값 생성
   */
  random(): number {
    // LCG: (a * seed + c) mod m
    // a = 1664525, c = 1013904223, m = 2^32
    this.seed = (this.seed * 1664525 + 1013904223) % 0x100000000;
    return this.seed / 0x100000000;
  }

  /**
   * min과 max 사이의 정수 랜덤 값 생성
   */
  randomInt(min: number, max: number): number {
    return Math.floor(this.random() * (max - min + 1)) + min;
  }
}

/**
 * Ground Truth 생성 옵션
 */
export interface GroundTruthGenerationOptions {
  /**
   * 시드 값 (재현성을 위해 사용, 기본값: 12345)
   */
  seed?: number;
  
  /**
   * 쿼리 목록 (기본값: ['React', 'TypeScript', 'database', 'MCP', 'optimization'])
   */
  queries?: string[];
  
  /**
   * 각 쿼리당 관련 결과 수 (기본값: 5)
   */
  relevantCountPerQuery?: number;
  
  /**
   * 관련 결과 선택 전략 (기본값: 'random')
   * - 'random': 랜덤 선택
   * - 'first': 처음 N개 선택
   * - 'pattern': 패턴 기반 선택 (i % 3 === 0 등)
   */
  selectionStrategy?: 'random' | 'first' | 'pattern';
}

/**
 * Ground Truth 자동 생성
 * 시드 기반으로 재현 가능한 Ground Truth 생성
 * 
 * @param memoryIds 메모리 ID 배열
 * @param options 생성 옵션
 * @returns Ground Truth 배열
 * 
 * @example
 * ```typescript
 * // 기본 옵션으로 생성
 * const groundTruths = generateGroundTruth(memoryIds);
 * 
 * // 시드와 쿼리 지정
 * const groundTruths = generateGroundTruth(memoryIds, {
 *   seed: 12345,
 *   queries: ['React', 'TypeScript'],
 *   relevantCountPerQuery: 3
 * });
 * ```
 */
export function generateGroundTruth(
  memoryIds: string[],
  options: GroundTruthGenerationOptions = {}
): GroundTruth[] {
  const {
    seed = 12345,
    queries = ['React', 'TypeScript', 'database', 'MCP', 'optimization'],
    relevantCountPerQuery = 5,
    selectionStrategy = 'random'
  } = options;

  const rng = new GroundTruthSeededRandom(seed);
  const groundTruths: GroundTruth[] = [];

  queries.forEach((query, queryIndex) => {
    let relevantIds: string[];

    switch (selectionStrategy) {
      case 'first':
        // 처음 N개 선택
        relevantIds = memoryIds.slice(0, relevantCountPerQuery);
        break;
      
      case 'pattern':
        // 패턴 기반 선택 (쿼리별로 다른 패턴)
        relevantIds = memoryIds.filter((_, i) => 
          i % (queries.length + 1) === queryIndex
        ).slice(0, relevantCountPerQuery);
        break;
      
      case 'random':
      default: {
        // 랜덤 선택 (시드 기반)
        const shuffled = [...memoryIds];
        // Fisher-Yates 셔플 (시드 기반)
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = rng.randomInt(0, i);
          const temp = shuffled[i];
          if (temp !== undefined && shuffled[j] !== undefined) {
            shuffled[i] = shuffled[j];
            shuffled[j] = temp;
          }
        }
        relevantIds = shuffled.slice(0, relevantCountPerQuery);
        break;
      }
    }

    groundTruths.push({
      queryId: query,
      relevantIds
    });
  });

  return groundTruths;
}

/**
 * Ground Truth 저장
 * JSON 파일로 Ground Truth를 저장합니다.
 * 
 * @param groundTruths 저장할 Ground Truth 배열
 * @param filePath 저장할 파일 경로 (기본값: `data/vector-search-quality-ground-truth.json`)
 * 
 * @example
 * ```typescript
 * const groundTruths = generateGroundTruth(memoryIds);
 * saveGroundTruth(groundTruths);
 * ```
 */
export function saveGroundTruth(
  groundTruths: GroundTruth[],
  filePath?: string
): void {
  const defaultPath = join(__dirname, '../../../data/vector-search-quality-ground-truth.json');
  const targetPath = filePath || defaultPath;
  const dir = dirname(targetPath);
  
  // 디렉토리가 없으면 생성
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  
  try {
    const jsonContent = JSON.stringify(groundTruths, null, 2);
    writeFileSync(targetPath, jsonContent, 'utf-8');
  } catch (error) {
    throw new Error(
      `Ground Truth 저장 실패: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Ground Truth 로드
 * JSON 파일에서 Ground Truth를 로드합니다.
 * 
 * @param filePath 로드할 파일 경로 (기본값: `data/vector-search-quality-ground-truth.json`)
 * @returns 로드된 Ground Truth 배열 또는 null (파일이 없거나 로드 실패 시)
 * 
 * @example
 * ```typescript
 * const groundTruths = loadGroundTruth();
 * if (groundTruths) {
 *   console.log(`로드된 Ground Truth 수: ${groundTruths.length}`);
 * } else {
 *   console.log('Ground Truth 파일이 없습니다. 새로 생성합니다.');
 *   const newGroundTruths = generateGroundTruth(memoryIds);
 *   saveGroundTruth(newGroundTruths);
 * }
 * ```
 */
export function loadGroundTruth(
  filePath?: string
): GroundTruth[] | null {
  const defaultPath = join(__dirname, '../../../data/vector-search-quality-ground-truth.json');
  const targetPath = filePath || defaultPath;
  
  // 파일 존재 여부 확인
  if (!existsSync(targetPath)) {
    return null;
  }
  
  try {
    // 파일 읽기
    const content = readFileSync(targetPath, 'utf-8');
    
    // JSON 파싱
    const groundTruths = JSON.parse(content) as GroundTruth[];
    
    // 기본 검증 (배열이고 각 항목이 올바른 형식인지 확인)
    if (!Array.isArray(groundTruths)) {
      throw new Error('Ground Truth는 배열이어야 합니다.');
    }
    
    for (const gt of groundTruths) {
      if (!gt.queryId || !Array.isArray(gt.relevantIds)) {
        throw new Error('Ground Truth 형식이 올바르지 않습니다.');
      }
    }
    
    return groundTruths;
  } catch (error) {
    // 로드 실패 시 null 반환 (에러 로깅은 호출자가 처리)
    return null;
  }
}

/**
 * Ground Truth 생성 또는 로드
 * 파일이 있으면 로드하고, 없으면 자동 생성하여 저장합니다.
 * 
 * @param memoryIds 메모리 ID 배열
 * @param options 생성 옵션 (파일이 없을 때만 사용)
 * @param filePath Ground Truth 파일 경로 (기본값: `data/vector-search-quality-ground-truth.json`)
 * @returns Ground Truth 배열
 * 
 * @example
 * ```typescript
 * // 파일이 있으면 로드, 없으면 생성
 * const groundTruths = generateOrLoadGroundTruth(memoryIds, {
 *   seed: 12345,
 *   queries: ['React', 'TypeScript']
 * });
 * ```
 */
export function generateOrLoadGroundTruth(
  memoryIds: string[],
  options: GroundTruthGenerationOptions = {},
  filePath?: string
): GroundTruth[] {
  // 먼저 파일에서 로드 시도
  const loaded = loadGroundTruth(filePath);
  
  if (loaded) {
    return loaded;
  }
  
  // 파일이 없으면 생성
  const generated = generateGroundTruth(memoryIds, options);
  
  // 생성한 Ground Truth 저장
  saveGroundTruth(generated, filePath);
  
  return generated;
}

