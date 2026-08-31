#!/usr/bin/env node
/**
 * Korean recall gold fixture validator (#808 / FR-012–015,021,026,028).
 *
 * Usage: tsx scripts/korean-gold-validate.ts --fixture <dir>
 * Exit 0 on success, 1 on failure.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { isMain, parseArgs as parseCliArgs } from './lib/cli.js';

export const ALLOWED_KOREAN_GOLD_TAGS = [
  'particle_agglutination',
  'short_multi_concept',
  'triple_isolation_probe',
] as const;

export type KoreanGoldTag = (typeof ALLOWED_KOREAN_GOLD_TAGS)[number];

const KO_MEM_ID = /^ko_mem_/;
/** Live-looking ids: mem_ without ko_ prefix, or UUID-like. */
const LIVE_LOOKING_ID =
  /^(mem_[a-zA-Z0-9_]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

const MIN_QUERIES = 15;

export interface KoreanGoldQuery {
  id: string;
  query: string;
  relevantIds: string[];
  tags?: string[];
  targetSessionIds?: string[];
}

export interface KoreanGoldValidateResult {
  ok: boolean;
  errors: string[];
}

function isAllowedTag(tag: string): tag is KoreanGoldTag {
  return (ALLOWED_KOREAN_GOLD_TAGS as readonly string[]).includes(tag);
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function loadCorpusIds(corpusPath: string): Set<string> {
  const text = readFileSync(corpusPath, 'utf8');
  const ids = new Set<string>();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const row = JSON.parse(trimmed) as { id?: unknown };
    if (typeof row.id === 'string') {
      ids.add(row.id);
    }
  }
  return ids;
}

function assertMemoryId(id: string, context: string, errors: string[]): void {
  if (!KO_MEM_ID.test(id) || LIVE_LOOKING_ID.test(id)) {
    errors.push(
      `${context}: memory id "${id}" must match /^ko_mem_/ (reject live-looking ids)`,
    );
  }
}

/**
 * Validate a Korean gold fixture directory (manifest + corpus.jsonl + queries.json).
 * Fail-closed: any contract violation yields ok=false with errors (FR-013).
 */
export function validateKoreanGoldFixture(fixtureDir: string): KoreanGoldValidateResult {
  const errors: string[] = [];
  const dir = resolve(fixtureDir);
  const manifestPath = join(dir, 'manifest.json');
  const corpusPath = join(dir, 'corpus.jsonl');
  const queriesPath = join(dir, 'queries.json');

  for (const path of [manifestPath, corpusPath, queriesPath]) {
    if (!existsSync(path)) {
      errors.push(`missing required file: ${path}`);
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  let manifest: { synthetic?: unknown };
  let queries: KoreanGoldQuery[];
  let corpusIds: Set<string>;
  try {
    manifest = loadJson(manifestPath);
    queries = loadJson(queriesPath);
    corpusIds = loadCorpusIds(corpusPath);
  } catch (err) {
    return {
      ok: false,
      errors: [`failed to parse fixture: ${err instanceof Error ? err.message : String(err)}`],
    };
  }

  if (manifest.synthetic !== true) {
    errors.push('manifest.synthetic must be true');
  }

  if (!Array.isArray(queries)) {
    return { ok: false, errors: ['queries.json must be a JSON array'] };
  }

  if (queries.length < MIN_QUERIES) {
    errors.push(`expected ≥${MIN_QUERIES} queries, got ${queries.length}`);
  }

  const seenIds = new Set<string>();
  const tagCoverage = new Set<string>();

  for (const id of corpusIds) {
    assertMemoryId(id, 'corpus', errors);
  }

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    const loc = `queries[${i}]`;
    if (!q || typeof q !== 'object') {
      errors.push(`${loc}: must be an object`);
      continue;
    }
    if (typeof q.id !== 'string' || q.id.length === 0) {
      errors.push(`${loc}: id must be a non-empty string`);
      continue;
    }
    if (typeof q.query !== 'string') {
      errors.push(`${loc} (id=${q.id}): query must be a string`);
      continue;
    }
    if (q.id === q.query) {
      errors.push(
        `${loc} (id=${q.id}): opaque id must not equal query text (FR-026)`,
      );
    }
    if (seenIds.has(q.id)) {
      errors.push(`${loc}: duplicate query id "${q.id}" (must be unique)`);
    }
    seenIds.add(q.id);

    if (!Array.isArray(q.relevantIds) || q.relevantIds.length < 1) {
      errors.push(`${loc} (id=${q.id}): relevantIds.length must be ≥ 1 (FR-028)`);
    } else {
      for (const rid of q.relevantIds) {
        if (typeof rid !== 'string') {
          errors.push(`${loc} (id=${q.id}): relevantIds entries must be strings`);
          continue;
        }
        assertMemoryId(rid, `${loc} relevantIds`, errors);
        if (!corpusIds.has(rid)) {
          errors.push(
            `${loc} (id=${q.id}): relevantId "${rid}" not found in corpus`,
          );
        }
      }
    }

    const tags = q.tags ?? [];
    if (!Array.isArray(tags)) {
      errors.push(`${loc} (id=${q.id}): tags must be an array`);
      continue;
    }
    for (const tag of tags) {
      if (typeof tag !== 'string' || !isAllowedTag(tag)) {
        errors.push(
          `${loc} (id=${q.id}): unknown tag "${String(tag)}" (allowed: ${ALLOWED_KOREAN_GOLD_TAGS.join(' | ')})`,
        );
      } else {
        tagCoverage.add(tag);
      }
    }
  }

  if (!tagCoverage.has('particle_agglutination')) {
    errors.push('set-level: missing required tag particle_agglutination (≥1 query)');
  }
  if (!tagCoverage.has('short_multi_concept')) {
    errors.push('set-level: missing required tag short_multi_concept (≥1 query)');
  }

  return { ok: errors.length === 0, errors };
}

export function parseFixtureArg(argv: string[]): string | undefined {
  const idx = argv.indexOf('--fixture');
  if (idx === -1) return undefined;
  return argv[idx + 1];
}

export function main(argv = process.argv.slice(2)): number {
  const { args } = parseCliArgs({ args: argv });
  const fixture = parseFixtureArg(args);
  if (!fixture) {
    process.stderr.write('Usage: korean-gold-validate.ts --fixture <dir>\n');
    return 1;
  }
  const result = validateKoreanGoldFixture(fixture);
  if (!result.ok) {
    for (const err of result.errors) {
      process.stderr.write(`${err}\n`);
    }
    process.stderr.write(`korean-gold-validate: FAIL (${result.errors.length} error(s))\n`);
    return 1;
  }
  process.stdout.write('korean-gold-validate: OK\n');
  return 0;
}

if (isMain(import.meta.url)) {
  process.exitCode = main();
}
