/**
 * 의존성 없는 CLI 헬퍼 — `scripts/*.js` 전용 진입점.
 *
 * `scripts/lib/cli.ts` 는 tsx 로 실행되는 `.ts` 스크립트를 위한 것이다. `.js` 스크립트가
 * 그 `.ts` 를 직접 import 하면 저장소 안에서는 Node 의 타입 스트리핑 덕에 돌지만,
 * npm 패키지로 설치된 뒤에는 Node 가 거절한다:
 *
 *   ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING:
 *   Stripping types is currently unsupported for files under node_modules
 *
 * `postinstall` 로 도는 auto-setup.js 가 여기 걸려 publish 가 통째로 실패했다.
 * 그래서 런타임 구현은 이 `.js` 에 두고, `cli.ts` 는 이 파일을 다시 export 한다.
 */

import { createRequire } from 'node:module';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs as parseNodeArgs } from 'node:util';

const require = createRequire(import.meta.url);

/**
 * node:util 의 parseArgs 를 관대한 기본값으로 감싸고 원본 argv 도 함께 돌려준다.
 *
 * @param {import('node:util').ParseArgsConfig} [config]
 */
export function parseArgs(config = {}) {
  const args = [...(config.args ?? process.argv.slice(2))];
  return {
    ...parseNodeArgs({
      ...config,
      args,
      allowPositionals: config.allowPositionals ?? true,
      strict: config.strict ?? false,
    }),
    args,
  };
}

/**
 * 이 모듈이 직접 실행된 진입점인지 판별한다.
 *
 * @param {string} moduleUrl - 호출한 모듈의 import.meta.url
 * @returns {boolean}
 */
export function isMain(moduleUrl) {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && resolve(entrypoint) === fileURLToPath(moduleUrl);
}

/**
 * better-sqlite3 핸들을 연다.
 *
 * 네이티브 애드온을 모듈 최상단에서 import 하면 auto-setup.js 의 postinstall 이
 * better-sqlite3 빌드가 끝나기 전에 그것을 로드하게 된다. 동기 시그니처는 유지해야
 * 하므로 동적 import 대신 createRequire 로 호출 시점에 가져온다.
 *
 * @param {string | Buffer} [filename]
 * @param {import('better-sqlite3').Options} [options]
 * @returns {import('better-sqlite3').Database}
 */
export function openDb(filename = ':memory:', options) {
  const Database = require('better-sqlite3');
  return new Database(filename, options);
}

/**
 * @param {string | undefined} raw
 * @param {string} defaultPath
 * @returns {string}
 */
function resolveConfigPath(raw, defaultPath) {
  const value = raw?.trim();
  if (!value) {
    return defaultPath;
  }
  if (value === '~') {
    return os.homedir();
  }
  const expanded = value.startsWith('~/') || value.startsWith('~\\')
    ? join(os.homedir(), value.slice(2))
    : value;
  return resolve(expanded);
}

/**
 * DB_PATH 해석의 단일 규칙 (#962).
 * - 선행 `~` / `~/` / `~\` 는 홈으로 확장한다 (core 의 expandHomeDirPath 와 같은 의미론).
 * - 그 뒤 path.resolve 로 절대경로화한다 (상대경로 사용례 유지).
 * - 미설정·공백이면 ~/.memento/data/memory.db.
 * @param {string | undefined} [raw=process.env.DB_PATH]
 * @returns {string} 절대 경로
 */
export function resolveDbPath(raw = process.env.DB_PATH) {
  return resolveConfigPath(raw, join(os.homedir(), '.memento', 'data', 'memory.db'));
}

/**
 * 백업 디렉터리 해석의 단일 규칙 (#963).
 * - MEMENTO_BACKUP_DIR 이 있으면 그것을 쓴다 (~ 확장 규칙은 DB_PATH 와 동일).
 * - 없으면 ~/.memento/backups (바인드 마운트 밖, 호스트 사용자 소유).
 * @param {string | undefined} [raw=process.env.MEMENTO_BACKUP_DIR]
 * @returns {string} 절대 경로
 */
export function resolveBackupDir(raw = process.env.MEMENTO_BACKUP_DIR) {
  return resolveConfigPath(raw, join(os.homedir(), '.memento', 'backups'));
}
