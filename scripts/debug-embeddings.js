#!/usr/bin/env node
import { isMain } from './lib/cli-runtime.js';

/**
 * 임베딩 디버깅 스크립트
 * 현재 데이터베이스의 임베딩 상태를 상세히 분석
 * 
 * 리팩토링: 공통 모듈(initializeDatabase)을 사용하여 일관된 DB 초기화 보장
 * 
 * 사용법: 
 *   - 개발 환경: npx tsx scripts/debug-embeddings.js
 *   - 프로덕션: npm run build && node dist/scripts/debug-embeddings.js
 */

import { initializeDatabase, closeDatabase } from '@memento/core';

async function debugEmbeddings() {
  console.log('🔍 임베딩 상태 디버깅 시작...');
  
  let db = null;
  
  try {
    // 공통 모듈을 사용하여 데이터베이스 초기화
    // initializeDatabase는 DB 파일이 없으면 자동으로 생성하고 초기화함
    db = await initializeDatabase();
    
    // 1. 전체 임베딩 통계
    console.log('\n📊 전체 임베딩 통계:');
    const totalStats = db.prepare(`
      SELECT 
        COUNT(*) as total_count,
        AVG(dim) as avg_dim,
        MIN(dim) as min_dim,
        MAX(dim) as max_dim,
        COUNT(DISTINCT dim) as unique_dims
      FROM memory_embedding
    `).get();

    console.log(`- 총 임베딩 개수: ${totalStats.total_count}`);
    console.log(`- 평균 차원: ${totalStats.avg_dim?.toFixed(1) || 'N/A'}`);
    console.log(`- 최소 차원: ${totalStats.min_dim || 'N/A'}`);
    console.log(`- 최대 차원: ${totalStats.max_dim || 'N/A'}`);
    console.log(`- 고유 차원 수: ${totalStats.unique_dims}`);

    // 2. 차원별 분포
    console.log('\n📈 차원별 분포:');
    const dimensionStats = db.prepare(`
      SELECT 
        dim,
        COUNT(*) as count,
        GROUP_CONCAT(memory_id) as memory_ids
      FROM memory_embedding
      GROUP BY dim
      ORDER BY count DESC
    `).all();

    dimensionStats.forEach(stat => {
      console.log(`- ${stat.dim}차원: ${stat.count}개`);
    });

    // 3. 모델별 분포
    console.log('\n🤖 모델별 분포:');
    const modelStats = db.prepare(`
      SELECT 
        COALESCE(model, 'NULL') as model,
        COUNT(*) as count,
        AVG(dim) as avg_dim
      FROM memory_embedding
      GROUP BY model
      ORDER BY count DESC
    `).all();

    modelStats.forEach(stat => {
      console.log(`- ${stat.model}: ${stat.count}개 (평균 ${stat.avg_dim?.toFixed(1) || 'N/A'}차원)`);
    });

    // 4. 임베딩 제공자별 분포 (컬럼이 있는 경우)
    const hasProvider = db.prepare("PRAGMA table_info(memory_embedding)").all()
      .some(col => col.name === 'embedding_provider');
    
    if (hasProvider) {
      console.log('\n🔧 임베딩 제공자별 분포:');
      const providerStats = db.prepare(`
        SELECT 
          COALESCE(embedding_provider, 'NULL') as provider,
          COUNT(*) as count,
          AVG(dimensions) as avg_dim
        FROM memory_embedding
        GROUP BY embedding_provider
        ORDER BY count DESC
      `).all();

      providerStats.forEach(stat => {
        console.log(`- ${stat.provider}: ${stat.count}개 (평균 ${stat.avg_dim?.toFixed(1) || 'N/A'}차원)`);
      });
    }

    // 5. 문제가 있는 임베딩 확인
    console.log('\n⚠️ 문제가 있는 임베딩:');
    const problematic = db.prepare(`
      SELECT 
        memory_id,
        dim,
        model,
        CASE 
          WHEN embedding IS NULL OR embedding = '' THEN '빈 임베딩'
          WHEN dim IS NULL OR dim = 0 THEN '차원 없음'
          ELSE '정상'
        END as issue
      FROM memory_embedding
      WHERE embedding IS NULL OR embedding = '' OR dim IS NULL OR dim = 0
      LIMIT 10
    `).all();

    if (problematic.length === 0) {
      console.log('- 문제가 있는 임베딩이 없습니다.');
    } else {
      problematic.forEach(item => {
        console.log(`- ${item.memory_id}: ${item.issue} (차원: ${item.dim || 'N/A'}, 모델: ${item.model || 'N/A'})`);
      });
    }

    // 6. 최근 생성된 임베딩
    console.log('\n🕐 최근 생성된 임베딩 (최대 5개):');
    const recent = db.prepare(`
      SELECT 
        memory_id,
        dim,
        model,
        created_at
      FROM memory_embedding
      ORDER BY created_at DESC
      LIMIT 5
    `).all();

    recent.forEach(item => {
      console.log(`- ${item.memory_id}: ${item.dim}차원, ${item.model || 'N/A'} (${item.created_at})`);
    });

    console.log('\n✅ 디버깅 완료!');

  } catch (error) {
    console.error('❌ 디버깅 중 오류 발생:', error.message);
    if (error.stack) {
      console.error('   스택 트레이스:', error.stack);
    }
    process.exit(1);
  } finally {
    // 데이터베이스 연결 종료
    if (db) {
      closeDatabase(db);
    }
  }
}

// 스크립트 실행
if (isMain(import.meta.url)) {
  debugEmbeddings().catch((error) => {
    console.error('❌ 스크립트 실행 중 오류 발생:', error);
    process.exit(1);
  });
}

export { debugEmbeddings };
