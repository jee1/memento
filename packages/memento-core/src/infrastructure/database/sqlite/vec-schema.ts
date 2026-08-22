/**
 * sqlite-vec 가상 테이블 스키마의 단일 원본 (issue #713)
 *
 * 검색 similarity 계약은 **cosine** 이다. vec0는 metric을 명시하지 않으면 L2를 쓰는데,
 * 결과 mapper는 `1 - distance`를 cosine similarity로 해석하고 slot threshold(0.8/0.6/0.4)도
 * cosine similarity를 가정하므로 모든 vec 테이블은 `distance_metric=cosine`으로 생성해야 한다.
 *
 * schema.sql(신규 DB) / init-legacy-schema / migrate / versioned migration 041이
 * 같은 정의를 쓰도록 여기에서만 DDL·트리거·필터를 정의한다.
 */

import type Database from 'better-sqlite3';
import { VECTOR_SEARCH_DISTANCE_METRIC } from '../../../shared/config/vector-search.config.js';

export const VEC_DISTANCE_METRIC = VECTOR_SEARCH_DISTANCE_METRIC;

export interface VecTableConfig {
  name: string;
  dimension: number;
  /**
   * memory_embedding 컬럼 단위 적재 조건.
   * 트리거(`NEW.` 접두)와 cardinality 비교가 같은 조건을 쓰도록 컬럼 단위로 보관한다.
   */
  predicates: readonly string[];
  /** predicates를 AND로 묶은 memory_embedding 필터 */
  filter: string;
}

function vecTable(name: string, dimension: number, predicates: readonly string[]): VecTableConfig {
  return { name, dimension, predicates, filter: predicates.join(' AND ') };
}

function nativeProviderPredicates(provider: string, dimension: number): string[] {
  return [
    `embedding_provider = '${provider}'`,
    `dimensions = ${dimension}`,
    "projection_type = 'native'"
  ];
}

/**
 * 대상 vec 테이블 전체.
 *
 * `memory_item_vec`는 legacy 384 공용 테이블이라 provider 전용이 아니며,
 * dimensions=384인 모든 행을 받는다(제공자별 1:1 비교 대상이 아님).
 */
export const VEC_TABLES: readonly VecTableConfig[] = [
  vecTable('memory_item_vec', 384, ['dimensions = 384']),
  vecTable('memory_item_vec_tfidf', 512, nativeProviderPredicates('tfidf', 512)),
  vecTable('memory_item_vec_minilm', 384, nativeProviderPredicates('minilm', 384)),
  vecTable('memory_item_vec_openai', 1536, nativeProviderPredicates('openai', 1536)),
  vecTable('memory_item_vec_gemini', 768, nativeProviderPredicates('gemini', 768)),
  vecTable('memory_item_vec_mock', 64, nativeProviderPredicates('mock', 64))
];

const ALLOWED_VEC_TABLE_NAMES: ReadonlySet<string> = new Set(VEC_TABLES.map(table => table.name));

function assertAllowedVecTable(name: string): void {
  if (!ALLOWED_VEC_TABLE_NAMES.has(name)) {
    throw new Error(`허용되지 않은 vec 테이블명입니다: ${name}`);
  }
}

export function buildVecTableDdl(config: VecTableConfig): string {
  assertAllowedVecTable(config.name);
  return (
    `CREATE VIRTUAL TABLE IF NOT EXISTS ${config.name} ` +
    `USING vec0(embedding float[${config.dimension}] distance_metric=${VEC_DISTANCE_METRIC})`
  );
}

/** VEC_DISTANCE_METRIC과 동기화된 리터럴 패턴 (vec-schema.spec.ts가 정합을 검증한다) */
const COSINE_METRIC_PATTERN = /distance_metric\s*=\s*cosine\b/i;

/**
 * sqlite_master의 DDL이 cosine metric으로 선언됐는지 검사한다.
 */
export function hasCosineDistanceMetric(sql: string | undefined | null): boolean {
  if (!sql) {
    return false;
  }
  return COSINE_METRIC_PATTERN.test(sql);
}

export interface VecTriggerSql {
  insert: string;
  update: string;
  delete: string;
}

function buildInsertStatements(tables: readonly VecTableConfig[]): string {
  return tables
    .map(table => {
      const triggerFilter = table.predicates.map(predicate => `NEW.${predicate}`).join(' AND ');
      return (
        `  INSERT INTO ${table.name}(rowid, embedding)\n` +
        `  SELECT NEW.id, json_extract(NEW.embedding, '$')\n` +
        `  WHERE ${triggerFilter};`
      );
    })
    .join('\n\n');
}

