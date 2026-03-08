/**
 * VectorSearchEngine 타입 정의
 * Phase 4.8: 타입 안정성 개선 - 타입 단언 최소화
 */

import type Database from 'better-sqlite3';
import type { VectorSearchEngine } from '../../../search/algorithms/vector-search-engine.js';

/**
 * 초기화 가능한 VectorSearchEngine 타입
 * initialize 메서드가 있는 경우를 위한 타입 가드
 */
export interface InitializableVectorSearchEngine extends VectorSearchEngine {
  initialize(db: Database.Database): void | Promise<void>;
}

/**
 * VectorSearchEngine이 초기화 가능한지 확인하는 타입 가드
 */
export function isInitializableVectorSearchEngine(
  engine: VectorSearchEngine
): engine is InitializableVectorSearchEngine {
  return typeof (engine as InitializableVectorSearchEngine).initialize === 'function';
}

