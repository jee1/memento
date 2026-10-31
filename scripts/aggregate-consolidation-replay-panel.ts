/** #1553: offline aggregation of sealed judgments; no model calls or memory writes. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { isMain } from './lib/cli-runtime.js';

const sha = (raw: Buffer) => createHash('sha256').update(raw).digest('hex');
const reviewSchema = z.object({
  reviewed_by: z.string().min(1), role: z.literal('human_contract_comparison_only'),
  label_authoring: z.literal(false), input_audit_sha256: z.string().length(64),
  protocol_sha256: z.string().length(64),
  cases: z.array(z.object({
    checkpoint_id: z.string(), contract_agreement: z.boolean(),
    required_facts_comparison: z.string().min(1), forbidden_claims_comparison: z.string().min(1),
    note: z.string().min(1),
  }).strict()).length(90),
}).strict();
const auditSchema = z.object({
  protocol_sha256: z.string().length(64),
  decisions: z.array(z.object({
    checkpoint_id: z.string(), sequence_id: z.string(), stage: z.number().int().min(1).max(3),
    split: z.enum(['dev', 'test_candidate']), status_pair_resolved: z.boolean(),
    relevant_evidence_agreement: z.boolean(),
    judgments: z.object({ a: z.object({ answer: z.object({
      relevant_evidence_refs: z.array(z.string()).min(1),
    }).passthrough() }).passthrough(), b: z.object({ answer: z.object({
      relevant_evidence_refs: z.array(z.string()).min(1),
    }).passthrough() }).passthrough() }),
  }).passthrough()).length(90),
}).passthrough();

function unique<T extends { checkpoint_id: string }>(rows: T[]) {
  const indexed = new Map(rows.map(r => [r.checkpoint_id, r]));
  if (indexed.size !== rows.length) throw new Error('Duplicate checkpoint_id');
  return indexed;
}

export function aggregateReplayPanel(auditInput: unknown, reviewInputs: unknown, auditSha: string) {
  const audit = auditSchema.parse(auditInput);
  const reviews = z.tuple([reviewSchema, reviewSchema]).parse(reviewInputs);
  const cases = unique(audit.decisions);
  if (reviews[0].reviewed_by === reviews[1].reviewed_by) throw new Error('Distinct adjudicators required');
  const indexed = reviews.map(review => {
    if (review.input_audit_sha256 !== auditSha || review.protocol_sha256 !== audit.protocol_sha256) {
      throw new Error('Adjudication source SHA mismatch');
    }
    const byId = unique(review.cases);
    if ([...byId.keys()].some(id => !cases.has(id))) throw new Error('Unknown checkpoint_id');
    return byId;
  });
  const decisions = audit.decisions.map(c => {
    const approvals = indexed.map(r => r.get(c.checkpoint_id)!.contract_agreement);
    const contractGold = c.status_pair_resolved && approvals.every(v => v === true);
    const aRefs = [...new Set(c.judgments.a.answer.relevant_evidence_refs)].sort();
    const bRefs = [...new Set(c.judgments.b.answer.relevant_evidence_refs)].sort();
    const sameRefs = JSON.stringify(aRefs) === JSON.stringify(bRefs);
    if (sameRefs !== c.relevant_evidence_agreement) throw new Error('Evidence agreement audit mismatch');
    return {
      checkpoint_id: c.checkpoint_id, sequence_id: c.sequence_id, stage: c.stage, split: c.split,
      adjudicator_approvals: approvals, contract_gold: contractGold,
      hold_reasons: contractGold ? [] : ['adjudicator_intersection_not_satisfied'],
      relevant_evidence_refs: contractGold && sameRefs ? aRefs : null,
      // Preserve both equivalent submitted contracts by reference, without authoring a third answer.
      contracts: contractGold ? Object.fromEntries(['a', 'b'].map(who => [who, {
        submission: `adjudication/stage${c.stage}-${who}-answers.sealed.json`, checkpoint_id: c.checkpoint_id,
      }])) : null,
    };
  });
  const sequences = [...new Set(decisions.map(d => d.sequence_id))].map(sequenceId => {
    const rows = decisions.filter(d => d.sequence_id === sequenceId);
    if (rows.length !== 3 || new Set(rows.map(d => d.stage)).size !== 3 ||
        new Set(rows.map(d => d.split)).size !== 1) throw new Error('Incomplete sequence audit');
    return { sequence_id: sequenceId, split: rows[0]!.split,
      complete: rows.every(d => d.contract_gold),
      held_checkpoints: rows.filter(d => !d.contract_gold).map(d => d.checkpoint_id) };
  });
  const test = sequences.filter(s => s.split === 'test_candidate');
  const dev = sequences.filter(s => s.split === 'dev');
  return {
    label_source: 'agent_panel', human_gold: false, same_vendor_adjudicators: true,
    summary: { checkpoints: decisions.length, contract_gold: decisions.filter(d => d.contract_gold).length,
      held: decisions.filter(d => !d.contract_gold).length,
      retrieval_gold: decisions.filter(d => d.relevant_evidence_refs !== null).length,
      complete_dev: dev.filter(s => s.complete).length, planned_dev: dev.length,
      complete_test: test.filter(s => s.complete).length, planned_test: test.length },
    decisions, sequences,
  };
}

if (isMain(import.meta.url)) {
  const root = join(process.cwd(), 'tests/fixtures/search-quality/consolidation-replay-v1');
  const raw = (name: string) => readFileSync(join(root, 'adjudication', name));
  const pins = JSON.parse(raw('source-pins.json').toString()) as Record<string, string>;
  for (const [name, expected] of Object.entries(pins)) {
    if (sha(raw(name)) !== expected) throw new Error(`Sealed source SHA mismatch: ${name}`);
  }
  const audit = raw('panel-audit.json');
  process.stdout.write(`${JSON.stringify(aggregateReplayPanel(JSON.parse(audit.toString()),
    ['m5', 'm2'].map(who => JSON.parse(raw(`adj-${who}.sealed.json`).toString())), sha(audit)), null, 2)}\n`);
}
