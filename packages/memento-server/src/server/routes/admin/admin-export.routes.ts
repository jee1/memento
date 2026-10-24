/**
 * Admin: memory export (#672)
 */

import type { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import { ExportMemoriesTool, logger, createToolContext } from '@memento/core';
import type { ServerServices } from '../../bootstrap.js';

const MEMORY_ITEM_TYPES = new Set(['working', 'episodic', 'semantic', 'procedural']);

function parseTypesQuery(value: unknown): Array<'working' | 'episodic' | 'semantic' | 'procedural'> | undefined | null {
  if (value === undefined) return undefined;
  const raw = typeof value === 'string' ? value.split(',') : value;
  if (!Array.isArray(raw) || raw.length === 0 || raw.some((t) => typeof t !== 'string' || !MEMORY_ITEM_TYPES.has(t.trim()))) {
    return null;
  }
  return raw.map((t) => t.trim()) as Array<'working' | 'episodic' | 'semantic' | 'procedural'>;
}

export function registerAdminExportRoutes(
  router: Router,
  db: Database.Database | null,
  serverServices: ServerServices | null,
): void {
  router.get('/export', async (req: Request, res: Response) => {
    try {
      if (!db || !serverServices) {
        return res.status(500).json({ error: '데이터베이스 또는 서비스가 연결되지 않았습니다' });
      }

      const format = req.query.format === 'jsonl' ? 'jsonl' : 'markdown';
      const types = parseTypesQuery(req.query.type ?? req.query.types);
      if (types === null) {
        return res.status(400).json({ error: 'type는 working, episodic, semantic, procedural 중 하나여야 합니다' });
      }
      const ownerId = typeof req.query.owner_id === 'string' ? req.query.owner_id : undefined;
      const limitRaw = req.query.limit;
      const limit = limitRaw === undefined ? undefined
        : typeof limitRaw === 'string' && /^\d+$/.test(limitRaw) ? Number(limitRaw) : NaN;

      if (limit !== undefined && (Number.isNaN(limit) || limit < 1 || limit > 10000)) {
        return res.status(400).json({ error: 'limit는 1–10000 사이 정수여야 합니다' });
      }

      const toolContext = createToolContext({ db, services: serverServices });
      const exportTool = new ExportMemoriesTool();
      const result = await exportTool.handle({ format, types, owner_id: ownerId, limit }, toolContext);
      const resultText = result.content[0]?.text || '{}';
      const resultData = JSON.parse(resultText) as { format: string; count: number; content: string };

      if (format === 'jsonl') {
        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="memento-export.jsonl"');
        return res.send(resultData.content);
      }

      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="memento-export.md"');
      return res.send(resultData.content);
    } catch (error) {
      logger.error('Memory export failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({
        error: '기억보내기 실패',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
