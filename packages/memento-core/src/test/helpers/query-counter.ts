import Database from 'better-sqlite3';
import { DatabaseUtils } from '../../shared/utils/database.js';

export type QueryType = 'SELECT' | 'UPDATE' | 'INSERT' | 'DELETE';

export interface QueryCounter {
  getCount(): number;
  getCountByType(type: QueryType): number;
  getCountsByType(): Record<QueryType, number>;
  reset(): void;
  dispose(): void;
}

const EXCLUDED_PATTERNS = [
  /^\s*PRAGMA/i,
  /^\s*(BEGIN|COMMIT|ROLLBACK)/i,
  /^\s*CREATE/i,
  /^\s*DROP/i,
  /INSERT\s+INTO\s+memory_item_fts/i,
  /DELETE\s+FROM\s+memory_item_fts/i,
];

function extractQueryType(query: string): QueryType | null {
  const trimmed = query.trim().toUpperCase();
  if (trimmed.startsWith('SELECT')) return 'SELECT';
  if (trimmed.startsWith('UPDATE')) return 'UPDATE';
  if (trimmed.startsWith('INSERT')) return 'INSERT';
  if (trimmed.startsWith('DELETE')) return 'DELETE';
  return null;
}

function isExcluded(query: string): boolean {
  return EXCLUDED_PATTERNS.some(pattern => pattern.test(query));
}

export function createQueryCounter(db: Database.Database): QueryCounter {
  const counts: Record<QueryType, number> = { SELECT: 0, UPDATE: 0, INSERT: 0, DELETE: 0 };
  const originalRun = DatabaseUtils.run.bind(DatabaseUtils);
  const originalGet = DatabaseUtils.get.bind(DatabaseUtils);
  const originalAll = DatabaseUtils.all.bind(DatabaseUtils);

  const countQuery = (query: string): void => {
    if (isExcluded(query)) return;
    const queryType = extractQueryType(query);
    if (queryType) counts[queryType]++;
  };

  (DatabaseUtils as any).run = function (d: Database.Database, sql: string, params: any[] = [], maxRetries: number = 3) {
    countQuery(sql);
    return originalRun(d, sql, params, maxRetries);
  };
  (DatabaseUtils as any).get = function (d: Database.Database, sql: string, params: any[] = [], maxRetries: number = 3) {
    countQuery(sql);
    return originalGet(d, sql, params, maxRetries);
  };
  (DatabaseUtils as any).all = function (d: Database.Database, sql: string, params: any[] = [], maxRetries: number = 3) {
    countQuery(sql);
    return originalAll(d, sql, params, maxRetries);
  };

  return {
    getCount: () => Object.values(counts).reduce((a, b) => a + b, 0),
    getCountByType: (type) => counts[type] ?? 0,
    getCountsByType: () => ({ ...counts }),
    reset: () => { counts.SELECT = 0; counts.UPDATE = 0; counts.INSERT = 0; counts.DELETE = 0; },
    dispose: () => {
      (DatabaseUtils as any).run = originalRun;
      (DatabaseUtils as any).get = originalGet;
      (DatabaseUtils as any).all = originalAll;
    },
  };
}
