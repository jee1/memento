import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createRelationGraph } from '../../../infrastructure/relation-graph-factory.js';
import { DatabaseUtils } from '../../../shared/utils/database.js';
import { RelationEngineSchemaMigration } from '../../../infrastructure/database/sqlite/migration/migrations/005-relation-engine-schema.js';
import {
  applyRelationRecallCandidateExpansion,
  discoverRelationRecallCandidates,
  memoryPassesRecallScopeFilters,
  memoryPassesTraversalBoundary,
  RELATION_RECALL_EXPANSION_LIMITS,
  relationRecallHopDecay,
} from './relation-recall-candidate-expansion.js';
import { HybridResultRanker } from './hybrid-result-ranker.js';
import { SearchResultCombiner } from './search-result-combiner.js';
import { SearchRanking } from './search-ranking.js';
import { ProceduralMemoryMatcher } from './procedural-memory-matcher.js';
import type { HybridSearchResult } from './hybrid-search-types.js';

function createMinimalSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_item (
      id TEXT PRIMARY KEY,
      type TEXT CHECK (type IN ('working','episodic','semantic','procedural')) NOT NULL,
      content TEXT NOT NULL,
      importance REAL DEFAULT 0.5,
      privacy_scope TEXT DEFAULT 'private',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      last_accessed_at TIMESTAMP,
      pinned BOOLEAN DEFAULT FALSE,
      tags TEXT,
      owner_id TEXT,
      project_id TEXT,
      process_id TEXT,
      session_id TEXT,
      is_deleted BOOLEAN DEFAULT FALSE NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE IF NOT EXISTS memento_schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);
  new RelationEngineSchemaMigration().up(db);
}

