#!/usr/bin/env node

/**
 * 임베딩 데이터 마이그레이션 스크립트
 * 기존 임베딩 데이터를 새로운 통합 시스템으로 마이그레이션
 * 
 * 리팩토링: 공통 모듈(initializeDatabase)을 사용하여 일관된 DB 초기화 보장
 * 
 * 사용법: 
 *   - 개발 환경: npx tsx scripts/migrate-embedding-data.js migrate
 *   - 프로덕션: npm run build && node dist/scripts/migrate-embedding-data.js migrate
 */

// TypeScript 소스를 직접 import (tsx로 실행 시)
// 빌드된 파일을 사용하려면 '../dist/infrastructure/database/database/init.js'로 변경
import { initializeDatabase, closeDatabase } from '../src/infrastructure/database/database/init.js';
import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, copyFileSync } from 'fs';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

class EmbeddingMigration {
  constructor() {
    // DB 경로는 initializeDatabase가 환경 변수에서 가져옴
    // 백업 경로는 data 디렉토리에 생성
    this.backupPath = join(process.cwd(), 'data', `memory-backup-${Date.now()}.db`);
    this.db = null;
  }

  /**
   * 데이터베이스 연결
   * 공통 모듈을 사용하여 일관된 초기화 보장
   */
  async connect() {
    try {
      // 공통 모듈을 사용하여 데이터베이스 초기화
      // initializeDatabase는 DB 파일이 없으면 자동으로 생성하고 초기화함
      this.db = await initializeDatabase();
      console.log('✅ 데이터베이스 연결 성공');
    } catch (error) {
      console.error('❌ 데이터베이스 연결 실패:', error);
      throw error;
    }
  }

  /**
   * 백업 생성
   */
  createBackup() {
    try {
      if (!this.db) {
        throw new Error('데이터베이스가 연결되지 않았습니다. connect()를 먼저 호출하세요.');
      }
      
      // 백업 디렉토리 생성
      const backupDir = dirname(this.backupPath);
      if (!existsSync(backupDir)) {
        const { mkdirSync } = require('fs');
        mkdirSync(backupDir, { recursive: true });
      }
      
      // 백업 생성
      this.db.backup(this.backupPath);
      console.log(`✅ 백업 생성 완료: ${this.backupPath}`);
    } catch (error) {
      console.error('❌ 백업 생성 실패:', error);
      throw error;
    }
  }

  /**
   * 마이그레이션 실행
   */
  async migrate() {
    try {
      console.log('🚀 임베딩 데이터 마이그레이션 시작...');
      
      // 1. 백업 생성
      this.createBackup();
      
      // 2. 스키마 업데이트
      await this.updateSchema();
      
      // 3. 기존 데이터 분석
      const analysis = this.analyzeExistingData();
      console.log('📊 기존 데이터 분석:', analysis);
      
      // 4. 데이터 마이그레이션
      await this.migrateData();
      
      // 5. 검증
      this.validateMigration();
      
      console.log('✅ 마이그레이션 완료!');
      
    } catch (error) {
      console.error('❌ 마이그레이션 실패:', error);
      if (error.stack) {
        console.error('   스택 트레이스:', error.stack);
      }
      console.log(`🔄 백업에서 복원하려면: cp ${this.backupPath} ${join(process.cwd(), 'data', 'memory.db')}`);
      throw error;
    } finally {
      if (this.db) {
        closeDatabase(this.db);
      }
    }
  }

  /**
   * 스키마 업데이트
   */
  async updateSchema() {
    console.log('📝 스키마 업데이트 중...');
    
    const migrationPath = join(__dirname, '..', 'src', 'database', 'migrations', '001_add_embedding_metadata.sql');
    
    if (!existsSync(migrationPath)) {
      console.log('📝 마이그레이션 파일이 없어서 직접 실행합니다...');
      await this.runDirectMigration();
      return;
    }
    
    const migrationSQL = readFileSync(migrationPath, 'utf8');
    
    // SQLite는 ALTER TABLE이 제한적이므로 단계별로 실행
    const statements = migrationSQL.split(';').filter(stmt => stmt.trim());
    
    for (const statement of statements) {
      if (statement.trim()) {
        try {
          this.db.exec(statement);
        } catch (error) {
          console.warn(`⚠️ SQL 실행 경고: ${error.message}`);
        }
      }
    }
    
    console.log('✅ 스키마 업데이트 완료');
  }

