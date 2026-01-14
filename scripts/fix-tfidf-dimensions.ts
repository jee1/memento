#!/usr/bin/env node

/**
 * TF-IDF 벡터 차원 마이그레이션 스크립트
 * 384차원 tfidf 임베딩을 512차원으로 재생성
 * 
 * 사용법: 
 *   - 개발 환경: npx tsx scripts/fix-tfidf-dimensions.js [--confirm]
 *   - 프로덕션: npm run build && node dist/scripts/fix-tfidf-dimensions.js [--confirm]
 */

import { initializeDatabase, closeDatabase } from '../src/infrastructure/database/database/init.js';
import { UnifiedEmbeddingService } from '../src/domains/embedding/services/unified-embedding-service.js';
import { vectorCompatibilityService } from '../src/domains/embedding/services/vector-compatibility-service.js';
import { DatabaseUtils } from '../src/shared/utils/database.js';
import { VECTOR_SEARCH_CONFIG } from '../src/shared/config/vector-search.config.js';

/**
 * sqlite-vec 확장 로드
 */
async function loadVecExtension(db: any): Promise<void> {
  try {
    const { getLoadablePath } = await import('sqlite-vec');
    const extensionPath = getLoadablePath();
    db.loadExtension(extensionPath);
  } catch (error) {
    console.warn('⚠️ sqlite-vec 확장 로드 실패:', error);
  }
}

