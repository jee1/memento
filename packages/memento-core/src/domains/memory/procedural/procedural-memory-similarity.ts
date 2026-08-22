/**
 * Procedural Memory 유사도·병합 전략
 * 기존 procedural memory와의 유사도 계산 및 병합 결정
 */

import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { logger } from '../../../shared/utils/logger.js';
import { PIIMasker } from '../../../shared/utils/pii-masker.js';
import type { ExtractedProceduralMemory } from './procedural-memory-extractor.types.js';

/**
 * 유사도 기반 병합 결과
 */
export interface SimilarityMergeResult {
  shouldMerge: boolean;
  similarity: number;
  existingMemoryId?: string;
  updateMode: 'replace' | 'incremental' | 'versioned';
}

const SIMILARITY_THRESHOLD = 0.7;
const HIGH_SIMILARITY_THRESHOLD = 0.9;

/** 병합 후보 기존 메모리 행 (검색 쿼리 결과) */
interface ExistingMemoryRow {
  id: string;
  workflow_name: string | null;
  skill_name: string | null;
  task_goal: string | null;
  steps: string | null;
}

const EXISTING_MEMORY_SELECT = `
  SELECT id, workflow_name, skill_name, task_goal, steps
  FROM memory_item
  WHERE type = 'procedural'
`.trim();

/** 완전 일치 쿼리 조건·파라미터 구성 */
function buildExactMatchQuery(extracted: ExtractedProceduralMemory): { conditions: string[]; params: (string | number)[] } {
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (extracted.workflow_name) {
    conditions.push('workflow_name = ?');
    params.push(extracted.workflow_name);
  }
  if (extracted.skill_name) {
    conditions.push('skill_name = ?');
    params.push(extracted.skill_name);
  }
  return { conditions, params };
}

/** LIKE fallback 검색 (AND 조건) */
function runFallbackSearchAnd(
  db: Database.Database,
  extracted: ExtractedProceduralMemory
): ExistingMemoryRow[] {
  const fallbackConditions: string[] = [];
  const fallbackParams: (string | number)[] = [];
  if (extracted.workflow_name) {
    fallbackConditions.push('LOWER(workflow_name) LIKE LOWER(?)');
    fallbackParams.push(`%${extracted.workflow_name}%`);
  }
  if (extracted.skill_name) {
    fallbackConditions.push('LOWER(skill_name) LIKE LOWER(?)');
    fallbackParams.push(`%${extracted.skill_name}%`);
  }
  if (fallbackConditions.length === 0) return [];
  const query = `${EXISTING_MEMORY_SELECT}
    AND ${fallbackConditions.join(' AND ')}
    ORDER BY created_at DESC
    LIMIT 20`;
  return DatabaseUtils.all(db, query, fallbackParams) as ExistingMemoryRow[];
}

/** LIKE fallback 검색 (OR 조건) */
function runFallbackSearchOr(
  db: Database.Database,
  extracted: ExtractedProceduralMemory
): ExistingMemoryRow[] {
  const fallbackConditions: string[] = [];
  const fallbackParams: (string | number)[] = [];
  if (extracted.workflow_name) {
    fallbackConditions.push('LOWER(workflow_name) LIKE LOWER(?)');
    fallbackParams.push(`%${extracted.workflow_name}%`);
  }
  if (extracted.skill_name) {
    fallbackConditions.push('LOWER(skill_name) LIKE LOWER(?)');
    fallbackParams.push(`%${extracted.skill_name}%`);
  }
  if (fallbackConditions.length === 0) return [];
  const query = `${EXISTING_MEMORY_SELECT}
    AND (${fallbackConditions.join(' OR ')})
    ORDER BY created_at DESC
    LIMIT 20`;
  return DatabaseUtils.all(db, query, fallbackParams) as ExistingMemoryRow[];
}

/**
 * 기존 procedural memory와의 유사도 계산
 *
 * 유사도 계산 전략:
 * 1. workflow_name 일치 여부
 * 2. skill_name 일치 여부
 * 3. task_goal 유사도 (문자열 유사도)
 * 4. steps 유사도 (JSON 배열 비교)
 */