function insertMemory(
  db: Database.Database,
  row: {
    id: string;
    content: string;
    type?: 'working' | 'episodic' | 'semantic' | 'procedural';
    owner_id?: string | null;
    project_id?: string | null;
    is_deleted?: boolean;
  }
): void {
  DatabaseUtils.run(
    db,
    `INSERT INTO memory_item (id, type, content, owner_id, project_id, is_deleted)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      row.id,
      row.type ?? 'episodic',
      row.content,
      row.owner_id ?? null,
      row.project_id ?? null,
      row.is_deleted ? 1 : 0,
    ]
  );
}

describe('relation-recall-candidate-expansion (#959)', () => {
  describe('relationRecallHopDecay', () => {
    it('applies explicit 0.5^hop decay', () => {
      expect(relationRecallHopDecay(0)).toBe(1);
      expect(relationRecallHopDecay(1)).toBe(0.5);
      expect(relationRecallHopDecay(2)).toBe(0.25);
    });
  });

  describe('discoverRelationRecallCandidates', () => {
    let db: Database.Database;
    let relationGraph: ReturnType<typeof createRelationGraph>;

    beforeAll(() => {
      db = new Database(':memory:');
      createMinimalSchema(db);
      relationGraph = createRelationGraph(db);

      for (const id of ['seed1', 'seed2', 'seed3', 'seed4', 'seed5', 'seed6', 'mid', 'target', 'cycleB', 'cycleC', 'hub']) {
        insertMemory(db, { id, content: `memory ${id}` });
      }

      void relationGraph.addRelation('seed1', 'mid', 'FOLLOWS', { confidence: 0.9 });
      void relationGraph.addRelation('mid', 'target', 'FOLLOWS', { confidence: 0.9 });
      for (let i = 2; i <= 6; i++) {
        void relationGraph.addRelation(`seed${i}`, 'hub', 'REFERENCES', { confidence: 0.5 });
      }
      void relationGraph.addRelation('cycleB', 'cycleC', 'DEPENDS_ON', { confidence: 0.8 });
      void relationGraph.addRelation('cycleC', 'cycleB', 'DEPENDS_ON', { confidence: 0.8 });
    });

    afterAll(() => {
      db.close();
    });

    it('respects max seeds, hops, and additions', async () => {
      const seeds = ['seed1', 'seed2', 'seed3', 'seed4', 'seed5', 'seed6'];
      const existing = new Set(seeds);
      const { additions: discovered } = await discoverRelationRecallCandidates(
        db,
        relationGraph,
        seeds,
        existing,
        undefined,
        'plain'
      );

      expect(discovered.length).toBeLessThanOrEqual(RELATION_RECALL_EXPANSION_LIMITS.maxAdditions);
      expect(discovered.every((item) => item.hop_distance <= RELATION_RECALL_EXPANSION_LIMITS.maxHops)).toBe(true);
      expect(discovered.some((item) => item.memory_id === 'target')).toBe(true);
      expect(discovered.every((item) => !existing.has(item.memory_id))).toBe(true);
    });

    it('does not loop on cycles', async () => {
      const { additions: discovered } = await discoverRelationRecallCandidates(
        db,
        relationGraph,
        ['cycleB'],
        new Set(['cycleB']),
        undefined,
        'plain'
      );
      expect(discovered.length).toBeLessThanOrEqual(RELATION_RECALL_EXPANSION_LIMITS.maxAdditions);
      expect(discovered.map((item) => item.memory_id)).toEqual(['cycleC']);
    });

    it('caps hub fan-out via max additions', async () => {
      const { additions: discovered } = await discoverRelationRecallCandidates(
        db,
        relationGraph,
        ['seed2', 'seed3', 'seed4', 'seed5', 'seed6'],
        new Set(['seed2', 'seed3', 'seed4', 'seed5', 'seed6']),
        undefined,
        'plain'
      );
      expect(discovered.length).toBeLessThanOrEqual(RELATION_RECALL_EXPANSION_LIMITS.maxAdditions);
    });

    it('weighted mode assigns hop-decayed propagated weights', async () => {
      const { additions: discovered } = await discoverRelationRecallCandidates(
        db,
        relationGraph,
        ['seed1'],
        new Set(['seed1']),
        undefined,
        'weighted'
      );
      const target = discovered.find((item) => item.memory_id === 'target');
      expect(target).toBeDefined();
      expect(target!.hop_distance).toBe(2);
      expect(target!.propagated_weight).toBeCloseTo(0.9 * 0.9 * relationRecallHopDecay(2), 5);
    });

    it('plain vs weighted produce different propagated weights for the same target', async () => {
      const plain = await discoverRelationRecallCandidates(
        db,
        relationGraph,
        ['seed1'],
        new Set(['seed1']),
        undefined,
        'plain'
      );
      const weighted = await discoverRelationRecallCandidates(
        db,
        relationGraph,
        ['seed1'],
        new Set(['seed1']),
        undefined,
        'weighted'
      );
      const plainTarget = plain.additions.find((item) => item.memory_id === 'target');
      const weightedTarget = weighted.additions.find((item) => item.memory_id === 'target');
      expect(plainTarget?.propagated_weight).toBe(0);
      expect(weightedTarget?.propagated_weight ?? 0).toBeGreaterThan(0);
      expect(weighted.propagatedWeights.get('target') ?? 0).toBeGreaterThan(0);
    });
  });

  describe('owner/project scope isolation', () => {
    let db: Database.Database;
    let relationGraph: ReturnType<typeof createRelationGraph>;

    beforeAll(() => {
      db = new Database(':memory:');
      createMinimalSchema(db);
      relationGraph = createRelationGraph(db);

      insertMemory(db, { id: 'seed', content: 'seed', owner_id: 'owner-a', project_id: 'proj-a' });
      insertMemory(db, { id: 'bridge', content: 'bridge', owner_id: 'owner-b', project_id: 'proj-a' });
      insertMemory(db, { id: 'target', content: 'target', owner_id: 'owner-a', project_id: 'proj-a' });

      void relationGraph.addRelation('seed', 'bridge', 'FOLLOWS', { confidence: 0.9 });
      void relationGraph.addRelation('bridge', 'target', 'FOLLOWS', { confidence: 0.9 });
    });

    afterAll(() => {
      db.close();
    });

    it('blocks traversal through owner/project mismatched intermediaries and targets', async () => {
      const filters = { owner_id: 'owner-a', project_id: 'proj-a' };
      expect(memoryPassesTraversalBoundary(db, 'bridge', filters)).toBe(false);
      expect(memoryPassesRecallScopeFilters(db, 'bridge', filters)).toBe(false);

      const { additions: discovered } = await discoverRelationRecallCandidates(
        db,
        relationGraph,
        ['seed'],
        new Set(['seed']),
        filters,
        'plain'
      );
      expect(discovered.some((item) => item.memory_id === 'bridge')).toBe(false);
      expect(discovered.some((item) => item.memory_id === 'target')).toBe(false);
    });
  });

  describe('target filters vs traversal boundaries', () => {
    let db: Database.Database;
    let relationGraph: ReturnType<typeof createRelationGraph>;

    beforeAll(() => {
      db = new Database(':memory:');
      createMinimalSchema(db);
      relationGraph = createRelationGraph(db);

      insertMemory(db, { id: 'seed', content: 'seed', type: 'semantic' });
      insertMemory(db, { id: 'bridge', content: 'bridge', type: 'episodic' });
      insertMemory(db, { id: 'target', content: 'target', type: 'semantic' });

      void relationGraph.addRelation('seed', 'bridge', 'FOLLOWS', { confidence: 0.9 });
      void relationGraph.addRelation('bridge', 'target', 'FOLLOWS', { confidence: 0.9 });
    });

    afterAll(() => {
      db.close();
    });

    it('discovers semantic target through allowed episodic intermediary when type semantic is requested', async () => {
      const filters = { type: ['semantic'] as const };
      expect(memoryPassesTraversalBoundary(db, 'bridge', filters)).toBe(true);
      expect(memoryPassesRecallScopeFilters(db, 'bridge', filters)).toBe(false);

      const { additions: discovered } = await discoverRelationRecallCandidates(
        db,
        relationGraph,
        ['seed'],
        new Set(['seed']),
        filters,
        'plain'
      );
      expect(discovered.some((item) => item.memory_id === 'bridge')).toBe(false);
      expect(discovered.some((item) => item.memory_id === 'target')).toBe(true);
    });
  });

  describe('soft-deleted memories', () => {
    let db: Database.Database;
    let relationGraph: ReturnType<typeof createRelationGraph>;

    beforeAll(() => {
      db = new Database(':memory:');
      createMinimalSchema(db);
      relationGraph = createRelationGraph(db);

      insertMemory(db, { id: 'seed', content: 'seed' });
      insertMemory(db, { id: 'deleted-bridge', content: 'deleted bridge', is_deleted: true });
      insertMemory(db, { id: 'target', content: 'target' });
      insertMemory(db, { id: 'deleted-target', content: 'deleted target', is_deleted: true });

      void relationGraph.addRelation('seed', 'deleted-bridge', 'FOLLOWS', { confidence: 0.9 });
      void relationGraph.addRelation('deleted-bridge', 'target', 'FOLLOWS', { confidence: 0.9 });
      void relationGraph.addRelation('seed', 'deleted-target', 'FOLLOWS', { confidence: 0.9 });
    });

    afterAll(() => {
      db.close();
    });

    it('cannot traverse through or return soft-deleted memories', async () => {
      expect(memoryPassesTraversalBoundary(db, 'deleted-bridge', undefined)).toBe(false);
      expect(memoryPassesRecallScopeFilters(db, 'deleted-target', undefined)).toBe(false);

      const { additions: discovered } = await discoverRelationRecallCandidates(
        db,
        relationGraph,
        ['seed'],
        new Set(['seed']),
        undefined,
        'plain'
      );
      expect(discovered.some((item) => item.memory_id === 'deleted-bridge')).toBe(false);
      expect(discovered.some((item) => item.memory_id === 'deleted-target')).toBe(false);
      expect(discovered.some((item) => item.memory_id === 'target')).toBe(false);
    });
  });

  describe('multi-path confidence selection', () => {
    let db: Database.Database;
    let relationGraph: ReturnType<typeof createRelationGraph>;

    beforeAll(() => {
      db = new Database(':memory:');
      createMinimalSchema(db);
      relationGraph = createRelationGraph(db);

      insertMemory(db, { id: 'seed', content: 'seed' });
      insertMemory(db, { id: 'weak-mid', content: 'weak mid' });
      insertMemory(db, { id: 'strong-mid', content: 'strong mid' });
      insertMemory(db, { id: 'target', content: 'target' });

      void relationGraph.addRelation('seed', 'weak-mid', 'FOLLOWS', { confidence: 0.1 });
      void relationGraph.addRelation('weak-mid', 'target', 'FOLLOWS', { confidence: 0.9 });
      void relationGraph.addRelation('seed', 'strong-mid', 'FOLLOWS', { confidence: 0.9 });
      void relationGraph.addRelation('strong-mid', 'target', 'FOLLOWS', { confidence: 0.9 });
    });

    afterAll(() => {
      db.close();
    });

    it('keeps the better propagated confidence when a weaker route is discovered first', async () => {
      const { additions: discovered, propagatedWeights } = await discoverRelationRecallCandidates(
        db,
        relationGraph,
        ['seed'],
        new Set(['seed']),
        undefined,
        'weighted'
      );
      const target = discovered.find((item) => item.memory_id === 'target');
      expect(target).toBeDefined();
      expect(target!.path_confidence).toBeCloseTo(0.9 * 0.9, 5);
      expect(target!.propagated_weight).toBeCloseTo(0.9 * 0.9 * relationRecallHopDecay(2), 5);
      expect(propagatedWeights.get('target')).toBeCloseTo(0.9 * 0.9 * relationRecallHopDecay(2), 5);
    });
  });

  describe('applyRelationRecallCandidateExpansion fallback', () => {
    it('returns primary ranking when relation graph lookup fails', async () => {
      const db = new Database(':memory:');
      createMinimalSchema(db);
      const ranker = new HybridResultRanker(
        new SearchResultCombiner(),
        new SearchRanking(),
        new ProceduralMemoryMatcher(),
        () => null
      );
      const primary: HybridSearchResult[] = [
        {
          id: 'seed',
          content: 'seed',
          type: 'episodic',
          importance: 0.5,
          created_at: new Date().toISOString(),
          pinned: false,
          textScore: 0.8,
          vectorScore: 0.2,
          finalScore: 0.5,
          recall_reason: 'test',
        },
      ];
      const failingGraph = {
        getRelationsBatch: vi.fn(async () => {
          throw new Error('graph unavailable');
        }),
      };

      const result = await applyRelationRecallCandidateExpansion({
        db,
        query: { query: 'q' },
        mode: 'plain',
        primaryRanked: primary,
        resultRanker: ranker,
        relationGraph: failingGraph,
        weights: { textWeight: 0.4, vectorWeight: 0.6 },
        outputLimit: 1,
        includeRelations: false,
      });

      expect(result).toEqual(primary);
      db.close();
    });
  });
});
