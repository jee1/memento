import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STRATA, V2_DIR, buildV2Panel, queryFor } from '../scripts/build-consolidation-replay-v2-panel.js';

const searchQuality = join(process.cwd(), 'tests/fixtures/search-quality');
const dir = join(process.cwd(), V2_DIR);
const text = (path: string) => readFileSync(path, 'utf8');
const read = (name: string) => JSON.parse(text(join(dir, name)));
const sha = (data: string) => createHash('sha256').update(data).digest('hex');

const registration = read('registration.json');
const sequences = read('sequences.json').sequences as Array<Record<string, any>>;
const split = read('split.json').assignments as Array<{ sequence_id: string; stratum: string; split: string }>;
const v1Observations = (JSON.parse(text(join(searchQuality, 'consolidation-replay-v1/sequences.json'))).sequences as Array<Record<string, any>>)
  .flatMap(s => s.observations as Array<{ content: string; content_sha256: string }>);
const observations = sequences.flatMap(s => s.observations as Array<{ content: string; content_sha256: string; recorded_at: string; subject_id: string }>);
const distributed = ['reviewer-a', 'reviewer-b'].flatMap(reviewer =>
  [1, 2, 3].flatMap(stage => ['packet.json', 'rubric.md', 'answers.blank.json'].map(file => `${reviewer}/stage-${stage}/${file}`)),
);
const LEAK_WINDOW = 20;

describe('consolidation-replay-v2 fixture (#1624)', () => {
  it('committed files are exactly what the generator produces', () => {
    const generated = buildV2Panel();
    expect(generated.size).toBe(distributed.length + 3);
    for (const [path, body] of generated) {
      expect(text(join(dir, path)), path).toBe(body);
    }
  });

  it('registration pins protocol and rubric bytes and records no gold, calls, or author candidates', () => {
    expect(registration).toMatchObject({ status: 'registered_before_inputs', gold_count: 0, system_calls: 0, author_candidates: false });
    expect(registration.protocol_sha256).toBe(sha(text(join(dir, 'protocol.md'))));
    expect(registration.rubric_sha256).toBe(sha(text(join(dir, 'rubric.md'))));
    for (const [name, digest] of Object.entries(registration.inherited_sha256)) {
      expect(sha(text(join(searchQuality, name))), name).toBe(digest);
    }
    expect(existsSync(join(dir, 'author-candidates.json'))).toBe(false);
  });

  it('rubric v2 keeps every rubric v1.1 paragraph and only adds after it', () => {
    const v11 = text(join(searchQuality, 'consolidation-replay-v1.1/rubric.md')).replace('consolidation-replay-v1.1\n', 'consolidation-replay-v2\n');
    expect(text(join(dir, 'rubric.md')).startsWith(v11)).toBe(true);
  });

  it('has eight sequences per stratum split 1 dev and 7 test by whole sequence', () => {
    expect(sequences).toHaveLength(40);
    expect(observations).toHaveLength(240);
    expect(sequences.flatMap(s => s.checkpoints)).toHaveLength(120);
    for (const stratum of STRATA) {
      const rows = split.filter(a => a.stratum === stratum);
      expect(rows.map(r => r.split).sort(), stratum).toEqual(['dev', ...Array(7).fill('test')]);
    }
    expect(new Set(split.map(a => a.sequence_id))).toEqual(new Set(sequences.map(s => s.sequence_id)));
  });

  it('observations follow the registered length, date grid, subject and query rules', () => {
    for (const s of sequences) {
      const stratum = split.find(a => a.sequence_id === s.sequence_id)!.stratum;
      expect(s.checkpoints.map((c: any) => c.query)).toEqual(Array(3).fill(queryFor(s.subject_name)));
      s.observations.forEach((o: any, i: number) => {
        expect(o.content.length, o.content).toBeGreaterThanOrEqual(45);
        expect(o.content.length, o.content).toBeLessThanOrEqual(95);
        expect(o.content_sha256).toBe(sha(o.content));
        const day = Number(o.recorded_at.slice(8, 10));
        const mentioned = o.content.match(/10월 (\d+)일/);
        if (mentioned) expect(Number(mentioned[1]), o.content).toBe(day);
        const other = stratum === 'task_noise' && (i === 2 || i === 3);
        expect(o.subject_id.endsWith(other ? '_y' : '_x')).toBe(true);
        if (!other) expect(o.content.includes(s.subject_name), o.content).toBe(true);
      });
    }
  });

  it('shares no sentence, hash, or 20-character run with v1 and uses no v1 subject or rubric example task', () => {
    const v1Hashes = new Set(v1Observations.map(o => o.content_sha256));
    const v1Windows = new Set(v1Observations.flatMap(o => [...Array(Math.max(0, o.content.length - LEAK_WINDOW + 1)).keys()]
      .map(i => o.content.slice(i, i + LEAK_WINDOW))));
    const v1Names = (registration.excluded_subject_names as string[]).map(n => n.split(' ')[0]!);
    for (const o of observations) {
      expect(v1Hashes.has(o.content_sha256), o.content).toBe(false);
      for (let i = 0; i + LEAK_WINDOW <= o.content.length; i += 1) {
        expect(v1Windows.has(o.content.slice(i, i + LEAK_WINDOW)), o.content).toBe(false);
      }
      for (const word of [...v1Names, '토마토', '화분', '레시피', '식빵', '오븐', '수영장']) {
        expect(o.content.includes(word), `${o.content} contains ${word}`).toBe(false);
      }
    }
  });

  it.each(distributed.filter(p => p.endsWith('packet.json')))('%s is the stage prefix of every sequence', (path) => {
    const packet = read(path);
    const stage = packet.stage as number;
    expect(packet.rubric_version).toBe('consolidation-replay-v2');
    expect(packet.cases).toHaveLength(40);
    for (const c of packet.cases) {
      const s = sequences.find(x => x.sequence_id === c.sequence_id)!;
      expect(c.checkpoint_id).toBe(s.checkpoints[stage - 1].checkpoint_id);
      expect(c.evidence.map((e: any) => e.content)).toEqual(s.observations.slice(0, stage * 2).map((o: any) => o.content));
    }
  });

  it('distributed files carry no stratum or split label', () => {
    for (const path of distributed) {
      const body = text(join(dir, path));
      for (const leak of [...STRATA, '"dev"', '"test"', 'split']) {
        expect(body.includes(leak), `${path} contains ${leak}`).toBe(false);
      }
    }
  });

  it.each(distributed.filter(p => p.endsWith('answers.blank.json')))('%s is an unjudged form bound to its packet', (path) => {
    const blank = read(path);
    const packetRaw = text(join(dir, path.replace('answers.blank.json', 'packet.json')));
    expect(blank).toMatchObject({ reviewer_id: null, model: null, judged_at: null, label_source: 'agent_panel', rubric_version: 'consolidation-replay-v2' });
    expect(blank.packet_sha256).toBe(sha(packetRaw));
    expect(blank.rubric_sha256).toBe(sha(text(join(dir, 'rubric.md'))));
    expect(blank.answers.map((a: any) => a.checkpoint_id)).toEqual(JSON.parse(packetRaw).cases.map((c: any) => c.checkpoint_id));
    for (const answer of blank.answers) {
      expect(answer).toMatchObject({ status: 'pending', required_facts: [], forbidden_claims: [], relevant_evidence_refs: [], execution_evidence: 'unmeasured' });
    }
  });
});