async function fixTfidfDimensions() {
  console.log('🔧 TF-IDF 벡터 차원 마이그레이션 시작...');
  console.log('📋 목표: 384차원 → 512차원\n');
  
  let db = null;
  
  try {
    // 데이터베이스 초기화
    db = await initializeDatabase();
    await loadVecExtension(db);
    
    const embeddingService = new UnifiedEmbeddingService();
    
    // 1. 현재 상태 확인
    console.log('📊 현재 상태 확인 중...');
    const currentStats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        COUNT(DISTINCT dimensions) as unique_dims,
        GROUP_CONCAT(DISTINCT dimensions) as dimensions_list
      FROM memory_embedding
      WHERE embedding_provider = 'tfidf'
    `).get();

    console.log(`- TF-IDF 임베딩 총 개수: ${currentStats.total}개`);
    console.log(`- 고유 차원 수: ${currentStats.unique_dims}개`);
    console.log(`- 차원 목록: ${currentStats.dimensions_list || '없음'}`);

    // 384차원 tfidf 임베딩 개수 확인
    const oldEmbeddings = db.prepare(`
      SELECT COUNT(*) as count
      FROM memory_embedding
      WHERE embedding_provider = 'tfidf' 
        AND (dimensions = 384 OR (dimensions IS NULL AND dim = 384))
    `).get();

    const oldCount = oldEmbeddings?.count || 0;
    console.log(`\n🔍 384차원 TF-IDF 임베딩: ${oldCount}개`);

    if (oldCount === 0) {
      console.log('✅ 마이그레이션할 임베딩이 없습니다. 모든 TF-IDF 임베딩이 이미 512차원입니다.');
      return;
    }

    // 2. 사용자 확인
    console.log('\n⚠️ 경고: 이 작업은 384차원 TF-IDF 임베딩을 512차원으로 재생성합니다.');
    console.log('백업을 먼저 수행하는 것을 권장합니다.');
    
    if (!process.argv.includes('--confirm')) {
      console.log('\n❌ 확인 플래그가 없어 작업을 중단합니다.');
      console.log('사용법: npx tsx scripts/fix-tfidf-dimensions.js --confirm');
      return;
    }

    // 3. 마이그레이션할 메모리 조회
    console.log('\n📋 마이그레이션할 메모리 조회 중...');
    const memoriesToMigrate = db.prepare(`
      SELECT DISTINCT 
        mi.id,
        mi.content,
        mi.type,
        me.id as embedding_id,
        me.dimensions as current_dimensions,
        me.dim as current_dim
      FROM memory_item mi
      INNER JOIN memory_embedding me ON mi.id = me.memory_id
      WHERE me.embedding_provider = 'tfidf'
        AND (me.dimensions = 384 OR (me.dimensions IS NULL AND me.dim = 384))
      ORDER BY mi.created_at
    `).all();

    console.log(`📊 처리할 메모리 개수: ${memoriesToMigrate.length}`);

    if (memoriesToMigrate.length === 0) {
      console.log('⚠️ 마이그레이션할 메모리가 없습니다.');
      return;
    }

    // 4. 임베딩 서비스 사용 가능 여부 확인
    if (!embeddingService.isAvailable()) {
      console.error('❌ 임베딩 서비스가 사용 불가능합니다.');
      process.exit(1);
    }

    // 5. 마이그레이션 실행
    console.log('\n🔄 TF-IDF 임베딩 재생성 중...');
    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    for (let i = 0; i < memoriesToMigrate.length; i++) {
      const memory = memoriesToMigrate[i];
      const progress = `[${i + 1}/${memoriesToMigrate.length}]`;
      
      try {
        console.log(`${progress} 처리 중: ${memory.id} (${memory.type})`);
        
        // tfidf provider로 임베딩 생성
        const embeddingResult = await embeddingService.generateEmbedding(memory.content, 'tfidf');
        
        if (!embeddingResult) {
          console.warn(`${progress} ⚠️ 임베딩 생성 실패: ${memory.id}`);
          errorCount++;
          errors.push({ memory_id: memory.id, error: '임베딩 생성 실패' });
          continue;
        }

        const embeddingVector = Array.isArray(embeddingResult.embedding) ? embeddingResult.embedding : [];
        if (embeddingVector.length === 0) {
          console.warn(`${progress} ⚠️ 임베딩 결과가 비어있음: ${memory.id}`);
          errorCount++;
          errors.push({ memory_id: memory.id, error: '임베딩 결과가 비어있음' });
          continue;
        }

        const provider = 'tfidf';

        // 벡터 호환성 평가
        const compatibility = vectorCompatibilityService.assessProviderCompatibility(
          embeddingVector,
          provider
        );

        const blockingIssues = compatibility.issues.filter(
          issue => issue.severity === 'error' && issue.code !== 'dimension_mismatch'
        );

        if (blockingIssues.length > 0) {
          const errorMessages = blockingIssues.map(issue => issue.message).join(', ');
          console.warn(`${progress} ⚠️ 임베딩 벡터 검증 실패: ${memory.id} - ${errorMessages}`);
          errorCount++;
          errors.push({ memory_id: memory.id, error: `검증 실패: ${errorMessages}` });
          continue;
        }

        const projection = compatibility.projection;
        const storedVector = projection.vector;
        const serializedEmbedding = JSON.stringify(storedVector);
        const sourceDimensions = projection.sourceDimensions;
        const storedDimensions = projection.targetDimensions;
        const projectionType = projection.projectionType;
        const normalized = projection.normalized ? 1 : 0;

        // 기존 512차원 임베딩이 이미 있는지 확인
        const existing512 = db.prepare(`
          SELECT id FROM memory_embedding
          WHERE memory_id = ?
            AND embedding_provider = ?
            AND (dimensions = ? OR (dimensions IS NULL AND dim = ?))
        `).get(memory.id, provider, storedDimensions, storedDimensions);

        if (existing512) {
          // 이미 512차원 임베딩이 있으면 기존 384차원만 삭제
          await DatabaseUtils.run(db, `
            DELETE FROM memory_embedding
            WHERE memory_id = ?
              AND embedding_provider = ?
              AND (dimensions = 384 OR (dimensions IS NULL AND dim = 384))
          `, [memory.id, provider]);
          console.log(`${progress} ℹ️ 이미 512차원 임베딩이 존재하여 384차원만 삭제: ${memory.id}`);
        } else {
          // 기존 384차원 임베딩 삭제
          await DatabaseUtils.run(db, `
            DELETE FROM memory_embedding
            WHERE memory_id = ?
              AND embedding_provider = ?
              AND (dimensions = 384 OR (dimensions IS NULL AND dim = 384))
          `, [memory.id, provider]);

          // 새 512차원 임베딩 삽입
          await DatabaseUtils.run(db, `
            INSERT INTO memory_embedding (
              memory_id,
              embedding_provider,
              projection_type,
              embedding,
              dim,
              model,
              dimensions,
              precision,
              normalized,
              version,
              created_by,
              created_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
          `, [
            memory.id,
            provider,
            projectionType,
            serializedEmbedding,
            sourceDimensions,
            embeddingResult.model || 'tfidf',
            storedDimensions,
            32,
            normalized,
            1,
            'fix-tfidf-dimensions-script'
          ]);
        }

        if (compatibility.needsProjection) {
          console.log(`${progress} 🔄 벡터 차원 조정: ${sourceDimensions} → ${storedDimensions} (${projectionType})`);
        }

        console.log(`${progress} ✅ 완료: ${memory.id} (${storedDimensions}차원)`);
        successCount++;

        // API 제한을 위한 대기 (필요시)
        if (i % 10 === 0 && i > 0) {
          console.log('⏳ API 제한 대기 중...');
          await new Promise(resolve => setTimeout(resolve, 1000));
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`${progress} ❌ 오류: ${memory.id}`, errorMessage);
        if (error instanceof Error && error.stack) {
          console.error('   스택 트레이스:', error.stack);
        }
        errorCount++;
        errors.push({ memory_id: memory.id, error: errorMessage });
      }
    }

    // 6. 결과 통계
    console.log('\n📊 작업 완료!');
    console.log(`✅ 성공: ${successCount}개`);
    console.log(`❌ 실패: ${errorCount}개`);
    console.log(`📈 성공률: ${((successCount / memoriesToMigrate.length) * 100).toFixed(1)}%`);

    if (errors.length > 0) {
      console.log('\n❌ 실패한 메모리:');
      errors.slice(0, 10).forEach(err => {
        console.log(`  - ${err.memory_id}: ${err.error}`);
      });
      if (errors.length > 10) {
        console.log(`  ... 외 ${errors.length - 10}개`);
      }
    }

    // 7. 최종 검증
    console.log('\n🔍 최종 검증:');
    const finalStats = db.prepare(`
      SELECT 
        COUNT(*) as total,
        COUNT(DISTINCT dimensions) as unique_dims,
        GROUP_CONCAT(DISTINCT dimensions) as dimensions_list
      FROM memory_embedding
      WHERE embedding_provider = 'tfidf'
    `).get();

    console.log(`- TF-IDF 임베딩 총 개수: ${finalStats.total}개`);
    console.log(`- 고유 차원 수: ${finalStats.unique_dims}개`);
    console.log(`- 차원 목록: ${finalStats.dimensions_list || '없음'}`);

    const expectedDim = VECTOR_SEARCH_CONFIG.providerDimensions.tfidf;
    const tfidf512Count = db.prepare(`
      SELECT COUNT(*) as count
      FROM memory_embedding
      WHERE embedding_provider = 'tfidf' 
        AND (dimensions = ? OR (dimensions IS NULL AND dim = ?))
    `).get(expectedDim, expectedDim);

    console.log(`- 512차원 TF-IDF 임베딩: ${tfidf512Count?.count || 0}개`);

    if (finalStats.unique_dims === 1 && finalStats.dimensions_list === String(expectedDim)) {
      console.log('✅ 모든 TF-IDF 임베딩의 차원이 일치합니다!');
    } else {
      const tfidf384Count = db.prepare(`
        SELECT COUNT(*) as count
        FROM memory_embedding
        WHERE embedding_provider = 'tfidf' 
          AND (dimensions = 384 OR (dimensions IS NULL AND dim = 384))
      `).get();
      
      if (tfidf384Count?.count > 0) {
        console.warn(`⚠️ 아직 384차원 TF-IDF 임베딩이 ${tfidf384Count.count}개 남아있습니다.`);
      } else {
        console.log('✅ 모든 TF-IDF 임베딩이 512차원으로 마이그레이션되었습니다!');
      }
    }

  } catch (error) {
    console.error('❌ 작업 실패:', error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
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
  fixTfidfDimensions().catch((error) => {
    console.error('❌ 스크립트 실행 중 오류 발생:', error);
    process.exit(1);
  });
}

export { fixTfidfDimensions };
