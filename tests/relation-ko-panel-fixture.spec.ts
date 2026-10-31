import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tokenize } from '../scripts/agent-memory-benchmark.js';
import {
  blindPacketSha256FromFixtureDir,
  blindPacketSha256FromParts,
  type QueryRow as BlindQueryRow,
  type RelationRow,
} from '../scripts/relation-ko-panel-blind-packet.js';

const root = process.cwd();
const dir = join(root, 'tests/fixtures/search-quality/relation-ko-panel-v1');

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');

const CLUSTER_PLACES = [
  '별빛 도서관', '솔내 연구실', '푸른 항구', '무지개 공방', '은하 수목원',
  '달빛 어학원', '새벽 시장', '고요 정원', '바람 천문대', '한울 제빵소',
  '서리 마을', '노을 갤러리', '이슬 농장', '산들 카페', '해온 항만',
  '자람 학당', '미르 공연장', '초록 언덕', '하늘 도장', '빛고을 센터',
  '들판 우체국', '물결 수영장', '고개 전망대', '나무 서점', '새싹 병원',
] as const;

const LEXICAL_TOP_K = 10;
const DIRECT_TOP_K = 5;

type CorpusRow = {
  benchmark_id: string;
  source_memory_id?: string;
  owner_id: string;
  status?: string;
  content: string;
};

type QueryRow = {
  query_id: string;
  query: string;
  category: string;
  split: string;
  cluster_id: string;
  scope_owner_id: string;
};

type KeyRow = {
  query_id: string;
  query_type: string;
  relevant_memory_ids: string[];
  forbidden_memory_ids: string[];
};

type AnswerRow = {
  query_id: string;
  relevant_memory_ids: string[];
  ambiguous: boolean;
  data_sha256?: string;
};

