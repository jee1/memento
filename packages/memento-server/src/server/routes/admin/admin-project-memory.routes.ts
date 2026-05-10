/**
 * Admin: project_id 기준 통계·정리(미리보기·삭제) — Issue #81
 */

import type { Router } from 'express';
import type Database from 'better-sqlite3';

/**
 * cleanup 파라미터 파싱 헬퍼 (Issue #81)
 * Math.floor를 사용해 정수 보장 — better-sqlite3의 datetime() modifier에 안전하게 사용 가능
 */
function parseCleanupParams(query: Record<string, unknown>): { olderThanDays: number; types: string[] } | { error: string; status: number } {
  const olderThanDays = Math.floor(Number(query['older_than_days']));
  if (!query['older_than_days'] || isNaN(olderThanDays) || olderThanDays <= 0) {
    return { error: 'older_than_days 파라미터가 필요합니다 (양의 정수)', status: 400 };
  }
  if (olderThanDays > 3650) {
    return { error: 'older_than_days는 최대 3650일(10년)입니다', status: 400 };
  }
  const typesRaw = typeof query['types'] === 'string' ? query['types'] : 'episodic,working';
  const types = typesRaw.split(',').map(t => t.trim()).filter(Boolean);
  if (types.includes('core')) {
    return { error: 'core 타입 기억은 삭제할 수 없습니다', status: 400 };
  }
  const allowedTypes = ['working', 'episodic', 'semantic', 'procedural', 'vault'];
  const invalid = types.filter(t => !allowedTypes.includes(t));
  if (invalid.length > 0) {
    return { error: `허용되지 않는 타입: ${invalid.join(', ')}`, status: 400 };
  }
  return { olderThanDays, types };
}

export function registerAdminProjectMemoryRoutes(router: Router, db: Database.Database | null): void {
  router.get('/memory/project/:project_id/stats', async (req, res) => {
    try {
      if (!db) return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      const { project_id } = req.params;
      if (!project_id || project_id.length > 200) {
        return res.status(400).json({ error: 'project_id는 1~200자여야 합니다' });
      }
      const total = (db.prepare(`SELECT COUNT(*) as c FROM memory_item WHERE project_id = ? AND COALESCE(is_deleted, 0) = 0`).get(project_id) as { c: number }).c;
      const byTypeRows = db.prepare(`SELECT type, COUNT(*) as c FROM memory_item WHERE project_id = ? AND COALESCE(is_deleted, 0) = 0 GROUP BY type`).all(project_id) as Array<{ type: string; c: number }>;
      const by_type: Record<string, number> = {};
      for (const row of byTypeRows) { by_type[row.type] = row.c; }
      const dates = db.prepare(`SELECT MIN(created_at) as oldest, MAX(created_at) as newest FROM memory_item WHERE project_id = ? AND COALESCE(is_deleted, 0) = 0`).get(project_id) as { oldest: string | null; newest: string | null };
      return res.json({ project_id, total, by_type, oldest_created_at: dates.oldest, newest_created_at: dates.newest });
    } catch (error) {
      return res.status(500).json({ error: '프로젝트 통계 조회 실패', message: String(error) });
    }
  });

  router.get('/memory/project/:project_id/cleanup/preview', async (req, res) => {
    try {
      if (!db) return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      const { project_id } = req.params;
      if (!project_id || project_id.length > 200) {
        return res.status(400).json({ error: 'project_id는 1~200자여야 합니다' });
      }
      const parsed = parseCleanupParams(req.query as Record<string, unknown>);
      if ('error' in parsed) return res.status(parsed.status).json({ error: parsed.error });
      const { olderThanDays, types } = parsed;
      const placeholders = types.map(() => '?').join(', ');
      const rows = db.prepare(
        `SELECT id, content, type, created_at FROM memory_item WHERE project_id = ? AND type IN (${placeholders}) AND created_at < datetime('now', '-${olderThanDays} days') AND COALESCE(is_deleted, 0) = 0`
      ).all(project_id, ...types) as Array<{ id: string; content: string; type: string; created_at: string }>;
      return res.json({ would_delete: rows.length, items: rows });
    } catch (error) {
      return res.status(500).json({ error: '프로젝트 정리 미리보기 실패', message: String(error) });
    }
  });

  router.delete('/memory/project/:project_id/cleanup', async (req, res) => {
    try {
      if (!db) return res.status(500).json({ error: '데이터베이스가 연결되지 않았습니다' });
      const { project_id } = req.params;
      if (!project_id || project_id.length > 200) {
        return res.status(400).json({ error: 'project_id는 1~200자여야 합니다' });
      }
      const parsed = parseCleanupParams(req.query as Record<string, unknown>);
      if ('error' in parsed) return res.status(parsed.status).json({ error: parsed.error });
      const { olderThanDays, types } = parsed;
      const placeholders = types.map(() => '?').join(', ');
      const result = db.prepare(
        `DELETE FROM memory_item WHERE project_id = ? AND type IN (${placeholders}) AND created_at < datetime('now', '-${olderThanDays} days') AND COALESCE(is_deleted, 0) = 0`
      ).run(project_id, ...types);
      return res.json({ deleted: result.changes });
    } catch (error) {
      return res.status(500).json({ error: '프로젝트 정리 실패', message: String(error) });
    }
  });
}
