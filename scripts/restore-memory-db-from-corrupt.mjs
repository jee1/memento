#!/usr/bin/env node
import { parseArgs as parseCliArgs, openDb } from './lib/cli.ts';
/**
 * Copy readable rows from a corrupt-but-queryable memory.db into a clean schema shell.
 * Usage (host):
 *   docker run --rm -v "$HOME/.memento/data:/data" memento-memento-mcp-server:latest \
 *     node /app/scripts/restore-memory-db-from-corrupt.mjs \
 *     --source /data/memory.db.pre-recover-20260615T120932Z.db \
 *     --target /data/memory-restored-final.db
 */
import fs from 'fs';
import path from 'path';
import { normalizeReflectionNotes } from '../packages/memento-core/dist/shared/utils/reflection-notes-normalize.js';

function parseArgs(argv) {
  const out = { source: '', target: '', onlyTables: null };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--source') out.source = argv[++i] ?? '';
    if (argv[i] === '--target') out.target = argv[++i] ?? '';
    if (argv[i] === '--only-tables') {
      const raw = argv[++i] ?? '';
      out.onlyTables = raw.split(',').map((name) => name.trim()).filter(Boolean);
    }
  }
  if (!out.source || !out.target) {
    throw new Error('Usage: --source <corrupt.db> --target <output.db> [--only-tables table1,table2]');
  }
  return out;
}

function tableNames(db) {
  return db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )
    .all()
    .map((row) => row.name);
}

function columnInfo(db, table, schema = 'main') {
  if (schema === 'main') {
    return db.prepare(`PRAGMA table_info("${table}")`).all();
  }
  return db.prepare('SELECT * FROM pragma_table_info(?, ?)').all(table, schema);
}

function columns(db, table, schema = 'main') {
  return columnInfo(db, table, schema).map((row) => row.name);
}

function selectExpr(targetCol, targetInfo) {
  const meta = targetInfo.find((row) => row.name === targetCol);
  const ref = `"${targetCol}"`;
  if (!meta || !meta.notnull) {
    return ref;
  }
  if (meta.dflt_value != null && meta.dflt_value !== '') {
    return `COALESCE(${ref}, ${meta.dflt_value})`;
  }
  if (meta.type.toUpperCase().includes('BOOL')) {
    return `COALESCE(${ref}, 0)`;
  }
  if (meta.type.toUpperCase().includes('INT')) {
    return `COALESCE(${ref}, 0)`;
  }
  if (meta.type.toUpperCase().includes('REAL')) {
    return `COALESCE(${ref}, 0.0)`;
  }
  return `COALESCE(${ref}, '')`;
}

function shouldSkipTable(name) {
  return (
    name.startsWith('memory_item_vec') ||
    name.startsWith('memory_item_fts') ||
    name === 'sqlite_sequence'
  );
}

const { source, target, onlyTables } = parseArgs(parseCliArgs().args);
if (!fs.existsSync(source)) {
  throw new Error(`Source not found: ${source}`);
}
if (onlyTables && !fs.existsSync(target)) {
  throw new Error(`Merge target not found: ${target}`);
}

const onlyTableSet = onlyTables ? new Set(onlyTables) : null;

for (const suffix of ['-wal', '-shm']) {
  const sidecar = target + suffix;
  if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
}

const tgt = openDb(target);
tgt.function('normalize_reflection_notes', { deterministic: true }, (value) =>
  normalizeReflectionNotes(value)
);
tgt.pragma('foreign_keys = OFF');
tgt.exec(`ATTACH '${source.replace(/'/g, "''")}' AS src`);

const srcTables = new Set(
  tgt
    .prepare("SELECT name FROM src.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((row) => row.name)
);

function dropVecTriggers(db, table) {
  if (table !== 'memory_embedding') return;
  for (const name of [
    'memory_embedding_vec_insert',
    'memory_embedding_vec_update',
    'memory_embedding_vec_delete',
  ]) {
    db.exec(`DROP TRIGGER IF EXISTS ${name}`);
  }
}

const results = [];
const tablesToCopy = tableNames(tgt).filter((table) => {
  if (shouldSkipTable(table) || !srcTables.has(table)) return false;
  if (onlyTableSet) return onlyTableSet.has(table);
  return true;
});

for (const table of tablesToCopy) {
  const common = columns(tgt, table).filter((col) => columns(tgt, table, 'src').includes(col));
  if (common.length === 0) continue;
  const targetInfo = columnInfo(tgt, table);
  const colList = common.map((col) => `"${col}"`).join(', ');
  const selectList = common.map((col) => selectExpr(col, targetInfo)).join(', ');
  try {
    dropVecTriggers(tgt, table);
    tgt.exec(`DELETE FROM "${table}"`);
    const info = tgt
      .prepare(`INSERT INTO "${table}" (${colList}) SELECT ${selectList} FROM src."${table}"`)
      .run();
    results.push({ table, status: 'ok', rows: info.changes });
  } catch (error) {
    results.push({
      table,
      status: 'error',
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

tgt.exec('DETACH src');

// Rebuild FTS shadow index from memory_item rows.
if (!onlyTableSet || onlyTableSet.has('memory_item')) {
try {
  tgt.exec('DELETE FROM memory_item_fts');
  tgt.exec(`
    INSERT INTO memory_item_fts(rowid, content, tags, source, reflection_notes)
    SELECT rowid, content, tags, source, normalize_reflection_notes(reflection_notes)
    FROM memory_item
  `);
  results.push({ table: 'memory_item_fts(rebuild)', status: 'ok' });
} catch (error) {
  results.push({
    table: 'memory_item_fts(rebuild)',
    status: 'error',
    error: error instanceof Error ? error.message : String(error),
  });
}
}

const summary = {
  memory_item: tgt.prepare('SELECT count(*) AS c FROM memory_item').get().c,
  memory_review_candidate: tgt.prepare('SELECT count(*) AS c FROM memory_review_candidate').get().c,
  memory_embedding: tgt.prepare('SELECT count(*) AS c FROM memory_embedding').get().c,
  quick_check: tgt.pragma('quick_check', { simple: true }),
};

console.log(JSON.stringify({ source, target, results, summary }, null, 2));
tgt.close();
