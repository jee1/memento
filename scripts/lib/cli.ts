import type Database from 'better-sqlite3';

/**
 * 런타임 구현은 cli-runtime.js 에 있다.
 * `.js` 스크립트가 이 `.ts` 를 import 하면 node_modules 하위에서 타입 스트리핑이
 * 거절되므로(ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING, #857), 코드는 그쪽에 둔다.
 */
export { isMain, openDb, parseArgs } from './cli-runtime.js';

export type CliDatabase = Database.Database;
