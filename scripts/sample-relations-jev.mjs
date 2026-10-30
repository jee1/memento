#!/usr/bin/env node
/** Read-only Jev backfill audit. JSON contains private memory text; keep it local. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import Database from 'better-sqlite3';

const TYPES = ['CAUSES', 'DEPENDS_ON', 'FOLLOWS', 'CONTRASTS_WITH', 'REFERENCES', 'BELONGS_TO'];
const BANDS = ['0.5-0.6', '0.6-0.8', '0.8-1.0'];
const VERDICTS = ['correct', 'wrong_type', 'unrelated'];

const { values } = parseArgs({ options: {
  db: { type: 'string' },
  size: { type: 'string', default: '30' },
  seed: { type: 'string', default: '1466' },
  report: { type: 'string' },
} });

function band(confidence) {
  if (!Number.isFinite(confidence) || confidence < 0.5 || confidence > 1) {
    throw new Error('confidence must be within [0.5, 1]');
  }
  return confidence < 0.6 ? BANDS[0] : confidence < 0.8 ? BANDS[1] : BANDS[2];
}

function summarize(samples) {
  const correct = samples.filter(s => s.verdict === 'correct').length;
  return {
    sampled: samples.length,
    correct,
    wrong_type: samples.filter(s => s.verdict === 'wrong_type').length,
    unrelated: samples.filter(s => s.verdict === 'unrelated').length,
    precision: samples.length ? correct / samples.length : null,
    related_precision: samples.length ? samples.filter(s => s.verdict !== 'unrelated').length / samples.length : null,
  };
}

function report() {
  const audit = JSON.parse(readFileSync(values.report, 'utf8'));
  const ids = new Set();
  if (!Array.isArray(audit.samples) || audit.samples.length === 0) throw new Error('samples must not be empty');
  if (!Number.isSafeInteger(audit.size_per_type) || audit.size_per_type < 1) throw new Error('invalid sample size');
  for (const type of TYPES) {
    const counts = BANDS.map(b => audit.population?.[type]?.[b]);
    if (counts.some(n => !Number.isSafeInteger(n) || n < 0)
      || audit.samples.filter(s => s.relation_type === type).length !== Math.min(audit.size_per_type, counts.reduce((a, b) => a + b, 0))) {
      throw new Error('sample coverage does not match population and size');
    }
  }
  for (const s of audit.samples) {
    if (!Number.isSafeInteger(s.id) || ids.has(s.id) || !TYPES.includes(s.relation_type)
      || !VERDICTS.includes(s.verdict) || typeof s.reason !== 'string' || !s.reason.trim()) {
      throw new Error('Each unique relation needs a valid type, verdict and reason');
    }
    band(s.confidence);
    ids.add(s.id);
  }
  return {
    sampled_at: audit.sampled_at,
    seed: audit.seed,
    note: 'Precision describes this type-stratified sample, not the population; pooled confidence bands are not population-weighted.',
    by_type: Object.fromEntries(TYPES.map(type => [type, summarize(audit.samples.filter(s => s.relation_type === type))])),
    by_confidence: Object.fromEntries(BANDS.map(b => [b, summarize(audit.samples.filter(s => band(s.confidence) === b))])),
    by_type_and_confidence: Object.fromEntries(TYPES.map(type => [type, Object.fromEntries(BANDS.map(b => [b,
      summarize(audit.samples.filter(s => s.relation_type === type && band(s.confidence) === b)),
    ]))])),
  };
}

function sample() {
  if (!/^\d+$/.test(values.size) || !Number.isSafeInteger(Number(values.size)) || Number(values.size) < 1) {
    throw new Error('--size must be a positive integer');
  }
  const path = values.db ?? process.env.DB_PATH;
  if (!path) throw new Error('--db or DB_PATH is required');
  const db = new Database(path, { readonly: true, fileMustExist: true });
  try {
    return db.transaction(() => {
      const rows = db.prepare(`
        SELECT r.id, r.relation_type, r.confidence
        FROM memory_relation r
        JOIN memory_item s ON s.id = r.source_id
        JOIN memory_item t ON t.id = r.target_id
        WHERE json_valid(r.metadata)
          AND json_extract(CASE WHEN json_valid(r.metadata) THEN r.metadata ELSE '{}' END, '$.backfill') = 1
          AND COALESCE(s.is_deleted, 0) = 0 AND COALESCE(t.is_deleted, 0) = 0
          AND r.relation_type IN (${TYPES.map(() => '?').join(',')})
      `).all(...TYPES);
      const pair = db.prepare(`
        SELECT r.source_id, r.target_id,
          s.content AS source_content, t.content AS target_content,
          s.created_at AS source_created_at, t.created_at AS target_created_at
        FROM memory_relation r
        JOIN memory_item s ON s.id = r.source_id JOIN memory_item t ON t.id = r.target_id
        WHERE r.id = ?
      `);
      const population = {};
      const samples = [];
      for (const type of TYPES) {
        const candidates = rows.filter(r => r.relation_type === type);
        population[type] = Object.fromEntries(BANDS.map(b => [b, candidates.filter(r => band(r.confidence) === b).length]));
        // Hash ordering makes the sample reproducible without relying on SQLite random().
        const ordered = candidates.map(r => ({ row: r, hash: createHash('sha256').update(`${values.seed}:${r.id}`).digest('hex') }))
          .sort((a, b) => a.hash.localeCompare(b.hash) || a.row.id - b.row.id);
        for (const { row } of ordered.slice(0, Number(values.size))) {
          samples.push({ ...row, ...pair.get(row.id), verdict: null, reason: '' });
        }
      }
      return { sampled_at: new Date().toISOString(), seed: values.seed, size_per_type: Number(values.size), population, samples };
    })();
  } finally {
    db.close();
  }
}

try {
  process.stdout.write(`${JSON.stringify(values.report ? report() : sample(), null, 2)}\n`);
} catch {
  process.stderr.write('Jev audit failed: check DB/schema, arguments, or verdicts (correct/wrong_type/unrelated with reason).\n');
  process.exitCode = 1;
}
