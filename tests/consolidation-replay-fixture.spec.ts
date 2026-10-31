import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { aggregateReplayPanel } from '../scripts/aggregate-consolidation-replay-panel.js';

const dir = join(process.cwd(), 'tests/fixtures/search-quality/consolidation-replay-v1');
const read = (name: string) => JSON.parse(readFileSync(join(dir, name), 'utf8'));
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const stamp = z.string().datetime();
const scopeSchema = z.object({ owner_id: z.string(), project_id: z.string(), subject_id: z.string() }).strict();
const observationSchema = z.object({
  memory_id: z.string(), type: z.literal('episodic'), subject_id: z.string(), content: z.string().min(1),
  recorded_at: stamp, event_at: stamp, content_sha256: z.string().length(64),
}).strict();
const checkpointSchema = z.object({
  checkpoint_id: z.string(), after_observation: z.number().int(), query_at: stamp,
  query: z.string().min(1), scope: scopeSchema,
}).strict();
const sequenceSchema = z.object({
  sequence_id: z.string(), family_id: z.string(), owner_id: z.string(), project_id: z.string(),
  observations: z.array(observationSchema).length(6), checkpoints: z.array(checkpointSchema).length(3),
}).strict();
const fixture = z.object({
  fixture_version: z.literal('consolidation-replay-v1'), source: z.literal('synthetic-only'),
  sequences: z.array(sequenceSchema).length(30),
}).strict().parse(read('sequences.json'));
const byId = new Map(fixture.sequences.map(s => [s.sequence_id, s]));
const evidenceSchema = z.object({
  evidence_id: z.string(), type: z.literal('episodic'), content: z.string().min(1),
  recorded_at: stamp, event_at: stamp, scope: scopeSchema, sha256: z.string().length(64),
}).strict();
const packetSchema = z.object({
  rubric_version: z.literal('consolidation-replay-v1'), stage: z.number().int().min(1).max(3),
  cases: z.array(checkpointSchema.extend({
    sequence_id: z.string(), family_id: z.string(), evidence: z.array(evidenceSchema),
  }).strict()).length(30),
}).strict();

function validatePacket(input: unknown, stage: number) {
  const packet = packetSchema.parse(input);
  expect(packet.stage).toBe(stage);
  expect(new Set(packet.cases.map(c => c.sequence_id)).size).toBe(30);
  for (const c of packet.cases) {
    const source = byId.get(c.sequence_id);
    expect(source).toBeDefined();
    expect(c).toEqual({
      sequence_id: source!.sequence_id, family_id: source!.family_id,
      ...source!.checkpoints[stage - 1],
      evidence: source!.observations.slice(0, stage * 2).map(o => ({
        evidence_id: o.memory_id, type: o.type, content: o.content,
        recorded_at: o.recorded_at, event_at: o.event_at,
        scope: { owner_id: source!.owner_id, project_id: source!.project_id, subject_id: o.subject_id },
        sha256: o.content_sha256,
      })),
    });
  }
  return packet;
}

