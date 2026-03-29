import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ClusteringService } from './clustering-service.js';
import type { EpisodicCandidateRow } from '../repositories/consolidation-repository.js';

function ep(
  id: string,
  owner: string | null,
  importance = 0.5
): EpisodicCandidateRow {
  return {
    id,
    content: `c-${id}`,
    importance,
    ownerId: owner,
    createdAt: new Date().toISOString(),
    pinned: false,
    isConsolidated: false
  };
}

describe('ClusteringService', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('clusters 10 similar embeddings into one group', () => {
    vi.stubEnv('CONSOLIDATION_SIMILARITY_THRESHOLD', '0.75');
    const svc = new ClusteringService();
    const emb = [1, 0, 0, 0];
    const items = Array.from({ length: 10 }, (_, i) => ({
      row: ep(`m${i}`, 'agent-1', 0.5 + i * 0.01),
      embedding: [...emb]
    }));
    const clusters = svc.clusterGroup(items);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.episodicIds).toHaveLength(10);
    expect(clusters[0]!.ownerId).toBe('agent-1');
  });

  it('skips groups smaller than min cluster size', () => {
    vi.stubEnv('CONSOLIDATION_SIMILARITY_THRESHOLD', '0.75');
    const svc = new ClusteringService();
    const emb = [1, 0, 0, 0];
    const items = Array.from({ length: 4 }, (_, i) => ({
      row: ep(`m${i}`, null),
      embedding: [...emb]
    }));
    expect(svc.clusterGroup(items)).toHaveLength(0);
  });

  it('isolates different owner_id into separate cluster runs', () => {
    vi.stubEnv('CONSOLIDATION_SIMILARITY_THRESHOLD', '0.75');
    const svc = new ClusteringService();
    const emb = [1, 0, 0, 0];
    const candidates = [
      ...Array.from({ length: 5 }, (_, i) => ep(`a${i}`, 'o1')),
      ...Array.from({ length: 5 }, (_, i) => ep(`b${i}`, 'o2'))
    ];
    const map = new Map<string, number[]>();
    for (const c of candidates) {
      map.set(c.id, [...emb]);
    }
    const clusters = svc.buildClusters(candidates, map);
    expect(clusters).toHaveLength(2);
  });

  it('excludes episodes without embeddings from clustering input', () => {
    vi.stubEnv('CONSOLIDATION_SIMILARITY_THRESHOLD', '0.75');
    const svc = new ClusteringService();
    const emb = [1, 0, 0, 0];
    const candidates = Array.from({ length: 10 }, (_, i) => ep(`m${i}`, 'o1'));
    const map = new Map<string, number[]>();
    for (let i = 0; i < 9; i++) {
      map.set(`m${i}`, [...emb]);
    }
    const clusters = svc.buildClusters(candidates, map);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.episodicIds).toHaveLength(9);
  });
});
