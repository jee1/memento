/**
 * #1574: build the v1.1 adjudication input from sealed panel submissions; no model calls or memory writes.
 *
 * Judges appear only as A (reviewer-a) and B (reviewer-b). v1 judgments, gold, holds, author candidates and split stay out.
 *
 * Usage: npx tsx scripts/build-consolidation-replay-v11-adjudication.ts [--out <dir>]
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { V11_DIR } from './build-consolidation-replay-v11-panel.js';
import { isMain } from './lib/cli-runtime.js';

const STAGES = [1, 2, 3] as const;
const REVIEWERS = { A: 'a', B: 'b' } as const;
const EQUIVALENCE_START = '## 계약 동등성 검사';
const EQUIVALENCE_END = '## 판정 절차';
export const ADJ_INPUT_DIR = 'adjudication/input';

interface Answer {
  checkpoint_id: string;
  required_facts: unknown[];
  forbidden_claims: unknown[];
  [key: string]: unknown;
}
interface Submission { packet_sha256: string; answers: Answer[] }
interface Case { checkpoint_id: string; [key: string]: unknown }

const sha = (data: string) => createHash('sha256').update(data).digest('hex');
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

function probesFor(contracts: Record<keyof typeof REVIEWERS, Answer>) {
  const targets = (Object.keys(REVIEWERS) as Array<keyof typeof REVIEWERS>).flatMap(label => [
    ...contracts[label].required_facts.map((_, i) => ({ probe: 'P_omit', target: `${label}.rf${i + 1}` })),
    ...contracts[label].forbidden_claims.map((_, i) => ({ probe: 'P_assert', target: `${label}.fc${i + 1}` })),
  ]);
  return [{ probe: 'P_A', target: null }, { probe: 'P_B', target: null }, ...targets]
    .map(p => ({ ...p, verdict_a: null, verdict_b: null }));
}

/** Returns adjudication input files keyed by path relative to the input directory. */
export function buildV11Adjudication(root = process.cwd()): Map<string, string> {
  const dir = join(root, V11_DIR);
  const read = (path: string) => readFileSync(join(dir, path), 'utf8');
  const protocol = read('protocol.md');
  const rubric = read('rubric.md');
  const start = protocol.indexOf(EQUIVALENCE_START);
  const end = protocol.indexOf(EQUIVALENCE_END);
  if (start < 0 || end <= start) throw new Error('equivalence section not found in protocol.md');
  const equivalence = protocol.slice(start, end);

  const seals: Record<string, string> = {};
  const cases = STAGES.flatMap((stage) => {
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

    return [...byReviewer.A.packetCases.keys()].sort().map((checkpointId) => {
      const caseA = byReviewer.A.packetCases.get(checkpointId)!;
      if (json(caseA) !== json(byReviewer.B.packetCases.get(checkpointId))) {
        throw new Error(`${checkpointId} differs between reviewer packets`);
      }
      const contracts = { A: byReviewer.A.answers.get(checkpointId)!, B: byReviewer.B.answers.get(checkpointId)! };
      if (!contracts.A || !contracts.B) throw new Error(`${checkpointId} lacks a submission`);
      return { stage, case: caseA, contract_a: contracts.A, contract_b: contracts.B, probes: probesFor(contracts) };
    });
  });

  const input = json({
    fixture_version: 'consolidation-replay-v1.1',
    role: 'contract_adjudication_input',
    rubric_sha256: sha(rubric),
    equivalence_sha256: sha(equivalence),
    equivalence_source: `protocol.md (${sha(protocol)}) from "${EQUIVALENCE_START}" up to "${EQUIVALENCE_END}"`,
    sealed_submissions_sha256: seals,
    cases: cases.map(({ stage, case: c, contract_a, contract_b }) => ({
      checkpoint_id: c.checkpoint_id, stage, packet_case: c, contract_a, contract_b,
    })),
  });
  const blank = json({
    adjudicator_id: null,
    model: null,
    adjudicated_at: null,
    label_source: 'agent_panel',
    role: 'contract_adjudication',
    input_sha256: sha(input),
    rubric_sha256: sha(rubric),
    equivalence_sha256: sha(equivalence),
    cases: cases.map(({ case: c, probes }) => ({
      checkpoint_id: c.checkpoint_id,
      contract_agreement: null,
      probes,
      boundaries_applied: [],
      rationale: null,
    })),
  });
  return new Map([
    ['adjudication-input.json', input],
    ['rubric.md', rubric],
    ['equivalence.md', equivalence],
    ['adjudication.blank.json', blank],
  ]);
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { out: { type: 'string', multiple: true } } });
  const outDirs = values.out ?? [join(V11_DIR, ADJ_INPUT_DIR)];
  const files = buildV11Adjudication();
  for (const outDir of outDirs) {
    for (const [path, body] of files) {
      const target = join(outDir, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, body);
    }
    process.stdout.write(`${files.size} files -> ${outDir}\n`);
  }
}