describe('consolidation replay panel preparation', () => {
  it('pins all files and preserves the adoption control bytes', () => {
    const manifest = read('manifest.json');
    expect(manifest).toMatchObject({
      status: 'gold_frozen_inconclusive', sequence_count: 30, observation_count: 180,
      checkpoint_count: 90, dev_sequences: 5, test_candidate_sequences: 25, gold_count: 58, actual_calls: 0,
    });
    for (const [name, hash] of Object.entries(manifest.files)) {
      expect(sha(readFileSync(join(dir, name))), name).toBe(hash);
    }
    const files = readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter(e => e.isFile()).map(e => join(e.parentPath, e.name).slice(dir.length + 1))
      .filter(name => name !== 'manifest.json').sort();
    expect(Object.keys(manifest.files).sort()).toEqual(files);
    const control = join(dir, '../adoption-ko-panel-v1');
    expect(sha(readFileSync(join(control, 'manifest.json')))).toBe(manifest.preserved_control.manifest_sha256);
    expect(sha(readFileSync(join(control, 'corpus.jsonl')))).toBe(manifest.preserved_control.corpus_sha256);
    const registration = read('design-registration.json');
    expect(sha(readFileSync(join(dir, 'protocol.md')))).toBe(registration.protocol_sha256);
    expect(Date.parse(registration.registered_at)).toBeLessThanOrEqual(Date.parse(manifest.input_generated_at));
  });

  it('preserves independent owner/family sequences and chronological episodic prefixes', () => {
    for (const field of ['sequence_id', 'family_id', 'owner_id', 'project_id'] as const) {
      expect(new Set(fixture.sequences.map(s => s[field])).size).toBe(30);
    }
    const ids = new Set<string>();
    const content = new Set<string>();
    const oldRows = readFileSync(join(dir, '../adoption-ko-panel-v1/corpus.jsonl'), 'utf8')
      .trim().split('\n').map(line => JSON.parse(line));
    const oldContent = new Set(oldRows.map(r => r.content));
    for (const s of fixture.sequences) {
      let previous = -Infinity;
      for (const o of s.observations) {
        expect(ids.has(o.memory_id)).toBe(false);
        expect(content.has(o.content)).toBe(false);
        expect(oldContent.has(o.content)).toBe(false);
        ids.add(o.memory_id);
        content.add(o.content);
        expect(sha(o.content)).toBe(o.content_sha256);
        expect(Date.parse(o.recorded_at)).toBeGreaterThan(previous);
        expect(o.event_at).toBe(o.recorded_at);
        previous = Date.parse(o.recorded_at);
      }
      for (const [i, c] of s.checkpoints.entries()) {
        expect(c.after_observation).toBe(2 * (i + 1));
        expect(c.scope.owner_id).toBe(s.owner_id);
        expect(c.scope.project_id).toBe(s.project_id);
        expect(c.scope.subject_id).toBe(s.observations[0]!.subject_id);
        const prefix = s.observations.slice(0, c.after_observation);
        expect(prefix.every(o => Date.parse(o.recorded_at) <= Date.parse(c.query_at))).toBe(true);
        expect(s.observations.slice(c.after_observation).every(o => Date.parse(o.recorded_at) > Date.parse(c.query_at))).toBe(true);
      }
    }
    expect(ids.size).toBe(180);
  });

  it('splits whole families and balances the five trap strata without hiding task switches', () => {
    const split = z.object({ unit: z.literal('whole_sequence_family'), assignments: z.array(z.object({
      sequence_id: z.string(), family_id: z.string(), stratum: z.enum([
        'conditional', 'correction', 'generalization', 'task_noise', 'source_preservation',
      ]), scenario: z.enum(['task_switch', 'small_batches']), split: z.enum(['dev', 'test_candidate']),
    }).strict()).length(30) }).strict().parse(read('split.json'));
    expect(new Set(split.assignments.map(a => a.sequence_id)).size).toBe(30);
    for (const stratum of new Set(split.assignments.map(a => a.stratum))) {
      const group = split.assignments.filter(a => a.stratum === stratum);
      expect(group).toHaveLength(6);
      expect(group.filter(a => a.split === 'dev')).toHaveLength(1);
      expect(group.filter(a => a.split === 'test_candidate')).toHaveLength(5);
    }
    for (const a of split.assignments) {
      const s = byId.get(a.sequence_id)!;
      expect(a.family_id).toBe(s.family_id);
      if (a.stratum === 'task_noise') {
        expect(a.scenario).toBe('task_switch');
        const subjects = s.observations.map(o => o.subject_id);
        expect(subjects).toEqual([subjects[0], subjects[0], subjects[2], subjects[2], subjects[0], subjects[0]]);
        expect(subjects[0]).not.toBe(subjects[2]);
      } else {
        expect(a.scenario).toBe('small_batches');
        expect(new Set(s.observations.map(o => o.subject_id)).size).toBe(1);
      }
    }
  });

  it('gives each independent reviewer only the exact stage prefix and an empty answer form', () => {
    const orders: string[][] = [];
    for (const who of ['reviewer-a', 'reviewer-b']) {
      for (let stage = 1; stage <= 3; stage++) {
        const folder = `${who}/stage-${stage}`;
        expect(readdirSync(join(dir, folder)).sort()).toEqual(['answers.blank.json', 'packet.json', 'rubric.md']);
        const packet = validatePacket(read(`${folder}/packet.json`), stage);
        const blank = read(`${folder}/answers.blank.json`);
        expect(blank.packet_sha256).toBe(sha(readFileSync(join(dir, folder, 'packet.json'))));
        expect(blank.rubric_sha256).toBe(sha(readFileSync(join(dir, folder, 'rubric.md'))));
        expect(blank).toMatchObject({ reviewer_id: null, model: null, judged_at: null, label_source: 'agent_panel', stage });
        expect(blank.answers).toEqual(packet.cases.map(c => ({
          checkpoint_id: c.checkpoint_id, status: 'pending', required_facts: [], forbidden_claims: [],
          relevant_evidence_refs: [], rationale: null, hold_reason: null, execution_evidence: 'unmeasured',
        })));
        orders.push(packet.cases.map(c => c.sequence_id));
      }
    }
    for (let i = 0; i < 3; i++) expect(orders[i]).not.toEqual(orders[i + 3]);
  });

  it('rejects author-label leakage and future evidence even when the packet length is unchanged', () => {
    const original = read('reviewer-a/stage-1/packet.json');
    const labelLeak = structuredClone(original);
    labelLeak.cases[0].required_facts = ['author answer'];
    expect(() => validatePacket(labelLeak, 1)).toThrow();
    const futureLeak = structuredClone(original);
    const s = byId.get(futureLeak.cases[0].sequence_id)!;
    futureLeak.cases[0].evidence[1].content = s.observations[2]!.content;
    futureLeak.cases[0].evidence[1].sha256 = s.observations[2]!.content_sha256;
    expect(() => validatePacket(futureLeak, 1)).toThrow();
    const duplicate = structuredClone(original);
    duplicate.cases[1] = structuredClone(duplicate.cases[0]);
    expect(() => validatePacket(duplicate, 1)).toThrow();
  });

  it('keeps every author checkpoint contract provisional and every execution result unmeasured', () => {
    const author = z.object({ status: z.literal('not_gold_do_not_distribute'), candidates: z.array(z.object({
      checkpoint_id: z.string(), status: z.literal('author_candidate_not_gold'),
      required_facts: z.array(z.string().min(1)).min(1), forbidden_claims: z.array(z.string().min(1)).min(1),
    }).strict()).length(90) }).strict().parse(read('author-candidates.json'));
    expect(author.candidates.map(a => a.checkpoint_id).sort()).toEqual(
      fixture.sequences.flatMap(s => s.checkpoints.map(c => c.checkpoint_id)).sort(),
    );
    const execution = read('execution-registration.blank.json');
    expect(execution).toMatchObject({
      status: 'not_registered', runner_commit: null, dataset_sha256: null, gold_sha256: null,
      registered_at: null, actual_calls: null, result: null, final_answer: null, execution: null,
    });
    expect(Object.values(execution.systems).every(v => v === null)).toBe(true);
    expect(existsSync(join(dir, 'ground-truth.json'))).toBe(true);
    expect(read('result-manifest.json')).toMatchObject({
      status: 'inconclusive_not_run', actual_calls: 0, performance: null, final_answer: null, execution: null,
    });
  });

  it('reports the coarse sequence-level detection limit instead of counting checkpoints as samples', () => {
    const design = read('design-check.json');
    expect(design.test_sequences).toBe(25);
    expect(design.comparisons).toBe(2);
    expect(design.alpha_each).toBe(0.025);
    expect(design.ideal_discordant_count).toBe(7);
    expect(2 * 0.5 ** 6).toBeGreaterThan(design.alpha_each);
    expect(2 * 0.5 ** 7).toBeLessThan(design.alpha_each);
    expect(design.ideal_two_sided_exact_p).toBe(2 * 0.5 ** 7);
    expect(design.ideal_observed_effect_pp).toBeCloseTo(7 / 25 * 100, 12);
    function power(p: number): number {
      let probability = (1 - p) ** 25;
      let cumulative = probability;
      for (let k = 1; k < 7; k++) {
        probability *= (26 - k) / k * p / (1 - p);
        cumulative += probability;
      }
      return 1 - cumulative;
    }
    const p = design.ideal_one_directional_effect_for_80pct_power;
    expect(power(p)).toBeCloseTo(0.8, 12);
    expect(power(p - 1e-6)).toBeLessThan(0.8);
    expect(p).toBeCloseTo(0.340459, 6);
  });

  it('reproduces sealed two-adjudicator intersection through the actual offline CLI', () => {
    const audit = read('adjudication/panel-audit.json');
    const auditSha = sha(readFileSync(join(dir, 'adjudication/panel-audit.json')));
    const reviews = ['m5', 'm2'].map(who => read(`adjudication/adj-${who}.sealed.json`));
    const result = aggregateReplayPanel(audit, reviews, auditSha);
    expect(result).toEqual(read('panel-result.json'));
    expect(result.summary).toEqual({ checkpoints: 90, contract_gold: 58, held: 32, retrieval_gold: 58,
      complete_dev: 2, planned_dev: 5, complete_test: 10, planned_test: 25 });
    const output = execFileSync(process.execPath, ['--import', 'tsx', 'scripts/aggregate-consolidation-replay-panel.ts'], {
      cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, NODE_ENV: 'test' },
    });
    expect(JSON.parse(output)).toEqual(result);
    const registration = read('result-manifest.json');
    expect(sha(readFileSync(join(process.cwd(), registration.runner.path)))).toBe(registration.runner.sha256);
    for (const [name, expected] of Object.entries(read('adjudication/source-pins.json'))) {
      expect(sha(readFileSync(join(dir, 'adjudication', name)))).toBe(expected);
    }
    expect(read('ground-truth.json')).toEqual(result.decisions.filter(d => d.contract_gold).map(d => ({
      checkpoint_id: d.checkpoint_id, contracts: d.contracts, relevant_evidence_refs: d.relevant_evidence_refs,
    })));
  });

  it('preserves controller seals for all stage inputs, original judgments and adjudicators', () => {
    const verify = (name: string, resolve: (path: string) => string, count: number) => {
      const lines = readFileSync(join(dir, 'adjudication/seals', name), 'utf8').trim().split('\n');
      expect(lines).toHaveLength(count);
      for (const line of lines) {
        const match = /^([a-f0-9]{64})\s+(.+)$/.exec(line)!;
        expect(match).not.toBeNull();
        expect(sha(readFileSync(join(dir, resolve(match[2]!))))).toBe(match[1]);
      }
    };
    for (let stage = 1; stage <= 3; stage++) {
      verify(`stage${stage}-input.sha256`, path => {
        expect(path).toMatch(new RegExp(`^r1553/panel/reviewer-[ab]/stage-${stage}/(packet\\.json|rubric\\.md|answers\\.blank\\.json)$`));
        return path.replace('r1553/panel/', '');
      }, 6);
    }
    verify('all-submissions.sha256', path => {
      const match = /^r1553\/panel\/reviewer-([ab])\/stage-([123])\/answers\.json$/.exec(path)!;
      expect(match).not.toBeNull();
      return `adjudication/stage${match[2]}-${match[1]}-answers.sealed.json`;
    }, 6);
    for (const who of ['m5', 'm2']) {
      verify(`adj-${who}.sha256`, path => {
        expect(path).toBe(`r1553/adj/${who}/contract-review.json`);
        return `adjudication/adj-${who}.sealed.json`;
      }, 1);
    }
  });

  it('requires both approvals, preserves evidence disagreements and rejects missing or substituted reviews', () => {
    const audit = read('adjudication/panel-audit.json');
    const auditSha = sha(readFileSync(join(dir, 'adjudication/panel-audit.json')));
    const reviews = ['m5', 'm2'].map(who => read(`adjudication/adj-${who}.sealed.json`));
    const goldId = read('ground-truth.json')[0].checkpoint_id;
    for (const approvals of [[true, false], [false, true], [false, false], [true, true]]) {
      const modified = structuredClone(reviews);
      modified.forEach((r, i) => { r.cases.find((c: { checkpoint_id: string }) => c.checkpoint_id === goldId).contract_agreement = approvals[i]; });
      const decision = aggregateReplayPanel(audit, modified, auditSha).decisions.find(d => d.checkpoint_id === goldId)!;
      expect(decision.contract_gold).toBe(approvals.every(Boolean));
    }
    const differentRefs = structuredClone(audit);
    const c = differentRefs.decisions.find((d: { checkpoint_id: string }) => d.checkpoint_id === goldId);
    c.judgments.b.answer.relevant_evidence_refs = [];
    c.relevant_evidence_agreement = false;
    expect(() => aggregateReplayPanel(differentRefs, reviews, auditSha)).toThrow();
    c.judgments.b.answer.relevant_evidence_refs = [c.judgments.a.answer.relevant_evidence_refs[0]];
    expect(c.judgments.a.answer.relevant_evidence_refs.length).toBeGreaterThan(1);
    const d = aggregateReplayPanel(differentRefs, reviews, auditSha).decisions.find(d => d.checkpoint_id === goldId)!;
    expect(d.contract_gold).toBe(true);
    expect(d.relevant_evidence_refs).toBeNull();
    expect(() => aggregateReplayPanel(audit, [reviews[0]], auditSha)).toThrow();
    expect(() => aggregateReplayPanel(audit, reviews, '0'.repeat(64))).toThrow(/SHA mismatch/);
    const duplicate = structuredClone(reviews);
    duplicate[0].cases[1] = duplicate[0].cases[0];
    expect(() => aggregateReplayPanel(audit, duplicate, auditSha)).toThrow(/Duplicate/);
    const unknown = structuredClone(reviews);
    unknown[0].cases[0].checkpoint_id = 'unknown';
    expect(() => aggregateReplayPanel(audit, unknown, auditSha)).toThrow(/Unknown/);
  });

  it('freezes all planned sequences and strata without calling a held contract a performance result', () => {
    const result = read('panel-result.json');
    const coverage = read('coverage.json');
    const split = read('split.frozen.json');
    expect(split.assignments.map((a: { complete: boolean; held_checkpoints: string[] }) => {
      const { complete: _complete, held_checkpoints: _held, ...original } = a;
      return original;
    })).toEqual(read('split.json').assignments);
    expect(coverage).toMatchObject({ status: 'inconclusive_insufficient_contract_coverage',
      test_coverage: 0.4, system_calls: 0, arm_results: null, summary: result.summary });
    expect(coverage.stage_gold.map((s: { gold: number }) => s.gold)).toEqual([24, 22, 12]);
    for (const stratum of coverage.strata) {
      const planned = split.assignments.filter((a: { stratum: string; split: string }) => a.stratum === stratum.stratum && a.split === 'test_candidate');
      expect(planned).toHaveLength(5);
      expect(stratum.test_candidate.complete).toBe(planned.filter((a: { complete: boolean }) => a.complete).length);
    }
    expect(coverage.coverage_bound.best_possible_worst_case_full_difference_pp).toBe((10 - 15) / 25 * 100);
    const previousProtocol = readFileSync(join(dir, 'adjudication/pre-adjudication-protocol.md'));
    expect(sha(previousProtocol)).toBe(read('adjudication/adj-m5.sealed.json').protocol_sha256);
    expect(read('design-registration.json').adjudication_amendment.previous_protocol_sha256).toBe(sha(previousProtocol));
  });
});
