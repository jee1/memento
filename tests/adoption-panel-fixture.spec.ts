import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertStrictBenchmark, loadBenchmarkCorpus, loadBenchmarkGroundTruth,
  loadBenchmarkManifest, loadBenchmarkQueries,
} from '../packages/memento-core/src/domains/monitoring/services/quality-assurance/search-quality-benchmark-fixtures.js';
import { aggregateAdoptionPanel } from '../scripts/aggregate-adoption-panel.js';

const root = process.cwd();
const dir = join(root, 'tests/fixtures/search-quality/adoption-ko-panel-v1');
const raw = (name: string) => readFileSync(join(dir, name));
const read = (name: string) => JSON.parse(raw(name).toString());
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

describe('frozen adoption-ko agent_panel fixture', () => {
  it('pins input, submissions, corpus, gold, split, rubric and runner bytes', () => {
    const manifest = read('manifest.json');
    for (const [name, hash] of Object.entries(manifest.files)) {
      expect(sha(raw(name)), name).toBe(hash);
    }
    const result = read('result-manifest.json');
    expect(sha(raw('panel-result.json'))).toBe(result.gold.sha256);
    expect(sha(raw('ground-truth.json'))).toBe(result.gold.retrieval_sha256);
    expect(sha(raw('candidates.json'))).toBe(result.dataset_sha256);
    expect(sha(raw('corpus.jsonl'))).toBe(result.corpus_sha256);
    expect(sha(raw('queries.json'))).toBe(result.queries_sha256);
    expect(sha(raw('split.frozen.json'))).toBe(result.split_sha256);
    expect(sha(readFileSync(join(root, result.aggregation.runner_path)))).toBe(result.aggregation.runner_sha256);
    for (const who of ['reviewer-a', 'reviewer-b']) {
      const submission = read(`${who}/answers.json`);
      expect(sha(raw(`${who}/packet.json`))).toBe(submission.data_sha256);
      expect(sha(raw(`${who}/answers.json`))).toBe(read('contract-review.json').submission_sha256[who]);
    }
  });

  it('preserves the complete blinded inputs, timestamps and source text', () => {
    const candidates = read('candidates.json');
    const corpus = new Map(loadBenchmarkCorpus(dir).map(e => [e.benchmark_id, e]));
    const expected = new Map();
    for (const c of candidates.cases) {
      expect(c.split).toBe('test_candidate');
      expect(c.evidence).toHaveLength(2);
      const { case_id, query_at, scope, query, retirement_target_ref, evidence } = c;
      expected.set(case_id, { case_id, query_at, scope, query, retirement_target_ref, evidence });
      for (const e of c.evidence) {
        expect(sha(e.content)).toBe(e.sha256);
        expect(corpus.get(e.evidence_id)?.content).toBe(e.content);
        expect(Date.parse(e.recorded_at)).toBeLessThanOrEqual(Date.parse(c.query_at));
        if (e.event_at) expect(Date.parse(e.event_at)).toBeLessThanOrEqual(Date.parse(c.query_at));
      }
    }
    for (const who of ['reviewer-a', 'reviewer-b']) {
      const packet = read(`${who}/packet.json`);
      expect(packet.rubric_version).toBe(candidates.rubric_version);
      expect(packet.cases).toHaveLength(60);
      const ids = new Set();
      for (const c of packet.cases) {
        expect(c).toEqual(expected.get(c.case_id));
        ids.add(c.case_id);
      }
      expect(ids.size).toBe(60);
    }
    expect(sha(raw('reviewer-a/packet.json'))).not.toBe(sha(raw('reviewer-b/packet.json')));
  });

  it('keeps whole episode/family units separate from the pinned development fixtures', () => {
    const split = read('split.frozen.json');
    const cases = read('candidates.json').cases;
    for (const key of ['case_id', 'episode_id', 'family']) {
      const source = new Set();
      const frozen = new Set();
      for (const c of cases) source.add(c[key]);
      for (const c of split.test_cases) frozen.add(c[key]);
      expect(source.size).toBe(60);
      expect(frozen).toEqual(source);
    }
    for (const c of split.test_cases) expect(c.split).toBe('test');
    expect(split.test_cases.filter((c: { gold: boolean }) => c.gold)).toHaveLength(57);
    for (const file of split.development) {
      expect(sha(readFileSync(join(root, file.path)))).toBe(file.sha256);
    }
    const development = join(root, 'tests/fixtures/search-quality/benchmark-v3');
    const old = new Set(loadBenchmarkCorpus(development).map(e => e.content));
    const pairs = JSON.parse(readFileSync(join(root, 'tests/fixtures/jev-relation-quality/review-draft-2026-10-31.json'), 'utf8')).cases;
    expect(pairs).toHaveLength(48);
    expect(loadBenchmarkQueries(development).filter(q => q.category === 'knowledge_update')).toHaveLength(24);
    for (const pair of pairs) for (const side of ['source', 'target']) old.add(pair[side].content);
    for (const e of loadBenchmarkCorpus(dir)) expect(old.has(e.content)).toBe(false);
    // Byte overlap checks do not prove absence of semantic leakage or statistical independence.
  });

  it('reuses existing loaders without granting strict human-gold approval', () => {
    const manifest = loadBenchmarkManifest(dir);
    expect(() => assertStrictBenchmark(manifest)).toThrow(/strict benchmark/i);
    expect(manifest.labeling_policy).toBe('agent_panel');
    expect(manifest.ground_truth_reviewed).toBe(false);
    expect(loadBenchmarkCorpus(dir)).toHaveLength(120);
    expect(loadBenchmarkQueries(dir)).toHaveLength(60);
    const gold = loadBenchmarkGroundTruth(dir);
    expect(gold).toHaveLength(55);
    expect(gold).toEqual(read('panel-result.json').ground_truth);
    expect(gold.filter(g => g.staleIds?.length)).toHaveLength(30);
    const queries = new Set(loadBenchmarkQueries(dir).map(q => q.query_id));
    const evidence = new Set(loadBenchmarkCorpus(dir).map(e => e.benchmark_id));
    for (const g of gold) {
      expect(queries.has(g.queryId)).toBe(true);
      for (const id of [...g.relevantIds, ...(g.staleIds ?? [])]) expect(evidence.has(id)).toBe(true);
    }
  });

  it('reproduces frozen aggregation through both function and real offline CLI', () => {
    const result = aggregateAdoptionPanel(read('candidates.json'),
      [read('reviewer-a/answers.json'), read('reviewer-b/answers.json')], read('contract-review.json'));
    expect(result).toEqual(read('panel-result.json'));
    const output = execFileSync(process.execPath, ['--import', 'tsx', 'scripts/aggregate-adoption-panel.ts'], {
      cwd: root, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' },
    });
    expect(JSON.parse(output)).toEqual(result);
  });

  it('keeps four evaluation stages, system metrics and preregistration unmeasured', () => {
    const result = read('result-manifest.json');
    expect(result.status).toBe('not_run');
    expect(result.stages).toEqual({ retrieval: null, gate: null, final_answer: null, execution: null });
    expect(result.registered_at).toBeNull();
    expect(result.runner.commit_sha).toBeNull();
    expect(Object.values(result.systems).every(v => v === null)).toBe(true);
    for (const m of Object.values(result.unmeasured_metrics)) {
      expect(m).toEqual({ numerator: null, denominator: null, value: null, ci95: null, reason: 'system_not_run' });
    }
    expect(result.eligible_denominators).toEqual({
      input: 60, gate_positive: 30, gate_negative: 27, gate_ambiguous: 3,
      gate_judgable: 57, final_answer_contracts: 57, retrieval_contracts: 55, execution_evidence: 0,
    });
    expect(read('difficulty-audit.json').strata).toEqual({
      explicit_change: { retire: 30 }, compatible: { retain: 6 },
      implicit: { retain: 3, ambiguous: 3 }, partial_change: { retain: 6 },
      late_evidence: { retain: 6 }, same_name_different_condition: { retain: 6 },
    });
  });

  it('rejects changed input, submission or packet bytes through the CLI', () => {
    mkdirSync(join(root, '.local'), { recursive: true });
    const temporary = mkdtempSync(join(root, '.local/adoption-panel-'));
    try {
      const copied = join(temporary, 'tests/fixtures/search-quality/adoption-ko-panel-v1');
      cpSync(dir, copied, { recursive: true });
      for (const name of ['candidates.json', 'reviewer-a/answers.json', 'reviewer-a/packet.json']) {
        writeFileSync(join(copied, name), `${raw(name).toString()}\n`);
        expect(() => execFileSync(process.execPath, ['--import', 'tsx', join(root, 'scripts/aggregate-adoption-panel.ts')], {
          cwd: temporary, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, NODE_ENV: 'test' },
        })).toThrow(/SHA mismatch/);
        writeFileSync(join(copied, name), raw(name));
      }
    } finally {
      rmSync(temporary, { recursive: true, force: true });
    }
  });
});
