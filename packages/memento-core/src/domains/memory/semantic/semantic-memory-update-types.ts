/**
 * Semantic Memory 업데이트 공유 타입·상수
 */

import type { ExtractionInfo, Triple } from '../../../shared/types/triple-extraction.js';

/** Confidence 임계값 기본값 (PRD 2.4) */
export const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

/** Subject/Object 유사도 임계값 기본값 */
export const DEFAULT_SIMILARITY_THRESHOLD = 0.9;

/**
 * Memory ID 생성 유틸리티
 */
export function generateSemanticMemoryId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 11);
  return `mem_${timestamp}_${random}`;
}

/**
 * Semantic Memory 업데이트 결과
 */
export interface SemanticMemoryUpdateResult {
  created: number;
  updated: number;
  skipped: number;
  semanticMemoryIds: string[];
}

/**
 * Semantic Memory 업데이트 옵션
 */
export interface SemanticMemoryUpdateOptions {
  episodicMemoryId: string;
  episodicImportance?: number;
  confidenceThreshold?: number;
  similarityThreshold?: number;
}

export interface InvocationPolicySnapshot {
  episodicMemoryId: string;
  episodicImportance: number;
  confidenceThreshold: number;
  similarityThreshold: number;
}

export interface InvocationInputPosition {
  index: number;
  triple: Triple | null;
}

export interface EpisodicSourceSnapshot {
  id: string;
  type: 'episodic';
  content: string;
  importance: number | null;
  ownerId: string | null;
  projectId: string | null;
  isDeleted: false;
  tripleExtracted: number | null;
  tripleExtractedStatus: string | null;
  tripleExtractionMetadata: string | null;
}

export interface NormalizedTripleSnapshot {
  index: number;
  subject: string;
  predicate: string;
  object: string;
  predicateCanonicalized: boolean;
  subjectLinked: boolean;
  objectLinked: boolean;
  confidence: number;
}

export type SemanticMemoryUpdateRequestSnapshot =
  | { kind: 'empty'; result: SemanticMemoryUpdateResult }
  | {
      kind: 'ready';
      policy: InvocationPolicySnapshot;
      positions: InvocationInputPosition[];
      extractionInfo: ExtractionInfo;
    };

export interface PreparedUpdateData {
  confidenceThreshold: number;
  similarityThreshold: number;
  result: SemanticMemoryUpdateResult;
  confidences: number[];
  hasError: boolean;
}
