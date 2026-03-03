#!/usr/bin/env node

/**
 * vec0 테이블 차원 수정 스크립트
 * memory_item_vec_tfidf 테이블을 512차원으로 재생성하고 기존 임베딩을 재인덱싱합니다.
 * 
 * 사용법:
 *   npx tsx scripts/fix-vec-table-dimensions.ts [--confirm]
 */

import { initializeDatabase } from '../src/infrastructure/database/database/init.js';
import Database from 'better-sqlite3';
import { mementoConfig } from '../src/shared/config/index.js';

async function fixVecTableDimensions() {
  const shouldConfirm = process.argv.includes('--confirm');
  
  console.log('🔧 vec0 테이블 차원 수정 중...\n');
  console.log(`데이터베이스 경로: ${mementoConfig.dbPath}\n`);

  let db: Database.Database | null = null;

  try {
    db = await initializeDatabase();

    // 1. 현재 테이블 상태 확인
    console.log('📊 현재 테이블 상태:');
    const tfidfTable = db.prepare(`
      SELECT name, sql 
      FROM sqlite_master 
      WHERE type='table' AND name='memory_item_vec_tfidf'
    `).get() as { name: string; sql: string } | undefined;

    if (!tfidfTable) {
      console.log('❌ memory_item_vec_tfidf 테이블이 존재하지 않습니다.');
      process.exit(1);
    }

    const dimensionMatch = tfidfTable.sql.match(/float\[(\d+)\]/);
    const currentDimension = dimensionMatch ? parseInt(dimensionMatch[1]) : null;
    
    console.log(`   memory_item_vec_tfidf: ${currentDimension}차원\n`);

    if (currentDimension === 512) {
      console.log('✅ 테이블이 이미 올바른 차원(512)으로 설정되어 있습니다.');
      
      // 데이터가 있는지 확인
      const rowCount = (db.prepare(`SELECT COUNT(*) as count FROM memory_item_vec_tfidf`).get() as { count: number })?.count ?? 0;
      if (rowCount === 0) {
        console.log('⚠️  테이블에 데이터가 없습니다. 재인덱싱이 필요합니다.\n');
        
        if (!shouldConfirm) {
          console.log('💡 재인덱싱을 실행하려면 --confirm 플래그를 사용하세요:');
          console.log('   npx tsx scripts/fix-vec-table-dimensions.ts --confirm\n');
          process.exit(1);
        }
        
        // 재인덱싱 진행
        console.log('🔧 재인덱싱 진행 중...\n');
      } else {
        console.log(`✅ 테이블에 ${rowCount}개의 행이 있습니다.\n`);
        process.exit(0);
      }
    }

    if (!shouldConfirm) {
      console.log('⚠️  경고: 이 작업은 memory_item_vec_tfidf 테이블을 삭제하고 재생성합니다.');
      console.log('   기존 벡터 인덱스 데이터가 삭제되지만, memory_embedding 테이블의 데이터는 유지됩니다.');
      console.log('   트리거가 자동으로 데이터를 재인덱싱합니다.\n');
      console.log('💡 실행하려면 --confirm 플래그를 사용하세요:');
      console.log('   npx tsx scripts/fix-vec-table-dimensions.ts --confirm\n');
      process.exit(1);
    }

    console.log('🔧 테이블 재생성 중...\n');

    // 2. 트리거 일시 비활성화 (선택적, 트리거가 자동으로 재인덱싱하므로 필요 없을 수 있음)
    // 하지만 안전을 위해 트리거를 삭제하고 재생성하는 것이 좋습니다.

    // 3. 기존 테이블 삭제
    console.log('   1. 기존 테이블 삭제 중...');
    db.exec('DROP TABLE IF EXISTS memory_item_vec_tfidf');
    console.log('      ✅ 완료\n');

    // 4. 512차원 테이블 재생성
    console.log('   2. 512차원 테이블 재생성 중...');
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_item_vec_tfidf 
      USING vec0(embedding float[512])
    `);
    console.log('      ✅ 완료\n');

    // 5. 트리거가 자동으로 재인덱싱하도록 확인
    console.log('   3. 트리거 상태 확인 중...');
    const insertTrigger = db.prepare(`
      SELECT sql 
      FROM sqlite_master 
      WHERE type='trigger' AND name='memory_embedding_vec_insert'
    `).get() as { sql: string } | undefined;

    if (insertTrigger && insertTrigger.sql.includes("dimensions = 512")) {
      console.log('      ✅ 트리거가 올바르게 설정되어 있습니다.\n');
    } else {
      console.log('      ⚠️  트리거에 문제가 있을 수 있습니다. check-and-fix-trigger.ts를 실행하세요.\n');
    }

    // 6. 재인덱싱: 트리거를 통해 자동으로 재인덱싱
    // 트리거는 UPDATE 이벤트를 감지하므로, 임베딩을 업데이트하여 트리거를 활성화
    console.log('   4. 기존 임베딩 재인덱싱 중 (트리거 사용)...');
    const tfidfEmbeddings = db.prepare(`
      SELECT id, embedding, dimensions
      FROM memory_embedding
      WHERE embedding_provider = 'tfidf' 
        AND dimensions = 512
        AND projection_type = 'native'
    `).all() as Array<{
      id: number;
      embedding: string;
      dimensions: number;
    }>;

    console.log(`      발견된 임베딩: ${tfidfEmbeddings.length}개`);

    let updatedCount = 0;
    // 트리거를 활성화하기 위해 각 임베딩을 업데이트
    // 실제 값은 변경하지 않고 동일한 값으로 업데이트하여 트리거만 활성화
    for (const emb of tfidfEmbeddings) {
      try {
        // UPDATE를 통해 트리거 활성화 (트리거가 자동으로 vec0 테이블에 삽입)
        db.prepare(`
          UPDATE memory_embedding
          SET embedding = embedding
          WHERE id = ?
        `).run(emb.id);
        updatedCount++;
      } catch (error) {
        console.log(`      ⚠️  임베딩 ${emb.id} 업데이트 실패: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    console.log(`      ✅ ${updatedCount}개 임베딩 업데이트 완료 (트리거가 자동으로 재인덱싱)\n`);

    // 7. 최종 확인
    console.log('📊 최종 상태:');
    const finalRowCount = (db.prepare(`SELECT COUNT(*) as count FROM memory_item_vec_tfidf`).get() as { count: number })?.count ?? 0;
    const finalTable = db.prepare(`
      SELECT sql 
      FROM sqlite_master 
      WHERE type='table' AND name='memory_item_vec_tfidf'
    `).get() as { sql: string } | undefined;
    
    const finalDimensionMatch = finalTable?.sql.match(/float\[(\d+)\]/);
    const finalDimension = finalDimensionMatch ? parseInt(finalDimensionMatch[1]) : null;

    console.log(`   memory_item_vec_tfidf: ${finalDimension}차원, ${finalRowCount}개 행`);
    
    if (finalDimension === 512 && finalRowCount > 0) {
      console.log('\n✅ 테이블 차원 수정이 성공적으로 완료되었습니다!');
      process.exit(0);
    } else {
      console.log('\n⚠️  테이블 차원 수정이 완료되었지만 데이터가 없을 수 있습니다.');
      console.log('   트리거가 자동으로 재인덱싱할 때까지 기다리거나,');
      console.log('   새로운 임베딩을 생성하면 자동으로 인덱싱됩니다.');
      process.exit(0);
    }

  } catch (error) {
    console.error('❌ 오류 발생:', error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error('스택 트레이스:', error.stack);
    }
    process.exit(1);
  } finally {
    if (db) {
      db.close();
    }
  }
}

fixVecTableDimensions();