export function buildVecTriggerSql(tables: readonly VecTableConfig[]): VecTriggerSql {
  for (const table of tables) {
    assertAllowedVecTable(table.name);
  }

  const insertStatements = buildInsertStatements(tables);
  const deleteForNew = tables
    .map(table => `  DELETE FROM ${table.name} WHERE rowid = NEW.id;`)
    .join('\n');
  const deleteForOld = tables
    .map(table => `  DELETE FROM ${table.name} WHERE rowid = OLD.id;`)
    .join('\n');

  return {
    insert:
      'CREATE TRIGGER IF NOT EXISTS memory_embedding_vec_insert AFTER INSERT ON memory_embedding BEGIN\n' +
      `${insertStatements}\n` +
      'END',
    update:
      'CREATE TRIGGER IF NOT EXISTS memory_embedding_vec_update AFTER UPDATE ON memory_embedding BEGIN\n' +
      `${deleteForNew}\n\n` +
      `${insertStatements}\n` +
      'END',
    delete:
      'CREATE TRIGGER IF NOT EXISTS memory_embedding_vec_delete AFTER DELETE ON memory_embedding BEGIN\n' +
      `${deleteForOld}\n` +
      'END'
  };
}

export const VEC_TRIGGER_NAMES = [
  'memory_embedding_vec_insert',
  'memory_embedding_vec_update',
  'memory_embedding_vec_delete'
] as const;

function getTableSql(db: Database.Database, name: string): string | undefined {
  const row = db
    .prepare(`SELECT sql FROM sqlite_master WHERE type IN ('table','view') AND name = ?`)
    .get(name) as { sql?: string } | undefined;
  return row?.sql;
}

export function listExistingVecTables(db: Database.Database): VecTableConfig[] {
  return VEC_TABLES.filter(table => Boolean(getTableSql(db, table.name)));
}

/**
 * vec 테이블을 filter 조건에 맞는 memory_embedding 행으로 재적재한다.
 */
export function repopulateVecTable(db: Database.Database, config: VecTableConfig): void {
  assertAllowedVecTable(config.name);
  db.exec(
    `INSERT OR IGNORE INTO ${config.name}(rowid, embedding) ` +
      `SELECT id, json_extract(embedding, '$') FROM memory_embedding WHERE ${config.filter}`
  );
}

/**
 * metric이 cosine이 아닌 vec 테이블을 재생성하고 재적재한다.
 *
 * @returns 재생성된 테이블명 목록
 */
export function reconcileVecDistanceMetric(
  db: Database.Database,
  options: { repopulate?: boolean } = {}
): string[] {
  const { repopulate = true } = options;
  const hasEmbeddingTable = Boolean(getTableSql(db, 'memory_embedding'));
  const recreated: string[] = [];

  for (const table of VEC_TABLES) {
    const sql = getTableSql(db, table.name);
    if (!sql) {
      continue;
    }
    if (hasCosineDistanceMetric(sql) && sql.includes(`float[${table.dimension}]`)) {
      continue;
    }

    db.exec(`DROP TABLE IF EXISTS ${table.name}`);
    db.exec(buildVecTableDdl(table));
    if (repopulate && hasEmbeddingTable) {
      repopulateVecTable(db, table);
    }
    recreated.push(table.name);
  }

  return recreated;
}

export function recreateVecTriggers(db: Database.Database, tables: readonly VecTableConfig[]): void {
  for (const triggerName of VEC_TRIGGER_NAMES) {
    db.exec(`DROP TRIGGER IF EXISTS ${triggerName}`);
  }

  if (tables.length === 0) {
    return;
  }

  const triggers = buildVecTriggerSql(tables);
  db.exec(triggers.insert);
  db.exec(triggers.update);
  db.exec(triggers.delete);
}

export interface VecCardinalityRow {
  table: string;
  /** 트리거 필터(embedding_provider + dimensions + projection_type)에 해당하는 memory_embedding 행 수 */
  expected: number;
  /** vec 인덱스에 실제로 적재된 행 수 */
  actual: number;
  matched: boolean;
}

/**
 * memory_embedding(native 필터) ↔ vec 인덱스 cardinality 진단.
 *
 * raw provider 행 수와의 1:1 비교가 아니라 각 테이블의 트리거 조건을 그대로 사용한다.
 */
export function checkVecCardinality(db: Database.Database): VecCardinalityRow[] {
  if (!getTableSql(db, 'memory_embedding')) {
    return [];
  }

  return listExistingVecTables(db).map(table => {
    const expectedRow = db
      .prepare(`SELECT COUNT(*) AS count FROM memory_embedding WHERE ${table.filter}`)
      .get() as { count: number };
    const actualRow = db
      .prepare(`SELECT COUNT(*) AS count FROM ${table.name}`)
      .get() as { count: number };

    return {
      table: table.name,
      expected: expectedRow.count,
      actual: actualRow.count,
      matched: expectedRow.count === actualRow.count
    };
  });
}
