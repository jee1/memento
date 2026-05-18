#!/usr/bin/env node
import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DEFAULT_TUNE_DIR = join(ROOT, 'tmp/tune-weights');

function parseReportArgs(argv: string[]): { runDir?: string } {
  let runDir: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--run-dir' && argv[i + 1]) {
      runDir = argv[++i]!;
    }
  }
  return { runDir };
}

function findLatestRunDir(tuneDir: string): string | null {
  if (!existsSync(tuneDir)) return null;
  const entries = readdirSync(tuneDir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('run-'))
    .sort((a, b) => {
      const seedA = parseInt(a.name.slice(4), 10);
      const seedB = parseInt(b.name.slice(4), 10);
      if (!isNaN(seedA) && !isNaN(seedB)) return seedB - seedA;
      return b.name.localeCompare(a.name);
    });
  const latest = entries[0];
  return latest ? join(tuneDir, latest.name) : null;
}

interface TopCandidate {
  rank: number;
  candidate_index: number;
  composite_score: number;
  mrr: number;
  ndcg_at_10: number;
  recall_at_10: number;
  p95_latency_ms: number;
  gate_passed: boolean;
  sum_warning: boolean;
}

interface Summary {
  seed: number;
  candidates_evaluated: number;
  candidates_rejected: number;
  candidates_with_sum_warning: number;
  baseline_composite_score: number | null;
  best_composite_score: number | null;
  best_candidate_index: number | null;
  best_toml_path: string | null;
  mrr_p_value: number;
  mrr_significant: boolean;
  mrr_verdict: string;
  top_candidates: TopCandidate[];
}

async function main(): Promise<void> {
  const { runDir: explicitRunDir } = parseReportArgs(process.argv.slice(2));

  const runDir = explicitRunDir ?? findLatestRunDir(DEFAULT_TUNE_DIR);
  if (!runDir) {
    console.error(
      'No run directory found. Run `npm run quality:benchmark:tune-weights` first or specify --run-dir <path>.',
    );
    process.exit(1);
  }

  const summaryPath = join(runDir, 'summary.json');
  if (!existsSync(summaryPath)) {
    console.error(`summary.json not found in ${runDir}`);
    process.exit(1);
  }

  let summary: Summary;
  try {
    summary = JSON.parse(readFileSync(summaryPath, 'utf-8'));
  } catch {
    console.error(`Failed to parse summary.json in ${runDir}: invalid JSON`);
    process.exit(1);
  }

  console.log('=== Tuning Run Report ===');
  console.log(`Seed:                    ${summary.seed}`);
  console.log(
    `Candidates:              ${summary.candidates_evaluated} evaluated, ${summary.candidates_rejected} rejected`,
  );
  console.log(`Sum warnings:            ${summary.candidates_with_sum_warning}`);
  console.log(
    `Baseline composite score: ${summary.baseline_composite_score?.toFixed(4) ?? 'N/A'}`,
  );
  console.log(
    `Best composite score:    ${summary.best_composite_score?.toFixed(4) ?? 'N/A'}`,
  );
  console.log(`MRR p-value:             ${summary.mrr_p_value?.toFixed(4) ?? 'N/A'}`);
  console.log(`MRR significant:         ${summary.mrr_significant}`);
  console.log(`MRR verdict:             ${summary.mrr_verdict}`);
  console.log('');

  if (summary.best_composite_score == null) {
    console.log(`⚠ No candidates passed gate (mrr_verdict: ${summary.mrr_verdict})`);
    if (summary.top_candidates?.length > 0) {
      console.log('(Gate-rejected candidates by composite score, for reference:)');
    }
  }

  if (summary.top_candidates?.length > 0) {
    console.table(
      summary.top_candidates.map((c) => ({
        rank: c.rank,
        candidate_index: c.candidate_index,
        composite_score: c.composite_score?.toFixed(4),
        mrr: c.mrr?.toFixed(4),
        ndcg_at_10: c.ndcg_at_10?.toFixed(4),
        recall_at_10: c.recall_at_10?.toFixed(4),
        p95_latency_ms: c.p95_latency_ms?.toFixed(1),
        sum_warning: c.sum_warning,
      })),
    );
  }

  if (summary.best_toml_path) {
    console.log('');
    console.log(`Best candidate TOML: ${summary.best_toml_path}`);
    console.log(
      'To apply: copy TOML content to config/ranking-weights.toml and sync config/ranking-profiles/default.toml',
    );
  }
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1] ?? '')
) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
