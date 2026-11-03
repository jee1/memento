/**
 * #1574: offline aggregation of the v1.1 sealed adjudications; no model calls or memory writes.
 *
 * Gold needs both adjudicators true. v1 status is read here for the first time and is never rewritten.
 *
 * Usage: npx tsx scripts/aggregate-consolidation-replay-v11-panel.ts [--write]
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { ADJ_INPUT_DIR } from './build-consolidation-replay-v11-adjudication.js';
import { V11_DIR } from './build-consolidation-replay-v11-panel.js';
import { isMain } from './lib/cli-runtime.js';
import { decideCheckpoint } from './lib/consolidation-panel-decision.js';

const V1_DIR = 'tests/fixtures/search-quality/consolidation-replay-v1';
const ADJUDICATORS = ['adj-1', 'adj-2'] as const;
const BOUNDARIES = ['B1', 'B2', 'B3', 'B4', 'DF1', 'DF2', 'DF3', 'DF4', 'DF5'] as const;

const verdict = z.enum(['pass', 'fail']);
const adjudicationSchema = z.object({
  adjudicator_id: z.string().min(1), model: z.string().min(1), adjudicated_at: z.string().datetime(),
  label_source: z.literal('agent_panel'), role: z.literal('contract_adjudication'),
  input_sha256: z.string().length(64), rubric_sha256: z.string().length(64), equivalence_sha256: z.string().length(64),
  cases: z.array(z.object({
    checkpoint_id: z.string(), contract_agreement: z.boolean(),
    probes: z.array(z.object({
      probe: z.enum(['P_A', 'P_B', 'P_omit', 'P_assert']), target: z.string().nullable(),
      verdict_a: verdict, verdict_b: verdict,
    }).strict()),
    boundaries_applied: z.array(z.enum(BOUNDARIES)), rationale: z.string().min(1),
  }).strict()).length(36),
}).strict();
type Adjudication = z.infer<typeof adjudicationSchema>;
type Probe = Adjudication['cases'][number]['probes'][number];

interface InputCase {
  checkpoint_id: string; stage: number;
  contract_a: { status: string; relevant_evidence_refs: string[] }; contract_b: { status: string; relevant_evidence_refs: string[] };
}

const sha = (data: string) => createHash('sha256').update(data).digest('hex');
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * P_omit that passes both contracts: the adjudicator read the omitted fact as still implied by the other contract's items.
 * The protocol did not fix this reading; it is reported, never used to change gold.
 */
function omitPassBoth(probes: Probe[]): number {
  return probes.filter(p => p.probe === 'P_omit' && p.verdict_a === 'pass' && p.verdict_b === 'pass').length;
}

function count<T extends string>(values: T[]): Record<T, number> {
  return values.reduce((acc, v) => ({ ...acc, [v]: (acc[v] ?? 0) + 1 }), {} as Record<T, number>);
}

