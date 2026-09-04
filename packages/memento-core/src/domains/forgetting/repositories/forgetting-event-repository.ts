/**
 * Forgetting event audit log repository (Issue #669).
 */

import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import { DatabaseUtils } from '../../../shared/utils/database.js';

export type ForgettingEventAction = 'soft' | 'hard' | 'review';

export interface ForgettingEventInsert {
  memory_id: string;
  action: ForgettingEventAction;
  reason: string;
  policy: string;
  forget_score?: number | null;
  ttl_days?: number | null;
  metadata_json?: string | null;
  created_at?: string;
}

export interface ForgettingEventRow {
  id: string;
  memory_id: string;
  action: ForgettingEventAction;
  reason: string;
  policy: string;
  forget_score: number | null;
  ttl_days: number | null;
  created_at: string;
  metadata_json: string | null;
}

export interface ListForgettingEventsOptions {
  memory_id?: string;
  action?: ForgettingEventAction;
  limit?: number;
  offset?: number;
}

export const DEFAULT_FORGETTING_POLICY_NAME = 'forgetting-policy-default';

export class ForgettingEventRepository {
  insert(db: Database.Database, input: ForgettingEventInsert): ForgettingEventRow {
    const id = `mfe_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const createdAt = input.created_at ?? new Date().toISOString();
    DatabaseUtils.run(
      db,
      `INSERT INTO memory_forgetting_event (
        id, memory_id, action, reason, policy, forget_score, ttl_days, created_at, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.memory_id,
        input.action,
        input.reason,
        input.policy,
        input.forget_score ?? null,
        input.ttl_days ?? null,
        createdAt,
        input.metadata_json ?? null,
      ],
    );
    return this.getById(db, id)!;
  }

  getById(db: Database.Database, id: string): ForgettingEventRow | null {
    const row = DatabaseUtils.get(
      db,
      `SELECT id, memory_id, action, reason, policy, forget_score, ttl_days, created_at, metadata_json
         FROM memory_forgetting_event
        WHERE id = ?`,
      [id],
    ) as ForgettingEventRow | undefined;
    return row ?? null;
  }

  list(db: Database.Database, options: ListForgettingEventsOptions = {}): ForgettingEventRow[] {
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
    const offset = Math.max(options.offset ?? 0, 0);
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (options.memory_id) {
      clauses.push('memory_id = ?');
      params.push(options.memory_id);
    }
    if (options.action) {
      clauses.push('action = ?');
      params.push(options.action);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    params.push(limit, offset);

    return DatabaseUtils.all(
      db,
      `SELECT id, memory_id, action, reason, policy, forget_score, ttl_days, created_at, metadata_json
         FROM memory_forgetting_event
         ${where}
         ORDER BY created_at DESC, id DESC
         LIMIT ? OFFSET ?`,
      params,
    ) as ForgettingEventRow[];
  }

  countByMemoryId(db: Database.Database, memoryId: string): number {
    const row = DatabaseUtils.get(
      db,
      `SELECT COUNT(*) AS c FROM memory_forgetting_event WHERE memory_id = ?`,
      [memoryId],
    ) as { c: number };
    return Number(row.c);
  }

  /** Issue #810: ISO cutoff + strict `<` — never shell `date -Iseconds` strings. */
  deleteExpiredEvents(db: Database.Database, retentionDays: number): number {
    const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
    const result = DatabaseUtils.run(
      db,
      `DELETE FROM memory_forgetting_event WHERE created_at < ?`,
      [cutoff],
    );
    return result.changes;
  }
}

export function listForgettingEvents(
  db: Database.Database,
  options: ListForgettingEventsOptions = {},
): ForgettingEventRow[] {
  return new ForgettingEventRepository().list(db, options);
}
