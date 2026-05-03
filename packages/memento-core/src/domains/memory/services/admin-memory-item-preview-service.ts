import type Database from 'better-sqlite3';

/** Admin 단건 조회용 `memory_id` 경로 파라미터 (SQL 인젝션·경로 조작 방지). */
const MEMORY_ID_PARAM_RE = /^mem_[A-Za-z0-9_]{1,220}$/;

export type AdminMemoryItemPreview = {
  id: string;
  type: string;
  content: string;
  importance: number;
  privacy_scope: string;
  pinned: boolean;
  created_at: string | null;
  last_accessed: string | null;
  last_accessed_at: string | null;
  tags: string | null;
  source: string | null;
  project_id: string | null;
  owner_id: string | null;
};

export function parseAdminMemoryItemIdParam(raw: string): { memoryId: string } | { error: string; status: number } {
  const id = decodeURIComponent(raw);
  if (!MEMORY_ID_PARAM_RE.test(id)) {
    return { error: 'Invalid memory id', status: 400 };
  }
  return { memoryId: id };
}

/**
 * `memory_item` 단건을 Admin JSON(프리뷰)용으로 조회한다. 삭제(soft)된 행은 null.
 */
export function getAdminMemoryItemPreviewById(db: Database.Database, memoryId: string): AdminMemoryItemPreview | null {
  const row = db
    .prepare(
      `SELECT id, type, content, importance, privacy_scope, pinned,
              created_at, last_accessed, last_accessed_at,
              tags, source, project_id, owner_id, is_deleted
         FROM memory_item WHERE id = ?`,
    )
    .get(memoryId) as Record<string, unknown> | undefined;

  if (!row) {
    return null;
  }
  const deleted = row.is_deleted === 1 || row.is_deleted === true;
  if (deleted) {
    return null;
  }

  return {
    id: String(row.id),
    type: String(row.type),
    content: String(row.content),
    importance: Number(row.importance),
    privacy_scope: String(row.privacy_scope ?? 'private'),
    pinned: Boolean(row.pinned),
    created_at: row.created_at == null ? null : String(row.created_at),
    last_accessed: row.last_accessed == null ? null : String(row.last_accessed),
    last_accessed_at: row.last_accessed_at == null ? null : String(row.last_accessed_at),
    tags: row.tags == null ? null : String(row.tags),
    source: row.source == null ? null : String(row.source),
    project_id: row.project_id == null ? null : String(row.project_id),
    owner_id: row.owner_id == null ? null : String(row.owner_id),
  };
}
