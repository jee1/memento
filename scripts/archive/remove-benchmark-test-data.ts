/**
 * 벤치마크 테스트 데이터 제거 스크립트
 * 
 * Given: 데이터베이스에 저장된 벤치마크 테스트 데이터
 * When: 벤치마크 관련 메모리 및 관계 제거
 * Then: 제거 결과 반환
 */

import Database from 'better-sqlite3';
import { DatabaseUtils } from '../src/shared/utils/database.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 데이터베이스 경로 설정
const dbPath = path.join(__dirname, '..', 'data', 'memory.db');
const backupDir = path.join(__dirname, '..', 'data', 'backups');

interface RemovalResult {
  total_memories: number;
  removed_memories: number;
  total_relations: number;
  removed_relations: number;
  errors: string[];
}

/**
 * 데이터베이스 백업 생성
 */
function createBackup(db: Database.Database): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDir, `memory-before-benchmark-removal-${timestamp}.db`);
  
  // 백업 디렉토리 생성
  try {
    const fs = require('fs');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
  } catch (e) {
    // 무시
  }
  
  // 데이터베이스 백업 (better-sqlite3의 backup은 동기적)
  try {
    const backup = db.backup(backupPath);
    backup.step(-1); // 전체 백업
    backup.finish();
    console.log(`✅ 백업 생성 완료: ${backupPath}`);
  } catch (err) {
    console.error(`❌ 백업 생성 실패:`, err);
    throw err;
  }
  
  return backupPath;
}

/**
 * 벤치마크 테스트 데이터 제거
 */
async function removeBenchmarkTestData(dryRun: boolean = false): Promise<RemovalResult> {
  console.log('벤치마크 테스트 데이터 제거 시작...\n');
  
  if (dryRun) {
    console.log('⚠️  DRY RUN 모드: 실제로 제거하지 않습니다.\n');
  }
  
  const db = new Database(dbPath);
  const result: RemovalResult = {
    total_memories: 0,
    removed_memories: 0,
    total_relations: 0,
    removed_relations: 0,
    errors: []
  };
  
  try {
    // 백업 생성 (dry run이 아닌 경우)
    let backupPath: string | null = null;
    if (!dryRun) {
      backupPath = createBackup(db);
    }
    
    // 벤치마크 데이터 ID 목록 조회
    const benchmarkMemoryIds = DatabaseUtils.all(db, `
      SELECT id
      FROM memory_item
      WHERE content LIKE '%벤치마크%' 
         OR content LIKE '%benchmark%'
         OR content LIKE '%성능 테스트%'
    `) as Array<{ id: string }>;
    
    result.total_memories = benchmarkMemoryIds.length;
    
    if (benchmarkMemoryIds.length === 0) {
      console.log('제거할 벤치마크 데이터가 없습니다.');
      return result;
    }
    
    console.log(`발견된 벤치마크 데이터: ${benchmarkMemoryIds.length}개\n`);
    
    // 관련 관계 수 조회
    const relationIds = DatabaseUtils.all(db, `
      SELECT mr.id
      FROM memory_relation mr
      INNER JOIN memory_item mi1 ON mr.source_id = mi1.id
      INNER JOIN memory_item mi2 ON mr.target_id = mi2.id
      WHERE (mi1.content LIKE '%벤치마크%' 
             OR mi1.content LIKE '%benchmark%'
             OR mi1.content LIKE '%성능 테스트%')
         OR (mi2.content LIKE '%벤치마크%' 
             OR mi2.content LIKE '%benchmark%'
             OR mi2.content LIKE '%성능 테스트%')
    `) as Array<{ id: string }>;
    
    result.total_relations = relationIds.length;
    
    if (relationIds.length > 0) {
      console.log(`제거할 관계: ${relationIds.length}개\n`);
    }
    
    // 트랜잭션으로 제거 실행
    if (!dryRun) {
      await DatabaseUtils.runTransaction(db, async () => {
        // 1. 관계 먼저 제거
        if (relationIds.length > 0) {
          const relationIdList = relationIds.map(r => r.id);
          const placeholders = relationIdList.map(() => '?').join(',');
          
          const relationDeleteResult = DatabaseUtils.run(db, `
            DELETE FROM memory_relation
            WHERE id IN (${placeholders})
          `, relationIdList);
          
          result.removed_relations = relationDeleteResult.changes || 0;
          console.log(`✅ 관계 제거 완료: ${result.removed_relations}개`);
        }
        
        // 2. 메모리 제거
        const memoryIdList = benchmarkMemoryIds.map(m => m.id);
        const placeholders = memoryIdList.map(() => '?').join(',');
        
        // 임베딩도 함께 제거 (memory_embedding 테이블)
        try {
          const embeddingDeleteResult = DatabaseUtils.run(db, `
            DELETE FROM memory_embedding
            WHERE memory_id IN (${placeholders})
          `, memoryIdList);
          console.log(`✅ 임베딩 제거 완료: ${embeddingDeleteResult.changes || 0}개`);
        } catch (err) {
          console.warn(`⚠️  임베딩 제거 중 경고:`, err);
        }
        
        // 메모리 아이템 제거
        const memoryDeleteResult = DatabaseUtils.run(db, `
          DELETE FROM memory_item
          WHERE id IN (${placeholders})
        `, memoryIdList);
        
        result.removed_memories = memoryDeleteResult.changes || 0;
        console.log(`✅ 메모리 제거 완료: ${result.removed_memories}개`);
      });
    } else {
      // Dry run: 통계만 출력
      console.log('[DRY RUN] 제거될 항목:');
      console.log(`  - 메모리: ${result.total_memories}개`);
      console.log(`  - 관계: ${result.total_relations}개`);
    }
    
    // 결과 출력
    console.log('\n' + '='.repeat(80));
    console.log('📊 제거 결과');
    console.log('='.repeat(80));
    console.log(`전체 벤치마크 데이터: ${result.total_memories}개`);
    console.log(`제거된 메모리: ${result.removed_memories}개`);
    console.log(`제거된 관계: ${result.removed_relations}개`);
    
    if (result.errors.length > 0) {
      console.log(`\n⚠️  에러: ${result.errors.length}개`);
      result.errors.forEach((error, idx) => {
        console.log(`  [${idx + 1}] ${error}`);
      });
    }
    
    if (backupPath) {
      console.log(`\n💾 백업 위치: ${backupPath}`);
    }
    
    console.log('='.repeat(80));
    
  } catch (error) {
    console.error('❌ 제거 중 에러 발생:', error);
    result.errors.push(error instanceof Error ? error.message : String(error));
    throw error;
  } finally {
    db.close();
  }
  
  return result;
}

// 스크립트 실행
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.includes('-d');

removeBenchmarkTestData(dryRun)
  .then((result) => {
    if (dryRun) {
      console.log('\n💡 실제 제거를 실행하려면 --dry-run 옵션을 제거하세요.');
    } else {
      console.log('\n✅ 제거 완료');
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ 제거 실패:', error);
    process.exit(1);
  });

