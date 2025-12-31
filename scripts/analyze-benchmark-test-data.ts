/**
 * 벤치마크 테스트 데이터 분석 스크립트
 * 
 * Given: 데이터베이스에 저장된 벤치마크 테스트 데이터
 * When: 벤치마크 관련 메모리 조회
 * Then: 제거 가능한 항목 목록과 통계 반환
 */

import Database from 'better-sqlite3';
import { DatabaseUtils } from '../src/shared/utils/database.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 데이터베이스 경로 설정
const dbPath = path.join(__dirname, '..', 'data', 'memory.db');

interface BenchmarkMemory {
  id: string;
  type: string;
  content: string;
  importance: number;
  created_at: string;
  triple_extracted: number | null;
  triple_extracted_status: string | null;
  relation_count: number;
}

async function analyzeBenchmarkTestData() {
  console.log('벤치마크 테스트 데이터 분석 시작...\n');
  
  const db = new Database(dbPath);
  
  try {
    // 벤치마크 테스트 데이터 통계
    const benchmarkStats = DatabaseUtils.get(db, `
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN type = 'episodic' THEN 1 END) as episodic_count,
        COUNT(CASE WHEN type = 'semantic' THEN 1 END) as semantic_count,
        COUNT(CASE WHEN type = 'working' THEN 1 END) as working_count,
        COUNT(CASE WHEN type = 'procedural' THEN 1 END) as procedural_count,
        COUNT(CASE WHEN triple_extracted = 1 THEN 1 END) as converted_count,
        AVG(importance) as avg_importance
      FROM memory_item
      WHERE content LIKE '%벤치마크%' 
         OR content LIKE '%benchmark%'
         OR content LIKE '%성능 테스트%'
    `) as {
      total: number;
      episodic_count: number;
      semantic_count: number;
      working_count: number;
      procedural_count: number;
      converted_count: number;
      avg_importance: number;
    };
    
    // 벤치마크 데이터와 관련된 관계 수
    const relationStats = DatabaseUtils.get(db, `
      SELECT 
        COUNT(*) as total_relations,
        COUNT(DISTINCT source_id) as source_memories,
        COUNT(DISTINCT target_id) as target_memories
      FROM memory_relation mr
      INNER JOIN memory_item mi1 ON mr.source_id = mi1.id
      INNER JOIN memory_item mi2 ON mr.target_id = mi2.id
      WHERE (mi1.content LIKE '%벤치마크%' 
             OR mi1.content LIKE '%benchmark%'
             OR mi1.content LIKE '%성능 테스트%')
         OR (mi2.content LIKE '%벤치마크%' 
             OR mi2.content LIKE '%benchmark%'
             OR mi2.content LIKE '%성능 테스트%')
    `) as {
      total_relations: number;
      source_memories: number;
      target_memories: number;
    };
    
    // 벤치마크 데이터 샘플 조회 (관계 수 포함)
    const benchmarkMemories = DatabaseUtils.all(db, `
      SELECT 
        mi.id,
        mi.type,
        mi.content,
        mi.importance,
        mi.created_at,
        mi.triple_extracted,
        mi.triple_extracted_status,
        COUNT(DISTINCT mr1.id) + COUNT(DISTINCT mr2.id) as relation_count
      FROM memory_item mi
      LEFT JOIN memory_relation mr1 ON mi.id = mr1.source_id
      LEFT JOIN memory_relation mr2 ON mi.id = mr2.target_id
      WHERE mi.content LIKE '%벤치마크%' 
         OR mi.content LIKE '%benchmark%'
         OR mi.content LIKE '%성능 테스트%'
      GROUP BY mi.id
      ORDER BY mi.created_at DESC
      LIMIT 20
    `) as BenchmarkMemory[];
    
    // 벤치마크 데이터와 연결된 실제 기억 확인
    const connectedRealMemories = DatabaseUtils.all(db, `
      SELECT DISTINCT
        mi.id,
        mi.type,
        mi.content,
        mi.importance,
        mi.created_at
      FROM memory_item mi
      INNER JOIN memory_relation mr ON (mi.id = mr.source_id OR mi.id = mr.target_id)
      INNER JOIN memory_item benchmark ON (
        (mr.source_id = benchmark.id OR mr.target_id = benchmark.id)
        AND (benchmark.content LIKE '%벤치마크%' 
             OR benchmark.content LIKE '%benchmark%'
             OR benchmark.content LIKE '%성능 테스트%')
        AND benchmark.id != mi.id
      )
      WHERE mi.content NOT LIKE '%벤치마크%' 
        AND mi.content NOT LIKE '%benchmark%'
        AND mi.content NOT LIKE '%성능 테스트%'
        AND mi.content NOT LIKE '%테스트%'
        AND mi.content NOT LIKE '%test%'
      LIMIT 10
    `) as Array<{ id: string; type: string; content: string; importance: number; created_at: string }>;
    
    // 결과 출력
    console.log('='.repeat(80));
    console.log('📊 벤치마크 테스트 데이터 통계');
    console.log('='.repeat(80));
    console.log(`전체 벤치마크 데이터: ${benchmarkStats.total}개`);
    console.log(`  - 일화 기억: ${benchmarkStats.episodic_count}개`);
    console.log(`  - 의미 기억: ${benchmarkStats.semantic_count}개`);
    console.log(`  - 작업 기억: ${benchmarkStats.working_count}개`);
    console.log(`  - 절차 기억: ${benchmarkStats.procedural_count}개`);
    console.log(`  - 이미 변환됨: ${benchmarkStats.converted_count}개`);
    console.log(`  - 평균 중요도: ${benchmarkStats.avg_importance?.toFixed(2) || 'N/A'}`);
    console.log();
    
    console.log('🔗 관련 관계 통계:');
    console.log(`  - 전체 관계 수: ${relationStats.total_relations}개`);
    console.log(`  - 관계가 있는 벤치마크 메모리 (source): ${relationStats.source_memories}개`);
    console.log(`  - 관계가 있는 벤치마크 메모리 (target): ${relationStats.target_memories}개`);
    console.log();
    
    if (benchmarkMemories.length > 0) {
      console.log('='.repeat(80));
      console.log(`📝 벤치마크 테스트 데이터 샘플 (최근 20개)`);
      console.log('='.repeat(80));
      benchmarkMemories.forEach((mem, idx) => {
        console.log(`\n[${idx + 1}] ID: ${mem.id}`);
        console.log(`    타입: ${mem.type}`);
        console.log(`    중요도: ${mem.importance}`);
        console.log(`    생성일: ${mem.created_at}`);
        console.log(`    관계 수: ${mem.relation_count}개`);
        console.log(`    변환 상태: ${mem.triple_extracted_status || '미처리'}`);
        console.log(`    내용: ${mem.content.substring(0, 100)}${mem.content.length > 100 ? '...' : ''}`);
      });
      console.log();
    }
    
    if (connectedRealMemories.length > 0) {
      console.log('='.repeat(80));
      console.log(`⚠️  벤치마크 데이터와 연결된 실제 기억 (최대 10개)`);
      console.log('='.repeat(80));
      console.log('주의: 이 기억들은 벤치마크 데이터와 관계가 있어 제거 시 관계가 끊어집니다.');
      console.log();
      connectedRealMemories.forEach((mem, idx) => {
        console.log(`\n[${idx + 1}] ID: ${mem.id}`);
        console.log(`    타입: ${mem.type}`);
        console.log(`    중요도: ${mem.importance}`);
        console.log(`    생성일: ${mem.created_at}`);
        console.log(`    내용: ${mem.content.substring(0, 150)}${mem.content.length > 150 ? '...' : ''}`);
      });
      console.log();
    } else {
      console.log('='.repeat(80));
      console.log('✅ 벤치마크 데이터와 연결된 실제 기억 없음');
      console.log('='.repeat(80));
      console.log('벤치마크 데이터를 안전하게 제거할 수 있습니다.\n');
    }
    
    console.log('='.repeat(80));
    console.log('💡 제거 방법');
    console.log('='.repeat(80));
    console.log('1. 개별 제거 (forget tool 사용):');
    console.log('   forget({ id: "mem_xxx", reason: "벤치마크 테스트 데이터 제거" })');
    console.log();
    console.log('2. 배치 제거 스크립트 실행:');
    console.log('   npm run script:remove-benchmark-data');
    console.log();
    console.log('⚠️  주의사항:');
    console.log('  - 제거 전 백업 권장');
    console.log('  - 관련 관계도 함께 제거됨');
    console.log('  - 되돌릴 수 없으므로 신중하게 진행');
    console.log('='.repeat(80));
    
  } catch (error) {
    console.error('에러 발생:', error);
    throw error;
  } finally {
    db.close();
  }
}

// 스크립트 실행
analyzeBenchmarkTestData()
  .then(() => {
    console.log('\n✅ 분석 완료');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ 분석 실패:', error);
    process.exit(1);
  });

