/** Blind adjudication packet bytes for relation-ko-panel-v1 (#1555). */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type RelationRow = {
  source: string;
  target: string;
  relation_type: string;
  confidence: number;
  note?: string;
};

export type QueryRow = {
  query_id: string;
  query: string;
  language: string;
  category: string;
  split: string;
  cluster_id: string;
  scope_owner_id: string;
  scope_project_id: string;
};

export function buildBlindPacketPayload(
  corpus: string,
  relations: RelationRow[],
  queries: QueryRow[],
): string {
  const relBody = `${relations.map(({ note: _note, ...row }) => JSON.stringify(row)).join('\n')}\n`;
  const blindQueries = queries.map(({ category: _c, split: _s, cluster_id: _id, ...row }) => row);
  const queryBody = `${JSON.stringify(blindQueries, null, 2)}\n`;
  return corpus + relBody + queryBody;
}

export function blindPacketSha256FromParts(
  corpus: string,
  relations: RelationRow[],
  queries: QueryRow[],
): string {
  return createHash('sha256').update(buildBlindPacketPayload(corpus, relations, queries)).digest('hex');
}

export function blindPacketSha256FromFixtureDir(fixtureDir: string): string {
  const corpus = readFileSync(join(fixtureDir, 'corpus.jsonl'), 'utf8');
  const relations = readFileSync(join(fixtureDir, 'relations.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map(line => JSON.parse(line) as RelationRow);
  const queries = JSON.parse(readFileSync(join(fixtureDir, 'queries.json'), 'utf8')) as QueryRow[];
  return blindPacketSha256FromParts(corpus, relations, queries);
}
