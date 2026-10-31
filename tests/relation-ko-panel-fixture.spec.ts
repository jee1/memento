import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const dir = join(root, 'tests/fixtures/search-quality/relation-ko-panel-v1');

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

type CorpusRow = {
  benchmark_id: string;
  owner_id: string;
  status?: string;
};

type RelRow = { source: string; target: string; relation_type: string };

type QueryRow = { query_id: string; category: string; split: string };

describe('relation-ko-panel-v1 fixture (#1555 stage 1)', () => {
  it('has expected files and query-type counts', () => {
    for (const name of [
      'protocol.md',
      'rubric.md',
      'corpus.jsonl',
      'relations.jsonl',
      'queries.json',
      'generator-key.json',
      'split.json',
      'README.md',
    ]) {
      expect(readFileSync(join(dir, name)).length).toBeGreaterThan(0);
    }
    const queries = JSON.parse(readFileSync(join(dir, 'queries.json'), 'utf8')) as QueryRow[];
    expect(queries).toHaveLength(75);
    const counts = queries.reduce<Record<string, number>>((a, q) => {
      a[q.category] = (a[q.category] ?? 0) + 1;
      return a;
    }, {});
    expect(counts.single_fact).toBe(25);
    expect(counts.multi_hop).toBe(25);
    expect(counts.irrelevant_trap).toBe(25);
  });

  it('keeps id reference integrity across corpus, relations, and generator-key', () => {
    const corpus = readFileSync(join(dir, 'corpus.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as CorpusRow);
    const ids = new Set(corpus.map(c => c.benchmark_id));
    expect(ids.size).toBe(corpus.length);

    const relations = readFileSync(join(dir, 'relations.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as RelRow);
    for (const r of relations) {
      expect(ids.has(r.source), `relation source ${r.source}`).toBe(true);
      expect(ids.has(r.target), `relation target ${r.target}`).toBe(true);
    }

    const key = JSON.parse(readFileSync(join(dir, 'generator-key.json'), 'utf8')) as {
      queries: { query_id: string; relevant_memory_ids: string[]; forbidden_memory_ids: string[] }[];
    };
    expect(key.queries).toHaveLength(75);
    const queryIds = new Set(JSON.parse(readFileSync(join(dir, 'queries.json'), 'utf8')).map((q: QueryRow) => q.query_id));
    for (const row of key.queries) {
      expect(queryIds.has(row.query_id)).toBe(true);
      for (const id of [...row.relevant_memory_ids, ...row.forbidden_memory_ids]) {
        expect(ids.has(id), `key ref ${id}`).toBe(true);
      }
    }
  });

  it('seals dev/held_out split 1:2 and records split sha in protocol', () => {
    const split = JSON.parse(readFileSync(join(dir, 'split.json'), 'utf8')) as {
      dev_query_ids: string[];
      held_out_query_ids: string[];
    };
    expect(split.dev_query_ids).toHaveLength(25);
    expect(split.held_out_query_ids).toHaveLength(50);
    const splitSha = sha256(readFileSync(join(dir, 'split.json')));
    const protocol = readFileSync(join(dir, 'protocol.md'), 'utf8');
    expect(protocol).toContain(splitSha);
  });

  it('pins agent_panel gold: corpus membership and no forbidden overlap (#1555 stage 2)', () => {
    const corpusIds = new Set(
      readFileSync(join(dir, 'corpus.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map(line => (JSON.parse(line) as CorpusRow).benchmark_id),
    );
    const key = JSON.parse(readFileSync(join(dir, 'generator-key.json'), 'utf8')) as {
      queries: { query_id: string; forbidden_memory_ids: string[] }[];
    };
    const forbiddenByQuery = new Map(key.queries.map(q => [q.query_id, new Set(q.forbidden_memory_ids)]));
    const ground = JSON.parse(readFileSync(join(dir, 'ground-truth.json'), 'utf8')) as {
      label_source: string;
      items: { queryId: string; relevantIds: string[] }[];
    };
    expect(ground.label_source).toBe('agent_panel');
    expect(ground.items).toHaveLength(75);
    for (const row of ground.items) {
      const forbidden = forbiddenByQuery.get(row.queryId) ?? new Set<string>();
      for (const id of row.relevantIds) {
        expect(corpusIds.has(id), `missing corpus id ${id} for ${row.queryId}`).toBe(true);
        expect(forbidden.has(id), `forbidden id ${id} in gold for ${row.queryId}`).toBe(false);
      }
    }
    const panel = JSON.parse(readFileSync(join(dir, 'panel-result.json'), 'utf8')) as {
      summary: { agent_panel_gold_queries: number; matches_generator_key: boolean };
      ground_truth_sha256: string;
    };
    expect(panel.summary.agent_panel_gold_queries).toBe(75);
    expect(panel.summary.matches_generator_key).toBe(true);
    expect(sha256(readFileSync(join(dir, 'ground-truth.json')))).toBe(panel.ground_truth_sha256);
  });

  it('includes scope traps without marking deleted/superseded as default answers', () => {
    const corpus = readFileSync(join(dir, 'corpus.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as CorpusRow & { superseded_by?: string });
    const deleted = corpus.filter(c => c.status === 'deleted');
    const superseded = corpus.filter(c => c.status === 'superseded');
    const foreign = corpus.filter(c => c.owner_id === 'owner_rkpanel_foreign');
    expect(deleted.length).toBeGreaterThanOrEqual(1);
    expect(superseded.length).toBeGreaterThanOrEqual(1);
    expect(foreign.length).toBeGreaterThanOrEqual(1);
    for (const s of superseded) expect(s.superseded_by && corpus.some(c => c.benchmark_id === s.superseded_by)).toBe(true);
  });
});
