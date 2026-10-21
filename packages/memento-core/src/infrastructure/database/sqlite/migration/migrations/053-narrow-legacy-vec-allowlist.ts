import type Database from 'better-sqlite3';
import { logger } from '../../../../../shared/utils/logger.js';
import {
  type VecTableConfig,
  checkVecCardinality,
  evictNonMembers,
  listExistingVecTables,
  recreateVecTriggers,
  repopulateVecTable,
} from '../../vec-schema.js';
import type { Migration } from '../types.js';

/** #1377 이전 저장소 술어. 라이브에 남은 `dimensions = 384` 단독 트리거가 아니다. */
const LEGACY_CATCHALL_PREDICATES = [
  'dimensions = 384',
  "projection_type NOT LIKE 'window:%'",
] as const;

const LEGACY_CATCHALL_FILTER = LEGACY_CATCHALL_PREDICATES.join(' AND ');

const LEGACY_ALLOWLIST_SQL = "embedding_provider IN ('tfidf', 'lightweight')";
const LEGACY_CATCHALL_TRIGGER_SQL =
  "NEW.dimensions = 384 AND NEW.projection_type NOT LIKE 'window:%'";

function isQueryable(db: Database.Database, table: string): boolean {
  try {
    db.prepare(`SELECT rowid FROM ${table} LIMIT 1`).get();
    return true;
  } catch {
    return false;
  }
}

function tableExists(db: Database.Database, name: string): boolean {
  return Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
  );
}

const LEGACY_MEMBER_FILTER =
  "embedding_provider IN ('tfidf', 'lightweight') AND dimensions = 384 AND projection_type = 'native'";

const LEGACY_MEMBER_TABLE: VecTableConfig = {
  name: 'memory_item_vec',
  dimension: 384,
  predicates: [
    "embedding_provider IN ('tfidf', 'lightweight')",
    'dimensions = 384',
    "projection_type = 'native'",
  ],
  filter: LEGACY_MEMBER_FILTER,
};

function withLegacyCatchall(tables: readonly VecTableConfig[]): VecTableConfig[] {
  return tables.map(table => {
    if (table.name !== 'memory_item_vec') {
      return table;
    }
    return {
      ...table,
      predicates: LEGACY_CATCHALL_PREDICATES,
      filter: LEGACY_CATCHALL_FILTER,
    };
  });
}

function logLegacyMembership(db: Database.Database): void {
  const rows = db
    .prepare(
      `SELECT embedding_provider AS provider, projection_type AS projection, COUNT(*) AS count
       FROM memory_embedding
       WHERE id IN (SELECT rowid FROM memory_item_vec)
       GROUP BY 1, 2`
    )
    .all();
  logger.info('narrow-legacy-vec-allowlist: legacy membership', { histogram: rows });
}

export class NarrowLegacyVecAllowlistMigration implements Migration {
  version = '53.0';
  name = 'narrow-legacy-vec-allowlist';
  description =
    'Keep memory_item_vec for tfidf/lightweight 384 native rows and evict every other rowid (#1377)';

  async validateBefore(db: Database.Database): Promise<void> {
    if (!tableExists(db, 'memory_embedding')) {
      throw new Error('Migration 053 requires the memory_embedding table');
    }
  }

  async up(db: Database.Database): Promise<void> {
    if (!isQueryable(db, 'memory_item_vec')) {
      return;
    }

    logLegacyMembership(db);

    const existing = listExistingVecTables(db).filter(table => table.name !== 'memory_item_vec');
    recreateVecTriggers(db, [...existing, LEGACY_MEMBER_TABLE]);

    const deleted = evictNonMembers(db, LEGACY_MEMBER_TABLE);
    logger.info('narrow-legacy-vec-allowlist: evicted non-members', { deleted });

    const minilm = existing.find(table => table.name === 'memory_item_vec_minilm');
    if (minilm) {
      repopulateVecTable(db, minilm);
    }
  }

  async down(db: Database.Database): Promise<void> {
    if (!isQueryable(db, 'memory_item_vec')) {
      return;
    }

    const existing = withLegacyCatchall([
      ...listExistingVecTables(db).filter(table => table.name !== 'memory_item_vec'),
      LEGACY_MEMBER_TABLE,
    ]);
    recreateVecTriggers(db, existing);
    // vec0 는 기존 rowid 에 INSERT OR IGNORE 를 주면 UNIQUE 로 실패한다.
    db.exec(
      `INSERT INTO memory_item_vec(rowid, embedding) ` +
        `SELECT id, embedding FROM memory_embedding WHERE ${LEGACY_CATCHALL_FILTER} ` +
        `AND id NOT IN (SELECT rowid FROM memory_item_vec)`
    );

    if (tableExists(db, 'memento_schema_version')) {
      db.prepare('DELETE FROM memento_schema_version WHERE version = ?').run(this.version);
    }
  }

  async validateAfter(db: Database.Database): Promise<void> {
    if (!isQueryable(db, 'memory_item_vec')) {
      return;
    }

    const report = checkVecCardinality(db);
    const minilm = report.find(item => item.table === 'memory_item_vec_minilm');
    if (minilm && !minilm.matched) {
      throw new Error(
        `memory_item_vec_minilm cardinality mismatch: expected ${minilm.expected}, actual ${minilm.actual}`
      );
    }

    const stray = db
      .prepare(
        `SELECT COUNT(*) AS count FROM memory_item_vec
         WHERE rowid NOT IN (SELECT id FROM memory_embedding WHERE ${LEGACY_MEMBER_FILTER})`
      )
      .get() as { count: number };
    if (stray.count !== 0) {
      throw new Error(`Migration 053 left ${stray.count} non-member rowids in memory_item_vec`);
    }

    const minilmInLegacy = db
      .prepare(
        `SELECT COUNT(*) AS count FROM memory_item_vec
         WHERE rowid IN (SELECT id FROM memory_embedding WHERE embedding_provider = 'minilm')`
      )
      .get() as { count: number };
    if (minilmInLegacy.count !== 0) {
      throw new Error(`Migration 053 left ${minilmInLegacy.count} minilm rowids in memory_item_vec`);
    }

    const insertTrigger = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'memory_embedding_vec_insert'"
      )
      .get() as { sql?: string } | undefined;
    const sql = insertTrigger?.sql ?? '';
    if (!sql.includes(LEGACY_ALLOWLIST_SQL)) {
      throw new Error('Migration 053 did not install the legacy provider allowlist');
    }
    if (sql.includes(LEGACY_CATCHALL_TRIGGER_SQL)) {
      throw new Error('Migration 053 left the legacy dimension catch-all trigger');
    }
  }
}

export default NarrowLegacyVecAllowlistMigration;
