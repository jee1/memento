/**
 * Procedural Memory 버전 조회/부여 (Issue #57 Phase 2)
 * version_series_id별 버전 체인·최신 버전·다음 버전 번호 제공
 */

import type Database from 'better-sqlite3';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import type { VersionChainItem } from '../../../shared/types/procedural-versioning.js';

/**
 * Given: db와 메모리 id.
 * When: getVersionChain 호출.
 * Then: 해당 메모리가 속한 버전 시리즈의 VersionChainItem[] 반환 (version 오름차순).
 * 시리즈가 없으면 해당 id만 id, version=1, created_at으로 반환.
 */
export function getVersionChain(db: Database.Database, memoryId: string): VersionChainItem[] {
  const row = DatabaseUtils.get(
    db,
    `SELECT id, version, version_series_id, created_at FROM memory_item WHERE id = ? AND type = 'procedural'`,
    [memoryId]
  ) as { id: string; version: number | null; version_series_id: string | null; created_at: string } | undefined;

  if (!row) {
    return [];
  }

  if (row.version_series_id == null) {
    return [{
      id: row.id,
      version: row.version ?? 1,
      created_at: row.created_at
    }];
  }

  const rows = DatabaseUtils.all(
    db,
    `SELECT id, version, created_at FROM memory_item WHERE type = 'procedural' AND version_series_id = ? ORDER BY COALESCE(version, 1) ASC`,
    [row.version_series_id]
  ) as Array<{ id: string; version: number | null; created_at: string }>;

  return rows.map(r => ({
    id: r.id,
    version: r.version ?? 1,
    created_at: r.created_at
  }));
}

/**
 * Given: db와 version_series_id.
 * When: getLatestVersionInSeries 호출.
 * Then: 해당 시리즈에서 version이 최대인 메모리 1건 반환 (id, version, created_at 등).
 */
export function getLatestVersionInSeries(
  db: Database.Database,
  versionSeriesId: string
): { id: string; version: number; created_at: string } | null {
  const row = DatabaseUtils.get(
    db,
    `SELECT id, version, created_at FROM memory_item WHERE type = 'procedural' AND version_series_id = ? ORDER BY version DESC LIMIT 1`,
    [versionSeriesId]
  ) as { id: string; version: number; created_at: string } | undefined;

  if (!row) {
    return null;
  }
  return { id: row.id, version: row.version, created_at: row.created_at };
}

/**
 * Given: db와 version_series_id.
 * When: getNextVersionNumber 호출.
 * Then: 해당 시리즈의 MAX(version)+1 반환. 행이 없으면 1.
 */
export function getNextVersionNumber(db: Database.Database, versionSeriesId: string): number {
  const row = DatabaseUtils.get(
    db,
    `SELECT COALESCE(MAX(version), 0) AS max_version FROM memory_item WHERE type = 'procedural' AND version_series_id = ?`,
    [versionSeriesId]
  ) as { max_version: number } | undefined;

  const max = row?.max_version ?? 0;
  return max + 1;
}
