/**
 * relation-ko-panel-v1 fixture seed: owner/project scope, deleted/superseded traps.
 * Offline measurement only — does not change production seed paths.
 */

import type Database from 'better-sqlite3';
import { readFileSync } from 'fs';
import { join } from 'path';
import { DatabaseUtils, mementoConfig } from '@memento/core';
import {
  createSeededBenchmarkDatabase,
  type SeededBenchmarkDb,
} from './benchmark-search-database.js';

export interface RelationKoPanelCorpusRow {
  benchmark_id: string;
  source_memory_id: string;
  type: string;
  tags?: string[];
  created_at?: string;
  content: string;
  owner_id?: string;
  project_id?: string;
  status?: 'active' | 'deleted' | 'superseded';
  superseded_by?: string;
}

export interface RelationKoPanelSafetyMeta {
  benchmarkId: string;
  memoryId: string;
  ownerId: string | null;
  projectId: string | null;
  isDeleted: boolean;
  supersededByBenchmarkId: string | null;
}

const DEFAULT_OWNER = 'owner_rkpanel_default';
const DEFAULT_PROJECT = 'project_rkpanel_synth';

function loadRelationKoPanelCorpus(benchmarkDir: string): RelationKoPanelCorpusRow[] {
  const corpusPath = join(benchmarkDir, 'corpus.jsonl');
  return readFileSync(corpusPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as RelationKoPanelCorpusRow);
}

export function buildRelationKoPanelSafetyMeta(
  corpus: readonly RelationKoPanelCorpusRow[],
): Map<string, RelationKoPanelSafetyMeta> {
  const map = new Map<string, RelationKoPanelSafetyMeta>();
  for (const row of corpus) {
    map.set(row.benchmark_id, {
      benchmarkId: row.benchmark_id,
      memoryId: row.source_memory_id,
      ownerId: row.owner_id ?? DEFAULT_OWNER,
      projectId: row.project_id ?? DEFAULT_PROJECT,
      isDeleted: row.status === 'deleted',
      supersededByBenchmarkId: row.superseded_by ?? null,
    });
  }
  return map;
}

export function patchRelationKoPanelScopeAndTraps(
  db: Database.Database,
  benchmarkDir: string,
): Map<string, RelationKoPanelSafetyMeta> {
  const corpus = loadRelationKoPanelCorpus(benchmarkDir);
  const benchmarkToMemory = new Map(corpus.map((row) => [row.benchmark_id, row.source_memory_id]));
  const meta = buildRelationKoPanelSafetyMeta(corpus);

  db.transaction(() => {
    for (const row of corpus) {
      const ownerId = row.owner_id ?? DEFAULT_OWNER;
      const projectId = row.project_id ?? DEFAULT_PROJECT;
      const isDeleted = row.status === 'deleted' ? 1 : 0;
      let supersededByMemory: string | null = null;
      if (row.superseded_by) {
        supersededByMemory = benchmarkToMemory.get(row.superseded_by) ?? null;
      }
      db.prepare(
        `UPDATE memory_item SET owner_id = ?, project_id = ?, is_deleted = ?, superseded_by = ? WHERE id = ?`,
      ).run(ownerId, projectId, isDeleted, supersededByMemory, row.source_memory_id);
    }
  })();

  return meta;
}

