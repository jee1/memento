#!/usr/bin/env node

/**
 * 임베딩 차원 상태 확인 스크립트
 * DB에 저장된 임베딩 차원과 테이블 차원을 확인합니다.
 */

import { initializeDatabase } from '../src/infrastructure/database/database/init.js';
import Database from 'better-sqlite3';
import { mementoConfig } from '../src/shared/config/index.js';

async function main() {
  console.log('🔍 임베딩 차원 상태 확인 중...\n');
  console.log(`데이터베이스 경로: ${mementoConfig.dbPath}\n`);

  let db: Database.Database | null = null;

  try {
    db = await initializeDatabase();

    // 1. memory_embedding 테이블의 차원 통계
    console.log('📊 memory_embedding 테이블 차원 통계:');
    const embeddingStats = db.prepare(`
      SELECT 
        embedding_provider,
        COUNT(*) as count,
        GROUP_CONCAT(DISTINCT dimensions) as dimensions_list,
        GROUP_CONCAT(DISTINCT dim) as dim_list
      FROM memory_embedding
      GROUP BY embedding_provider
    `).all() as Array<{
      embedding_provider: string;
      count: number;
      dimensions_list: string | null;
      dim_list: string | null;
    }>;

    if (embeddingStats.length === 0) {
      console.log('   ⚠️  저장된 임베딩이 없습니다.\n');
    } else {
      for (const stat of embeddingStats) {
        console.log(`   ${stat.embedding_provider}:`);
        console.log(`     - 개수: ${stat.count}`);
        console.log(`     - dimensions: ${stat.dimensions_list || 'NULL'}`);
        console.log(`     - dim: ${stat.dim_list || 'NULL'}`);
      }
      console.log('');
    }

    // 2. vec0 테이블 상태 확인
    console.log('📊 vec0 테이블 상태:');
    const vecTables = db.prepare(`
      SELECT name, sql 
      FROM sqlite_master 
      WHERE type='table' AND name LIKE 'memory_item_vec%'
    `).all() as Array<{ name: string; sql: string }>;

    for (const table of vecTables) {
      // 차원 추출 (float[384] 형식에서)
      const dimensionMatch = table.sql.match(/float\[(\d+)\]/);
      const dimension = dimensionMatch ? dimensionMatch[1] : 'unknown';
      
      // 행 개수 확인
      let rowCount = 0;
      try {
        const countResult = db.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get() as { count: number } | undefined;
        rowCount = countResult?.count ?? 0;
      } catch (error) {
        // 테이블이 없거나 접근할 수 없는 경우
        rowCount = -1;
      }

      console.log(`   ${table.name}:`);
      console.log(`     - 차원: ${dimension}`);
      console.log(`     - 행 개수: ${rowCount >= 0 ? rowCount : 'N/A'}`);
    }
    console.log('');

    // 3. 트리거에서 사용하는 차원 조건 확인
    console.log('📊 트리거 차원 조건:');
    const insertTrigger = db.prepare(`
      SELECT sql 
      FROM sqlite_master 
      WHERE type='trigger' AND name='memory_embedding_vec_insert'
    `).get() as { sql: string } | undefined;

    if (insertTrigger) {
      const tfidfMatch = insertTrigger.sql.match(/tfidf.*?dimensions\s*=\s*(\d+)/);
      const minilmMatch = insertTrigger.sql.match(/minilm.*?dimensions\s*=\s*(\d+)/);
      
      console.log(`   memory_embedding_vec_insert:`);
      if (tfidfMatch) {
        console.log(`     - TF-IDF 차원 조건: ${tfidfMatch[1]}`);
      }
      if (minilmMatch) {
        console.log(`     - MiniLM 차원 조건: ${minilmMatch[1]}`);
      }
    }
    console.log('');

    // 4. provider별 테이블 매핑 확인
    console.log('📊 Provider별 테이블 매핑:');
    const { VECTOR_SEARCH_CONFIG } = await import('../src/shared/config/vector-search.config.js');
    for (const [provider, tableName] of Object.entries(VECTOR_SEARCH_CONFIG.tableNames)) {
      const expectedDim = VECTOR_SEARCH_CONFIG.providerDimensions[provider as keyof typeof VECTOR_SEARCH_CONFIG.providerDimensions];
      console.log(`   ${provider}: ${tableName} (예상 차원: ${expectedDim})`);
    }

  } catch (error) {
    console.error('❌ 오류 발생:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  } finally {
    if (db) {
      db.close();
    }
  }
}

main();
