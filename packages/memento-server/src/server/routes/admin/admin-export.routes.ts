/**
 * Admin: memory export (#672)
 */

import type { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import { ExportMemoriesTool, logger, createToolContext } from '@memento/core';
import type { ServerServices } from '../../bootstrap.js';

const MEMORY_ITEM_TYPES = new Set(['working', 'episodic', 'semantic', 'procedural']);

function parseTypesQuery(value: unknown): Array<'working' | 'episodic' | 'semantic' | 'procedural'> | undefined {
  if (value === undefined || value === '') return undefined;
  const raw = Array.isArray(value) ? value : String(value).split(',');
  const types = raw
    .map((t) => String(t).trim())
    .filter((t) => MEMORY_ITEM_TYPES.has(t)) as Array<'working' | 'episodic' | 'semantic' | 'procedural'>;
  return types.length > 0 ? types : undefined;
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
      const ownerId = typeof req.query.owner_id === 'string' ? req.query.owner_id : undefined;
      const limitRaw = req.query.limit;
      const limit = limitRaw !== undefined ? parseInt(String(limitRaw), 10) : undefined;

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
