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

export function buildBenchmarkCorpus(rows: BenchmarkSourceMemory[]): BenchmarkCorpusEntry[] {
  const corpus: BenchmarkCorpusEntry[] = [];

  for (const row of rows) {
    if (row.content.trim().length === 0) {
      continue;
    }

    corpus.push({
      benchmark_id: `bench_mem_${String(corpus.length + 1).padStart(6, '0')}`,
      source_memory_id: row.id,
      type: row.type,
      tags: normalizeTags(row.tags),
      created_at: row.created_at ?? undefined,
      content: row.content,
    });
  }

  return corpus;
}