export function calculateSimilarity(
  extracted: ExtractedProceduralMemory,
  existing: {
    workflow_name?: string | null;
    skill_name?: string | null;
    task_goal?: string | null;
    steps?: string | null;
  }
): number {
  let similarity = 0;
  let weightSum = 0;

  // 1. workflow_name 일치 (가중치: 0.3)
  if (extracted.workflow_name && existing.workflow_name) {
    const weight = 0.3;
    weightSum += weight;
    if (extracted.workflow_name === existing.workflow_name) {
      similarity += weight;
    } else if (extracted.workflow_name.toLowerCase().includes(existing.workflow_name.toLowerCase()) ||
               existing.workflow_name.toLowerCase().includes(extracted.workflow_name.toLowerCase())) {
      similarity += weight * 0.7;
    }
  }

  // 2. skill_name 일치 (가중치: 0.3)
  if (extracted.skill_name && existing.skill_name) {
    const weight = 0.3;
    weightSum += weight;
    if (extracted.skill_name === existing.skill_name) {
      similarity += weight;
    } else if (extracted.skill_name.toLowerCase().includes(existing.skill_name.toLowerCase()) ||
               existing.skill_name.toLowerCase().includes(extracted.skill_name.toLowerCase())) {
      similarity += weight * 0.7;
    }
  }

  // 3. task_goal 유사도 (가중치: 0.2)
  if (extracted.task_goal && existing.task_goal) {
    const weight = 0.2;
    weightSum += weight;
    // 간단한 문자열 유사도 (공통 단어 비율)
    const extractedWords = extracted.task_goal.toLowerCase().split(/\s+/);
    const existingWords = existing.task_goal.toLowerCase().split(/\s+/);
    const commonWords = extractedWords.filter(w => existingWords.includes(w));
    const similarityRatio = commonWords.length / Math.max(extractedWords.length, existingWords.length);
    similarity += weight * similarityRatio;
  }

  // 4. steps 유사도 (가중치: 0.2)
  if (extracted.steps && existing.steps) {
    const weight = 0.2;
    weightSum += weight;
    try {
      const extractedSteps = JSON.parse(extracted.steps) as string[];
      const existingSteps = JSON.parse(existing.steps) as string[];

      // 공통 steps 비율
      const commonSteps = extractedSteps.filter(s =>
        existingSteps.some(es => es.toLowerCase().includes(s.toLowerCase()) ||
                                 s.toLowerCase().includes(es.toLowerCase()))
      );
      const similarityRatio = commonSteps.length / Math.max(extractedSteps.length, existingSteps.length);
      similarity += weight * similarityRatio;
    } catch (error) {
      // JSON 파싱 실패 시 0점
    }
  }

  // 가중치 합으로 정규화
  return weightSum > 0 ? similarity / weightSum : 0;
}

/**
 * 유사도 기반 병합 결정
 *
 * 결정 전략:
 * 1. 유사도가 SIMILARITY_THRESHOLD 이상이면 병합
 * 2. 유사도가 HIGH_SIMILARITY_THRESHOLD 이상이면 replace 모드
 * 3. 그 외에는 incremental 모드
 * 4. 유사도가 임계값 미만이면 새로 생성 (versioned 모드)
 */
export async function determineMergeStrategy(
  db: Database.Database,
  extracted: ExtractedProceduralMemory
): Promise<SimilarityMergeResult> {
  try {
    const { conditions, params } = buildExactMatchQuery(extracted);
    if (conditions.length === 0) {
      return {
        shouldMerge: false,
        similarity: 0,
        updateMode: 'versioned'
      };
    }

    const conditionOperator = extracted.workflow_name && extracted.skill_name ? 'AND' : '';
    const exactQuery = `${EXISTING_MEMORY_SELECT}
      AND ${conditions.join(` ${conditionOperator} `)}
      ORDER BY created_at DESC
      LIMIT 10`;
    let existingMemories: ExistingMemoryRow[] = DatabaseUtils.all(db, exactQuery, params) as ExistingMemoryRow[];

    if (existingMemories.length === 0) {
      existingMemories = runFallbackSearchAnd(db, extracted);
      if (existingMemories.length === 0 && (extracted.workflow_name || extracted.skill_name)) {
        existingMemories = runFallbackSearchOr(db, extracted);
      }
    }

    if (existingMemories.length === 0) {
      return {
        shouldMerge: false,
        similarity: 0,
        updateMode: 'versioned'
      };
    }

    // 각 기존 메모리와 유사도 계산
    let maxSimilarity = 0;
    let bestMatch: typeof existingMemories[0] | undefined;

    for (const existing of existingMemories) {
      const similarity = calculateSimilarity(extracted, existing);
      if (similarity > maxSimilarity) {
        maxSimilarity = similarity;
        bestMatch = existing;
      }
    }

    // 병합 결정
    if (maxSimilarity >= SIMILARITY_THRESHOLD) {
      const updateMode = maxSimilarity >= HIGH_SIMILARITY_THRESHOLD ? 'replace' : 'incremental';
      return {
        shouldMerge: true,
        similarity: maxSimilarity,
        existingMemoryId: bestMatch?.id,
        updateMode
      };
    }

    return {
      shouldMerge: false,
      similarity: maxSimilarity,
      updateMode: 'versioned'
    };
  } catch (error) {
    const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
    logger.error('병합 전략 결정 실패', PIIMasker.maskObject({
      error: maskedError.message
    }));
    return {
      shouldMerge: false,
      similarity: 0,
      updateMode: 'versioned'
    };
  }
}
