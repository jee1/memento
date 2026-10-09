/**
 * Admin memory search (#1118 Phase 2) — GET /admin/memory/search.
 * Calls the hybrid search engine directly (same ranking as recall) so the dashboard
 * search has no recall side effects: no anchor update, no meta-stat writes.
 * Returns previews only; the full body comes from GET /admin/memory/items/:memory_id.
 */

import type { Router } from 'express';
import type Database from 'better-sqlite3';
import type { ServerServices } from '../../bootstrap.js';
import { logger } from '@memento/core';

const SEARCH_TYPES = ['episodic', 'semantic', 'procedural', 'working'] as const;
type SearchType = (typeof SEARCH_TYPES)[number];
const SEARCH_LIMITS = ['25', '50'] as const;
const MAX_QUERY_LENGTH = 500;
const MAX_OWNER_ID_LENGTH = 200;
const PREVIEW_LENGTH = 200;

type AdminMemorySearchQuery = {
  q: string;
  type?: SearchType;
  owner_id?: string;
  limit: number;
};

function singleString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function parseAdminMemorySearchQuery(
  query: Record<string, unknown>
): AdminMemorySearchQuery | { error: string } {
  const q = (singleString(query.q) ?? '').trim();
  if (!q || q.length > MAX_QUERY_LENGTH) {
    return { error: 'Invalid q query' };
  }
  const parsed: AdminMemorySearchQuery = { q, limit: 25 };
  if (query.type !== undefined) {
    const type = singleString(query.type);
    if (!type || !(SEARCH_TYPES as readonly string[]).includes(type)) {
      return { error: 'Invalid type query' };
    }
    parsed.type = type as SearchType;
  }
  if (query.owner_id !== undefined) {
    const ownerId = (singleString(query.owner_id) ?? '').trim();
    if (!ownerId || ownerId.length > MAX_OWNER_ID_LENGTH) {
      return { error: 'Invalid owner_id query' };
    }
    parsed.owner_id = ownerId;
  }
  if (query.limit !== undefined) {
    const limit = singleString(query.limit);
    if (!limit || !(SEARCH_LIMITS as readonly string[]).includes(limit)) {
      return { error: 'Invalid limit query' };
    }
    parsed.limit = Number(limit);
  }
  return parsed;
}

export function registerAdminMemorySearchRoutes(
  router: Router,
  db: Database.Database | null,
  serverServices: ServerServices | null
): void {
  router.get('/memory/search', async (req, res) => {
    const parsed = parseAdminMemorySearchQuery(req.query as Record<string, unknown>);
    if ('error' in parsed) {
      return res.status(400).json({ error: parsed.error });
    }
    const engine = serverServices?.hybridSearchEngine;
    if (!db || !engine) {
      return res.status(503).json({ error: 'Search engine unavailable' });
    }
    try {
      const filters = {
        ...(parsed.type ? { type: [parsed.type] } : {}),
        ...(parsed.owner_id ? { owner_id: parsed.owner_id } : {}),
      };
      const result = await engine.search(db, { query: parsed.q, filters, limit: parsed.limit });
      const items = result.items.map((item) => ({
        id: item.id,
        type: item.type,
        content_preview: String(item.content ?? '').slice(0, PREVIEW_LENGTH),
        similarity: item.finalScore,
        created_at: item.created_at,
      }));
      return res.json({
        items,
        total_count: result.total_count,
        filters_applied: {
          q: parsed.q,
          limit: parsed.limit,
          ...(parsed.type ? { type: parsed.type } : {}),
          ...(parsed.owner_id ? { owner_id: parsed.owner_id } : {}),
        },
      });
    } catch (error) {
      logger.error('Admin memory search failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return res.status(500).json({
        error: 'Failed to search memories',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });
}