function loadCorpus(): CorpusRow[] {
  return readFileSync(join(dir, 'corpus.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map(line => JSON.parse(line) as CorpusRow);
}

function loadQueries(): QueryRow[] {
  return JSON.parse(readFileSync(join(dir, 'queries.json'), 'utf8')) as QueryRow[];
}

function loadKey(): { queries: KeyRow[] } {
  return JSON.parse(readFileSync(join(dir, 'generator-key.json'), 'utf8')) as { queries: KeyRow[] };
}

function placeForClusterId(clusterId: string): string {
  const n = Number(/^cl_(\d+)$/.exec(clusterId)?.[1]);
  return CLUSTER_PLACES[n - 1] ?? '';
}

function searchableCorpus(rows: CorpusRow[], scopeOwner: string): CorpusRow[] {
  return rows.filter(row =>
    row.owner_id === scopeOwner &&
    row.status !== 'deleted' &&
    row.status !== 'superseded',
  );
}

function rankLexical(documents: CorpusRow[], query: string): string[] {
  const queryTokens = [...new Set(tokenize(query))];
  return documents
    .map(document => {
      const content = document.content.toLocaleLowerCase('en-US');
      const score = queryTokens.reduce(
        (sum, token) => sum + Math.max(0, content.split(token).length - 1),
        0,
      );
      return { id: document.benchmark_id, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .map(item => item.id);
}

function normAnswerIds(ids: string[], corpus: CorpusRow[]): string[] {
  const bench = new Set(corpus.map(c => c.benchmark_id));
  const srcToBench = new Map(
    corpus.filter(c => c.source_memory_id).map(c => [c.source_memory_id!, c.benchmark_id]),
  );
  return ids.map(id => (bench.has(id) ? id : srcToBench.get(id) ?? id)).sort();
}

describe('relation-ko-panel-v1 fixture (#1555)', () => {
  it('has expected files and query-type counts', () => {
    for (const name of [
      'protocol.md',
      'rubric.md',
      'corpus.jsonl',
      'relations.jsonl',
      'queries.json',
      'generator-key.json',
      'split.json',
      'fixture-seals.json',
      'ground-truth.json',
      'panel-result.json',
      'README.md',
    ]) {
      expect(readFileSync(join(dir, name)).length).toBeGreaterThan(0);
    }
    const queries = loadQueries();
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
    const corpus = loadCorpus();
    const ids = new Set(corpus.map(c => c.benchmark_id));
    expect(ids.size).toBe(corpus.length);

    const relations = readFileSync(join(dir, 'relations.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as RelationRow);
    for (const r of relations) {
      expect(ids.has(r.source), `relation source ${r.source}`).toBe(true);
      expect(ids.has(r.target), `relation target ${r.target}`).toBe(true);
    }

    const key = loadKey();
    expect(key.queries).toHaveLength(75);
    const queryIds = new Set(loadQueries().map(q => q.query_id));
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

  it('pins fixture byte seals including blind adjudication packet and reviewer submissions', () => {
    const seals = JSON.parse(readFileSync(join(dir, 'fixture-seals.json'), 'utf8')) as {
      blind_packet_sha256: string;
      split_json_sha256: string;
      generator_key_sha256: string;
      corpus_jsonl_sha256: string;
      relations_jsonl_sha256: string;
      queries_json_sha256: string;
      reviewer_a_answers_sha256: string;
      reviewer_b_answers_sha256: string;
      ground_truth_sha256: string;
      panel_result_sha256: string;
    };
    expect(sha256(readFileSync(join(dir, 'split.json')))).toBe(seals.split_json_sha256);
    expect(sha256(readFileSync(join(dir, 'generator-key.json')))).toBe(seals.generator_key_sha256);
    expect(seals.split_json_sha256).toBe('2582d083f8975dd26a9eb041367d875be8eb292f481d04d81e38cb36a5f8bf43');
    expect(seals.generator_key_sha256).toBe('0f66ebe30bca4ea30052911643ab6e5e8b9ace1432988d2fdaed87545fd1f493');
    expect(sha256(readFileSync(join(dir, 'corpus.jsonl')))).toBe(seals.corpus_jsonl_sha256);
    expect(sha256(readFileSync(join(dir, 'relations.jsonl')))).toBe(seals.relations_jsonl_sha256);
    expect(sha256(readFileSync(join(dir, 'queries.json')))).toBe(seals.queries_json_sha256);
    expect(blindPacketSha256FromFixtureDir(dir)).toBe(seals.blind_packet_sha256);
    expect(seals.blind_packet_sha256).toBe('a5df6eac4931b578ad946cf672c85170a1ff66a58cb72a7e5f9183893d859c10');
    expect(sha256(readFileSync(join(dir, 'reviewer-a/answers.json')))).toBe(seals.reviewer_a_answers_sha256);
    expect(sha256(readFileSync(join(dir, 'reviewer-b/answers.json')))).toBe(seals.reviewer_b_answers_sha256);
    expect(seals.reviewer_a_answers_sha256).toBe('d150b75610b14b675d0609cede0d6c1df74594b60aeec4c0991edabe1c1a0418');
    expect(seals.reviewer_b_answers_sha256).toBe('f258b04fca03f7bd5805cae574e04a7f4b0f53c8f41abb423500c317a118bcda');
    expect(sha256(readFileSync(join(dir, 'ground-truth.json')))).toBe(seals.ground_truth_sha256);
    expect(sha256(readFileSync(join(dir, 'panel-result.json')))).toBe(seals.panel_result_sha256);
    const corpus = readFileSync(join(dir, 'corpus.jsonl'), 'utf8');
    const relations = readFileSync(join(dir, 'relations.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as RelationRow);
    const queries = loadQueries() as BlindQueryRow[];
    expect(blindPacketSha256FromParts(corpus, relations, queries)).toBe(seals.blind_packet_sha256);
    expect(readFileSync(join(dir, 'protocol.md'), 'utf8')).toContain(seals.blind_packet_sha256);
  });

  it('keeps agent_panel ground-truth ids in corpus and off forbidden lists', () => {
    const corpusIds = new Set(loadCorpus().map(c => c.benchmark_id));
    const forbiddenByQuery = new Map(
      loadKey().queries.map(q => [q.query_id, new Set(q.forbidden_memory_ids)]),
    );
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
  });

  it('enforces multi_hop lexical isolation and direct/trap retrievability', () => {
    const corpus = loadCorpus();
    const queries = loadQueries();
    const keyById = new Map(loadKey().queries.map(row => [row.query_id, row]));

    for (const query of queries.filter(q => q.category === 'multi_hop')) {
      const key = keyById.get(query.query_id)!;
      const answerId = key.relevant_memory_ids[0]!;
      const answer = corpus.find(c => c.benchmark_id === answerId)!;
      const place = placeForClusterId(query.cluster_id);
      expect(answer.content.includes(place), `${query.query_id} hop_ans must omit place`).toBe(false);
      const ranked = rankLexical(searchableCorpus(corpus, query.scope_owner_id), query.query);
      const rank = ranked.indexOf(answerId);
      expect(rank, `${query.query_id} hop_ans lexical rank ${rank}`).toBe(-1);
      if (rank >= 0) expect(rank).toBeGreaterThanOrEqual(LEXICAL_TOP_K);
    }

    for (const query of queries.filter(q => q.category === 'single_fact')) {
      const key = keyById.get(query.query_id)!;
      const answerId = key.relevant_memory_ids[0]!;
      const ranked = rankLexical(searchableCorpus(corpus, query.scope_owner_id), query.query);
      expect(ranked.slice(0, DIRECT_TOP_K)).toContain(answerId);
    }

    for (const query of queries.filter(q => q.category === 'irrelevant_trap')) {
      const key = keyById.get(query.query_id)!;
      const answerId = key.relevant_memory_ids[0]!;
      const ranked = rankLexical(searchableCorpus(corpus, query.scope_owner_id), query.query);
      expect(ranked.slice(0, DIRECT_TOP_K)).toContain(answerId);
    }
  });

  it('aligns panel-result sealed_before_judging and blind packet with fixture-seals', () => {
    const panel = JSON.parse(readFileSync(join(dir, 'panel-result.json'), 'utf8')) as {
      blind_packet_sha256: string;
      sealed_before_judging: { split_json_sha256: string; generator_key_sha256: string };
      ground_truth_sha256: string;
    };
    const seals = JSON.parse(readFileSync(join(dir, 'fixture-seals.json'), 'utf8')) as {
      blind_packet_sha256: string;
      split_json_sha256: string;
      generator_key_sha256: string;
      ground_truth_sha256: string;
      panel_result_sha256: string;
    };
    expect(panel.blind_packet_sha256).toBe(seals.blind_packet_sha256);
    expect(panel.sealed_before_judging.split_json_sha256).toBe(seals.split_json_sha256);
    expect(panel.sealed_before_judging.generator_key_sha256).toBe(seals.generator_key_sha256);
    expect(panel.ground_truth_sha256).toBe(seals.ground_truth_sha256);
    expect(sha256(readFileSync(join(dir, 'panel-result.json')))).toBe(seals.panel_result_sha256);
  });

  it('matches reviewer submissions to seals and normalized ground-truth', () => {
    const seals = JSON.parse(readFileSync(join(dir, 'fixture-seals.json'), 'utf8')) as {
      blind_packet_sha256: string;
      reviewer_a_answers_sha256: string;
      reviewer_b_answers_sha256: string;
    };
    const aRaw = readFileSync(join(dir, 'reviewer-a/answers.json'));
    const bRaw = readFileSync(join(dir, 'reviewer-b/answers.json'));
    expect(sha256(aRaw)).toBe(seals.reviewer_a_answers_sha256);
    expect(sha256(bRaw)).toBe(seals.reviewer_b_answers_sha256);

    const corpus = loadCorpus();
    const a = JSON.parse(aRaw.toString()) as AnswerRow[];
    const b = JSON.parse(bRaw.toString()) as AnswerRow[];
    const ground = JSON.parse(readFileSync(join(dir, 'ground-truth.json'), 'utf8')) as {
      items: { queryId: string; relevantIds: string[] }[];
    };
    const groundById = new Map(ground.items.map(row => [row.queryId, row.relevantIds.sort().join(',')]));
    const bByQ = new Map(b.map(row => [row.query_id, row]));

    for (const row of a) {
      expect(row.data_sha256).toBe(seals.blind_packet_sha256);
      const other = bByQ.get(row.query_id)!;
      expect(other.data_sha256).toBe(seals.blind_packet_sha256);
      const na = normAnswerIds(row.relevant_memory_ids, corpus).join(',');
      const nb = normAnswerIds(other.relevant_memory_ids, corpus).join(',');
      expect(na).toBe(nb);
      expect(groundById.get(row.query_id)).toBe(na);
    }
  });

  it('includes scope traps without marking deleted/superseded as default answers', () => {
    const corpus = loadCorpus();
    const deleted = corpus.filter(c => c.status === 'deleted');
    const superseded = corpus.filter(c => c.status === 'superseded');
    const foreign = corpus.filter(c => c.owner_id === 'owner_rkpanel_foreign');
    expect(deleted.length).toBeGreaterThanOrEqual(1);
    expect(superseded.length).toBeGreaterThanOrEqual(1);
    expect(foreign.length).toBeGreaterThanOrEqual(1);
    for (const s of superseded) {
      expect(s.superseded_by && corpus.some(c => c.benchmark_id === s.superseded_by)).toBe(true);
    }
  });
});
