/** #1545: offline consent aggregation; never calls a model or changes memories. */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { isMain } from './lib/cli-runtime.js';

const label = z.enum(['retire', 'retain', 'ambiguous']);
const answerSchema = z.object({
  case_id: z.string().min(1), label,
  expected_outcome: z.string().trim().min(1),
  forbidden_outcome: z.string().trim().min(1),
  rationale: z.string().trim().min(1),
  evidence_refs: z.array(z.string()),
  relevant_evidence_refs: z.array(z.string()).min(1),
  hold_reason: z.string().nullable(),
  execution_evidence: z.literal('unmeasured'),
}).strict();
const submissionSchema = z.object({
  reviewer_id: z.string().min(1), model: z.string().min(1),
  judged_at: z.iso.datetime(), rubric_version: z.string().min(1),
  label_source: z.literal('agent_panel'), data_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  answers: z.array(answerSchema),
}).strict();
const inputSchema = z.object({
  rubric_version: z.string().min(1),
  cases: z.array(z.object({
    case_id: z.string().min(1), retirement_target_ref: z.string().min(1),
    evidence: z.array(z.object({ evidence_id: z.string().min(1) }).passthrough()),
  }).passthrough()).min(1),
}).strict();
const reviewSchema = z.object({
  reviewed_by: z.string().min(1), role: z.literal('contract_comparison_only'),
  label_authoring: z.literal(false),
  input_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  submission_sha256: z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/)),
  cases: z.array(z.object({
    case_id: z.string().min(1), stratum: z.string().min(1),
    contract_agreement: z.boolean(), note: z.string().trim().min(1),
  }).strict()),
}).strict();

function uniqueById<T extends { case_id: string }>(rows: T[]): Map<string, T> {
  const indexed = new Map(rows.map(row => [row.case_id, row]));
  if (indexed.size !== rows.length) throw new Error('Duplicate case_id');
  return indexed;
}

export function aggregateAdoptionPanel(input: unknown, judgments: unknown, comparison: unknown) {
  const candidates = inputSchema.parse(input);
  const submissions = z.tuple([submissionSchema, submissionSchema]).parse(judgments);
  const review = reviewSchema.parse(comparison);
  const cases = uniqueById(candidates.cases);
  const contracts = uniqueById(review.cases);
  if (contracts.size !== cases.size || [...contracts.keys()].some(id => !cases.has(id))) {
    throw new Error('Contract review must cover every case exactly once');
  }
  if (submissions[0].reviewer_id === submissions[1].reviewer_id || submissions[0].model === submissions[1].model) {
    throw new Error('Two distinct reviewers and models are required');
  }
  const answers = submissions.map(submission => {
    if (submission.rubric_version !== candidates.rubric_version) throw new Error('Rubric mismatch');
    const indexed = uniqueById(submission.answers);
    for (const answer of submission.answers) {
      const candidate = cases.get(answer.case_id);
      if (!candidate) throw new Error('Unknown judgment case_id');
      const refs = new Set(candidate.evidence.map(e => e.evidence_id));
      if (![...answer.evidence_refs, ...answer.relevant_evidence_refs].every(ref => refs.has(ref))) {
        throw new Error('Unknown evidence reference');
      }
      if (answer.label === 'retire' && answer.evidence_refs.length === 0) throw new Error('Retirement requires evidence');
    }
    return indexed;
  });
  const decisions = candidates.cases.map(candidate => {
    const a = answers[0]!.get(candidate.case_id);
    const b = answers[1]!.get(candidate.case_id);
    const contract = contracts.get(candidate.case_id)!;
    const hold_reasons: string[] = [];
    if (!a || !b) hold_reasons.push('missing_judgment');
    else {
      if (a.label !== b.label) hold_reasons.push('label_disagreement');
      if (a.label === 'ambiguous' || b.label === 'ambiguous') hold_reasons.push('panel_ambiguous');
    }
    if (!contract.contract_agreement) hold_reasons.push('contract_disagreement');
    const gold = hold_reasons.length === 0;
    const decidedLabel: z.infer<typeof label> = gold ? a!.label : 'ambiguous';
    const relevant = gold && a && b &&
      JSON.stringify([...new Set(a.relevant_evidence_refs)].sort()) ===
      JSON.stringify([...new Set(b.relevant_evidence_refs)].sort())
      ? [...new Set(a.relevant_evidence_refs)].sort() : null;
    return {
      case_id: candidate.case_id, label: decidedLabel, gold,
      label_agreement: !!a && !!b && a.label === b.label,
      hold_reasons, relevant_evidence_refs: relevant,
      // Keep both submitted contracts verbatim; the implementer does not write a third answer.
      judgments: submissions.map((s, i) => ({ reviewer_id: s.reviewer_id, answer: answers[i]!.get(candidate.case_id) ?? null })),
    };
  });
  const ground_truth = decisions.flatMap(d => d.relevant_evidence_refs ? [{
    queryId: d.case_id, relevantIds: d.relevant_evidence_refs,
    // A retained memory may contain a corrected claim; it is not a wholly stale document.
    ...(d.label === 'retire' ? { staleIds: [cases.get(d.case_id)!.retirement_target_ref] } : {}),
  }] : []);
  const labels = { retire: 0, retain: 0, ambiguous: 0 };
  for (const decision of decisions) labels[decision.label]++;
  return {
    label_source: 'agent_panel',
    summary: {
      total: decisions.length, label_agreement: decisions.filter(d => d.label_agreement).length,
      gold_count: decisions.filter(d => d.gold).length, labels,
      retrieval_gold_count: ground_truth.length, retrieval_held_count: decisions.length - ground_truth.length,
    },
    decisions, ground_truth,
  };
}

if (isMain(import.meta.url)) {
  const dir = join(process.cwd(), 'tests/fixtures/search-quality/adoption-ko-panel-v1');
  const read = (name: string) => readFileSync(join(dir, name), 'utf8');
  const review = reviewSchema.parse(JSON.parse(read('contract-review.json')));
  if (createHash('sha256').update(read('candidates.json')).digest('hex') !== review.input_sha256) {
    throw new Error('Contract review input SHA mismatch');
  }
  const submissions = ['reviewer-a', 'reviewer-b'].map(who => {
    const raw = read(`${who}/answers.json`);
    if (createHash('sha256').update(raw).digest('hex') !== review.submission_sha256[who]) {
      throw new Error('Contract review submission SHA mismatch');
    }
    const submission = submissionSchema.parse(JSON.parse(raw));
    if (createHash('sha256').update(read(`${who}/packet.json`)).digest('hex') !== submission.data_sha256) {
      throw new Error('Judgment packet SHA mismatch');
    }
    return submission;
  });
  process.stdout.write(`${JSON.stringify(aggregateAdoptionPanel(JSON.parse(read('candidates.json')), submissions, review), null, 2)}\n`);
}
