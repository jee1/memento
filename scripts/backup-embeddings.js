#!/usr/bin/env node
import { isMain } from './lib/cli.ts';

/**
 * 임베딩 백업 스크립트
 * 기존 벡터값을 백업한 후 삭제하고 재생성하는 스크립트
 * 
 * 리팩토링: 공통 모듈(initializeDatabase)을 사용하여 일관된 DB 초기화 보장
 * 
 * 사용법: 
 *   - 개발 환경: npx tsx scripts/backup-embeddings.js
 *   - 프로덕션: npm run build && node dist/scripts/backup-embeddings.js
 */

import { initializeDatabase, closeDatabase } from '@memento/core';
import { validateFilePath, sanitizeFileName } from '@memento/core/shared/utils/path-validator.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 백업 디렉토리 설정
// PRD 0019: 보안 강화 (Phase 1) - Path Traversal 방지
const backupDir = path.join(process.cwd(), 'backup');
if (!validateFilePath(backupDir, 'backup')) {
  throw new Error(
    `Path Traversal 방지: 허용되지 않은 백업 디렉토리 경로입니다. ` +
    `경로: ${backupDir}`
  );
}

// 백업 파일명 정제
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const sanitizedFileName = sanitizeFileName(`embeddings-backup-${timestamp}.json`);
const backupFile = path.join(backupDir, sanitizedFileName);

async function backupEmbeddings() {
  console.log('🔄 임베딩 백업 시작...');
  
  // 백업 디렉토리 생성 (PRD 0019: Path Traversal 방지)
  // 경로 검증은 이미 위에서 수행됨
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  let db = null;
  
  try {
    // 공통 모듈을 사용하여 데이터베이스 초기화
    // initializeDatabase는 DB 파일이 없으면 자동으로 생성하고 초기화함
    db = await initializeDatabase();
    
    // 모든 임베딩 데이터 조회
    const embeddings = db.prepare(`
      SELECT 
        memory_id,
        embedding,
        dim,
        model,
        created_at
      FROM memory_embedding
    `).all();

    console.log(`📊 백업할 임베딩 개수: ${embeddings.length}`);

    if (embeddings.length === 0) {
      console.log('⚠️ 백업할 임베딩이 없습니다.');
      return;
    }

    // 백업 데이터 준비
    const backupData = {
      timestamp: new Date().toISOString(),
      count: embeddings.length,
      embeddings: embeddings.map(e => ({
        memory_id: e.memory_id,
        embedding: e.embedding,
        dim: e.dim,
        model: e.model,
        created_at: e.created_at
      }))
    };

    // JSON 파일로 저장
    fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2), 'utf8');
    console.log(`✅ 백업 완료: ${backupFile}`);
    console.log(`📦 백업 크기: ${(fs.statSync(backupFile).size / 1024).toFixed(2)} KB`);

    // 사용자 확인
    console.log('\n⚠️ 백업이 완료되었습니다.');
    console.log('다음 단계로 임베딩을 삭제하고 재생성할 수 있습니다.');
    console.log('백업 파일:', backupFile);

  } catch (error) {
    console.error('❌ 백업 실패:', error.message);
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
  backupEmbeddings().catch((error) => {
    console.error('❌ 스크립트 실행 중 오류 발생:', error);
    process.exit(1);
  });
}

export { backupEmbeddings };