  /**
   * 직접 마이그레이션 실행
   */
  async runDirectMigration() {
    try {
      if (!this.db) {
        throw new Error('데이터베이스가 연결되지 않았습니다.');
      }
      
      // 1. 새로운 컬럼 추가
      console.log('📝 컬럼 추가 중...');
      try {
        this.db.exec('ALTER TABLE memory_embedding ADD COLUMN embedding_provider TEXT');
      } catch (error) {
        // 컬럼이 이미 존재할 수 있음
        if (!error.message.includes('duplicate column')) {
          throw error;
        }
      }
      
      try {
        this.db.exec('ALTER TABLE memory_embedding ADD COLUMN dimensions INTEGER');
      } catch (error) {
        if (!error.message.includes('duplicate column')) {
          throw error;
        }
      }
      
      try {
        this.db.exec('ALTER TABLE memory_embedding ADD COLUMN created_by TEXT DEFAULT "migration"');
      } catch (error) {
        if (!error.message.includes('duplicate column')) {
          throw error;
        }
      }
      
      // 2. 기존 데이터 업데이트
      console.log('📝 기존 데이터 업데이트 중...');
      this.db.exec(`
        UPDATE memory_embedding 
        SET 
          embedding_provider = CASE 
            WHEN model = 'lightweight-hybrid' THEN 'tfidf'
            WHEN model IS NULL OR model = '' THEN 'tfidf'
            ELSE 'unknown'
          END,
          dimensions = dim,
          created_by = 'legacy'
        WHERE embedding_provider IS NULL
      `);
      
      // 3. 인덱스 추가
      console.log('📝 인덱스 추가 중...');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_memory_embedding_provider ON memory_embedding(embedding_provider)');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_memory_embedding_dimensions ON memory_embedding(dimensions)');
      this.db.exec('CREATE INDEX IF NOT EXISTS idx_memory_embedding_created_by ON memory_embedding(created_by)');
      
      console.log('✅ 직접 마이그레이션 완료');
    } catch (error) {
      console.error('❌ 직접 마이그레이션 실패:', error);
      throw error;
    }
  }

  /**
   * 기존 데이터 분석
   */
  analyzeExistingData() {
    if (!this.db) {
      throw new Error('데이터베이스가 연결되지 않았습니다.');
    }
    
    const analysis = {};
    
    // 차원별 분포
    const dimensionStats = this.db.prepare(`
      SELECT dim, COUNT(*) as count, 
             COUNT(CASE WHEN model IS NOT NULL AND model != '' THEN 1 END) as with_model
      FROM memory_embedding 
      GROUP BY dim
    `).all();
    
    analysis.dimensions = dimensionStats;
    
    // 전체 통계
    const totalStats = this.db.prepare(`
      SELECT COUNT(*) as total,
             COUNT(CASE WHEN embedding_provider IS NOT NULL THEN 1 END) as migrated
      FROM memory_embedding
    `).get();
    
    analysis.total = totalStats;
    
    return analysis;
  }

  /**
   * 데이터 마이그레이션
   */
  async migrateData() {
    console.log('🔄 데이터 마이그레이션 중...');
    
    // 기존 데이터를 새로운 통합 시스템으로 재생성할지 결정
    const shouldRegenerate = process.argv.includes('--regenerate');
    
    if (shouldRegenerate) {
      console.log('🔄 기존 임베딩 데이터 재생성 모드');
      await this.regenerateEmbeddings();
    } else {
      console.log('📝 기존 데이터 메타데이터 업데이트 모드');
      this.updateMetadata();
    }
  }

  /**
   * 메타데이터 업데이트
   */
  updateMetadata() {
    if (!this.db) {
      throw new Error('데이터베이스가 연결되지 않았습니다.');
    }
    
    const updateStmt = this.db.prepare(`
      UPDATE memory_embedding 
      SET 
        embedding_provider = CASE 
          WHEN model = 'lightweight-hybrid' THEN 'tfidf'
          WHEN model IS NULL OR model = '' THEN 'tfidf'
          ELSE 'unknown'
        END,
        dimensions = dim,
        created_by = 'legacy'
      WHERE embedding_provider IS NULL
    `);
    
    const result = updateStmt.run();
    console.log(`✅ ${result.changes}개 레코드 메타데이터 업데이트 완료`);
  }

  /**
   * 임베딩 재생성 (선택사항)
   */
  async regenerateEmbeddings() {
    console.log('⚠️ 임베딩 재생성은 시간이 오래 걸릴 수 있습니다.');
    console.log('💡 이 기능은 향후 구현 예정입니다.');
    
    // TODO: UnifiedEmbeddingService를 사용하여 임베딩 재생성
    // 1. memory_item에서 content 추출
    // 2. UnifiedEmbeddingService로 새로운 임베딩 생성
    // 3. memory_embedding 테이블 업데이트
  }

  /**
   * 마이그레이션 검증
   */
  validateMigration() {
    if (!this.db) {
      throw new Error('데이터베이스가 연결되지 않았습니다.');
    }
    
    console.log('🔍 마이그레이션 검증 중...');
    
    const validation = this.db.prepare(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN embedding_provider IS NOT NULL THEN 1 END) as with_provider,
        COUNT(CASE WHEN dimensions IS NOT NULL THEN 1 END) as with_dimensions,
        COUNT(CASE WHEN created_by IS NOT NULL THEN 1 END) as with_created_by
      FROM memory_embedding
    `).get();
    
    console.log('📊 검증 결과:', validation);
    
    if (validation.total === validation.with_provider) {
      console.log('✅ 모든 임베딩에 제공자 정보가 있습니다');
    } else {
      console.warn('⚠️ 일부 임베딩에 제공자 정보가 없습니다');
    }
  }

  /**
   * 롤백
   */
  rollback() {
    try {
      const dbPath = join(process.cwd(), 'data', 'memory.db');
      copyFileSync(this.backupPath, dbPath);
      console.log('🔄 백업에서 복원 완료');
    } catch (error) {
      console.error('❌ 롤백 실패:', error);
      throw error;
    }
  }
}

// CLI 실행
if (import.meta.url === `file://${process.argv[1]}` || import.meta.url.endsWith(process.argv[1])) {
  const migration = new EmbeddingMigration();
  
  const command = process.argv[2];
  
  switch (command) {
    case 'migrate':
      migration.connect().then(() => {
        migration.migrate().catch((error) => {
          console.error('❌ 마이그레이션 실행 중 오류:', error);
          process.exit(1);
        });
      }).catch((error) => {
        console.error('❌ 데이터베이스 연결 중 오류:', error);
        process.exit(1);
      });
      break;
    case 'rollback':
      migration.rollback();
      break;
    case 'analyze':
      migration.connect().then(() => {
        try {
          const analysis = migration.analyzeExistingData();
          console.log('📊 데이터 분석 결과:', JSON.stringify(analysis, null, 2));
          if (migration.db) {
            closeDatabase(migration.db);
          }
        } catch (error) {
          console.error('❌ 분석 중 오류:', error);
          if (migration.db) {
            closeDatabase(migration.db);
          }
          process.exit(1);
        }
      }).catch((error) => {
        console.error('❌ 데이터베이스 연결 중 오류:', error);
        process.exit(1);
      });
      break;
    default:
      console.log(`
사용법:
  npx tsx scripts/migrate-embedding-data.js migrate     # 마이그레이션 실행
  npx tsx scripts/migrate-embedding-data.js rollback   # 백업에서 복원
  npx tsx scripts/migrate-embedding-data.js analyze    # 데이터 분석만
  npx tsx scripts/migrate-embedding-data.js migrate --regenerate  # 임베딩 재생성 모드
      `);
  }
}

export default EmbeddingMigration;
