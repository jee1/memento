#!/usr/bin/env node

import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 프로젝트 루트 디렉토리 경로
const projectRoot = join(__dirname, '..', '..');
const distDatabaseDir = join(projectRoot, 'dist', 'database');
const distMigrationDir = join(projectRoot, 'dist', 'infrastructure', 'database', 'database', 'migration', 'migrations');
const distPromptsDir = join(projectRoot, 'dist', 'prompts');
const sourceSchemaFile = join(projectRoot, 'src', 'infrastructure', 'database', 'database', 'schema.sql');
const targetSchemaFile = join(distDatabaseDir, 'schema.sql');
const sourceMigrationDir = join(projectRoot, 'src', 'infrastructure', 'database', 'database', 'migration', 'migrations');
const sourcePromptsDir = join(projectRoot, 'prompts');

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
    // dist/infrastructure/database/database/migration/migrations 디렉토리 생성
    if (!existsSync(distMigrationDir)) {
      mkdirSync(distMigrationDir, { recursive: true });
      console.log('✅ Created dist/infrastructure/database/database/migration/migrations directory');
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
      console.log(`✅ Copied ${copiedCount} migration SQL file(s) to dist/infrastructure/database/database/migration/migrations/`);
    }
  }

  // prompts 디렉토리 복사
  if (existsSync(sourcePromptsDir)) {
    // dist/prompts 디렉토리가 없으면 생성
    if (!existsSync(distPromptsDir)) {
      mkdirSync(distPromptsDir, { recursive: true });
      console.log('✅ Created dist/prompts directory');
    }

    // prompts 디렉토리의 모든 파일 복사
    const copyRecursive = (src, dest) => {
      const entries = readdirSync(src, { withFileTypes: true });
      
      for (const entry of entries) {
        const srcPath = join(src, entry.name);
        const destPath = join(dest, entry.name);
        
        if (entry.isDirectory()) {
          if (!existsSync(destPath)) {
            mkdirSync(destPath, { recursive: true });
          }
          copyRecursive(srcPath, destPath);
        } else {
          copyFileSync(srcPath, destPath);
        }
      }
    };

    copyRecursive(sourcePromptsDir, distPromptsDir);
    console.log('✅ Copied prompts directory to dist/prompts/');
  } else {
    console.warn('⚠️  Source prompts directory not found:', sourcePromptsDir);
  }

} catch (error) {
  console.error('❌ Error copying assets:', error.message);
  process.exit(1);
}

