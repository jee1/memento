#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAgentMemoryBenchmark } from './agent-memory-benchmark.js';
import { adaptLongMemEvalS } from './agent-memory-benchmark-adapter.js';

export interface LongMemEvalJudgeResult {
  question_id: string;
  hypothesis: string;
  correct: boolean;
  cited_evidence_session_ids: string[];
  required_evidence_session_ids: string[];
  judge: {
    provider: string;
    model: string;
    prompt_version: string;
  };
}

interface ValidationOptions {
  datasetPath: string;
  outputDir: string;
  judgeResultsPath?: string;
  datasetRevision?: string;
  seed?: number;
}

interface ValidationRunSummary {
  status: 'completed' | 'partial' | 'skipped';
  reason_codes: string[];
}

export function aggregateJudgeResults(results: LongMemEvalJudgeResult[]): {
  status: 'completed';
  case_count: number;
  accuracy: number;
  evidence_coverage: number;
  judges: string[];
  prompt_versions: string[];
} {
  const correct = results.filter((result) => result.correct).length;
  let requiredEvidence = 0;
  let citedEvidence = 0;
  for (const result of results) {
    const cited = new Set(result.cited_evidence_session_ids);
    requiredEvidence += result.required_evidence_session_ids.length;
    citedEvidence += result.required_evidence_session_ids.filter(
      (sessionId) => cited.has(sessionId),
    ).length;
  }
  return {
    status: 'completed',
    case_count: results.length,
    accuracy: results.length === 0 ? 0 : correct / results.length,
    evidence_coverage: requiredEvidence === 0 ? 0 : citedEvidence / requiredEvidence,
    judges: [...new Set(results.map(
      (result) => `${result.judge.provider}/${result.judge.model}`,
    ))].sort(),
    prompt_versions: [...new Set(results.map(
      (result) => result.judge.prompt_version,
    ))].sort(),
  };
}

export function runLongMemEvalValidation(
  options: ValidationOptions,
): ValidationRunSummary {
  const datasetPath = resolve(options.datasetPath);
  const outputDir = resolve(options.outputDir);
  const judgeResultsPath = options.judgeResultsPath
    ? resolve(options.judgeResultsPath)
    : undefined;
  mkdirSync(outputDir, { recursive: true });

  if (!existsSync(datasetPath)) {
    const reasons = ['dataset_missing'];
    writeArtifacts(outputDir, {
      manifest: createManifest(options, datasetPath, false, undefined),
      results: {
        retrieval: { status: 'not_run', reason: 'dataset_missing' },
        task_completion: { status: 'not_run', reason: 'dataset_missing' },
        graph_rrf: graphRrfStatus(),
      },
      reasons,
    });
    return { status: 'skipped', reason_codes: reasons };
  }

  const report = runAgentMemoryBenchmark({
    longMemEvalSPath: datasetPath,
    graphRrf: false,
    seed: options.seed ?? 483,
  });
  const dataset = adaptLongMemEvalS(datasetPath, {
    sourceRevision: options.datasetRevision,
  });
  const judgeResults = judgeResultsPath && existsSync(judgeResultsPath)
    ? readJsonLines<LongMemEvalJudgeResult>(judgeResultsPath)
    : undefined;
  if (judgeResults) {
    assertJudgeResults(dataset.taskCases ?? [], judgeResults);
  }
  const reasons = judgeResults ? [] : ['judge_results_missing'];
  const results = {
    retrieval: {
      status: 'completed',
      evaluated_question_count: dataset.queries.length,
      excluded_abstention_count: (dataset.taskCases ?? []).filter(
        (testCase) => testCase.abstention,
      ).length,
      conditions: {
        corpus_scope: 'per-question history sessions',
        top_k: dataset.manifest.top_k,
        token_budget: dataset.manifest.token_budget,
        seed: options.seed ?? 483,
      },
      data_handling: {
        credential_like_values_redacted: dataset.manifest.redaction_count ?? 0,
        raw_dataset_vendored: false,
      },
      baselines: report.retrieval,
    },
    task_completion: judgeResults
      ? aggregateJudgeResults(judgeResults)
      : { status: 'not_run', reason: 'judge_results_missing' },
    graph_rrf: graphRrfStatus(),
  };
  writeArtifacts(outputDir, {
    manifest: createManifest(
      options,
      datasetPath,
      true,
      sha256(readFileSync(datasetPath)),
    ),
    results,
    reasons,
  });
  return {
    status: judgeResults ? 'completed' : 'partial',
    reason_codes: reasons,
  };
}

