/**
 * 일화 기억 중 의미 기억으로 변환 가능한 항목 조사 스크립트
 * 
 * Given: 데이터베이스에 저장된 일화 기억들
 * When: 변환 가능한 조건으로 조회
 * Then: 변환 가능한 항목 목록과 통계 반환
 */

import Database from 'better-sqlite3';
import { DatabaseUtils } from '../src/shared/utils/database.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 데이터베이스 경로 설정
const dbPath = path.join(__dirname, '..', 'data', 'memory.db');

interface ConvertibleMemory {
  id: string;
  content: string;
  importance: number;
  created_at: string;
  triple_extracted: number | null;
  triple_extracted_status: string | null;
  triple_extraction_metadata: string | null;
}

interface Statistics {
  total_episodic: number;
  already_converted: number;
  convertible: number;
  failed: number;
  abandoned: number;
  not_processed: number;
  by_status: Record<string, number>;
}

async function checkConvertibleEpisodicMemories() {
  console.log('일화 기억 중 의미 기억으로 변환 가능한 항목 조사 시작...\n');
  
  const db = new Database(dbPath);
  
  try {
    // 전체 일화 기억 통계
    const totalStats = DatabaseUtils.get(db, `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN triple_extracted = 1 AND triple_extracted_status = 'success' THEN 1 ELSE 0 END) as already_converted,
        SUM(CASE WHEN (triple_extracted IS NULL OR triple_extracted = 0) 
                    AND (triple_extracted_status IS NULL OR triple_extracted_status != 'abandoned')
                    AND (triple_extracted_status IS NULL OR triple_extracted_status != 'failed')
            THEN 1 ELSE 0 END) as convertible_not_failed,
        SUM(CASE WHEN triple_extracted_status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN triple_extracted_status = 'abandoned' THEN 1 ELSE 0 END) as abandoned,
        SUM(CASE WHEN triple_extracted IS NULL THEN 1 ELSE 0 END) as not_processed
      FROM memory_item
      WHERE type = 'episodic'
    `) as {
      total: number;
      already_converted: number;
      convertible_not_failed: number;
      failed: number;
      abandoned: number;
      not_processed: number;
    };
    
    // 상태별 통계
    const statusStats = DatabaseUtils.all(db, `
      SELECT 
        COALESCE(triple_extracted_status, 'not_processed') as status,
        COUNT(*) as count
      FROM memory_item
      WHERE type = 'episodic'
      GROUP BY triple_extracted_status
      ORDER BY count DESC
    `) as Array<{ status: string; count: number }>;
    
    // 변환 가능한 항목 조회 (실패한 항목 제외)
    const convertibleMemories = DatabaseUtils.all(db, `
      SELECT 
        id,
        content,
        importance,
        created_at,
        triple_extracted,
        triple_extracted_status,
        triple_extraction_metadata
      FROM memory_item
      WHERE type = 'episodic'
        AND (triple_extracted IS NULL OR triple_extracted = 0)
        AND (triple_extracted_status IS NULL OR triple_extracted_status != 'abandoned')
        AND (triple_extracted_status IS NULL OR triple_extracted_status != 'failed')
      ORDER BY created_at ASC
      LIMIT 20
    `) as ConvertibleMemory[];
    
    // 실패한 항목 조회 (재시도 가능)
    const failedMemories = DatabaseUtils.all(db, `
      SELECT 
        id,
        content,
        importance,
        created_at,
        triple_extracted,
        triple_extracted_status,
        triple_extraction_metadata
      FROM memory_item
      WHERE type = 'episodic'
        AND triple_extracted_status = 'failed'
      ORDER BY created_at ASC
      LIMIT 10
    `) as ConvertibleMemory[];
    
    // 이미 변환된 항목 샘플
    const convertedSample = DatabaseUtils.all(db, `
      SELECT 
        id,
        content,
        importance,
        created_at,
        triple_extracted,
        triple_extracted_status,
        triple_extraction_metadata
      FROM memory_item
      WHERE type = 'episodic'
        AND triple_extracted = 1
        AND triple_extracted_status = 'success'
      ORDER BY created_at DESC
      LIMIT 5
    `) as ConvertibleMemory[];
    
    // 결과 출력
    console.log('='.repeat(80));
    console.log('📊 일화 기억 변환 가능성 통계');
    console.log('='.repeat(80));
    console.log(`전체 일화 기억: ${totalStats.total}개`);
    console.log(`이미 변환됨: ${totalStats.already_converted}개`);
    console.log(`변환 가능 (실패 제외): ${totalStats.convertible_not_failed}개`);
    console.log(`실패한 항목 (재시도 가능): ${totalStats.failed}개`);
    console.log(`포기된 항목: ${totalStats.abandoned}개`);
    console.log(`미처리 항목: ${totalStats.not_processed}개`);
    console.log();
    
    console.log('📈 상태별 분포:');
    statusStats.forEach(stat => {
      console.log(`  - ${stat.status}: ${stat.count}개`);
    });
    console.log();
    
    if (convertibleMemories.length > 0) {
      console.log('='.repeat(80));
      console.log(`✅ 변환 가능한 일화 기억 (최대 20개, 실패 제외)`);
      console.log('='.repeat(80));
      convertibleMemories.forEach((mem, idx) => {
        console.log(`\n[${idx + 1}] ID: ${mem.id}`);
        console.log(`    중요도: ${mem.importance}`);
        console.log(`    생성일: ${mem.created_at}`);
        console.log(`    상태: ${mem.triple_extracted_status || '미처리'}`);
        console.log(`    내용: ${mem.content.substring(0, 100)}${mem.content.length > 100 ? '...' : ''}`);
        if (mem.triple_extraction_metadata) {
          try {
            const meta = JSON.parse(mem.triple_extraction_metadata);
            console.log(`    메타데이터: ${JSON.stringify(meta, null, 2)}`);
          } catch (e) {
            // 무시
          }
        }
      });
      console.log();
    } else {
      console.log('변환 가능한 일화 기억이 없습니다 (실패 제외).\n');
    }
    
    if (failedMemories.length > 0) {
      console.log('='.repeat(80));
      console.log(`⚠️  실패한 일화 기억 (재시도 가능, 최대 10개)`);
      console.log('='.repeat(80));
      failedMemories.forEach((mem, idx) => {
        console.log(`\n[${idx + 1}] ID: ${mem.id}`);
        console.log(`    중요도: ${mem.importance}`);
        console.log(`    생성일: ${mem.created_at}`);
        console.log(`    내용: ${mem.content.substring(0, 100)}${mem.content.length > 100 ? '...' : ''}`);
        if (mem.triple_extraction_metadata) {
          try {
            const meta = JSON.parse(mem.triple_extraction_metadata);
            console.log(`    실패 사유: ${meta.failureReason || 'unknown'}`);
            console.log(`    재시도 횟수: ${meta.retry_count || 0}`);
          } catch (e) {
            // 무시
          }
        }
      });
      console.log();
    }
    
    if (convertedSample.length > 0) {
      console.log('='.repeat(80));
      console.log(`✓ 이미 변환된 일화 기억 샘플 (최근 5개)`);
      console.log('='.repeat(80));
      convertedSample.forEach((mem, idx) => {
        console.log(`\n[${idx + 1}] ID: ${mem.id}`);
        console.log(`    중요도: ${mem.importance}`);
        console.log(`    생성일: ${mem.created_at}`);
        console.log(`    내용: ${mem.content.substring(0, 100)}${mem.content.length > 100 ? '...' : ''}`);
        if (mem.triple_extraction_metadata) {
          try {
            const meta = JSON.parse(mem.triple_extraction_metadata);
            console.log(`    Triple 수: ${meta.triple_count || 0}`);
            console.log(`    평균 신뢰도: ${meta.confidence_avg || 'N/A'}`);
            console.log(`    변환일: ${meta.extracted_at || 'N/A'}`);
          } catch (e) {
            // 무시
          }
        }
      });
      console.log();
    }
    
    // 중요도가 높은 변환 가능한 항목 조회
    const highImportanceMemories = DatabaseUtils.all(db, `
      SELECT 
        id,
        content,
        importance,
        created_at,
        triple_extracted,
        triple_extracted_status
      FROM memory_item
      WHERE type = 'episodic'
        AND importance >= 0.7
        AND (triple_extracted IS NULL OR triple_extracted = 0)
        AND (triple_extracted_status IS NULL OR triple_extracted_status != 'abandoned')
        AND (triple_extracted_status IS NULL OR triple_extracted_status != 'failed')
      ORDER BY importance DESC, created_at DESC
      LIMIT 10
    `) as ConvertibleMemory[];
    
    // 테스트 데이터가 아닌 실제 기억 조회
    const realMemories = DatabaseUtils.all(db, `
      SELECT 
        id,
        content,
        importance,
        created_at,
        triple_extracted,
        triple_extracted_status
      FROM memory_item
      WHERE type = 'episodic'
        AND (triple_extracted IS NULL OR triple_extracted = 0)
        AND (triple_extracted_status IS NULL OR triple_extracted_status != 'abandoned')
        AND (triple_extracted_status IS NULL OR triple_extracted_status != 'failed')
        AND content NOT LIKE '%벤치마크%'
        AND content NOT LIKE '%테스트%'
        AND content NOT LIKE '%test%'
        AND content NOT LIKE '%Test%'
      ORDER BY importance DESC, created_at DESC
      LIMIT 10
    `) as ConvertibleMemory[];
    
    // 테스트 데이터가 아닌 실제 기억 통계
    const realMemoriesStats = DatabaseUtils.get(db, `
      SELECT 
        COUNT(*) as count,
        AVG(importance) as avg_importance,
        MAX(importance) as max_importance,
        MIN(importance) as min_importance
      FROM memory_item
      WHERE type = 'episodic'
        AND (triple_extracted IS NULL OR triple_extracted = 0)
        AND (triple_extracted_status IS NULL OR triple_extracted_status != 'abandoned')
        AND (triple_extracted_status IS NULL OR triple_extracted_status != 'failed')
        AND content NOT LIKE '%벤치마크%'
        AND content NOT LIKE '%테스트%'
        AND content NOT LIKE '%test%'
        AND content NOT LIKE '%Test%'
    `) as {
      count: number;
      avg_importance: number;
      max_importance: number;
      min_importance: number;
    };
    
    if (highImportanceMemories.length > 0) {
      console.log('='.repeat(80));
      console.log(`⭐ 중요도 높은 변환 가능한 일화 기억 (importance >= 0.7, 최대 10개)`);
      console.log('='.repeat(80));
      highImportanceMemories.forEach((mem, idx) => {
        console.log(`\n[${idx + 1}] ID: ${mem.id}`);
        console.log(`    중요도: ${mem.importance}`);
        console.log(`    생성일: ${mem.created_at}`);
        console.log(`    내용: ${mem.content.substring(0, 150)}${mem.content.length > 150 ? '...' : ''}`);
      });
      console.log();
    }
    
    if (realMemories.length > 0) {
      console.log('='.repeat(80));
      console.log(`📝 실제 기억 (테스트 데이터 제외, 최대 10개)`);
      console.log('='.repeat(80));
      console.log(`통계: ${realMemoriesStats.count}개, 평균 중요도: ${realMemoriesStats.avg_importance?.toFixed(2) || 'N/A'}, 최대: ${realMemoriesStats.max_importance || 'N/A'}, 최소: ${realMemoriesStats.min_importance || 'N/A'}`);
      console.log();
      realMemories.forEach((mem, idx) => {
        console.log(`\n[${idx + 1}] ID: ${mem.id}`);
        console.log(`    중요도: ${mem.importance}`);
        console.log(`    생성일: ${mem.created_at}`);
        console.log(`    내용: ${mem.content.substring(0, 200)}${mem.content.length > 200 ? '...' : ''}`);
      });
      console.log();
    }
    
    console.log('='.repeat(80));
    console.log('💡 변환 방법');
    console.log('='.repeat(80));
    console.log('1. 변환 가능한 항목 변환 (실패 제외):');
    console.log('   convert_episodic_to_semantic({ skip_converted: true, retry_failed: false, limit: 10 })');
    console.log();
    console.log('2. 실패한 항목 재시도:');
    console.log('   convert_episodic_to_semantic({ skip_converted: true, retry_failed: true, limit: 10 })');
    console.log();
    console.log('3. 특정 항목 변환:');
    console.log('   convert_episodic_to_semantic({ memory_id: "mem_xxx" })');
    console.log('='.repeat(80));
    
  } catch (error) {
    console.error('에러 발생:', error);
    throw error;
  } finally {
    db.close();
  }
}

// 스크립트 실행
checkConvertibleEpisodicMemories()
  .then(() => {
    console.log('\n✅ 조사 완료');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ 조사 실패:', error);
    process.exit(1);
  });

