import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { aggregateV2Panel } from '../scripts/aggregate-consolidation-replay-v2-panel.js';
import { ADJ_INPUT_DIR, buildV2Adjudication, checkV2Adjudication } from '../scripts/build-consolidation-replay-v2-adjudication.js';
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

describe('consolidation-replay-v2 adjudication input (#1624)', () => {
  const generated = buildV2Adjudication();
  const bundles = [...new Set([...generated.keys()].map(k => k.split('/')[0]!))];

  it('committed input is exactly what the builder produces, six bundles of twenty covering all 120 checkpoints', () => {
    for (const [path, body] of generated) {
      expect(text(join(dir, ADJ_INPUT_DIR, path)), path).toBe(body);
    }
    expect(bundles).toEqual(['stage-1-part-1', 'stage-1-part-2', 'stage-2-part-1', 'stage-2-part-2', 'stage-3-part-1', 'stage-3-part-2']);
    const ids = bundles.flatMap(b => JSON.parse(generated.get(`${b}/adjudication-input.json`)!).cases.map((c: any) => c.checkpoint_id));
    expect(ids).toHaveLength(120);
    expect(new Set(ids)).toEqual(new Set(sequences.flatMap(s => s.checkpoints.map((c: any) => c.checkpoint_id))));
  });

  it('sealed submissions match their seals and their distributed inputs', () => {
    for (const stage of [1, 2, 3]) {
      for (const reviewer of ['a', 'b']) {
        const base = `adjudication/seals/stage${stage}-${reviewer}`;
        const raw = text(join(dir, `adjudication/stage${stage}-${reviewer}-answers.sealed.json`));
        expect(sha(raw)).toBe(text(join(dir, `${base}-submission.sha256`)).split(/\s+/)[0]);
        const inputs = Object.fromEntries(text(join(dir, `${base}-input.sha256`)).trim().split('\n').map(l => l.split(/\s+/).reverse()));
        for (const file of ['packet.json', 'rubric.md', 'answers.blank.json']) {
          expect(inputs[file], `${base} ${file}`).toBe(sha(text(join(dir, `reviewer-${reviewer}/stage-${stage}/${file}`))));
        }
      }
    }
  });

  it('names judges only as A and B and leaks no stratum, split, or judge identity', () => {
    for (const [path, body] of [...generated].filter(([path]) => path.endsWith('adjudication-input.json'))) {
      for (const leak of [...STRATA, 'reviewer_id', '"model"', 'judged_at', 'split', 'inputs.source', 'composer', 'claude', 'opus']) {
        expect(body.toLowerCase().includes(leak), `${path} contains ${leak}`).toBe(false);
      }
    }
  });

  describe('checker', () => {
    const inputRaw = generated.get('stage-1-part-1/adjudication-input.json')!;
    const input = JSON.parse(inputRaw);
    /** Every fact on its own row: a fact only one contract requires splits the verdicts, so agreement is false. */
    const filled = () => ({
      ...JSON.parse(generated.get('stage-1-part-1/adjudication.blank.json')!),
      adjudicator_id: 'adj-test', model: 'test', adjudicated_at: '2026-11-03T00:00:00Z',
      cases: input.cases.map((c: any) => {
        const rows = [
          ...c.contract_a.required_facts.map((f: any, i: number) => ({ row: `a${i + 1}`, a: [f.fact_key], b: [] })),
          ...c.contract_b.required_facts.map((f: any, i: number) => ({ row: `b${i + 1}`, a: [], b: [f.fact_key] })),
        ];
        return {
          checkpoint_id: c.checkpoint_id, contract_agreement: false, fact_alignment: rows,
          probes: [
            { probe: 'P_A', target: null, verdict_a: 'pass', verdict_b: 'pass' },
            { probe: 'P_B', target: null, verdict_a: 'pass', verdict_b: 'pass' },
            ...rows.map(r => ({ probe: 'P_omit', target: r.row, verdict_a: r.a.length ? 'fail' : 'pass', verdict_b: r.b.length ? 'fail' : 'pass' })),
            ...c.contract_a.forbidden_claims.map((_: unknown, i: number) => ({ probe: 'P_assert', target: `A.fc${i + 1}`, verdict_a: 'fail', verdict_b: 'fail' })),
            ...c.contract_b.forbidden_claims.map((_: unknown, i: number) => ({ probe: 'P_assert', target: `B.fc${i + 1}`, verdict_a: 'fail', verdict_b: 'fail' })),
          ],
          boundaries_applied: [], rationale: 'test',
        };
      }),
    });

    it('accepts a complete record and rejects the blank form', () => {
      expect(checkV2Adjudication(inputRaw, JSON.stringify(filled()))).toEqual([]);
      expect(checkV2Adjudication(inputRaw, generated.get('stage-1-part-1/adjudication.blank.json')!).length).toBeGreaterThan(0);
    });

    it('rejects agreement that contradicts the probes', () => {
      const bad = filled();
      bad.cases[0].contract_agreement = true;
      expect(checkV2Adjudication(inputRaw, JSON.stringify(bad))).toEqual([
        `adj-test ${bad.cases[0].checkpoint_id}: contract_agreement=true but probes diverge`,
      ]);
    });

    it('rejects an alignment that drops a fact or a P_omit that skips a row', () => {
      const dropped = filled();
      dropped.cases[0].fact_alignment.pop();
      expect(checkV2Adjudication(inputRaw, JSON.stringify(dropped)).join('\n')).toMatch(/does not cover every B fact_key|one P_omit per fact_alignment row/);
      const skipped = filled();
      skipped.cases[1].probes = skipped.cases[1].probes.filter((p: any) => p.target !== 'a1');
      expect(checkV2Adjudication(inputRaw, JSON.stringify(skipped))).toEqual([`${skipped.cases[1].checkpoint_id}: needs exactly one P_omit per fact_alignment row`]);
    });
  });
});

