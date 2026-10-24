#!/usr/bin/env node
/** Compare fixed relation pairs, preserving whether labels were human-reviewed. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const TYPES = ['CAUSES', 'DEPENDS_ON', 'FOLLOWS', 'CONTRASTS_WITH', 'REFERENCES', 'BELONGS_TO'];
const MEMORY_TYPES = ['working', 'episodic', 'semantic', 'procedural'];
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const rate = (count, total) => total === 0 ? null : count / total;

function requireValid(condition) {
  if (!condition) throw new Error('Invalid Jev evaluation input');
}

function validateFixture(fixture) {
  const review = fixture?.review;
  const actor = review?.status === 'reviewed' ? review.reviewer : review?.accepted_by;
  const date = review?.status === 'reviewed' ? review.reviewed_at : review?.accepted_at;
  requireValid(fixture?.version === 1 && ['accepted', 'reviewed'].includes(review?.status)
    && nonempty(actor) && typeof date === 'string'
    && /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(date)
    && Number.isFinite(Date.parse(date))
    && Array.isArray(fixture.cases) && fixture.cases.length > 0);
  const ids = new Set();
  for (const item of fixture.cases) {
    requireValid(nonempty(item?.id) && !ids.has(item.id));
    ids.add(item.id);
    for (const memory of [item.source, item.target]) {
      requireValid(MEMORY_TYPES.includes(memory?.type) && nonempty(memory.content));
    }
    const expected = item.expected;
    requireValid(['related', 'unrelated', 'ambiguous'].includes(expected?.relevance)
      && nonempty(expected.reason) && Array.isArray(expected.types)
      && expected.types.every(type => TYPES.includes(type))
      && new Set(expected.types).size === expected.types.length
      && (expected.relevance === 'related' || expected.types.length === 0));
  }
  return ids;
}

function validateSnapshot(snapshot, hash, ids) {
  requireValid(snapshot?.fixture_sha256 === hash && nonempty(snapshot.revision)
    && Array.isArray(snapshot.results) && snapshot.results.length === ids.size);
  const seen = new Set();
  for (const result of snapshot.results) {
    requireValid(ids.has(result?.id) && !seen.has(result.id)
      && ['ok', 'error'].includes(result.status)
      && (result.relation_type === null || TYPES.includes(result.relation_type))
      && (result.status === 'ok' || result.relation_type === null));
    seen.add(result.id);
  }
}

function summarize(fixture, snapshot) {
  const results = new Map(snapshot.results.map(result => [result.id, result]));
  const evaluable = fixture.cases.filter(item => item.expected.relevance !== 'ambiguous');
  const rows = evaluable.map(item => ({ expected: item.expected, result: results.get(item.id) }));
  const accepted = rows.filter(row => row.result.status === 'ok' && row.result.relation_type !== null);
  const positives = rows.filter(row => row.expected.types.length > 0);
  const correct = row => row.result.status === 'ok' && row.expected.types.includes(row.result.relation_type);
  const unrelatedAccepted = accepted.filter(row => row.expected.relevance === 'unrelated').length;
  return {
    revision: snapshot.revision,
    code_sha256: snapshot.code_sha256,
    model: snapshot.model,
    created_at: snapshot.created_at,
    evaluable_count: rows.length,
    ambiguous_count: fixture.cases.length - rows.length,
    accepted_count: accepted.length,
    type_precision: rate(accepted.filter(correct).length, accepted.length),
    unrelated_connection_rate: rate(unrelatedAccepted, accepted.length),
    unrelated_false_positive_rate: rate(unrelatedAccepted, rows.filter(row => row.expected.relevance === 'unrelated').length),
    false_negative_rate: rate(positives.filter(row => !correct(row)).length, positives.length),
    rejection_rate: rate(rows.filter(row => row.result.status === 'ok' && row.result.relation_type === null).length, rows.length),
    error_rate: rate(rows.filter(row => row.result.status === 'error').length, rows.length),
    wrong_type_count: accepted.filter(row => row.expected.relevance === 'related' && !correct(row)).length,
    by_type: Object.fromEntries(TYPES.map(type => {
      const expected = positives.filter(row => row.expected.types.includes(type));
      const predicted = accepted.filter(row => row.result.relation_type === type);
      const matched = predicted.filter(correct).length;
      return [type, {
        expected: expected.length,
        predicted: predicted.length,
        correct: matched,
        precision: rate(matched, predicted.length),
        missed_rate: rate(expected.filter(row => !correct(row)).length, expected.length),
      }];
    })),
  };
}

export function evaluateComparison(fixtureBytes, baseline, candidate) {
  const hash = createHash('sha256').update(fixtureBytes).digest('hex');
  const fixture = JSON.parse(fixtureBytes.toString());
  const ids = validateFixture(fixture);
  validateSnapshot(baseline, hash, ids);
  validateSnapshot(candidate, hash, ids);
  return {
    fixture_sha256: hash,
    input_review_status: fixture.review.status,
    human_reviewed: fixture.review.status === 'reviewed',
    baseline: summarize(fixture, baseline), candidate: summarize(fixture, candidate),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: {
      fixture: { type: 'string' }, baseline: { type: 'string' }, candidate: { type: 'string' },
    } });
    requireValid(values.fixture && values.baseline && values.candidate);
    /* eslint-disable security/detect-non-literal-fs-filename -- Local CLI reads operator-selected files, not server input. */
    const report = evaluateComparison(
      readFileSync(values.fixture),
      JSON.parse(readFileSync(values.baseline, 'utf8')),
      JSON.parse(readFileSync(values.candidate, 'utf8')),
    );
    /* eslint-enable security/detect-non-literal-fs-filename */
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch {
    process.stderr.write('Jev evaluation failed: check accepted or reviewed fixture, snapshot coverage, types and fixture hashes.\n');
    process.exitCode = 1;
  }
}