export function aggregateV11Panel(root = process.cwd()) {
  const dir = join(root, V11_DIR);
  const read = (path: string) => readFileSync(join(dir, path), 'utf8');
  const inputRaw = read(`${ADJ_INPUT_DIR}/adjudication-input.json`);
  const input = JSON.parse(inputRaw) as { cases: InputCase[] };
  const idMap = JSON.parse(read('id-map.json')) as {
    sequences: Array<{ sequence_id: string; v1_stratum: string; v1_split: string; checkpoints: Array<{ checkpoint_id: string; v1_checkpoint_id: string }> }>;
  };
  const v1Raw = readFileSync(join(root, V1_DIR, 'panel-result.json'), 'utf8');
  const v1 = new Map((JSON.parse(v1Raw).decisions as Array<{ checkpoint_id: string; contract_gold: boolean; adjudicator_approvals: boolean[] }>)
    .map(d => [d.checkpoint_id, d]));

  const pins: Record<string, string> = {};
  const adjudications = ADJUDICATORS.map((name) => {
    const raw = read(`adjudication/${name}.sealed.json`);
    const sealed = read(`adjudication/seals/${name}.sha256`).split(/\s+/)[0]!;
    if (sha(raw) !== sealed) throw new Error(`${name} does not match its seal`);
    pins[`${name}.sealed.json`] = sealed;
    const parsed = adjudicationSchema.parse(JSON.parse(raw));
    if (parsed.input_sha256 !== sha(inputRaw)) throw new Error(`${name} adjudicated another input`);
    const byId = new Map(parsed.cases.map(c => [c.checkpoint_id, c]));
    if (byId.size !== 36) throw new Error(`${name} has duplicate checkpoint_id`);
    return { name, model: parsed.model, byId };
  });

  const where = new Map(idMap.sequences.flatMap(s => s.checkpoints.map(c => [c.checkpoint_id, { sequence: s, v1Id: c.v1_checkpoint_id }])));
  const decisions = input.cases.map((c) => {
    const { sequence, v1Id } = where.get(c.checkpoint_id)!;
    const rows = adjudications.map(a => a.byId.get(c.checkpoint_id));
    if (rows.some(r => !r)) throw new Error(`${c.checkpoint_id} lacks an adjudication`);
    const decision = decideCheckpoint(c.checkpoint_id, { a: c.contract_a, b: c.contract_b },
      adjudications.map((a, i) => ({ adjudicator: a.name, ...rows[i]! })));
    const approvals = decision.adjudicator_approvals;
    const gold = decision.contract_gold;
    const v1Decision = v1.get(v1Id);
    if (!v1Decision) throw new Error(`v1 decision missing for ${v1Id}`);
    return {
      checkpoint_id: c.checkpoint_id, v1_checkpoint_id: v1Id, sequence_id: sequence.sequence_id,
      stage: c.stage, stratum: sequence.v1_stratum,
      adjudicator_approvals: approvals, contract_gold: gold,
      hold_reasons: gold ? [] : adjudications.filter((_, i) => !approvals[i]).map(a => `${a.name}_contract_agreement_false`),
      relevant_evidence_agreement: decision.relevant_evidence_agreement,
      relevant_evidence_refs: decision.relevant_evidence_refs,
      contracts: gold ? Object.fromEntries(['a', 'b'].map(who => [who, {
        submission: `adjudication/stage${c.stage}-${who}-answers.sealed.json`, checkpoint_id: c.checkpoint_id,
      }])) : null,
      boundaries_applied: Object.fromEntries(adjudications.map((a, i) => [a.name, rows[i]!.boundaries_applied])),
      divergent_probes: Object.fromEntries(adjudications.map((a, i) => [a.name, rows[i]!.probes.filter(p => p.verdict_a !== p.verdict_b).length])),
      p_omit_pass_both: Object.fromEntries(adjudications.map((a, i) => [a.name, omitPassBoth(rows[i]!.probes)])),
      v1: { contract_gold: v1Decision.contract_gold, adjudicator_approvals: v1Decision.adjudicator_approvals },
      v1_to_v1_1: `${v1Decision.contract_gold ? 'gold' : 'held'}->${gold ? 'gold' : 'held'}`,
    };
  });

  const sequences = idMap.sequences.map((s) => {
    const rows = decisions.filter(d => d.sequence_id === s.sequence_id);
    if (rows.length !== 3) throw new Error(`${s.sequence_id} lacks a checkpoint`);
    return {
      sequence_id: s.sequence_id, stratum: s.v1_stratum, v1_split: s.v1_split,
      complete: rows.every(d => d.contract_gold), v1_complete: rows.every(d => d.v1.contract_gold),
      held_checkpoints: rows.filter(d => !d.contract_gold).map(d => d.checkpoint_id),
    };
  });
  const strata = [...new Set(sequences.map(s => s.stratum))].map(stratum => {
    const inStratum = decisions.filter(d => d.stratum === stratum);
    const seqs = sequences.filter(s => s.stratum === stratum);
    return {
      stratum, checkpoints: inStratum.length, contract_gold: inStratum.filter(d => d.contract_gold).length,
      v1_contract_gold: inStratum.filter(d => d.v1.contract_gold).length,
      complete_sequences: seqs.filter(s => s.complete).length, v1_complete_sequences: seqs.filter(s => s.v1_complete).length,
      planned_sequences: seqs.length,
    };
  });
  const held = decisions.filter(d => !d.contract_gold);

  return {
    pins,
    result: {
      fixture_version: 'consolidation-replay-v1.1',
      label_source: 'agent_panel', human_gold: false, held_out_test: false,
      adjudicators: adjudications.map(a => ({ id: a.name, model: a.model })),
      sources: {
        [`${ADJ_INPUT_DIR}/adjudication-input.json`]: sha(inputRaw),
        [`${V1_DIR}/panel-result.json`]: sha(v1Raw),
        ...Object.fromEntries(Object.entries(pins).map(([name, digest]) => [`adjudication/${name}`, digest])),
      },
      summary: {
        checkpoints: decisions.length,
        contract_gold: decisions.filter(d => d.contract_gold).length,
        held: held.length,
        adjudicator_true: Object.fromEntries(adjudications.map((a, i) => [a.name, decisions.filter(d => d.adjudicator_approvals[i]).length])),
        adjudicators_split: decisions.filter(d => new Set(d.adjudicator_approvals).size > 1).length,
        relevant_evidence_agreement: decisions.filter(d => d.relevant_evidence_agreement).length,
        retrieval_gold: decisions.filter(d => d.relevant_evidence_refs !== null).length,
        stage_gold: [1, 2, 3].map(stage => ({ stage, gold: decisions.filter(d => d.stage === stage && d.contract_gold).length, planned: 12 })),
        complete_sequences: sequences.filter(s => s.complete).length,
        planned_sequences: sequences.length,
        v1_to_v1_1: count(decisions.map(d => d.v1_to_v1_1)),
        held_boundaries_applied: Object.fromEntries(adjudications.map(a => [a.name,
          count(held.flatMap(d => d.boundaries_applied[a.name]!))])),
        p_omit_pass_both: Object.fromEntries(adjudications.map(a => [a.name,
          decisions.reduce((n, d) => n + d.p_omit_pass_both[a.name]!, 0)])),
      },
      strata, sequences, decisions,
      system_calls: 0,
    },
  };
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { write: { type: 'boolean' } } });
  const { pins, result } = aggregateV11Panel();
  if (values.write) {
    writeFileSync(join(V11_DIR, 'adjudication/source-pins.json'), json(pins));
    writeFileSync(join(V11_DIR, 'panel-result.json'), json(result));
  }
  process.stdout.write(json(result.summary));
}