describe('consolidation-replay-v2 panel result (#1624)', () => {
  const { pins, result } = aggregateV2Panel();
  const inputs = new Map(['1', '2', '3'].flatMap(stage => ['1', '2'].flatMap(part =>
    JSON.parse(text(join(dir, ADJ_INPUT_DIR, `stage-${stage}-part-${part}/adjudication-input.json`))).cases.map((c: any) => [c.checkpoint_id, c]))));

  it('committed panel result and pins are the aggregation of the sealed adjudications', () => {
    expect(read('panel-result.json')).toEqual(result);
    expect(read('adjudication/source-pins.json')).toEqual(pins);
    expect(Object.keys(pins)).toHaveLength(12);
  });

  it('gold needs both judges resolved and both adjudicators true; evidence freezes only on gold with equal sets', () => {
    for (const d of result.decisions) {
      const c = inputs.get(d.checkpoint_id);
      const resolved = c.contract_a.status === 'resolved' && c.contract_b.status === 'resolved';
      expect(d.contract_gold).toBe(resolved && d.adjudicator_approvals.every(Boolean));
      const same = [...new Set<string>(c.contract_a.relevant_evidence_refs)].sort().join() === [...new Set<string>(c.contract_b.relevant_evidence_refs)].sort().join();
      expect(d.relevant_evidence_agreement).toBe(same);
      expect(d.relevant_evidence_refs === null).toBe(!(d.contract_gold && same));
    }
    expect(result.decisions.some(d => d.contract_gold && !d.relevant_evidence_agreement)).toBe(true);
  });

  it('reports G1 on gold alone against the registered floor', () => {
    const perStratum = result.strata.map(s => s.test_complete_sequences);
    expect(result.summary.g1_gold_only.passes).toBe(result.summary.test_complete_sequences >= 16 && perStratum.every(n => n >= 2));
    expect(result.strata.map(s => s.test_planned_sequences)).toEqual([7, 7, 7, 7, 7]);
  });
});
