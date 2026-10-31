/**
 * #1548: 대체 후보 3분류를 adoption-ko-panel-v1 gold 로 채점한다.
 *
 * 기본은 오프라인이다. `--verdicts <jsonl>` 은 채점만 하고 모델·DB·네트워크를 쓰지 않는다.
 * `--live` 만 judge 를 호출하며 429 를 받으면 멈추고 그때까지의 판정으로 채점한다.
 * 고정 fixture 무오류를 운영 안전성이나 자동 적용 근거로 쓰지 않는다.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import {
  SUPERSEDE_PROMPT_VERSION,
  computeSupersedeInputHash,
  judgeSupersedePair,
  type ScopedMemory,
  type SupersedeJudgeOutcome,
  type SupersedeVerdict,
} from '../packages/memento-core/src/domains/memory/supersede/supersede-judge.js';
import { isMain } from './lib/cli-runtime.js';
import { wilson95 } from './lib/rejection-sweep.js';

const DEFAULT_FIXTURE_DIR = join(process.cwd(), 'tests/fixtures/search-quality/adoption-ko-panel-v1');
const DEFAULT_STORE_PATH = join(process.cwd(), '.local/issue-1548-supersede-verdicts.jsonl');

const verdictSchema = z.enum(['confirmed', 'pending', 'compatible']);
const verdictRowSchema = z.object({
  case_id: z.string().min(1),
  verdict: verdictSchema,
  input_hash: z.string().min(1),
  provider: z.string().min(1),
  model: z.string().min(1),
  prompt_version: z.string().min(1),
});
export type VerdictRow = z.infer<typeof verdictRowSchema>;

export interface PanelDecision {
  case_id: string;
  label: 'retire' | 'retain' | 'ambiguous';
  gold: boolean;
}

interface CandidateEvidence {
  evidence_id: string;
  recorded_at: string;
  type: string;
  content: string;
}

export interface CandidateCase {
  case_id: string;
  scope: { owner: string; project: string };
  retirement_target_ref: string;
  evidence: CandidateEvidence[];
}

export interface RatioReport {
  numerator: number;
  denominator: number;
  rate: number | null;
  ci95: [number, number] | null;
  reason?: string;
}

function ratio(numerator: number, denominator: number, emptyReason: string): RatioReport {
  if (denominator === 0) {
    return { numerator, denominator, rate: null, ci95: null, reason: emptyReason };
  }
  return { numerator, denominator, rate: numerator / denominator, ci95: wilson95(numerator, denominator) };
}

export function scoreSupersedeVerdicts(
  decisions: readonly PanelDecision[],
  verdictByCaseId: ReadonlyMap<string, SupersedeVerdict>,
) {
  const positives = decisions.filter((d) => d.gold && d.label === 'retire');
  const negatives = decisions.filter((d) => d.gold && d.label === 'retain');
  const count = (rows: PanelDecision[], verdict: SupersedeVerdict) =>
    rows.filter((d) => verdictByCaseId.get(d.case_id) === verdict).length;
  const missing = (rows: PanelDecision[]) => rows.filter((d) => !verdictByCaseId.has(d.case_id)).length;

  const tp = count(positives, 'confirmed');
  const fp = count(negatives, 'confirmed');
  const pendingPositive = count(positives, 'pending');
  const pendingNegative = count(negatives, 'pending');
  const binaryCases = positives.length + negatives.length;
  const judged = binaryCases - missing(positives) - missing(negatives);
  const falseRetire = ratio(fp, negatives.length, 'empty_denominator');

  return {
    counts: {
      positive: positives.length,
      negative: negatives.length,
      excluded: decisions.length - binaryCases,
      tp,
      fp,
      fn: positives.length - tp,
      missing_positive: missing(positives),
      missing_negative: missing(negatives),
    },
    coverage: {
      judged,
      binary_cases: binaryCases,
      rate: binaryCases === 0 ? null : judged / binaryCases,
    },
    precision: ratio(tp, tp + fp, 'no_confirmed_verdicts'),
    detection: ratio(tp, positives.length, 'empty_denominator'),
    false_retire: {
      ...falseRetire,
      zero_error_upper95: fp === 0 && negatives.length > 0 ? 1 - 0.05 ** (1 / negatives.length) : null,
    },
    detection_lenient: ratio(tp + pendingPositive, positives.length, 'empty_denominator'),
    detection_loss: ratio(pendingPositive, positives.length, 'empty_denominator'),
    false_retire_lenient: ratio(fp + pendingNegative, negatives.length, 'empty_denominator'),
  };
}

export function buildCaseMemories(candidate: CandidateCase): { old: ScopedMemory; next: ScopedMemory } {
  const toMemory = (evidence: CandidateEvidence): ScopedMemory => ({
    id: evidence.evidence_id,
    content: evidence.content,
    type: evidence.type,
    ownerId: candidate.scope.owner,
    projectId: candidate.scope.project,
    privacyScope: 'private',
    createdAt: evidence.recorded_at,
  });
  const old = candidate.evidence.find((e) => e.evidence_id === candidate.retirement_target_ref);
  const next = candidate.evidence.find((e) => e.evidence_id !== candidate.retirement_target_ref);
  if (!old || !next) {
    throw new Error(`Case ${candidate.case_id} needs a retirement target and one other evidence`);
  }
  return { old: toMemory(old), next: toMemory(next) };
}

function readVerdictRows(storePath: string): VerdictRow[] {
  if (!existsSync(storePath)) {
    return [];
  }
  return readFileSync(storePath, 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => verdictRowSchema.parse(JSON.parse(line)));
}

function verdictMapFromRows(rows: readonly VerdictRow[]): Map<string, SupersedeVerdict> {
  const verdicts = new Map<string, SupersedeVerdict>();
  for (const row of rows) {
    const existing = verdicts.get(row.case_id);
    if (existing && existing !== row.verdict) {
      throw new Error(`Rows with conflicting verdicts for ${row.case_id}`);
    }
    verdicts.set(row.case_id, row.verdict);
  }
  return verdicts;
}

const sha256OfFile = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

export function evaluateFromVerdictRows(params: {
  fixtureDir: string;
  rows: readonly VerdictRow[];
  runnerGitSha: string | null;
}) {
  const candidatesPath = join(params.fixtureDir, 'candidates.json');
  const panelPath = join(params.fixtureDir, 'panel-result.json');
  const decisions = (JSON.parse(readFileSync(panelPath, 'utf8')) as { decisions: PanelDecision[] }).decisions;
  const unique = (values: string[]) => [...new Set(values)].sort();
  return {
    schema_version: 1,
    inputs: { candidates_sha256: sha256OfFile(candidatesPath), panel_result_sha256: sha256OfFile(panelPath) },
    runner_git_sha: params.runnerGitSha,
    prompt_versions: unique(params.rows.map((r) => r.prompt_version)),
    providers_models: unique(params.rows.map((r) => `${r.provider}/${r.model}`)),
    score: scoreSupersedeVerdicts(decisions, verdictMapFromRows(params.rows)),
  };
}

export async function collectLiveVerdicts(params: {
  cases: readonly CandidateCase[];
  judge: (old: ScopedMemory, next: ScopedMemory) => Promise<SupersedeJudgeOutcome>;
  provider: string;
  model: string;
  promptVersion: string;
  storePath: string;
}): Promise<{ verdicts: Map<string, SupersedeVerdict>; rows: VerdictRow[]; stoppedByRateLimit: boolean }> {
  const stored = readVerdictRows(params.storePath);
  const byHash = new Map(stored.map((row) => [row.input_hash, row]));
  const rows: VerdictRow[] = [];
  mkdirSync(dirname(params.storePath), { recursive: true });

  for (const candidate of params.cases) {
    const { old, next } = buildCaseMemories(candidate);
    const inputHash = computeSupersedeInputHash({
      promptVersion: params.promptVersion,
      provider: params.provider,
      model: params.model,
      old,
      next,
    });
    const resumed = byHash.get(inputHash);
    if (resumed) {
      rows.push(resumed);
      continue;
    }
    const outcome = await params.judge(old, next);
    if (outcome.kind === 'rate_limited') {
      return { verdicts: verdictMapFromRows(rows), rows, stoppedByRateLimit: true };
    }
    if (outcome.kind === 'failed') {
      continue;
    }
    const row: VerdictRow = {
      case_id: candidate.case_id,
      verdict: outcome.judgment.verdict,
      input_hash: inputHash,
      provider: params.provider,
      model: params.model,
      prompt_version: params.promptVersion,
    };
    appendFileSync(params.storePath, `${JSON.stringify(row)}\n`);
    rows.push(row);
  }
  return { verdicts: verdictMapFromRows(rows), rows, stoppedByRateLimit: false };
}

function gitSha(): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      verdicts: { type: 'string' },
      live: { type: 'boolean', default: false },
      fixture: { type: 'string', default: DEFAULT_FIXTURE_DIR },
      store: { type: 'string', default: DEFAULT_STORE_PATH },
    },
  });
  if (values.live === (values.verdicts !== undefined)) {
    throw new Error('Pass exactly one of --verdicts <jsonl> or --live');
  }
  const fixtureDir = values.fixture!;
  let rows: VerdictRow[];
  let stoppedByRateLimit = false;

  if (values.verdicts !== undefined) {
    rows = readVerdictRows(values.verdicts);
  } else {
    const { resolveSupersedeLlm } = await import(
      '../packages/memento-core/src/domains/memory/supersede/supersede-llm-resolver.js'
    );
    const llm = await resolveSupersedeLlm();
    if (!llm) {
      throw new Error('No LLM client is configured for the selected provider');
    }
    const decisions = (JSON.parse(readFileSync(join(fixtureDir, 'panel-result.json'), 'utf8')) as {
      decisions: PanelDecision[];
    }).decisions;
    const binaryIds = new Set(decisions.filter((d) => d.gold && d.label !== 'ambiguous').map((d) => d.case_id));
    const cases = (JSON.parse(readFileSync(join(fixtureDir, 'candidates.json'), 'utf8')) as {
      cases: CandidateCase[];
    }).cases.filter((c) => binaryIds.has(c.case_id));
    const collected = await collectLiveVerdicts({
      cases,
      judge: (old, next) => judgeSupersedePair(llm.port, llm.model, old, next),
      provider: llm.port.provider,
      model: llm.model,
      promptVersion: SUPERSEDE_PROMPT_VERSION,
      storePath: values.store!,
    });
    rows = collected.rows;
    stoppedByRateLimit = collected.stoppedByRateLimit;
  }

  const report = evaluateFromVerdictRows({ fixtureDir, rows, runnerGitSha: gitSha() });
  process.stdout.write(`${JSON.stringify({ ...report, stopped_by_rate_limit: stoppedByRateLimit }, null, 2)}\n`);
}

if (isMain(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
