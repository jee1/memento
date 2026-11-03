/**
 * #1624: build the v2 adjudication input per stage from sealed panel submissions, and check filled adjudications; no model calls or memory writes.
 *
 * Judges appear only as A (reviewer-a) and B (reviewer-b). Split, strata, judge identities and source inputs stay out.
 *
 * Each stage is cut into bundles of BUNDLE_SIZE checkpoints so one adjudicator session can hold a bundle.
 *
 * Usage:
 *   npx tsx scripts/build-consolidation-replay-v2-adjudication.ts [--out <dir>]...
 *   npx tsx scripts/build-consolidation-replay-v2-adjudication.ts --check <filled.json> --bundle stage-<1|2|3>-part-<n>
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { V2_DIR } from './build-consolidation-replay-v2-panel.js';
import { isMain } from './lib/cli-runtime.js';
import { assertAgreementMatchesProbes } from './lib/consolidation-panel-decision.js';

const STAGES = [1, 2, 3] as const;
const BUNDLE_SIZE = 20;
const REVIEWERS = { A: 'a', B: 'b' } as const;
const V11_PROTOCOL = 'tests/fixtures/search-quality/consolidation-replay-v1.1/protocol.md';
const SECTIONS = [
  { source: V11_PROTOCOL, start: '## 계약 동등성 검사', end: '## 판정 절차' },
  { source: `${V2_DIR}/protocol.md`, start: '## 판정과 조정', end: '## 지표' },
] as const;
export const ADJ_INPUT_DIR = 'adjudication/input';
export const BOUNDARIES = ['B1', 'B2', 'B3', 'B4', 'B5', 'DF1', 'DF2', 'DF3', 'DF4', 'DF5'] as const;

interface Answer {
  checkpoint_id: string;
  status: string;
  required_facts: Array<{ fact_key: string }>;
  forbidden_claims: unknown[];
  [key: string]: unknown;
}
interface Submission { packet_sha256: string; answers: Answer[] }
interface Case { checkpoint_id: string; [key: string]: unknown }
interface InputCase { checkpoint_id: string; contract_a: Answer; contract_b: Answer }

const sha = (data: string) => createHash('sha256').update(data).digest('hex');
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

const assertTargets = (contracts: { contract_a: Answer; contract_b: Answer }) => [
  ...contracts.contract_a.forbidden_claims.map((_, i) => `A.fc${i + 1}`),
  ...contracts.contract_b.forbidden_claims.map((_, i) => `B.fc${i + 1}`),
];

function equivalenceText(root: string): string {
  const header = '# 조정용 동등성 검사 (consolidation-replay-v2)\n\n'
    + '아래 두 발췌를 그대로 붙였다. 두 번째 발췌와 rubric.md 「탐침 P_omit의 뜻」이 첫 번째 발췌의 3번(P_omit(f))을 대체한다. '
    + 'P_omit은 필수 사실 항목이 아니라 fact_alignment 행마다 하나씩 쓴다.\n\n';
  return header + SECTIONS.map(({ source, start, end }) => {
    const text = readFileSync(join(root, source), 'utf8');
    const from = text.indexOf(start);
    const to = text.indexOf(end);
    if (from < 0 || to <= from) throw new Error(`section ${start} not found in ${source}`);
    return `<!-- ${source} (${sha(text)}) "${start}" .. "${end}" -->\n\n${text.slice(from, to)}`;
  }).join('\n');
}

/** Returns adjudication input files keyed by `stage-N-part-M/<file>` relative to the input directory. */
export function buildV2Adjudication(root = process.cwd()): Map<string, string> {
  const dir = join(root, V2_DIR);
  const read = (path: string) => readFileSync(join(dir, path), 'utf8');
  const rubric = read('rubric.md');
  const equivalence = equivalenceText(root);
  const files = new Map<string, string>();

  for (const stage of STAGES) {
    const seals: Record<string, string> = {};
    const byReviewer = Object.fromEntries(Object.entries(REVIEWERS).map(([label, reviewer]) => {
      const name = `stage${stage}-${reviewer}-answers.sealed.json`;
      const raw = read(`adjudication/${name}`);
      const sealed = read(`adjudication/seals/stage${stage}-${reviewer}-submission.sha256`).split(/\s+/)[0];
      if (sha(raw) !== sealed) throw new Error(`${name} does not match its seal`);
      seals[name] = sealed;
      const packetRaw = read(`reviewer-${reviewer}/stage-${stage}/packet.json`);
      const submission = JSON.parse(raw) as Submission;
      if (submission.packet_sha256 !== sha(packetRaw)) throw new Error(`${name} was judged on another packet`);
      const packetCases = new Map((JSON.parse(packetRaw).cases as Case[]).map(c => [c.checkpoint_id, c]));
      const answers = new Map(submission.answers.map(a => [a.checkpoint_id, a]));
      return [label, { packetCases, answers }];
    })) as Record<keyof typeof REVIEWERS, { packetCases: Map<string, Case>; answers: Map<string, Answer> }>;

    const stageCases = [...byReviewer.A.packetCases.keys()].sort().map((checkpointId) => {
      const packetCase = byReviewer.A.packetCases.get(checkpointId)!;
      if (json(packetCase) !== json(byReviewer.B.packetCases.get(checkpointId))) {
        throw new Error(`${checkpointId} differs between reviewer packets`);
      }
      const contract_a = byReviewer.A.answers.get(checkpointId);
      const contract_b = byReviewer.B.answers.get(checkpointId);
      if (!contract_a || !contract_b) throw new Error(`${checkpointId} lacks a submission`);
      return { checkpoint_id: checkpointId, stage, packet_case: packetCase, contract_a, contract_b };
    });

    for (let part = 1; (part - 1) * BUNDLE_SIZE < stageCases.length; part += 1) {
    const bundle = `stage-${stage}-part-${part}`;
    const cases = stageCases.slice((part - 1) * BUNDLE_SIZE, part * BUNDLE_SIZE);

    const input = json({
      fixture_version: 'consolidation-replay-v2',
      role: 'contract_adjudication_input',
      bundle,
      stage,
      rubric_sha256: sha(rubric),
      equivalence_sha256: sha(equivalence),
      sealed_submissions_sha256: seals,
      cases,
    });
    const blank = json({
      adjudicator_id: null,
      model: null,
      adjudicated_at: null,
      label_source: 'agent_panel',
      role: 'contract_adjudication',
      bundle,
      stage,
      input_sha256: sha(input),
      rubric_sha256: sha(rubric),
      equivalence_sha256: sha(equivalence),
      cases: cases.map(c => ({
        checkpoint_id: c.checkpoint_id,
        contract_agreement: null,
        fact_alignment: [],
        probes: [
          { probe: 'P_A', target: null }, { probe: 'P_B', target: null },
          ...assertTargets(c).map(target => ({ probe: 'P_assert', target })),
        ].map(p => ({ ...p, verdict_a: null, verdict_b: null })),
        boundaries_applied: [],
        rationale: null,
      })),
    });
    files.set(`${bundle}/adjudication-input.json`, input);
    files.set(`${bundle}/rubric.md`, rubric);
    files.set(`${bundle}/equivalence.md`, equivalence);
    files.set(`${bundle}/adjudication.blank.json`, blank);
    }
  }
  return files;
}

