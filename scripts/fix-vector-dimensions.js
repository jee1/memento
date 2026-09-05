#!/usr/bin/env node
import { isMain, parseArgs as parseCliArgs } from './lib/cli-runtime.js';

/**
 * 벡터 차원 통일 스크립트
 * 모든 임베딩을 삭제하고 현재 설정에 맞는 모델로 재생성
 * 
 * 리팩토링: 공통 모듈(initializeDatabase)을 사용하여 일관된 DB 초기화 보장
 * 
 * 사용법: 
 *   - 개발 환경: npx tsx scripts/fix-vector-dimensions.js
 *   - 프로덕션: npm run build && node dist/scripts/fix-vector-dimensions.js
 */

import { initializeDatabase, closeDatabase, encodeFloat32Embedding } from '@memento/core';
import { UnifiedEmbeddingService } from '@memento/core/domains/embedding/services/unified-embedding-service.js';

async function fixVectorDimensions() {
  console.log('🔧 벡터 차원 통일 작업 시작...');
  
  let db = null;
  
  try {
    // 공통 모듈을 사용하여 데이터베이스 초기화
    // initializeDatabase는 DB 파일이 없으면 자동으로 생성하고 초기화함
    db = await initializeDatabase();
    
    const embeddingService = new UnifiedEmbeddingService();
    
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

    // 3. 사용자 확인
    console.log('\n⚠️ 경고: 이 작업은 모든 임베딩을 삭제하고 재생성합니다.');
    console.log('백업을 먼저 수행하는 것을 권장합니다.');
    console.log('계속하려면 스크립트를 --confirm 플래그와 함께 실행하세요.');

    if (!parseCliArgs().args.includes('--confirm')) {
      console.log('\n❌ 확인 플래그가 없어 작업을 중단합니다.');
      console.log('사용법: npx tsx scripts/fix-vector-dimensions.js --confirm');
      return;
    }

    // 4. 모든 기억 조회
    console.log('\n📋 기억 조회 중...');
    const memories = db.prepare(`
      SELECT id, content, type
      FROM memory_item
      ORDER BY created_at
    `).all();

    console.log(`📊 처리할 기억 개수: ${memories.length}`);

    if (memories.length === 0) {
      console.log('⚠️ 재생성할 기억이 없습니다.');
      return;
    }

    // 5. 기존 임베딩 삭제
    console.log('\n🗑️ 기존 임베딩 삭제 중...');
    const deleteResult = db.prepare('DELETE FROM memory_embedding').run();
    console.log(`✅ ${deleteResult.changes}개 임베딩 삭제 완료`);

    // 6. 새로운 임베딩 생성
    console.log('\n🔄 새로운 임베딩 생성 중...');
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
          encodeFloat32Embedding(embeddingResult.embedding),
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

    // 7. 결과 통계
    console.log('\n📊 작업 완료!');
    console.log(`✅ 성공: ${successCount}개`);
    console.log(`❌ 실패: ${errorCount}개`);
    console.log(`📈 성공률: ${((successCount / memories.length) * 100).toFixed(1)}%`);

    // 8. 최종 검증
    const finalStats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        COUNT(DISTINCT dim) as unique_dims,
        AVG(dim) as avg_dim
      FROM memory_embedding
    `).get();

    console.log('\n🔍 최종 검증:');
    console.log(`- 총 임베딩: ${finalStats.total}개`);
    console.log(`- 고유 차원 수: ${finalStats.unique_dims}개`);
    console.log(`- 평균 차원: ${finalStats.avg_dim?.toFixed(1) || 'N/A'}`);

    const expectedDim = modelInfo.dimensions;
    if (finalStats.unique_dims === 1 && finalStats.avg_dim === expectedDim) {
      console.log('✅ 모든 임베딩의 차원이 일치합니다!');
    } else {
      console.warn(`⚠️ 차원 불일치: 예상 ${expectedDim}차원, 실제 ${finalStats.avg_dim?.toFixed(1) || 'N/A'}차원`);
    }

  } catch (error) {
    console.error('❌ 작업 실패:', error.message);
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
  fixVectorDimensions().catch((error) => {
    console.error('❌ 스크립트 실행 중 오류 발생:', error);
    process.exit(1);
  });
}

export { fixVectorDimensions };
