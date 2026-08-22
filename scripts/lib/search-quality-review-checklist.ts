import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  loadBenchmarkCorpus,
  loadBenchmarkGroundTruth,
  loadBenchmarkManifest,
  loadBenchmarkQueries,
  type BenchmarkCorpusEntry,
  type BenchmarkQuery,
} from '@memento/core/domains/monitoring/services/quality-assurance/search-quality-benchmark-fixtures.js';
import type { GroundTruth } from '@memento/core/domains/monitoring/services/quality-assurance/search-quality-metrics.js';

export interface LabelCandidateEntry {
  query_id: string;
  query: string;
  candidate_benchmark_ids: string[];
}

function loadLabelCandidates(benchmarkDir: string): LabelCandidateEntry[] {
  const filePath = join(benchmarkDir, 'label-candidates.json');
  if (!existsSync(filePath)) {
    return [];
  }

  const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error('Invalid label candidates: expected an array');
  }

  return parsed as LabelCandidateEntry[];
}

function summarizeContent(content: string, maxLength = 160): string {
  const normalized = content.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 1)}…`;
}

function findGroundTruth(query: BenchmarkQuery, groundTruths: GroundTruth[]): GroundTruth | undefined {
  return groundTruths.find((groundTruth) =>
    groundTruth.queryId === query.query || groundTruth.queryId === query.query_id
  );
}

function renderCandidate(entry: BenchmarkCorpusEntry | undefined, benchmarkId: string): string[] {
  if (!entry) {
    return [
      `- [ ] \`${benchmarkId}\``,
      '  - source: `(missing from corpus)`',
    ];
  }

  return [
    `- [ ] \`${entry.benchmark_id}\``,
    `  - source: \`${entry.source_memory_id}\``,
    `  - type: \`${entry.type}\``,
    `  - tags: ${entry.tags && entry.tags.length > 0 ? entry.tags.map((tag) => `\`${tag}\``).join(', ') : '(none)'}`,
    `  - content: ${summarizeContent(entry.content)}`,
  ];
}

function renderRelevantEntry(entry: BenchmarkCorpusEntry | undefined, benchmarkId: string): string[] {
  if (!entry) {
    return [
      `- [x] \`${benchmarkId}\``,
      '  - source: `(missing from corpus)`',
    ];
  }

  return [
    `- [x] \`${entry.benchmark_id}\``,
    `  - source: \`${entry.source_memory_id}\``,
    `  - type: \`${entry.type}\``,
    `  - tags: ${entry.tags && entry.tags.length > 0 ? entry.tags.map((tag) => `\`${tag}\``).join(', ') : '(none)'}`,
    `  - content: ${summarizeContent(entry.content)}`,
  ];
}

export function buildReviewChecklistMarkdown(benchmarkDir: string): string {
  const manifest = loadBenchmarkManifest(benchmarkDir);
  const queries = loadBenchmarkQueries(benchmarkDir);
  const groundTruths = loadBenchmarkGroundTruth(benchmarkDir);
  const labelCandidates = loadLabelCandidates(benchmarkDir);
  const corpus = loadBenchmarkCorpus(benchmarkDir);

  const corpusByBenchmarkId = new Map(corpus.map((entry) => [entry.benchmark_id, entry]));
  const candidatesByQueryId = new Map(labelCandidates.map((entry) => [entry.query_id, entry]));

  const lines: string[] = [
    '# Search Quality Benchmark Review Checklist',
    '',
    `- Benchmark version: \`${manifest.benchmark_version}\``,
    `- Reviewed flag: \`${manifest.ground_truth_reviewed === true ? 'true' : 'false'}\``,
    '',
    '## Review Rules',
    '',
    '- relevant: 이 기억이 실제 답변 품질을 올리면 선택',
    '- not relevant: 키워드는 비슷하지만 답변에 도움되지 않으면 제외',
    '- 검토 후 `ground-truth.json`을 수정하고 verify 스크립트를 실행',
    '',
  ];

  for (const query of queries) {
    const groundTruth = findGroundTruth(query, groundTruths);
    const relevantIds = groundTruth?.relevantIds ?? [];
    const candidateEntry = candidatesByQueryId.get(query.query_id);

    lines.push(`## Query ${query.query_id}`);
    lines.push('');
    lines.push(`- Query: \`${query.query}\``);
    if (query.language) lines.push(`- Language: \`${query.language}\``);
    if (query.category) lines.push(`- Category: \`${query.category}\``);
    if (query.notes) lines.push(`- Notes: ${query.notes}`);
    lines.push(`- Current relevant IDs: ${relevantIds.length > 0 ? relevantIds.map((id) => `\`${id}\``).join(', ') : '(none)'}`);
    lines.push('');
    lines.push('### Current Relevant Memories');
    lines.push('');

    for (const relevantId of relevantIds) {
      lines.push(...renderRelevantEntry(corpusByBenchmarkId.get(relevantId), relevantId));
    }

    if (relevantIds.length === 0) {
      lines.push('- (none)');
    }

    lines.push('');
    lines.push('### Candidate Memories');
    lines.push('');

    for (const benchmarkId of candidateEntry?.candidate_benchmark_ids ?? []) {
      lines.push(...renderCandidate(corpusByBenchmarkId.get(benchmarkId), benchmarkId));
    }

    if (!candidateEntry || candidateEntry.candidate_benchmark_ids.length === 0) {
      lines.push('- (no candidates)');
    }

    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}