function assertJudgeResults(
  taskCases: Array<{
    id: string;
    requiredEvidenceSessionIds: string[];
  }>,
  results: LongMemEvalJudgeResult[],
): void {
  const taskById = new Map(taskCases.map((testCase) => [testCase.id, testCase]));
  const seen = new Set<string>();
  for (const result of results) {
    const task = taskById.get(result.question_id);
    if (!task) {
      throw new Error(`Judge result references unknown question: ${result.question_id}`);
    }
    if (seen.has(result.question_id)) {
      throw new Error(`Duplicate judge result: ${result.question_id}`);
    }
    if (
      JSON.stringify([...result.required_evidence_session_ids].sort())
      !== JSON.stringify([...task.requiredEvidenceSessionIds].sort())
    ) {
      throw new Error(`Judge evidence contract mismatch: ${result.question_id}`);
    }
    if (
      !result.judge.provider
      || !result.judge.model
      || result.judge.prompt_version !== 'longmemeval-v1'
    ) {
      throw new Error(`Invalid judge metadata: ${result.question_id}`);
    }
    seen.add(result.question_id);
  }
}

function createManifest(
  options: ValidationOptions,
  datasetPath: string,
  pathPresent: boolean,
  sha256Digest: string | undefined,
): Record<string, unknown> {
  return {
    schema_version: 1,
    benchmark: 'LongMemEval-S cleaned',
    status: pathPresent ? 'completed' : 'skipped',
    dataset: {
      upstream_repository: 'https://github.com/xiaowu0162/LongMemEval',
      upstream_dataset: 'https://huggingface.co/datasets/xiaowu0162/longmemeval-cleaned',
      file: 'longmemeval_s_cleaned.json',
      revision: options.datasetRevision ?? 'unrecorded',
      sha256: sha256Digest ?? null,
      path: basename(datasetPath),
      path_present: pathPresent,
      vendored: false,
      license: 'MIT upstream repository; verify the dataset card at acquisition time',
    },
    run: {
      seed: options.seed ?? 483,
      node_version: process.version,
      platform: process.platform,
      architecture: process.arch,
    },
  };
}

function graphRrfStatus(): Record<string, unknown> {
  return {
    default_enabled: false,
    reason: 'Requires a completed real-dataset gate before adoption',
  };
}

function writeArtifacts(
  outputDir: string,
  input: {
    manifest: Record<string, unknown>;
    results: Record<string, unknown>;
    reasons: string[];
  },
): void {
  const status = input.reasons.length === 0
    ? 'completed'
    : input.reasons.includes('dataset_missing') ? 'skipped' : 'partial';
  writeJson(join(outputDir, 'manifest.json'), {
    ...input.manifest,
    status,
  });
  writeJson(join(outputDir, 'results.json'), input.results);
  writeFileSync(
    join(outputDir, 'limitations.md'),
    [
      '# LongMemEval-S Validation Limitations',
      '',
      `- Run status: \`${status}\``,
      `- Reason codes: ${input.reasons.length === 0 ? 'none' : input.reasons.map((reason) => `\`${reason}\``).join(', ')}`,
      '- The LongMemEval-S source file is never committed to this repository.',
      '- Retrieval metrics and task-completion judge metrics are reported separately.',
      '- Graph-RRF remains disabled by default until a completed real-data gate passes.',
      '',
    ].join('\n'),
    'utf8',
  );
}

function readJsonLines<T>(path: string): T[] {
  const content = readFileSync(path, 'utf8').trim();
  if (!content) {
    return [];
  }
  return content.split(/\r?\n/).map((line) => JSON.parse(line) as T);
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function sha256(content: Buffer): string {
  return createHash('sha256').update(content).digest('hex');
}

function parseCli(argv: string[]): ValidationOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || !value) {
      throw new Error(`Invalid argument near ${key ?? '<end>'}`);
    }
    values.set(key, value);
  }
  return {
    datasetPath: values.get('--dataset')
      ?? join(process.cwd(), '.local/longmemeval/longmemeval_s_cleaned.json'),
    outputDir: values.get('--output-dir')
      ?? join(process.cwd(), 'artifacts/longmemeval-s/latest'),
    judgeResultsPath: values.get('--judge-results'),
    datasetRevision: values.get('--dataset-revision'),
    seed: values.has('--seed') ? Number(values.get('--seed')) : 483,
  };
}

function main(): void {
  const result = runLongMemEvalValidation(parseCli(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
