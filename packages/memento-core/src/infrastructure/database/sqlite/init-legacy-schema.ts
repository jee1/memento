import type Database from 'better-sqlite3';
import { log } from './init-log.js';
import {
  
  
  
  repopulateVecTable,
  type VecTableConfig
} from './vec-schema.js';


export function populateVecTables(db: Database.Database, configs: VecTableConfig[]): void {
  if (!configs.length) {
    return;
  }

  const hasEmbeddingTable = !!db
    .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='memory_embedding'`)
    .get();

  if (!hasEmbeddingTable) {
    return;
  }

  for (const config of configs) {
    try {
      // repopulateVecTable이 VEC_TABLES 화이트리스트로 테이블명을 검증한다.
      repopulateVecTable(db, config);
    } catch (error) {
      log(`[WARN] ${config.name} 재구축 중 오류 발생:`, error);
    }
  }
}
