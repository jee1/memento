/**
 * #1624: offline aggregation of the v2 sealed adjudications; no model calls or memory writes.
 *
 * Gold needs both judges resolved and both adjudicators true. Evidence freezes only on gold with identical judge sets.
 *
 * Usage: npx tsx scripts/aggregate-consolidation-replay-v2-panel.ts [--write]
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { ADJ_INPUT_DIR, adjudicationSchema, buildV2Adjudication, checkV2Adjudication } from './build-consolidation-replay-v2-adjudication.js';
import { STRATA, V2_DIR } from './build-consolidation-replay-v2-panel.js';
import { isMain } from './lib/cli-runtime.js';
import { decideCheckpoint, type JudgeContract } from './lib/consolidation-panel-decision.js';

const ADJUDICATORS = ['adj-1', 'adj-2'] as const;
/** protocol.md 「유효성 관문」 G1, checked here on gold alone; output-panel holds can only lower it. */
const G1_MIN_PAIRED = 16;
const G1_MIN_PER_STRATUM = 2;

interface InputCase { checkpoint_id: string; stage: number; contract_a: JudgeContract; contract_b: JudgeContract }

const sha = (data: string) => createHash('sha256').update(data).digest('hex');
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export function aggregateV2Panel(root = process.cwd()) {
  const dir = join(root, V2_DIR);
  const read = (path: string) => readFileSync(join(dir, path), 'utf8');
  const built = buildV2Adjudication(root);
  const bundles = [...new Set([...built.keys()].map(k => k.split('/')[0]!))];
  const sequences = JSON.parse(read('sequences.json')).sequences as Array<{ sequence_id: string; checkpoints: Array<{ checkpoint_id: string }> }>;
  const split = new Map((JSON.parse(read('split.json')).assignments as Array<{ sequence_id: string; stratum: string; split: string }>)
    .map(a => [a.sequence_id, a]));

  const pins: Record<string, string> = {};
  const models: Record<string, Set<string>> = Object.fromEntries(ADJUDICATORS.map(a => [a, new Set<string>()]));
  const decisions = bundles.flatMap((bundle) => {
    const inputRaw = read(`${ADJ_INPUT_DIR}/${bundle}/adjudication-input.json`);
    if (inputRaw !== built.get(`${bundle}/adjudication-input.json`)) throw new Error(`${bundle} input differs from its builder`);
    const rows = ADJUDICATORS.map((name) => {
      const file = `${name}-${bundle}`;
      const raw = read(`adjudication/${file}.sealed.json`);
      const sealed = read(`adjudication/seals/${file}.sha256`).split(/\s+/)[0]!;
      if (sha(raw) !== sealed) throw new Error(`${file} does not match its seal`);
      const problems = checkV2Adjudication(inputRaw, raw);
      if (problems.length) throw new Error(`${file}: ${problems.join('; ')}`);
      pins[`${file}.sealed.json`] = sealed;
      const parsed = adjudicationSchema.parse(JSON.parse(raw));
      models[name]!.add(parsed.model);
      return new Map(parsed.cases.map(c => [c.checkpoint_id, c]));
    });
    return (JSON.parse(inputRaw).cases as InputCase[]).map((c) => {
      const cases = rows.map(r => r.get(c.checkpoint_id)!);
      const decision = decideCheckpoint(c.checkpoint_id, { a: c.contract_a, b: c.contract_b },
        cases.map((row, i) => ({ adjudicator: ADJUDICATORS[i]!, ...row })));
      const sequenceId = c.checkpoint_id.replace(/_t\d$/, '');
      const assignment = split.get(sequenceId);
      if (!assignment) throw new Error(`${c.checkpoint_id} has no split assignment`);
      return {
        checkpoint_id: c.checkpoint_id, sequence_id: sequenceId, stage: c.stage,
        stratum: assignment.stratum, split: assignment.split, bundle,
        ...decision,
        hold_reasons: decision.contract_gold ? [] : ADJUDICATORS.filter((_, i) => !decision.adjudicator_approvals[i]).map(a => `${a}_contract_agreement_false`),
        divergent_probes: Object.fromEntries(ADJUDICATORS.map((a, i) => [a, cases[i]!.probes.filter(p => p.verdict_a !== p.verdict_b).length])),
        alignment_rows: Object.fromEntries(ADJUDICATORS.map((a, i) => [a, cases[i]!.fact_alignment.length])),
        boundaries_applied: Object.fromEntries(ADJUDICATORS.map((a, i) => [a, cases[i]!.boundaries_applied])),
      };
    });
  });
  if (decisions.length !== 120) throw new Error(`expected 120 checkpoints, got ${decisions.length}`);

  const sequenceRows = sequences.map((s) => {
    const rows = decisions.filter(d => d.sequence_id === s.sequence_id);
    if (rows.length !== 3) throw new Error(`${s.sequence_id} lacks a checkpoint`);
    const a = split.get(s.sequence_id)!;
    return {
      sequence_id: s.sequence_id, stratum: a.stratum, split: a.split,
      complete: rows.every(d => d.contract_gold),
      held_checkpoints: rows.filter(d => !d.contract_gold).map(d => d.checkpoint_id),
    };
  });
  const strata = STRATA.map((stratum) => {
    const inStratum = decisions.filter(d => d.stratum === stratum);
    const test = sequenceRows.filter(s => s.stratum === stratum && s.split === 'test');
    return {
      stratum,
      checkpoints: inStratum.length,
      contract_gold: inStratum.filter(d => d.contract_gold).length,
      test_complete_sequences: test.filter(s => s.complete).length,
      test_planned_sequences: test.length,
      dev_complete_sequences: sequenceRows.filter(s => s.stratum === stratum && s.split === 'dev' && s.complete).length,
    };
  });
  const testComplete = sequenceRows.filter(s => s.split === 'test' && s.complete).length;

  return {
    pins,
    result: {
      fixture_version: 'consolidation-replay-v2',
      label_source: 'agent_panel', human_gold: false, held_out_test: true,
      adjudicators: ADJUDICATORS.map(a => ({ id: a, models: [...models[a]!].sort() })),
      sources: Object.fromEntries(Object.entries(pins).map(([name, digest]) => [`adjudication/${name}`, digest])),
      summary: {
        checkpoints: decisions.length,
        contract_gold: decisions.filter(d => d.contract_gold).length,
        held: decisions.filter(d => !d.contract_gold).length,
        adjudicator_true: Object.fromEntries(ADJUDICATORS.map((a, i) => [a, decisions.filter(d => d.adjudicator_approvals[i]).length])),
        adjudicators_split: decisions.filter(d => new Set(d.adjudicator_approvals).size > 1).length,
        relevant_evidence_agreement: decisions.filter(d => d.relevant_evidence_agreement).length,
        retrieval_gold: decisions.filter(d => d.relevant_evidence_refs !== null).length,
        stage_gold: [1, 2, 3].map(stage => ({ stage, gold: decisions.filter(d => d.stage === stage && d.contract_gold).length, planned: 40 })),
        test_complete_sequences: testComplete,
        test_planned_sequences: sequenceRows.filter(s => s.split === 'test').length,
        g1_gold_only: {
          min_paired: G1_MIN_PAIRED, min_per_stratum: G1_MIN_PER_STRATUM,
          passes: testComplete >= G1_MIN_PAIRED && strata.every(s => s.test_complete_sequences >= G1_MIN_PER_STRATUM),
          note: 'Upper bound for G1: output-panel holds can only remove pairs.',
        },
      },
      strata, sequences: sequenceRows, decisions,
      system_calls: 0,
    },
  };
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { write: { type: 'boolean' } } });
  const { pins, result } = aggregateV2Panel();
  if (values.write) {
    writeFileSync(join(V2_DIR, 'adjudication/source-pins.json'), json(pins));
    writeFileSync(join(V2_DIR, 'panel-result.json'), json(result));
  }
  process.stdout.write(json({ summary: result.summary, strata: result.strata }));
}
