#!/usr/bin/env node

/**
 * 임베딩 재생성 스크립트
 * 모든 기억에 대해 새로운 벡터값을 생성하는 스크립트
 * 
 * 리팩토링: 공통 모듈(initializeDatabase)을 사용하여 일관된 DB 초기화 보장
 * 
 * 사용법: 
 *   - 개발 환경: npx tsx scripts/regenerate-embeddings.js
 *   - 프로덕션: npm run build && node dist/scripts/regenerate-embeddings.js
 */

import { initializeDatabase, closeDatabase } from '@memento/core';
import { UnifiedEmbeddingService } from '@memento/core/domains/embedding/services/unified-embedding-service.js';

async function regenerateEmbeddings() {
  console.log('🔄 임베딩 재생성 시작...');
  
  let db = null;
  
  try {
    // 공통 모듈을 사용하여 데이터베이스 초기화
    // initializeDatabase는 DB 파일이 없으면 자동으로 생성하고 초기화함
    db = await initializeDatabase();
    
    const embeddingService = new UnifiedEmbeddingService();
    
    // 임베딩 서비스 사용 가능 여부 확인
    if (!embeddingService.isAvailable()) {
      console.error('❌ 임베딩 서비스가 사용 불가능합니다.');
      process.exit(1);
    }

    // 모델 정보 출력
    const modelInfo = embeddingService.getModelInfo();
    console.log(`🤖 사용 모델: ${modelInfo.model} (${modelInfo.dimensions}차원)`);

    // 모든 기억 조회
    const memories = db.prepare(`
      SELECT id, content, type, importance, created_at
      FROM memory_item
      ORDER BY created_at
    `).all();

    console.log(`📊 처리할 기억 개수: ${memories.length}`);

    if (memories.length === 0) {
      console.log('⚠️ 재생성할 기억이 없습니다.');
      return;
    }

    let successCount = 0;
    let errorCount = 0;

    // 각 기억에 대해 임베딩 생성
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
          INSERT OR REPLACE INTO memory_embedding (memory_id, embedding, dim, model, created_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        `).run(
          memory.id,
          JSON.stringify(embeddingResult.embedding),
          embeddingResult.embedding.length,
          embeddingResult.model
        );

        console.log(`${progress} ✅ 완료: ${memory.id} (${embeddingResult.embedding.length}차원)`);
        successCount++;

        // API 제한을 위한 대기 (필요시)
        if (i % 10 === 0 && i > 0) {
          console.log('⏳ API 제한 대기 중...');
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

      } catch (error) {
        console.error(`${progress} ❌ 오류: ${memory.id}`, error.message);
        if (error.stack) {
          console.error('   스택 트레이스:', error.stack);
        }
        errorCount++;
      }
    }

    // 결과 통계
    console.log('\n📊 재생성 완료!');
    console.log(`✅ 성공: ${successCount}개`);
    console.log(`❌ 실패: ${errorCount}개`);
    console.log(`📈 성공률: ${((successCount / memories.length) * 100).toFixed(1)}%`);

    // 최종 검증
    const finalStats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        AVG(dim) as avg_dim,
        MIN(dim) as min_dim,
        MAX(dim) as max_dim
      FROM memory_embedding
    `).get();

    console.log('\n🔍 최종 검증:');
    console.log(`- 총 임베딩 개수: ${finalStats.total}`);
    console.log(`- 평균 차원: ${finalStats.avg_dim?.toFixed(1) || 'N/A'}`);
    console.log(`- 최소 차원: ${finalStats.min_dim || 'N/A'}`);
    console.log(`- 최대 차원: ${finalStats.max_dim || 'N/A'}`);

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

  } catch (error) {
    console.error('❌ 재생성 실패:', error);
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
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1])) {
  regenerateEmbeddings().catch((error) => {
    console.error('❌ 스크립트 실행 중 오류 발생:', error);
    process.exit(1);
  });
}

export { regenerateEmbeddings };
