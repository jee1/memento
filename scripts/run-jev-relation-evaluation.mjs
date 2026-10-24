#!/usr/bin/env node
/** Run fixed pairs through the shared judge without opening a database. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { evaluateComparison } from './evaluate-jev-relations.mjs';

function validatedFixture(bytes) {
  const fixture = JSON.parse(bytes.toString());
  const fixture_sha256 = createHash('sha256').update(bytes).digest('hex');
  const empty = {
    fixture_sha256, revision: 'input-validation',
    results: fixture.cases?.map(item => ({ id: item.id, status: 'ok', relation_type: null })),
  };
  evaluateComparison(bytes, empty, empty);
  return { fixture, fixture_sha256 };
}

function memory(id, item) {
  return {
    id, type: item.type, content: item.content,
    importance: 0.5, privacy_scope: 'private', pinned: false,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
  };
}

export async function runEvaluation(bytes, { judgePair, revision, code_sha256, model, created_at }) {
  const { fixture, fixture_sha256 } = validatedFixture(bytes);
  const results = [];
  for (const item of fixture.cases) {
    const source = memory(`${item.id}_source`, item.source);
    const target = memory(`${item.id}_target`, item.target);
    const { outcome, rounds } = await judgePair(source, target);
    const candidate = outcome.ok ? outcome.candidates[0] : undefined;
    if (candidate && (outcome.candidates.length !== 1
      || candidate.source_id !== source.id || candidate.target_id !== target.id)) {
      throw new Error('Unexpected judge output');
    }
    results.push({
      id: item.id, status: outcome.ok ? 'ok' : 'error',
      relation_type: candidate?.relation_type ?? null,
      ...(candidate ? { confidence: candidate.confidence } : {}),
      ...(!outcome.ok ? { reason: outcome.reason } : {}),
      rounds,
    });
  }
  const snapshot = {
    fixture_sha256, input_review_status: fixture.review.status,
    human_reviewed: fixture.review.status === 'reviewed',
    revision, code_sha256, model, created_at, results,
  };
  evaluateComparison(bytes, snapshot, snapshot);
  return snapshot;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { fixture: { type: 'string' } } });
    if (!values.fixture) throw new Error('Missing fixture');
    // Local CLI deliberately reads the operator-selected fixture.
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const bytes = readFileSync(values.fixture);
    validatedFixture(bytes);
    const [{ SystemOneClient }, { JevRelationJudge, RELATION_JEV_TIMEOUT_MS }, { mementoConfig }] = await Promise.all([
      import('../packages/memento-core/dist/shared/services/typesafe/system-one-client.js'),
      import('../packages/memento-core/dist/domains/relation/services/jev-relation-judge.js'),
      import('../packages/memento-core/dist/shared/config/index.js'),
    ]);
    if (!mementoConfig.typesafeApiKey?.trim()) throw new Error('Missing key');
    const client = new SystemOneClient({
      apiKey: mementoConfig.typesafeApiKey.trim(), model: mementoConfig.typesafeModel,
      timeoutMs: RELATION_JEV_TIMEOUT_MS,
    });
    let rounds = [];
    const recordingClient = { ask: async (...args) => {
      const result = await client.ask(...args);
      rounds.push({
        questions: args[1], ok: result.ok,
        ...(result.ok ? { scores: [...result.noulById] } : { reason: result.reason }),
      });
      return result;
    } };
    const unexpectedEmbedding = () => { throw new Error('Single pair must not embed'); };
    const judge = new JevRelationJudge(recordingClient, {
      generateEmbedding: unexpectedEmbedding, searchSimilar: unexpectedEmbedding,
    });
    const snapshot = await runEvaluation(bytes, {
      judgePair: async (source, target) => {
        rounds = [];
        const outcome = await judge.judge(source, [target]);
        return { outcome, rounds };
      },
      revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- Fixed built judge URL relative to this script.
      code_sha256: createHash('sha256').update(readFileSync(new URL(
        '../packages/memento-core/dist/domains/relation/services/jev-relation-judge.js', import.meta.url,
      ))).digest('hex'),
      model: mementoConfig.typesafeModel || 'jev-latest',
      created_at: new Date().toISOString(),
    });
    process.stdout.write(`${JSON.stringify(snapshot, null, 2)}\n`);
  } catch {
    process.stderr.write('Jev evaluation run failed: check accepted or reviewed fixture, built core and API configuration.\n');
    process.exitCode = 1;
  }
}
