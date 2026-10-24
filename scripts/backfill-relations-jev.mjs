#!/usr/bin/env node
/* eslint-disable no-console, security/detect-non-literal-fs-filename -- CLI reports progress and appends to the --state file it was given. */
/**
 * Backfill relations for memories saved before the Jev seat existed.
 * Runs inside the server image (`scripts/backfill-relations-jev.sh`): the DB is owned by the container user.
 *
 * Each source is judged against the 100 newest memories of the same owner created before it,
 * the same pool remember used at save time. Preview by default; --apply writes.
 */

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import Database from 'better-sqlite3';
import { mementoConfig } from '../packages/memento-core/dist/shared/config/index.js';
import { extractForRemember } from '../packages/memento-core/dist/domains/relation/services/remember-relation-extraction.js';
import { createRelationGraph } from '../packages/memento-core/dist/infrastructure/relation-graph-factory.js';

const JEV_TYPES = ['CAUSES', 'DEPENDS_ON', 'FOLLOWS', 'CONTRASTS_WITH', 'REFERENCES', 'BELONGS_TO'];
const POOL_SIZE = 100;

const { values } = parseArgs({
  options: {
    apply: { type: 'boolean', default: false },
    limit: { type: 'string' },
    state: { type: 'string', default: '/app/data/backfill-relations-jev.done' },
  },
});
const apply = values.apply;
const limit = values.limit === undefined ? (apply ? Infinity : 5) : Number(values.limit);
if (!Number.isFinite(limit) && limit !== Infinity) throw new Error(`--limit must be a number: ${values.limit}`);

if (mementoConfig.relationExtractionOverride.kind !== 'jev') {
  throw new Error('LLM_PROVIDER_RELATION_EXTRACTION must be jev');
}

const done = new Set(existsSync(values.state) ? readFileSync(values.state, 'utf8').split('\n').filter(Boolean) : []);
const db = new Database(mementoConfig.dbPath, { readonly: !apply });
db.pragma('busy_timeout = 10000');

const typeList = JEV_TYPES.map(() => '?').join(', ');
const sources = db.prepare(`
  SELECT id FROM memory_item m
  WHERE COALESCE(is_deleted, 0) = 0
    AND NOT EXISTS (SELECT 1 FROM memory_relation r WHERE r.source_id = m.id AND r.relation_type IN (${typeList}))
  ORDER BY created_at DESC
`).all(...JEV_TYPES).map(r => r.id).filter(id => !done.has(id));

const selectItem = db.prepare(`
  SELECT id, type, content, importance, privacy_scope, created_at, last_accessed, pinned, tags, source, owner_id
  FROM memory_item WHERE id = ?
`);
const selectPool = db.prepare(`
  SELECT id, type, content, importance, privacy_scope, created_at, last_accessed, pinned, tags, source
  FROM memory_item
  WHERE id != ? AND COALESCE(is_deleted, 0) = 0
    AND COALESCE(owner_id, '') = COALESCE(?, '')
    AND created_at < ?
  ORDER BY created_at DESC
  LIMIT ${POOL_SIZE}
`);

function parseTags(raw) {
  try {
    return raw ? JSON.parse(raw) : undefined;
  } catch {
    return undefined;
  }
}

function toMemoryItem(row) {
  return {
    id: row.id,
    type: row.type,
    content: row.content,
    importance: row.importance,
    privacy_scope: row.privacy_scope,
    created_at: new Date(row.created_at),
    last_accessed: row.last_accessed ? new Date(row.last_accessed) : undefined,
    pinned: Boolean(row.pinned),
    tags: parseTags(row.tags),
    source: row.source || undefined,
  };
}

const relationGraph = apply ? createRelationGraph(db) : null;
const tally = { judged: 0, extracted: 0, relations: 0, none: 0, failed: 0, skipped: 0 };
const failures = new Map();
console.log(`[backfill-relations-jev] mode=${apply ? 'apply' : 'preview'} pending=${sources.length} limit=${limit}`);

for (const id of sources.slice(0, limit)) {
  const row = selectItem.get(id);
  const pool = row ? selectPool.all(id, row.owner_id, row.created_at).map(toMemoryItem) : [];
  if (!row || pool.length === 0) {
    tally.skipped++;
    if (apply) appendFileSync(values.state, `${id}\n`);
    continue;
  }

  const outcome = await extractForRemember(toMemoryItem(row), pool, {
    llmProvider: mementoConfig.llmProvider,
    relationExtractionOverride: mementoConfig.relationExtractionOverride,
    typesafeApiKey: mementoConfig.typesafeApiKey,
    typesafeModel: mementoConfig.typesafeModel,
  });
  tally.judged++;

  if (outcome.status === 'unavailable') throw new Error('TYPESAFE_API_KEY is not set');
  if (outcome.status === 'failed') {
    tally.failed++;
    failures.set(outcome.reason, (failures.get(outcome.reason) ?? 0) + 1);
    continue;
  }
  if (outcome.status === 'none') {
    tally.none++;
  } else {
    tally.extracted++;
    tally.relations += outcome.candidates.length;
    if (!apply) {
      console.log(id, outcome.candidates.map(c => `${c.relation_type}:${c.confidence}→${c.target_id}`).join(' '));
    } else {
      const extractedAt = new Date().toISOString();
      await relationGraph.addRelationsBatch(outcome.candidates.map(c => ({
        source_id: c.source_id,
        target_id: c.target_id,
        relation_type: c.relation_type,
        confidence: c.confidence,
        metadata: { method: c.method, evidence: c.evidence, extracted_at: extractedAt, backfill: true },
      })));
    }
  }
  if (apply) appendFileSync(values.state, `${id}\n`);
  if (tally.judged % 100 === 0) console.log(`[backfill-relations-jev] ${JSON.stringify(tally)}`);
}

console.log(`[backfill-relations-jev] done ${JSON.stringify(tally)} failures=${JSON.stringify(Object.fromEntries(failures))}`);
db.close();
