import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  validateKoreanGoldFixture,
  type KoreanGoldQuery,
} from './korean-gold-validate.js';

const ALLOWED_TAGS = [
  'particle_agglutination',
  'short_multi_concept',
  'triple_isolation_probe',
] as const;

interface FixtureParts {
  manifest?: Record<string, unknown>;
  corpusIds?: string[];
  queries?: KoreanGoldQuery[];
}

function buildValidQueries(count = 15): KoreanGoldQuery[] {
  return Array.from({ length: count }, (_, i) => {
    const n = String(i + 1).padStart(3, '0');
    const tags: string[] =
      i === 0
        ? ['particle_agglutination']
        : i === 1
          ? ['short_multi_concept']
          : [];
    return {
      id: `kq_${n}`,
      query: `합성 질의 ${n}`,
      relevantIds: [`ko_mem_${n}`],
      tags,
      targetSessionIds: ['ko_sess_1'],
    };
  });
}

function writeFixture(parts: FixtureParts = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'korean-gold-'));
  const queries = parts.queries ?? buildValidQueries();
  const corpusIds =
    parts.corpusIds ??
    [...new Set(queries.flatMap((q) => q.relevantIds))];
  const manifest = {
    synthetic: true,
    name: 'korean-gold-test',
    ...(parts.manifest ?? {}),
  };

  writeFileSync(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(
    join(dir, 'corpus.jsonl'),
    `${corpusIds
      .map((id) =>
        JSON.stringify({
          id,
          sessionId: 'ko_sess_1',
          content: `합성 본문 ${id}`,
          type: 'semantic',
        }),
      )
      .join('\n')}\n`,
  );
  writeFileSync(join(dir, 'queries.json'), `${JSON.stringify(queries, null, 2)}\n`);
  return dir;
}

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('korean-gold-validate', () => {
  it('accepts a minimal valid synthetic fixture', () => {
    const dir = writeFixture();
    dirs.push(dir);
    const result = validateKoreanGoldFixture(dir);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('fails when query count is below 15', () => {
    const dir = writeFixture({ queries: buildValidQueries(14) });
    dirs.push(dir);
    const result = validateKoreanGoldFixture(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/15|query/i);
  });

  it('fails when particle_agglutination tag is missing from the set', () => {
    const queries = buildValidQueries().map((q) => ({
      ...q,
      tags: q.tags.filter((t) => t !== 'particle_agglutination'),
    }));
    queries[1] = { ...queries[1]!, tags: ['short_multi_concept'] };
    const dir = writeFixture({ queries });
    dirs.push(dir);
    const result = validateKoreanGoldFixture(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/particle_agglutination/);
  });

  it('fails when relevantIds is empty', () => {
    const queries = buildValidQueries();
    queries[2] = { ...queries[2]!, relevantIds: [] };
    const dir = writeFixture({ queries });
    dirs.push(dir);
    const result = validateKoreanGoldFixture(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/relevantIds/i);
  });

  it('fails when query ids are duplicated', () => {
    const queries = buildValidQueries();
    queries[3] = { ...queries[3]!, id: queries[0]!.id };
    const dir = writeFixture({ queries });
    dirs.push(dir);
    const result = validateKoreanGoldFixture(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/duplicate|unique/i);
  });

  it('fails when opaque id equals query text (FR-026)', () => {
    const queries = buildValidQueries();
    queries[4] = {
      ...queries[4]!,
      id: '가중치',
      query: '가중치',
    };
    const dir = writeFixture({ queries });
    dirs.push(dir);
    const result = validateKoreanGoldFixture(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/opaque|query text|FR-026|equals/i);
  });

  it('fails on unknown tags', () => {
    const queries = buildValidQueries();
    queries[5] = {
      ...queries[5]!,
      tags: ['not_a_real_tag'],
    };
    const dir = writeFixture({ queries });
    dirs.push(dir);
    const result = validateKoreanGoldFixture(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/unknown tag|not_a_real_tag/i);
    for (const allowed of ALLOWED_TAGS) {
      expect(allowed).not.toBe('not_a_real_tag');
    }
  });

  it('fails when relevantIds contain live-looking ids', () => {
    const queries = buildValidQueries();
    queries[6] = {
      ...queries[6]!,
      relevantIds: ['mem_1788096135267_b0hicxp2g'],
    };
    const dir = writeFixture({
      queries,
      corpusIds: [
        ...queries.flatMap((q) => q.relevantIds).filter((id) => id.startsWith('ko_mem_')),
        'mem_1788096135267_b0hicxp2g',
      ],
    });
    dirs.push(dir);
    const result = validateKoreanGoldFixture(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/ko_mem_|live|mem_/i);
  });

  it('fails when a relevantId is missing from corpus', () => {
    const queries = buildValidQueries();
    queries[7] = {
      ...queries[7]!,
      relevantIds: ['ko_mem_missing'],
    };
    const dir = writeFixture({
      queries,
      corpusIds: queries
        .flatMap((q) => q.relevantIds)
        .filter((id) => id !== 'ko_mem_missing'),
    });
    dirs.push(dir);
    const result = validateKoreanGoldFixture(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/ko_mem_missing|corpus/i);
  });

  it('fails when manifest.synthetic is not true', () => {
    const dir = writeFixture({ manifest: { synthetic: false } });
    dirs.push(dir);
    const result = validateKoreanGoldFixture(dir);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/synthetic/i);
  });
});
