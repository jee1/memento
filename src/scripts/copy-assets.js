#!/usr/bin/env node

import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 프로젝트 루트 디렉토리 경로
const projectRoot = join(__dirname, '..', '..');
const distDatabaseDir = join(projectRoot, 'dist', 'database');
const distMigrationDir = join(distDatabaseDir, 'migration', 'migrations');
const sourceSchemaFile = join(projectRoot, 'src', 'database', 'schema.sql');
const targetSchemaFile = join(distDatabaseDir, 'schema.sql');
const sourceMigrationDir = join(projectRoot, 'src', 'database', 'migration', 'migrations');

try {
  // dist/database 디렉토리가 없으면 생성
  if (!existsSync(distDatabaseDir)) {
    mkdirSync(distDatabaseDir, { recursive: true });
    console.log('✅ Created dist/database directory');
  }

  // schema.sql 파일이 존재하는지 확인
  if (!existsSync(sourceSchemaFile)) {
    console.error('❌ Source schema file not found:', sourceSchemaFile);
    process.exit(1);
  }

  // schema.sql 파일 복사
  copyFileSync(sourceSchemaFile, targetSchemaFile);
  console.log('✅ Copied schema.sql to dist/database/');

  // 마이그레이션 SQL 파일 복사
  if (existsSync(sourceMigrationDir)) {
    // dist/database/migration/migrations 디렉토리 생성
    if (!existsSync(distMigrationDir)) {
      mkdirSync(distMigrationDir, { recursive: true });
      console.log('✅ Created dist/database/migration/migrations directory');
    }

    // SQL 파일만 복사 (.sql 확장자만)
    const files = readdirSync(sourceMigrationDir);
    const sqlFiles = files.filter(file => file.endsWith('.sql'));
    
    let copiedCount = 0;
    for (const file of sqlFiles) {
      const sourceFile = join(sourceMigrationDir, file);
      const targetFile = join(distMigrationDir, file);
      copyFileSync(sourceFile, targetFile);
      copiedCount++;
    }

    if (copiedCount > 0) {
      console.log(`✅ Copied ${copiedCount} migration SQL file(s) to dist/database/migration/migrations/`);
    }
  }

} catch (error) {
  console.error('❌ Error copying assets:', error.message);
  process.exit(1);
}

