#!/usr/bin/env node
import { existsSync, mkdirSync, copyFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// 프로젝트 루트 디렉토리 경로
const projectRoot = join(__dirname, '..', '..');
const distDatabaseDir = join(projectRoot, 'dist', 'database');
const sourceSchemaFile = join(projectRoot, 'src', 'database', 'schema.sql');
const targetSchemaFile = join(distDatabaseDir, 'schema.sql');
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
}
catch (error) {
    console.error('❌ Error copying assets:', error.message);
    process.exit(1);
}
//# sourceMappingURL=copy-assets.js.map