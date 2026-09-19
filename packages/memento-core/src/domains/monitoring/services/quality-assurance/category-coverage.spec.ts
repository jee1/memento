import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  loadBenchmarkCorpus,
  loadBenchmarkGroundTruth,
  loadBenchmarkQueries,
} from './search-quality-benchmark-fixtures.js';
import { normalizeBenchmarkGroundTruths } from './search-quality-review-verifier.js';
import { assertMacroCategory, type MacroCategory } from '../../../../shared/types/benchmark.types.js';

const BENCHMARK_DIR = join(
  process.cwd(),
  'tests/fixtures/search-quality/benchmark-v3'
);
const MAPPING_PATH = join(BENCHMARK_DIR, 'category-mapping.json');

describe('benchmark-v3 category coverage (#934, lightweight)', () => {
  it('모든 authored 쿼리가 채점되어 macro별 query_count가 채워진다', () => {
    const mapping = JSON.parse(readFileSync(MAPPING_PATH, 'utf8')) as {
      macro_categories: Record<string, string[]>;
      query_id_to_category: Record<string, string>;
    };
    const categoryToMacro = new Map<string, MacroCategory>();
    for (const [macro, cats] of Object.entries(mapping.macro_categories)) {
      const macroKey = assertMacroCategory(macro, 'macro_categories key');
      for (const c of cats) {
        categoryToMacro.set(c, macroKey);
      }
    }

    const queries = loadBenchmarkQueries(BENCHMARK_DIR);
    const groundTruths = normalizeBenchmarkGroundTruths(BENCHMARK_DIR).filter(
      (gt) => gt.relevantIds.length > 0
    );
    const queryIdToMacro = new Map<string, MacroCategory>();
    for (const q of queries) {
      const label = mapping.query_id_to_category[q.query_id];
      const macro = categoryToMacro.get(label);
      if (!macro) {
        throw new Error(`missing macro for ${q.query_id}`);
      }
      queryIdToMacro.set(q.query_id, macro);
      queryIdToMacro.set(q.query, macro);
    }

    const ALL: MacroCategory[] = [
      'incident_ops',
      'procedural',
      'conceptual',
      'tag_filter',
    ];
    const counts = ALL.map((macro) => {
      const n = groundTruths.filter((gt) => queryIdToMacro.get(gt.queryId) === macro).length;
      return [macro, n] as const;
    });

    expect(counts).toEqual([
      ['incident_ops', 4],
      ['procedural', 6],
      ['conceptual', 10],
      ['tag_filter', 6],
    ]);
  });

  it('모든 macro에서 query_count === authored_query_count', () => {
    const mapping = JSON.parse(readFileSync(MAPPING_PATH, 'utf8')) as {
      macro_categories: Record<string, string[]>;
      query_id_to_category: Record<string, string>;
    };
    const categoryToMacro = new Map<string, MacroCategory>();
    for (const [macro, cats] of Object.entries(mapping.macro_categories)) {
      const macroKey = assertMacroCategory(macro, 'macro_categories key');
      for (const c of cats) {
        categoryToMacro.set(c, macroKey);
      }
    }
    const queries = loadBenchmarkQueries(BENCHMARK_DIR);
    const scored = new Set(
      normalizeBenchmarkGroundTruths(BENCHMARK_DIR)
        .filter((gt) => gt.relevantIds.length > 0)
        .map((gt) => gt.queryId)
    );

    for (const q of queries) {
      const label = mapping.query_id_to_category[q.query_id];
      expect(categoryToMacro.has(label)).toBe(true);
      expect(scored.has(q.query) || scored.has(q.query_id)).toBe(true);
    }
    expect(queries).toHaveLength(26);
    expect(loadBenchmarkGroundTruth(BENCHMARK_DIR)).toHaveLength(26);
  });
});
