#!/usr/bin/env node

/**
 * 벡터 차원 통일 스크립트
 * 모든 임베딩을 삭제하고 현재 설정에 맞는 모델로 재생성
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { EmbeddingService } from '../dist/services/embedding-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 데이터베이스 경로 설정
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'memory.db');

async function fixVectorDimensions() {
  console.log('🔧 벡터 차원 통일 작업 시작...');
  
  // 데이터베이스 연결
  const db = new Database(dbPath);
  const embeddingService = new EmbeddingService();
  
  try {
    // 1. 현재 상태 확인
    console.log('\n📊 현재 상태:');
    const currentStats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        COUNT(DISTINCT dim) as unique_dims,
        GROUP_CONCAT(DISTINCT dim) as dimensions
      FROM memory_embedding
    `).get();

    console.log(`- 총 임베딩: ${currentStats.total}개`);
    console.log(`- 고유 차원 수: ${currentStats.unique_dims}개`);
    console.log(`- 차원들: ${currentStats.dimensions}`);

    // 2. 임베딩 서비스 설정 확인
    console.log('\n🤖 임베딩 서비스 설정:');
    const modelInfo = embeddingService.getModelInfo();
    console.log(`- 모델: ${modelInfo.model}`);
    console.log(`- 차원: ${modelInfo.dimensions}`);
    console.log(`- 사용 가능: ${embeddingService.isAvailable()}`);

    if (!embeddingService.isAvailable()) {
      console.error('❌ 임베딩 서비스가 사용 불가능합니다.');
      process.exit(1);
    }

    // 3. 기존 임베딩 백업
    console.log('\n💾 기존 임베딩 백업 중...');
    const backupData = db.prepare(`
      SELECT 
        me.memory_id,
        me.embedding,
        me.dim,
        me.model,
        me.created_at,
        mi.content,
        mi.type
      FROM memory_embedding me
      JOIN memory_item mi ON me.memory_id = mi.id
    `).all();

    const backupFile = path.join(__dirname, '..', 'backup', `embeddings-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    const fs = await import('fs');
    
    if (!fs.existsSync(path.dirname(backupFile))) {
      fs.mkdirSync(path.dirname(backupFile), { recursive: true });
    }

    fs.writeFileSync(backupFile, JSON.stringify({
      timestamp: new Date().toISOString(),
      totalEmbeddings: backupData.length,
      embeddings: backupData.map(emb => ({
        memory_id: emb.memory_id,
        content: emb.content,
        type: emb.type,
        embedding: JSON.parse(emb.embedding),
        dim: emb.dim,
        model: emb.model,
        created_at: emb.created_at
      }))
    }, null, 2));

    console.log(`✅ 백업 완료: ${backupFile}`);

    // 4. 기존 임베딩 삭제
    console.log('\n🗑️ 기존 임베딩 삭제 중...');
    const deleteResult = db.prepare('DELETE FROM memory_embedding').run();
    console.log(`✅ 삭제 완료: ${deleteResult.changes}개 행 삭제`);

    // 5. 모든 메모리에 대해 새로운 임베딩 생성
    console.log('\n🔄 새로운 임베딩 생성 중...');
    const memories = db.prepare(`
      SELECT id, content, type, importance, created_at
      FROM memory_item
      ORDER BY created_at
    `).all();

    console.log(`📊 처리할 메모리 개수: ${memories.length}`);

    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < memories.length; i++) {
      const memory = memories[i];
      const progress = `[${i + 1}/${memories.length}]`;
      
      try {
        console.log(`${progress} 처리 중: ${memory.id} (${memory.type})`);
        
        // 임베딩 생성
        const embeddingResult = await embeddingService.generateEmbedding(memory.content);
        
        if (!embeddingResult) {
          console.warn(`${progress} ⚠️ 임베딩 생성 실패: ${memory.id}`);
          errorCount++;
          continue;
        }

        // 데이터베이스에 저장
        db.prepare(`
          INSERT INTO memory_embedding (memory_id, embedding, dim, model, created_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run(
          memory.id,
          JSON.stringify(embeddingResult.embedding),
          embeddingResult.embedding.length,
          embeddingResult.model
        );

        console.log(`${progress} ✅ 완료: ${memory.id} (${embeddingResult.embedding.length}차원)`);
        successCount++;

        // API 제한을 위한 대기
        if (i % 10 === 0 && i > 0) {
          console.log('⏳ API 제한 대기 중...');
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

      } catch (error) {
        console.error(`${progress} ❌ 오류: ${memory.id}`, error.message);
        errorCount++;
      }
    }

    // 6. 최종 검증
    console.log('\n🔍 최종 검증:');
    const finalStats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        AVG(dim) as avg_dim,
        MIN(dim) as min_dim,
        MAX(dim) as max_dim,
        COUNT(DISTINCT dim) as unique_dims
      FROM memory_embedding
    `).get();

    console.log(`- 총 임베딩: ${finalStats.total}개`);
    console.log(`- 평균 차원: ${finalStats.avg_dim?.toFixed(1) || 'N/A'}`);
    console.log(`- 최소 차원: ${finalStats.min_dim || 'N/A'}`);
    console.log(`- 최대 차원: ${finalStats.max_dim || 'N/A'}`);
    console.log(`- 고유 차원 수: ${finalStats.unique_dims}개`);

    // 차원 일치성 확인
    const expectedDim = modelInfo.dimensions;
    const mismatchedDims = db.prepare(`
      SELECT COUNT(*) as count FROM memory_embedding WHERE dim != ?
    `).get(expectedDim);

    if (mismatchedDims.count > 0) {
      console.warn(`⚠️ 차원 불일치 발견: ${mismatchedDims.count}개`);
    } else {
      console.log('✅ 모든 임베딩의 차원이 일치합니다!');
    }

    // 7. 결과 요약
    console.log('\n📊 작업 완료 요약:');
    console.log(`✅ 성공: ${successCount}개`);
    console.log(`❌ 실패: ${errorCount}개`);
    console.log(`📈 성공률: ${((successCount / memories.length) * 100).toFixed(1)}%`);

    if (finalStats.unique_dims === 1) {
      console.log('🎉 벡터 차원 통일 완료! 이제 검색이 정상 작동할 것입니다.');
    } else {
      console.log('⚠️ 여전히 차원 불일치가 있습니다. 추가 확인이 필요합니다.');
    }

  } catch (error) {
    console.error('❌ 벡터 차원 통일 실패:', error);
    process.exit(1);
  } finally {
    db.close();
  }
}

// 스크립트 실행
if (import.meta.url === `file://${process.argv[1]}`) {
  fixVectorDimensions().catch(console.error);
}

export { fixVectorDimensions };
