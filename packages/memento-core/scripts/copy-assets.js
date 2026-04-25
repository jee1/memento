#!/usr/bin/env node
/**
 * Core 패키지 에셋 복사: schema.sql, migrations, prompts, config
 * projectRoot = 패키지 루트(packages/memento-core)
 */
import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const projectRoot = join(__dirname, '..');
const repoRoot = join(projectRoot, '..', '..');

const distDatabaseDir = join(projectRoot, 'dist', 'database');
const distMigrationDir = join(projectRoot, 'dist', 'infrastructure', 'database', 'database', 'migration', 'migrations');
const sourceSchemaFile = join(projectRoot, 'src', 'infrastructure', 'database', 'database', 'schema.sql');
const targetSchemaFile = join(distDatabaseDir, 'schema.sql');
const sourceMigrationDir = join(projectRoot, 'src', 'infrastructure', 'database', 'database', 'migration', 'migrations');

// 추가 자산
const distPromptsDir = join(projectRoot, 'dist', 'prompts');
const distConfigDir = join(projectRoot, 'dist', 'config');
const sourcePromptsDir = join(projectRoot, 'prompts');
const sourceConfigDir = join(repoRoot, 'config'); // config는 레포 루트에 있을 수 있음

/**
 * 디렉토리 재귀 복사 유틸리티
 */
function copyDir(src, dest) {
  if (!existsSync(src)) return;
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }
  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

try {
  // 1. Database schema
  if (!existsSync(distDatabaseDir)) {
    mkdirSync(distDatabaseDir, { recursive: true });
    console.log('✅ Created dist/database directory');
  }
  if (existsSync(sourceSchemaFile)) {
    copyFileSync(sourceSchemaFile, targetSchemaFile);
    console.log('✅ Copied schema.sql to dist/database/');
  }

  // 2. Migrations (SQL files only)
  if (existsSync(sourceMigrationDir)) {
    if (!existsSync(distMigrationDir)) {
      mkdirSync(distMigrationDir, { recursive: true });
    }
    const files = readdirSync(sourceMigrationDir);
    const sqlFiles = files.filter((f) => f.endsWith('.sql'));
    for (const file of sqlFiles) {
      copyFileSync(join(sourceMigrationDir, file), join(distMigrationDir, file));
    }
    console.log(`✅ Copied ${sqlFiles.length} migration SQL file(s) to dist/.../migrations/`);
  }

  // 3. Prompts
  if (existsSync(sourcePromptsDir)) {
    copyDir(sourcePromptsDir, distPromptsDir);
    console.log('✅ Copied prompts/ to dist/prompts/');
  }

  // 4. Config (from repo root if exists)
  if (existsSync(sourceConfigDir)) {
    copyDir(sourceConfigDir, distConfigDir);
    console.log('✅ Copied config/ to dist/config/');
  }

} catch (err) {
  console.error('❌ Error copying assets:', err.message);
  process.exit(1);
}
