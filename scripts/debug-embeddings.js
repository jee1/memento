#!/usr/bin/env node

/**
 * 임베딩 디버깅 스크립트
 * 현재 데이터베이스의 임베딩 상태를 상세히 분석
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 데이터베이스 경로 설정
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'memory.db');

async function debugEmbeddings() {
  console.log('🔍 임베딩 상태 디버깅 시작...');
  
  // 데이터베이스 연결
  const db = new Database(dbPath);
  
  try {
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
      ORDER BY dim
    `).all();

    dimensionStats.forEach(stat => {
      console.log(`- ${stat.dim}차원: ${stat.count}개`);
      if (stat.count <= 5) {
        console.log(`  메모리 ID: ${stat.memory_ids}`);
      }
    });

    // 3. 모델별 분포
    console.log('\n🤖 모델별 분포:');
    const modelStats = db.prepare(`
      SELECT 
        model,
        COUNT(*) as count,
        AVG(dim) as avg_dim
      FROM memory_embedding
      GROUP BY model
      ORDER BY count DESC
    `).all();

    modelStats.forEach(stat => {
      console.log(`- ${stat.model || 'NULL'}: ${stat.count}개 (평균 ${stat.avg_dim?.toFixed(1)}차원)`);
    });

    // 4. 최근 생성된 임베딩들
    console.log('\n🕒 최근 생성된 임베딩 (최대 10개):');
    const recentEmbeddings = db.prepare(`
      SELECT 
        memory_id,
        dim,
        model,
        created_at,
        LENGTH(embedding) as embedding_length
      FROM memory_embedding
      ORDER BY created_at DESC
      LIMIT 10
    `).all();

    recentEmbeddings.forEach(emb => {
      console.log(`- ${emb.memory_id}: ${emb.dim}차원, ${emb.model}, ${emb.created_at}`);
    });

    // 5. 문제가 있는 임베딩 찾기
    console.log('\n⚠️ 문제가 있을 수 있는 임베딩들:');
    
    // 차원이 0인 경우
    const zeroDim = db.prepare(`
      SELECT memory_id, dim, model FROM memory_embedding WHERE dim = 0
    `).all();
    
    if (zeroDim.length > 0) {
      console.log(`- 차원이 0인 임베딩: ${zeroDim.length}개`);
      zeroDim.forEach(emb => {
        console.log(`  ${emb.memory_id} (${emb.model})`);
      });
    }

    // 차원이 매우 큰 경우 (1536보다 큰 경우)
    const largeDim = db.prepare(`
      SELECT memory_id, dim, model FROM memory_embedding WHERE dim > 1536
    `).all();
    
    if (largeDim.length > 0) {
      console.log(`- 차원이 1536보다 큰 임베딩: ${largeDim.length}개`);
      largeDim.forEach(emb => {
        console.log(`  ${emb.memory_id}: ${emb.dim}차원 (${emb.model})`);
      });
    }

    // 6. 임베딩 데이터 샘플 확인
    console.log('\n🔬 임베딩 데이터 샘플 (첫 3개):');
    const samples = db.prepare(`
      SELECT 
        memory_id,
        dim,
        model,
        SUBSTR(embedding, 1, 100) as embedding_preview
      FROM memory_embedding
      LIMIT 3
    `).all();

    samples.forEach((sample, index) => {
      console.log(`\n샘플 ${index + 1}:`);
      console.log(`- 메모리 ID: ${sample.memory_id}`);
      console.log(`- 차원: ${sample.dim}`);
      console.log(`- 모델: ${sample.model}`);
      console.log(`- 임베딩 미리보기: ${sample.embedding_preview}...`);
      
      // 실제 벡터 길이 확인
      try {
        const fullEmbedding = db.prepare(`
          SELECT embedding FROM memory_embedding WHERE memory_id = ?
        `).get(sample.memory_id);
        
        const vector = JSON.parse(fullEmbedding.embedding);
        console.log(`- 실제 벡터 길이: ${vector.length}`);
        console.log(`- 첫 5개 값: [${vector.slice(0, 5).join(', ')}...]`);
      } catch (error) {
        console.log(`- 벡터 파싱 오류: ${error.message}`);
      }
    });

    // 7. 메모리 아이템과의 연결 상태 확인
    console.log('\n🔗 메모리 아이템 연결 상태:');
    const connectionStats = db.prepare(`
      SELECT 
        (SELECT COUNT(*) FROM memory_item) as total_memories,
        (SELECT COUNT(*) FROM memory_embedding) as total_embeddings,
        (SELECT COUNT(*) FROM memory_item mi 
         LEFT JOIN memory_embedding me ON mi.id = me.memory_id 
         WHERE me.memory_id IS NULL) as memories_without_embedding
    `).get();

    console.log(`- 총 메모리 개수: ${connectionStats.total_memories}`);
    console.log(`- 총 임베딩 개수: ${connectionStats.total_embeddings}`);
    console.log(`- 임베딩이 없는 메모리: ${connectionStats.memories_without_embedding}`);

  } catch (error) {
    console.error('❌ 디버깅 실패:', error);
    process.exit(1);
  } finally {
    db.close();
  }
}

// 스크립트 실행
if (import.meta.url === `file://${process.argv[1]}`) {
  debugEmbeddings().catch(console.error);
}

export { debugEmbeddings };
