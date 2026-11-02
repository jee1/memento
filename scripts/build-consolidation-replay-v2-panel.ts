/**
 * #1624: build consolidation-replay-v2 sequences, split and blind panel from hand-written inputs; no model calls or memory writes.
 *
 * Usage: npx tsx scripts/build-consolidation-replay-v2-panel.ts [--out <dir>]
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { shuffled } from './build-consolidation-replay-v11-panel.js';
import { isMain } from './lib/cli-runtime.js';

export const V2_DIR = 'tests/fixtures/search-quality/consolidation-replay-v2';
const VERSION = 'consolidation-replay-v2';
export const STRATA = ['conditional', 'correction', 'generalization', 'task_noise', 'source_preservation'] as const;
const SPLIT_SEED = 1624;
const SEEDS = { 'reviewer-a': 1624, 'reviewer-b': 4261 } as const;
const STAGES = [1, 2, 3] as const;
const DAYS = ['2026-10-05', '2026-10-12', '2026-10-19'] as const;
/** task_noise observations o3/o4 belong to the separate task Y. */
const OTHER_TASK_INDEXES = new Set([2, 3]);

type Stratum = typeof STRATA[number];
interface SourceSequence { subject: string; other_subject?: string; observations: string[] }
interface Source { strata: Record<Stratum, SourceSequence[]> }

const sha = (data: string) => createHash('sha256').update(data).digest('hex');
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export const queryFor = (subject: string) =>
  `${subject}의 질의 시점 현재 지침, 회차별 관찰 기록, 미확정 범위를 정리하라. 대상, 조건, 시점, 관찰 회차를 구분하고 별개 작업을 섞지 말라.`;

function buildSequence(stratum: Stratum, index: number, src: SourceSequence) {
  const h = sha(`${VERSION}:${stratum}:${index}`).slice(0, 12);
  const owner = `owner_${h}`;
  const project = `project_${h}`;
  const observations = src.observations.map((content, i) => {
    const other = stratum === 'task_noise' && OTHER_TASK_INDEXES.has(i);
    const at = `${DAYS[Math.floor(i / 2)]}T09:${i % 2 === 0 ? '00' : '10'}:00Z`;
    return {
      memory_id: `cr2_${h}_o${i + 1}`, type: 'episodic', subject_id: `subject_${h}_${other ? 'y' : 'x'}`,
      content, recorded_at: at, event_at: at, content_sha256: sha(content),
    };
  });
  const checkpoints = STAGES.map(stage => ({
    checkpoint_id: `cr2_${h}_t${stage}`, after_observation: stage * 2, query_at: `${DAYS[stage - 1]}T10:00:00Z`,
    query: queryFor(src.subject), scope: { owner_id: owner, project_id: project, subject_id: `subject_${h}_x` },
  }));
  return {
    sequence_id: `cr2_${h}`, family_id: `family_${h}`, owner_id: owner, project_id: project,
    subject_name: src.subject, observations, checkpoints,
  };
}

/** Returns every generated file keyed by its path relative to the v2 fixture directory. */
export function buildV2Panel(root = process.cwd()): Map<string, string> {
  const read = (name: string) => readFileSync(join(root, V2_DIR, name), 'utf8');
  const sourceRaw = read('inputs.source.json');
  const source = JSON.parse(sourceRaw) as Source;
  const rubric = read('rubric.md');
  const rubricSha = sha(rubric);

  const built = STRATA.flatMap(stratum => source.strata[stratum].map((src, i) => ({ stratum, seq: buildSequence(stratum, i, src) })));
  const devIds = new Set(STRATA.map(stratum => shuffled(built, SPLIT_SEED).find(b => b.stratum === stratum)!.seq.sequence_id));

  const files = new Map<string, string>();
  files.set('sequences.json', json({ fixture_version: VERSION, source_sha256: sha(sourceRaw), sequences: built.map(b => b.seq) }));
  files.set('split.json', json({
    unit: 'whole_sequence_family', seed: SPLIT_SEED,
    rule: 'shuffle all 40 sequences with the seed; the first sequence of each stratum is dev, the rest test',
    assignments: built.map(({ stratum, seq }) => ({
      sequence_id: seq.sequence_id, family_id: seq.family_id, stratum, split: devIds.has(seq.sequence_id) ? 'dev' : 'test',
    })),
  }));

  for (const [reviewer, seed] of Object.entries(SEEDS)) {
    const order = shuffled(built.map(b => b.seq), seed);
    for (const stage of STAGES) {
      const cases = order.map(seq => ({
        sequence_id: seq.sequence_id, family_id: seq.family_id,
        ...seq.checkpoints[stage - 1]!,
        evidence: seq.observations.slice(0, stage * 2).map(o => ({
          evidence_id: o.memory_id, type: o.type, content: o.content,
          recorded_at: o.recorded_at, event_at: o.event_at,
          scope: { owner_id: seq.owner_id, project_id: seq.project_id, subject_id: o.subject_id },
          sha256: o.content_sha256,
        })),
      }));
      const packet = json({ rubric_version: VERSION, stage, cases });
      const blank = json({
        reviewer_id: null, model: null, judged_at: null, label_source: 'agent_panel',
        rubric_version: VERSION, stage, packet_sha256: sha(packet), rubric_sha256: rubricSha,
        answers: cases.map(c => ({
          checkpoint_id: c.checkpoint_id, status: 'pending', required_facts: [], forbidden_claims: [],
          relevant_evidence_refs: [], rationale: null, hold_reason: null, execution_evidence: 'unmeasured',
        })),
      });
      const base = `${reviewer}/stage-${stage}`;
      files.set(`${base}/packet.json`, packet);
      files.set(`${base}/rubric.md`, rubric);
      files.set(`${base}/answers.blank.json`, blank);
    }
  }

  files.set('manifest.json', json({
    fixture_version: VERSION,
    status: 'pending_panel',
    gold_count: 0,
    system_calls: 0,
    author_candidates: false,
    seeds: { split: SPLIT_SEED, ...SEEDS },
    sources: {
      'inputs.source.json': sha(sourceRaw),
      'protocol.md': sha(read('protocol.md')),
      'rubric.md': rubricSha,
      'registration.json': sha(read('registration.json')),
    },
    files: Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, body]) => [path, sha(body)])),
    dispatch_order: ['stage-1', 'seal-submissions', 'stage-2', 'seal-submissions', 'stage-3', 'seal-submissions'],
    do_not_distribute: ['parent directory', 'other reviewer', 'future stages', 'inputs.source.json', 'sequences.json', 'split.json', 'manifest.json', 'protocol.md', 'registration.json'],
  }));
  return files;
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  const outDir = values.out ?? V2_DIR;
  const files = buildV2Panel();
  for (const [path, body] of files) {
    const target = join(outDir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
  process.stdout.write(`${files.size} files -> ${outDir}\n`);
}
