/**
 * Admin: project_id 기준 통계·정리(미리보기·삭제) — Issue #81
 */

import type { Router } from 'express';
import type Database from 'better-sqlite3';
import {
  deleteProjectMemoriesOlderThan,
  listProjectMemoryCleanupCandidates,
  queryProjectMemoryStats,
} from '@memento/core';

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
      const stats = queryProjectMemoryStats(db, project_id);
      return res.json({
        project_id,
        total: stats.total,
        by_type: stats.by_type,
        oldest_created_at: stats.oldest,
        newest_created_at: stats.newest,
      });
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
      const rows = listProjectMemoryCleanupCandidates(db, project_id, types, olderThanDays);
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
      const deleted = deleteProjectMemoriesOlderThan(db, project_id, types, olderThanDays);
      return res.json({ deleted });
    } catch (error) {
      return res.status(500).json({ error: '프로젝트 정리 실패', message: String(error) });
    }
  });
}
