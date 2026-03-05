/**
 * @memento/core - 라이브러리 진입점
 * createMementoCore로 DB·서비스 초기화 후 서버/앱에서 ToolContext·getToolRegistry 사용.
 */

import { initializeDatabase, closeDatabase as closeDb } from './infrastructure/database/database/init.js';
import { initializeServices } from './bootstrap.js';
import { createToolContext } from './context.js';
import { getToolRegistry } from './tools/index.js';

export interface MementoCoreOptions {
  dbPath: string;
  config?: Partial<Record<string, unknown>>;
}

export interface MementoCoreInstance {
  db: import('better-sqlite3').Database;
  services: import('./bootstrap.js').ServerServices;
}

/**
 * Core 인스턴스 생성 (DB 초기화 + 서비스 부트스트랩).
 * 서버는 반환된 db, services로 createToolContext(db, services) 및 getToolRegistry() 사용.
 */
export async function createMementoCore(options: MementoCoreOptions): Promise<MementoCoreInstance> {
  const db = await initializeDatabase(options.dbPath);
  const services = await initializeServices(db);
  return { db, services };
}

/** DB 연결 종료 (서버 종료 시 호출) */
export function closeDatabase(db: import('better-sqlite3').Database): void {
  closeDb(db);
}

export { createToolContext, getToolRegistry, initializeServices };
export type { ServerServices } from './bootstrap.js';
export type { ServerContext } from './context.js';

// 타입·인터페이스 re-export (서버/앱에서 사용)
export type { ToolContext, ToolResult } from './tools/types.js';
export type { RecallResultItem } from './domains/memory/tools/recall-tool.js';
