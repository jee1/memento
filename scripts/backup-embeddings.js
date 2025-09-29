#!/usr/bin/env node

/**
 * 임베딩 백업 스크립트
 * 기존 벡터값을 백업한 후 삭제하고 재생성하는 스크립트
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 데이터베이스 경로 설정
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'memory.db');
const backupDir = path.join(__dirname, '..', 'backup');
const backupFile = path.join(backupDir, `embeddings-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);

async function backupEmbeddings() {
  console.log('🔄 임베딩 백업 시작...');
  
  // 백업 디렉토리 생성
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  // 데이터베이스 연결
  const db = new Database(dbPath);
  
  try {
    // 기존 임베딩 데이터 조회
    const embeddings = db.prepare(`
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
      ORDER BY me.created_at
    `).all();

    console.log(`📊 발견된 임베딩 개수: ${embeddings.length}`);

    if (embeddings.length === 0) {
      console.log('⚠️ 백업할 임베딩이 없습니다.');
      return;
    }

    // 차원별 통계
    const dimensionStats = {};
    embeddings.forEach(emb => {
      const dim = emb.dim;
      dimensionStats[dim] = (dimensionStats[dim] || 0) + 1;
    });

    console.log('📈 차원별 통계:');
    Object.entries(dimensionStats).forEach(([dim, count]) => {
      console.log(`  - ${dim}차원: ${count}개`);
    });

    // 백업 데이터 생성
    const backupData = {
      timestamp: new Date().toISOString(),
      totalEmbeddings: embeddings.length,
      dimensionStats,
      embeddings: embeddings.map(emb => ({
        memory_id: emb.memory_id,
        content: emb.content,
        type: emb.type,
        embedding: JSON.parse(emb.embedding),
        dim: emb.dim,
        model: emb.model,
        created_at: emb.created_at
      }))
    };

    // 백업 파일 저장
    fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));
    console.log(`✅ 백업 완료: ${backupFile}`);

    // 임베딩 테이블 삭제
    console.log('🗑️ 기존 임베딩 삭제 중...');
    const deleteResult = db.prepare('DELETE FROM memory_embedding').run();
    console.log(`✅ 삭제 완료: ${deleteResult.changes}개 행 삭제`);

    console.log('🎉 백업 및 삭제 완료!');
    console.log('다음 단계: npm run regenerate-embeddings');

  } catch (error) {
    console.error('❌ 백업 실패:', error);
    process.exit(1);
  } finally {
    db.close();
  }
}

// 스크립트 실행
if (import.meta.url === `file://${process.argv[1]}`) {
  backupEmbeddings().catch(console.error);
}

export { backupEmbeddings };
