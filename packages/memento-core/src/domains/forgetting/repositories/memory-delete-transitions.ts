/**
 * 기억 삭제 전이 (#1752)
 *
 * 기억을 지우는 모든 경로(망각 정리, forget, wipe, 자가 치유, 프로젝트 정리)가 이 두 함수만 쓴다.
 * 규칙: 살아 있는 행만 소프트 삭제, 소프트 삭제된 행만 영구 삭제(옵션으로 넓힌다), 바뀐 행에만 이벤트,
 * `deleted_at` 은 늘 채우고 `last_accessed` 는 건드리지 않는다.
 * memory 도메인이 forgetting 을 부르는 방향이라 여기(forgetting)에 둔다.
 */

import type Database from 'better-sqlite3';
import { ForgettingEventRepository } from './forgetting-event-repository.js';

/** 삭제 전이가 남기는 망각 이벤트 (memory_forgetting_event) */
export interface MemoryDeleteEvent {
  reason: string;
  policy: string;
  forgetScore?: number | null;
  ttlDays?: number | null;
  metadata?: Record<string, unknown>;
}

/** 호출자 범위 등 추가 WHERE 조건. sql 은 ` AND ...` 로 시작한다. */
export interface MemoryDeleteScope {
  sql: string;
  params: unknown[];
}

const forgettingEvents = new ForgettingEventRepository();

/**
 * 기억 소프트 삭제 (#1752). 기억을 지우는 모든 경로가 이 함수와 hardDeleteMemoryItem 만 쓴다.
 *
 * 살아 있고 핀이 없는 행만 바꾼다. 이미 삭제된 행은 그대로 두어 유예가 다시 시작되지 않는다.
 * `deleted_at` 을 늘 채우고 `last_accessed` 는 건드리지 않는다. 행이 바뀌었을 때만 이벤트를 남긴다.
 */
export function softDeleteMemoryItem(
  db: Database.Database,
  memoryId: string,
  event: MemoryDeleteEvent,
  scope: MemoryDeleteScope = { sql: '', params: [] },
): boolean {
  const deletedAt = new Date().toISOString();
  return db.transaction(() => {
    const { changes } = db
      .prepare(
        `UPDATE memory_item SET is_deleted = 1, deleted_at = ?, pinned = 0
         WHERE id = ? AND COALESCE(is_deleted, 0) = 0 AND COALESCE(pinned, 0) = 0${scope.sql}`,
      )
      .run(deletedAt, memoryId, ...scope.params);
    if (changes === 0) return false;
    forgettingEvents.insert(db, {
      memory_id: memoryId,
      action: 'soft',
      reason: event.reason,
      policy: event.policy,
      forget_score: event.forgetScore ?? null,
      ttl_days: event.ttlDays ?? null,
      metadata_json: JSON.stringify({ deleted_at: deletedAt, ...event.metadata }),
    });
    return true;
  })();
}

/**
 * 기억 영구 삭제 (#1752). 기본은 소프트 삭제된 행만 지운다.
 *
 * - `includeLive`: 살아 있는 행도 지운다(사용자가 `forget hard` 로 바로 지울 때). 핀은 여전히 막는다.
 * - `force`: 살아 있는 행과 핀 고정 행도 지운다(관리자 wipe).
 * 행이 지워졌을 때만 이벤트를 남긴다.
 */
export function hardDeleteMemoryItem(
  db: Database.Database,
  memoryId: string,
  event: MemoryDeleteEvent,
  options: { includeLive?: boolean; force?: boolean; scope?: MemoryDeleteScope } = {},
): boolean {
  const scope = options.scope ?? { sql: '', params: [] };
  const guards = [
    options.force || options.includeLive ? '' : ' AND COALESCE(is_deleted, 0) = 1',
    options.force ? '' : ' AND COALESCE(pinned, 0) = 0',
  ].join('');
  return db.transaction(() => {
    const { changes } = db
      .prepare(`DELETE FROM memory_item WHERE id = ?${guards}${scope.sql}`)
      .run(memoryId, ...scope.params);
    if (changes === 0) return false;
    forgettingEvents.insert(db, {
      memory_id: memoryId,
      action: 'hard',
      reason: event.reason,
      policy: event.policy,
      forget_score: event.forgetScore ?? null,
      ttl_days: event.ttlDays ?? null,
      metadata_json: event.metadata ? JSON.stringify(event.metadata) : null,
    });
    return true;
  })();
}
