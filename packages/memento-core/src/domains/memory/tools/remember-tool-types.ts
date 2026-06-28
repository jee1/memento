/**
 * Remember Tool 공유 타입 (remember-tool.ts에서 분리, #582).
 */

import type { MemoryItem } from '../../../shared/types/index.js';

/** memory_item SELECT row 공통 형태 */
export interface MemoryItemRow {
  id: string;
  type: string;
  content: string;
  importance: number;
  privacy_scope: string;
  created_at: string;
  last_accessed?: string | null;
  pinned: number | boolean;
  tags?: string | null;
  source?: string | null;
  is_consolidated?: number | boolean | null;
}

/** Procedural 기존 레코드 조회용 */
export type ProceduralMemoryItem = MemoryItem & {
  recall_count?: number;
  g_value?: number;
  last_accessed_at?: Date;
  version_series_id?: string;
  version?: number;
  consolidation_score?: number;
};
