/**
 * #1574: build the consolidation-replay-v1.1 blind panel from v1 inputs; no model calls or memory writes.
 *
 * Usage: npx tsx scripts/build-consolidation-replay-v11-panel.ts [--out <dir>]
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { isMain } from './lib/cli-runtime.js';

const V1_DIR = 'tests/fixtures/search-quality/consolidation-replay-v1';
export const V11_DIR = 'tests/fixtures/search-quality/consolidation-replay-v1.1';
const VERSION = 'consolidation-replay-v1.1';
const STRATA = ['task_noise', 'source_preservation'];
const SEEDS = { 'reviewer-a': 1574, 'reviewer-b': 4751 } as const;
const STAGES = [1, 2, 3] as const;

interface Observation {
  memory_id: string; type: string; subject_id: string; content: string;
  recorded_at: string; event_at: string; content_sha256: string;
}
interface Checkpoint {
  checkpoint_id: string; after_observation: number; query_at: string; query: string;
  scope: { owner_id: string; project_id: string; subject_id: string };
}
interface Sequence {
  sequence_id: string; family_id: string; owner_id: string; project_id: string;
  observations: Observation[]; checkpoints: Checkpoint[];
}
interface Assignment { sequence_id: string; stratum: string; split: string }

const sha = (data: string) => createHash('sha256').update(data).digest('hex');
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(items: T[], seed: number): T[] {
  const out = [...items];
  const random = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** v1 ids embed the sequence hash in every prefix, so one renamer covers all of them. */
function renamer(v1SequenceId: string) {
  const oldHash = v1SequenceId.replace(/^cr_/, '');
  const newHash = sha(`${VERSION}:${v1SequenceId}`).slice(0, 12);
  return (id: string) => {
    if (!id.includes(oldHash)) throw new Error(`id ${id} does not carry ${oldHash}`);
    return id.replace(/^cr_/, 'cr11_').replace(oldHash, newHash);
  };
}

/** Returns every generated file keyed by its path relative to the v1.1 fixture directory. */
export function buildV11Panel(root = process.cwd()): Map<string, string> {
  const readV1 = (name: string) => readFileSync(join(root, V1_DIR, name), 'utf8');
  const sequencesRaw = readV1('sequences.json');
  const splitRaw = readV1('split.json');
  const sequences = new Map((JSON.parse(sequencesRaw).sequences as Sequence[]).map(s => [s.sequence_id, s]));
  const targets = (JSON.parse(splitRaw).assignments as Assignment[]).filter(a => STRATA.includes(a.stratum));
  const rubric = readFileSync(join(root, V11_DIR, 'rubric.md'), 'utf8');
  const rubricSha = sha(rubric);

  const mapped = targets.map((assignment) => {
    const v1 = sequences.get(assignment.sequence_id);
    if (!v1) throw new Error(`missing v1 sequence ${assignment.sequence_id}`);
    const rename = renamer(v1.sequence_id);
    const next: Sequence = {
      sequence_id: rename(v1.sequence_id), family_id: rename(v1.family_id),
      owner_id: rename(v1.owner_id), project_id: rename(v1.project_id),
      observations: v1.observations.map(o => ({ ...o, memory_id: rename(o.memory_id), subject_id: rename(o.subject_id) })),
      checkpoints: v1.checkpoints.map(c => ({
        ...c, checkpoint_id: rename(c.checkpoint_id),
        scope: { owner_id: rename(c.scope.owner_id), project_id: rename(c.scope.project_id), subject_id: rename(c.scope.subject_id) },
      })),
    };
    return { assignment, v1, next };
  });

  const files = new Map<string, string>();
  for (const [reviewer, seed] of Object.entries(SEEDS)) {
    const order = shuffled(mapped, seed);
    for (const stage of STAGES) {
      const cases = order.map(({ next }) => ({
        sequence_id: next.sequence_id, family_id: next.family_id,
        ...next.checkpoints[stage - 1]!,
        evidence: next.observations.slice(0, stage * 2).map(o => ({
          evidence_id: o.memory_id, type: o.type, content: o.content,
          recorded_at: o.recorded_at, event_at: o.event_at,
          scope: { owner_id: next.owner_id, project_id: next.project_id, subject_id: o.subject_id },
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

  files.set('id-map.json', json({
    fixture_version: VERSION,
    rename_rule: `cr_<h> -> cr11_<sha256("${VERSION}:" + v1 sequence_id)[0:12]>, same hash in family/owner/project/subject/checkpoint/evidence ids`,
    sequences: mapped.map(({ assignment, v1, next }) => ({
      sequence_id: next.sequence_id, v1_sequence_id: v1.sequence_id,
      v1_stratum: assignment.stratum, v1_split: assignment.split, v1_1_split: 'dev',
      checkpoints: next.checkpoints.map((c, i) => ({ checkpoint_id: c.checkpoint_id, v1_checkpoint_id: v1.checkpoints[i]!.checkpoint_id })),
      evidence: next.observations.map((o, i) => ({ evidence_id: o.memory_id, v1_evidence_id: v1.observations[i]!.memory_id })),
    })),
  }));

  const readV11 = (name: string) => readFileSync(join(root, V11_DIR, name), 'utf8');
  files.set('manifest.json', json({
    fixture_version: VERSION,
    status: 'pending_panel',
    gold_count: 0,
    system_calls: 0,
    seeds: SEEDS,
    sources: {
      [`${V1_DIR}/sequences.json`]: sha(sequencesRaw),
      [`${V1_DIR}/split.json`]: sha(splitRaw),
      'protocol.md': sha(readV11('protocol.md')),
      'rubric.md': rubricSha,
      'registration.json': sha(readV11('registration.json')),
    },
    files: Object.fromEntries([...files].sort(([a], [b]) => a.localeCompare(b)).map(([path, body]) => [path, sha(body)])),
    dispatch_order: ['stage-1', 'seal-submissions', 'stage-2', 'seal-submissions', 'stage-3', 'seal-submissions'],
    do_not_distribute: ['parent directory', 'other reviewer', 'future stages', 'id-map.json', 'manifest.json', 'protocol.md', 'registration.json', 'consolidation-replay-v1/'],
  }));
  return files;
}

if (isMain(import.meta.url)) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  const outDir = values.out ?? V11_DIR;
  const files = buildV11Panel();
  for (const [path, body] of files) {
    const target = join(outDir, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
  }
  process.stdout.write(`${files.size} files -> ${outDir}\n`);
}
