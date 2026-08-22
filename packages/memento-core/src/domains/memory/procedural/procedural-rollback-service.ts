/**
 * Procedural Memory rollback: 이전 버전 내용으로 새 버전 생성 (Issue #57 Phase 2)
 * 기존 버전 행은 수정하지 않고, 새 memory_item 생성 후 version_of 링크 추가
 */

import type Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { getNextVersionNumber } from './procedural-versioning.js';

function generateMemoryId(): string {
  return `mem_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Given: currentId(기준 메모리), targetVersionId(되돌릴 버전 id), db.
 * When: rollbackToVersion 호출.
 * Then: target 버전 내용으로 새 memory_item 생성, version_of 링크 추가, 새 id 반환.
 * 대상이 없거나 동일 version_series가 아니면 throw.
 */
export function rollbackToVersion(
  db: Database.Database,
  currentId: string,
  targetVersionId: string
): string {
  const target = DatabaseUtils.get(
    db,
    `SELECT id, type, version_series_id, content, importance, privacy_scope, tags,
      task_goal, steps, reflection_notes, workflow_name, skill_name, trigger_conditions
     FROM memory_item WHERE id = ?`,
    [targetVersionId]
  ) as {
    id: string; type: string; version_series_id: string | null;
    content: string; importance: number | null; privacy_scope: string | null; tags: string | null;
    task_goal: string | null; steps: string | null; reflection_notes: string | null;
    workflow_name: string | null; skill_name: string | null; trigger_conditions: string | null;
  } | undefined;

  if (!target || target.type !== 'procedural') {
    throw new Error(`Procedural memory not found or wrong type: ${targetVersionId}`);
  }

  const seriesId = target.version_series_id ?? target.id;
  const current = DatabaseUtils.get(
    db,
    `SELECT id, version_series_id FROM memory_item WHERE id = ? AND type = 'procedural'`,
    [currentId]
  ) as { id: string; version_series_id: string | null } | undefined;

  if (!current) {
    throw new Error(`Current procedural memory not found: ${currentId}`);
  }
  const currentSeries = current.version_series_id ?? current.id;
  if (currentSeries !== seriesId) {
    throw new Error(`Target version is not in the same version series as current`);
  }

  const newId = generateMemoryId();
  const nextVersion = getNextVersionNumber(db, seriesId);

  DatabaseUtils.run(
    db,
    `INSERT INTO memory_item (
      id, type, content, importance, privacy_scope, tags,
      task_goal, steps, reflection_notes, workflow_name, skill_name, trigger_conditions,
      version, version_series_id) VALUES (?, 'procedural', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId,
      target.content,
      target.importance ?? 0.5,
      target.privacy_scope ?? 'private',
      target.tags ?? null,
      target.task_goal ?? null,
      target.steps ?? null,
      target.reflection_notes ?? null,
      target.workflow_name ?? null,
      target.skill_name ?? null,
      target.trigger_conditions ?? null,
      nextVersion,
      seriesId
    ]
  );

  DatabaseUtils.run(
    db,
    `INSERT INTO memory_link (source_id, target_id, relation_type) VALUES (?, ?, 'version_of')`,
    [newId, targetVersionId]
  );

  return newId;
}
