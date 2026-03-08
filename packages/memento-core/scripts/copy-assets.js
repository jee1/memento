#!/usr/bin/env node
/**
 * Core 패키지 에셋 복사: schema.sql, migrations
 * projectRoot = 패키지 루트(packages/memento-core)
 */
import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const projectRoot = join(__dirname, '..');
const distDatabaseDir = join(projectRoot, 'dist', 'database');
const distMigrationDir = join(projectRoot, 'dist', 'infrastructure', 'database', 'database', 'migration', 'migrations');
const sourceSchemaFile = join(projectRoot, 'src', 'infrastructure', 'database', 'database', 'schema.sql');
const targetSchemaFile = join(distDatabaseDir, 'schema.sql');
const sourceMigrationDir = join(projectRoot, 'src', 'infrastructure', 'database', 'database', 'migration', 'migrations');

try {
  if (!existsSync(distDatabaseDir)) {
    mkdirSync(distDatabaseDir, { recursive: true });
    console.log('✅ Created dist/database directory');
  }
  if (!existsSync(sourceSchemaFile)) {
    console.error('❌ Source schema file not found:', sourceSchemaFile);
    process.exit(1);
  }
  copyFileSync(sourceSchemaFile, targetSchemaFile);
  console.log('✅ Copied schema.sql to dist/database/');

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
} catch (err) {
  console.error('❌ Error copying assets:', err.message);
  process.exit(1);
}
