export interface BenchmarkCorpusEntry {
  benchmark_id: string;
  source_memory_id: string;
  type: string;
  tags: string[];
  created_at?: string;
  content: string;
}

export interface BenchmarkSourceMemory {
  id: string;
  type: string;
  content: string;
  tags?: string[] | string | null;
  created_at?: string | null;
}

function extractBenchmarkSequence(benchmarkId: string): number | null {
  const match = benchmarkId.match(/^bench_mem_(\d+)$/);
  return match ? parseInt(match[1], 10) : null;
}

function normalizeTags(tags?: string[] | string | null): string[] {
  if (Array.isArray(tags)) {
    return tags.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0);
  }

  if (typeof tags !== 'string' || tags.trim().length === 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(tags) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0);
    }
  } catch {
    return [];
  }

  return [];
}

export function buildBenchmarkCorpus(
  rows: BenchmarkSourceMemory[],
  existingCorpus: BenchmarkCorpusEntry[] = []
): BenchmarkCorpusEntry[] {
  const corpus: BenchmarkCorpusEntry[] = [];
  const existingBySourceId = new Map(existingCorpus.map((entry) => [entry.source_memory_id, entry]));
  const usedBenchmarkIds = new Set(existingCorpus.map((entry) => entry.benchmark_id));
  let nextSequence =
    existingCorpus.reduce((max, entry) => Math.max(max, extractBenchmarkSequence(entry.benchmark_id) ?? 0), 0) + 1;

  for (const row of rows) {
    if (row.content.trim().length === 0) {
      continue;
    }

    const existingEntry = existingBySourceId.get(row.id);
    let benchmarkId = existingEntry?.benchmark_id;

    if (!benchmarkId) {
      do {
        benchmarkId = `bench_mem_${String(nextSequence).padStart(6, '0')}`;
        nextSequence++;
      } while (usedBenchmarkIds.has(benchmarkId));
    }

    usedBenchmarkIds.add(benchmarkId);

    corpus.push({
      benchmark_id: benchmarkId,
      source_memory_id: row.id,
      type: row.type,
      tags: normalizeTags(row.tags),
      created_at: row.created_at ?? undefined,
      content: row.content,
    });
  }

  return corpus;
}
