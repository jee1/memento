/**
 * @memento/core - 라이브러리 진입점
 * createMementoCore로 초기화 후 recall, remember 등 API 사용.
 */

export interface MementoCoreOptions {
  dbPath: string;
  config?: Partial<Record<string, unknown>>;
}

export interface MementoCoreAPI {
  recall(params: unknown): Promise<unknown>;
  remember(params: unknown): Promise<unknown>;
  forget(params: unknown): Promise<unknown>;
  /** 나중에 anchor, search_local 등 확장 */
}

/**
 * Core 인스턴스 생성 (스텁).
 * Phase 2.2에서 init·설정 주입·실제 recall/remember 연동 구현 예정.
 */
export function createMementoCore(_options: MementoCoreOptions): MementoCoreAPI {
  return {
    async recall() {
      return { items: [], total_count: 0, query_time: 0 };
    },
    async remember() {
      return { memory_id: '', success: true };
    },
    async forget() {
      return { success: true };
    }
  };
}

// 타입·인터페이스 re-export (서버/앱에서 사용)
export type { ToolContext, ToolResult } from './tools/types.js';
export type { RecallResultItem } from './domains/memory/tools/recall-tool.js';