const verdict = z.enum(['pass', 'fail']);
export const adjudicationSchema = z.object({
  adjudicator_id: z.string().min(1), model: z.string().min(1), adjudicated_at: z.string().datetime(),
  label_source: z.literal('agent_panel'), role: z.literal('contract_adjudication'), bundle: z.string(), stage: z.number().int(),
  input_sha256: z.string().length(64), rubric_sha256: z.string().length(64), equivalence_sha256: z.string().length(64),
  cases: z.array(z.object({
    checkpoint_id: z.string(), contract_agreement: z.boolean(),
    fact_alignment: z.array(z.object({ row: z.string().min(1), a: z.array(z.string()), b: z.array(z.string()) }).strict()),
    probes: z.array(z.object({
      probe: z.enum(['P_A', 'P_B', 'P_omit', 'P_assert']), target: z.string().nullable(),
      verdict_a: verdict, verdict_b: verdict,
    }).strict()),
    boundaries_applied: z.array(z.enum(BOUNDARIES)), rationale: z.string().min(1),
  }).strict()),
}).strict();

const sameSet = (got: string[], want: string[]) =>
  got.length === new Set(got).size && got.length === want.length && want.every(w => got.includes(w));

/** Returns every problem in a filled adjudication; an empty list means it may be sealed. */
export function checkV2Adjudication(inputRaw: string, filledRaw: string): string[] {
  const parsed = adjudicationSchema.safeParse(JSON.parse(filledRaw));
  if (!parsed.success) return parsed.error.issues.map(i => `schema ${i.path.join('.')}: ${i.message}`);
  const filled = parsed.data;
  const input = JSON.parse(inputRaw) as { bundle: string; stage: number; rubric_sha256: string; equivalence_sha256: string; cases: InputCase[] };
  const problems: string[] = [];
  if (filled.input_sha256 !== sha(inputRaw)) problems.push('input_sha256 does not match the input');
  if (filled.bundle !== input.bundle || filled.stage !== input.stage) problems.push(`bundle ${filled.bundle} != input bundle ${input.bundle}`);
  if (filled.rubric_sha256 !== input.rubric_sha256 || filled.equivalence_sha256 !== input.equivalence_sha256) {
    problems.push('rubric or equivalence sha does not match the input');
  }
  const ids = filled.cases.map(c => c.checkpoint_id);
  if (ids.join() !== input.cases.map(c => c.checkpoint_id).join()) problems.push('cases are not the input checkpoints in input order');

  for (const c of filled.cases) {
    const source = input.cases.find(x => x.checkpoint_id === c.checkpoint_id);
    if (!source) continue;
    const at = (msg: string) => problems.push(`${c.checkpoint_id}: ${msg}`);
    const rows = c.fact_alignment;
    if (new Set(rows.map(r => r.row)).size !== rows.length) at('duplicate fact_alignment row id');
    if (rows.some(r => r.a.length + r.b.length === 0)) at('empty fact_alignment row');
    if (!sameSet(rows.flatMap(r => r.a), source.contract_a.required_facts.map(f => f.fact_key))) at('fact_alignment does not cover every A fact_key exactly once');
    if (!sameSet(rows.flatMap(r => r.b), source.contract_b.required_facts.map(f => f.fact_key))) at('fact_alignment does not cover every B fact_key exactly once');
    const targets = (kind: string) => c.probes.filter(p => p.probe === kind).map(p => p.target ?? '');
    const minimal = c.probes.filter(p => p.probe === 'P_A' || p.probe === 'P_B');
    if (minimal.length !== 2 || minimal[0]!.probe === minimal[1]!.probe || minimal.some(p => p.target !== null)) {
      at('needs exactly one P_A and one P_B with null target');
    }
    if (!sameSet(targets('P_omit'), rows.map(r => r.row))) at('needs exactly one P_omit per fact_alignment row');
    if (!sameSet(targets('P_assert'), assertTargets(source))) at('needs exactly one P_assert per case-specific forbidden claim');
    try {
      assertAgreementMatchesProbes(c.checkpoint_id, { adjudicator: filled.adjudicator_id, ...c });
    } catch (error) {
      problems.push((error as Error).message);
    }
  }
  return problems;
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { out: { type: 'string', multiple: true }, check: { type: 'string' }, bundle: { type: 'string' } } });
  if (values.check) {
    const inputRaw = readFileSync(join(V2_DIR, ADJ_INPUT_DIR, values.bundle ?? '', 'adjudication-input.json'), 'utf8');
    const problems = checkV2Adjudication(inputRaw, readFileSync(values.check, 'utf8'));
    process.stdout.write(problems.length ? `${problems.join('\n')}\n` : 'ok\n');
    process.exitCode = problems.length ? 1 : 0;
  } else {
    const files = buildV2Adjudication();
    for (const outDir of values.out ?? [join(V2_DIR, ADJ_INPUT_DIR)]) {
      for (const [path, body] of files) {
        const target = join(outDir, path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, body);
      }
      process.stdout.write(`${files.size} files -> ${outDir}\n`);
    }
  }
}