export async function createSeededRelationKoPanelDatabase(
  benchmarkDir: string,
  dbPath?: string,
): Promise<SeededBenchmarkDb & { safetyMetaByBenchmarkId: Map<string, RelationKoPanelSafetyMeta> }> {
  const prevProvider = process.env.EMBEDDING_PROVIDER;
  const candidates = [
    mementoConfig.embeddingProvider,
    'tfidf',
    'minilm',
  ].filter((value, index, arr) => arr.indexOf(value) === index);

  let lastError: unknown;
  try {
    for (const candidate of candidates) {
      process.env.EMBEDDING_PROVIDER = candidate;
      try {
        const seeded = await createSeededBenchmarkDatabase(benchmarkDir, dbPath ? { dbPath } : undefined);
        const safetyMetaByBenchmarkId = patchRelationKoPanelScopeAndTraps(seeded.db, benchmarkDir);
        return { ...seeded, safetyMetaByBenchmarkId };
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('Benchmark corpus seed must use')) {
          throw error;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  } finally {
    if (prevProvider === undefined) {
      delete process.env.EMBEDDING_PROVIDER;
    } else {
      process.env.EMBEDDING_PROVIDER = prevProvider;
    }
  }
}

export function loadRelationKoPanelSplit(benchmarkDir: string): {
  devQueryIds: string[];
  heldOutQueryIds: string[];
} {
  const split = JSON.parse(readFileSync(join(benchmarkDir, 'split.json'), 'utf8')) as {
    dev_query_ids: string[];
    held_out_query_ids: string[];
  };
  return { devQueryIds: split.dev_query_ids, heldOutQueryIds: split.held_out_query_ids };
}

export function loadRelationKoPanelForbiddenByQuery(
  benchmarkDir: string,
): Map<string, readonly string[]> {
  const key = JSON.parse(readFileSync(join(benchmarkDir, 'generator-key.json'), 'utf8')) as {
    queries: Array<{ query_id: string; forbidden_memory_ids?: string[] }>;
  };
  const map = new Map<string, readonly string[]>();
  for (const row of key.queries) {
    map.set(row.query_id, row.forbidden_memory_ids ?? []);
  }
  return map;
}

export function loadRelationKoPanelGroundTruth(
  benchmarkDir: string,
): Map<string, { relevantIds: string[] }> {
  const gt = JSON.parse(readFileSync(join(benchmarkDir, 'ground-truth.json'), 'utf8')) as {
    items: Array<{ queryId: string; relevantIds: string[] }>;
  };
  return new Map(gt.items.map((item) => [item.queryId, { relevantIds: item.relevantIds }]));
}

export interface RelationKoPanelQueryRow {
  query_id: string;
  query: string;
  category: 'single_fact' | 'multi_hop' | 'irrelevant_trap';
  scope_owner_id: string;
  scope_project_id: string;
}

export function loadRelationKoPanelQueries(benchmarkDir: string): RelationKoPanelQueryRow[] {
  return JSON.parse(readFileSync(join(benchmarkDir, 'queries.json'), 'utf8')) as RelationKoPanelQueryRow[];
}

export function buildBenchmarkIdMaps(corpus: readonly RelationKoPanelCorpusRow[]): {
  memoryIdToBenchmarkId: Map<string, string>;
  contentByBenchmarkId: Map<string, string>;
} {
  const memoryIdToBenchmarkId = new Map<string, string>();
  const contentByBenchmarkId = new Map<string, string>();
  for (const row of corpus) {
    memoryIdToBenchmarkId.set(row.source_memory_id, row.benchmark_id);
    contentByBenchmarkId.set(row.benchmark_id, row.content);
  }
  return { memoryIdToBenchmarkId, contentByBenchmarkId };
}

export function loadRelationKoPanelCorpusRows(benchmarkDir: string): RelationKoPanelCorpusRow[] {
  return loadRelationKoPanelCorpus(benchmarkDir);
}

export function countRelationJsonlRows(benchmarkDir: string): number {
  const relationsPath = join(benchmarkDir, 'relations.jsonl');
  return readFileSync(relationsPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0).length;
}

/** 임베딩 없이 corpus+relations.jsonl 만 적재(BFS/관계 진단용). */
export function seedRelationGraphFromCorpusAndJsonl(
  db: Database.Database,
  benchmarkDir: string,
): Map<string, RelationKoPanelSafetyMeta> {
  const corpus = loadRelationKoPanelCorpus(benchmarkDir);
  const benchmarkToMemory = new Map(corpus.map((row) => [row.benchmark_id, row.source_memory_id]));

  db.transaction(() => {
    for (const row of corpus) {
      const ownerId = row.owner_id ?? DEFAULT_OWNER;
      const projectId = row.project_id ?? DEFAULT_PROJECT;
      const isDeleted = row.status === 'deleted' ? 1 : 0;
      let supersededByMemory: string | null = null;
      if (row.superseded_by) {
        supersededByMemory = benchmarkToMemory.get(row.superseded_by) ?? null;
      }
      DatabaseUtils.run(
        db,
        `INSERT INTO memory_item (id, type, content, tags, created_at, owner_id, project_id, is_deleted, superseded_by, importance, recall_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0.5, 0)`,
        [
          row.source_memory_id,
          row.type,
          row.content,
          JSON.stringify(row.tags ?? []),
          row.created_at ?? new Date().toISOString(),
          ownerId,
          projectId,
          isDeleted,
          supersededByMemory,
        ],
      );
    }

    const relationsPath = join(benchmarkDir, 'relations.jsonl');
    const lines = readFileSync(relationsPath, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0);
    for (const line of lines) {
      const rel = JSON.parse(line) as {
        source: string;
        target: string;
        relation_type: string;
        confidence: number;
      };
      const sourceId = benchmarkToMemory.get(rel.source);
      const targetId = benchmarkToMemory.get(rel.target);
      if (!sourceId || !targetId) {
        throw new Error(`Relation references unknown benchmark_id: ${rel.source} -> ${rel.target}`);
      }
      DatabaseUtils.run(
        db,
        `INSERT INTO memory_relation (source_id, target_id, relation_type, confidence) VALUES (?, ?, ?, ?)`,
        [sourceId, targetId, rel.relation_type, rel.confidence],
      );
    }
  })();

  return buildRelationKoPanelSafetyMeta(corpus);
}
