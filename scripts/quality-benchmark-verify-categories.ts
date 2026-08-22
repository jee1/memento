#!/usr/bin/env node
import { isMain } from './lib/cli.js';
/**
 * benchmark-v3 queries + category-mapping.json 검증 — query_id → category → macro_category
 *
 * FR-005: query_id→카테고리는 queries.json이 아닌 category-mapping.json의 query_id_to_category에서 유지한다.
 *
 * 사용: npm run quality -- benchmark verify-categories
 */

import { join, dirname } from 'path';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import {
  loadBenchmarkQueries,
} from '@memento/core/domains/monitoring/services/quality-assurance/search-quality-benchmark-fixtures.js';
import {
  assertMacroCategory,
  type MacroCategory,
} from '@memento/core/shared/types/benchmark.types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BENCHMARK_DIR = join(ROOT, 'tests/fixtures/search-quality/benchmark-v3');
const MAPPING_PATH = join(BENCHMARK_DIR, 'category-mapping.json');

function main(): void {
  const raw = JSON.parse(readFileSync(MAPPING_PATH, 'utf8')) as {
    macro_categories: Record<string, string[]>;
    query_overrides?: Record<string, string>;
    query_id_to_category: Record<string, string>;
  };
  const queries = loadBenchmarkQueries(BENCHMARK_DIR);

  const categoryToMacro = new Map<string, MacroCategory>();
  for (const [macro, cats] of Object.entries(raw.macro_categories)) {
    const macroKey = assertMacroCategory(macro, 'macro_categories key');
    for (const c of cats) {
      categoryToMacro.set(c, macroKey);
    }
  }

  if (raw.query_overrides) {
    for (const qid of Object.keys(raw.query_overrides)) {
      const v = raw.query_overrides[qid];
      if (v !== undefined) {
        assertMacroCategory(v, `query_overrides[${qid}]`);
      }
    }
  }

  let warnings = 0;
  for (const q of queries) {
    const categoryLabel = raw.query_id_to_category?.[q.query_id];
    if (!categoryLabel) {
      console.warn(`[MISS] ${q.query_id} — no query_id_to_category entry (FR-005)`);
      warnings++;
      continue;
    }
    const overrideRaw = raw.query_overrides?.[q.query_id];
    const macro =
      overrideRaw !== undefined ? (overrideRaw as MacroCategory) : categoryToMacro.get(categoryLabel);
    const cat = categoryLabel;
    const lang = q.language ?? '';
    const notes = q.notes ?? '';
    if (!macro) {
      console.warn(`[MISS] ${q.query_id} category=${cat} → no macro_category`);
      warnings++;
    } else {
      console.log(
        `${q.query_id}\tcategory=${cat}\tlanguage=${lang}\tmacro=${macro}\tnotes=${notes}`
      );
    }
  }

  if (warnings > 0) {
    process.exit(1);
  }
}

if (isMain(import.meta.url)) {
  main();
}
