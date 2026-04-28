#!/usr/bin/env node
/**
 * npm publish용 루트 `dist/`에 memento-server 빌드 산출물을 복사한다.
 * - 루트 package.json `bin`은 `./dist/server/*.js`를 가리켜야 하며(verify-bin),
 * - `prepack-bundle-core.js`도 동일 경로를 전제로 한다.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const src = join(root, 'packages/memento-server/dist');
const dest = join(root, 'dist');

if (!existsSync(join(src, 'server/index.js'))) {
  console.error(
    '[sync-root-server-dist] packages/memento-server/dist/server/index.js 가 없습니다. 먼저 `npm run build -w memento-server` 를 실행하세요.'
  );
  process.exit(1);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log('[sync-root-server-dist] Copied packages/memento-server/dist → dist/');
