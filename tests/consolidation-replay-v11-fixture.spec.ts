import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { V11_DIR, buildV11Panel } from '../scripts/build-consolidation-replay-v11-panel.js';

const v1Dir = join(process.cwd(), 'tests/fixtures/search-quality/consolidation-replay-v1');
const dir = join(process.cwd(), V11_DIR);
const text = (path: string) => readFileSync(path, 'utf8');
const read = (name: string) => JSON.parse(text(join(dir, name)));
const sha = (data: string) => createHash('sha256').update(data).digest('hex');

const v1Sequences = new Map(
  (JSON.parse(text(join(v1Dir, 'sequences.json'))).sequences as Array<Record<string, any>>).map(s => [s.sequence_id, s]),
);
const v1Split = JSON.parse(text(join(v1Dir, 'split.json'))).assignments as Array<{ sequence_id: string; stratum: string; split: string }>;
const idMap = read('id-map.json');
const distributed = ['reviewer-a', 'reviewer-b'].flatMap(reviewer =>
  [1, 2, 3].flatMap(stage => ['packet.json', 'rubric.md', 'answers.blank.json'].map(file => `${reviewer}/stage-${stage}/${file}`)),
);

describe('consolidation-replay-v1.1 panel fixture (#1574)', () => {
  it('committed files are exactly what the generator produces', () => {
    const generated = buildV11Panel();
    expect(generated.size).toBe(distributed.length + 2);
    for (const [path, body] of generated) {
      expect(text(join(dir, path)), path).toBe(body);
    }
  });

  it('registration pins the protocol and rubric bytes and the v1 sources', () => {
    const registration = read('registration.json');
    expect(registration).toMatchObject({ status: 'rubric_registered_before_packets', v1_results_reopened: false, gold_count: 0, system_calls: 0 });
    expect(registration.protocol_sha256).toBe(sha(text(join(dir, 'protocol.md'))));
    expect(registration.rubric_sha256).toBe(sha(text(join(dir, 'rubric.md'))));
    for (const [name, digest] of Object.entries(registration.v1_source_sha256)) {
      expect(sha(text(join(v1Dir, name))), name).toBe(digest);
    }
  });

  it('rubric v1.1 keeps every v1 rubric paragraph and only adds boundaries after it', () => {
    const v1 = text(join(v1Dir, 'reviewer-a/stage-1/rubric.md')).replace('consolidation-replay-v1\n', 'consolidation-replay-v1.1\n');
    expect(text(join(dir, 'rubric.md')).startsWith(v1)).toBe(true);
  });

  it('covers all six task_noise and six source_preservation sequences, all dev in v1.1', () => {
    const expected = v1Split.filter(a => ['task_noise', 'source_preservation'].includes(a.stratum));
    expect(idMap.sequences.map((s: any) => s.v1_sequence_id).sort()).toEqual(expected.map(a => a.sequence_id).sort());
    for (const s of idMap.sequences) {
      const v1 = expected.find(a => a.sequence_id === s.v1_sequence_id)!;
      expect(s).toMatchObject({ v1_stratum: v1.stratum, v1_split: v1.split, v1_1_split: 'dev' });
    }
    expect(idMap.sequences.flatMap((s: any) => s.checkpoints)).toHaveLength(36);
  });

  it.each(distributed.filter(p => p.endsWith('packet.json')))('%s is the mapped v1 prefix with renamed ids', (path) => {
    const packet = read(path);
    const stage = packet.stage as number;
    expect(packet.rubric_version).toBe('consolidation-replay-v1.1');
    expect(packet.cases).toHaveLength(12);
    for (const c of packet.cases) {
      const map = idMap.sequences.find((s: any) => s.sequence_id === c.sequence_id);
      const v1 = v1Sequences.get(map.v1_sequence_id)!;
      const v1Checkpoint = v1.checkpoints[stage - 1];
      expect(c.checkpoint_id).toBe(map.checkpoints[stage - 1].checkpoint_id);
      expect({ after: c.after_observation, at: c.query_at, query: c.query })
        .toEqual({ after: v1Checkpoint.after_observation, at: v1Checkpoint.query_at, query: v1Checkpoint.query });
      expect(c.evidence).toHaveLength(stage * 2);
      c.evidence.forEach((e: any, i: number) => {
        const o = v1.observations[i];
        expect(e.evidence_id).toBe(map.evidence[i].evidence_id);
        expect({ content: e.content, recorded_at: e.recorded_at, event_at: e.event_at, sha256: e.sha256 })
          .toEqual({ content: o.content, recorded_at: o.recorded_at, event_at: o.event_at, sha256: o.content_sha256 });
        expect(e.scope.subject_id.split('_').at(-1)).toBe(o.subject_id.split('_').at(-1));
      });
    }
  });

  it('distributed files carry no v1 id, stratum, or split label', () => {
    const v1Hashes = idMap.sequences.map((s: any) => s.v1_sequence_id.replace(/^cr_/, ''));
    for (const path of distributed) {
      const body = text(join(dir, path));
      for (const leak of [...v1Hashes, 'task_noise', 'source_preservation', 'test_candidate', 'v1_split']) {
        expect(body.includes(leak), `${path} contains ${leak}`).toBe(false);
      }
    }
  });

  it.each(distributed.filter(p => p.endsWith('answers.blank.json')))('%s is an unjudged form bound to its packet', (path) => {
    const blank = read(path);
    const packetRaw = text(join(dir, path.replace('answers.blank.json', 'packet.json')));
    expect(blank).toMatchObject({ reviewer_id: null, model: null, judged_at: null, label_source: 'agent_panel', rubric_version: 'consolidation-replay-v1.1' });
    expect(blank.packet_sha256).toBe(sha(packetRaw));
    expect(blank.rubric_sha256).toBe(sha(text(join(dir, 'rubric.md'))));
    expect(blank.answers.map((a: any) => a.checkpoint_id)).toEqual(JSON.parse(packetRaw).cases.map((c: any) => c.checkpoint_id));
    for (const answer of blank.answers) {
      expect(answer).toMatchObject({ status: 'pending', required_facts: [], forbidden_claims: [], relevant_evidence_refs: [], execution_evidence: 'unmeasured' });
    }
  });
});
