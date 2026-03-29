/**
 * 에피소딕 임베딩 기반 시드·greedy 임계값 클러스터링.
 *
 * 각 클러스터에서 시드를 제외한 멤버는 **해당 시드**와의 코사인 유사도만 임계값 이상임이 보장된다.
 * 클러스터 내부 임의 두 에피소딕 쌍(pairwise)이 모두 임계값 이상은 아닐 수 있다(트랜지티브 가정 없음).
 */

import type { ConsolidationCluster } from '../../../shared/types/consolidation.types.js';
import type { EpisodicCandidateRow } from '../repositories/consolidation-repository.js';

export interface EpisodicWithEmbedding {
  row: EpisodicCandidateRow;
  embedding: number[];
}

export class ClusteringService {
  getSimilarityThreshold(): number {
    const raw = process.env.CONSOLIDATION_SIMILARITY_THRESHOLD;
    const n = raw ? parseFloat(raw) : 0.75;
    return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.75;
  }

  getMinClusterSize(): number {
    return 5;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) {
      return 0;
    }
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
      const x = a[i] ?? 0;
      const y = b[i] ?? 0;
      dot += x * y;
      na += x * x;
      nb += y * y;
    }
    const denom = Math.sqrt(na) * Math.sqrt(nb);
    return denom === 0 ? 0 : dot / denom;
  }

  /**
   * owner_id 격리: 입력이 이미 동일 owner 그룹이라고 가정하고 클러스터링
   */
  clusterGroup(items: EpisodicWithEmbedding[]): ConsolidationCluster[] {
    const threshold = this.getSimilarityThreshold();
    const minSize = this.getMinClusterSize();
    if (items.length < minSize) {
      return [];
    }

    const sorted = [...items].sort((x, y) => x.row.id.localeCompare(y.row.id));
    const assigned = new Set<string>();
    const clusters: ConsolidationCluster[] = [];

    for (const seed of sorted) {
      if (assigned.has(seed.row.id)) {
        continue;
      }
      const members: EpisodicWithEmbedding[] = [seed];
      assigned.add(seed.row.id);
      for (const other of sorted) {
        if (assigned.has(other.row.id)) {
          continue;
        }
        const sim = this.cosineSimilarity(seed.embedding, other.embedding);
        if (sim >= threshold) {
          members.push(other);
          assigned.add(other.row.id);
        }
      }
      if (members.length < minSize) {
        for (const m of members) {
          assigned.delete(m.row.id);
        }
        continue;
      }

      let rep = members[0]!;
      for (const m of members) {
        if (m.row.importance > rep.row.importance) {
          rep = m;
        }
      }

      let simSum = 0;
      let simCount = 0;
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          simSum += this.cosineSimilarity(
            members[i]!.embedding,
            members[j]!.embedding
          );
          simCount++;
        }
      }

      clusters.push({
        ownerId: seed.row.ownerId,
        episodicIds: members.map(m => m.row.id),
        representativeId: rep.row.id,
        averageSimilarity: simCount === 0 ? 1 : simSum / simCount
      });
    }

    return clusters;
  }

  /**
   * 후보명 임베딩 맵을 받아 owner_id별로 그룹핑 후 클러스터링
   */
  buildClusters(
    candidates: EpisodicCandidateRow[],
    embeddings: Map<string, number[]>
  ): ConsolidationCluster[] {
    const withEmb: EpisodicWithEmbedding[] = [];
    for (const row of candidates) {
      const emb = embeddings.get(row.id);
      if (emb) {
        withEmb.push({ row, embedding: emb });
      }
    }

    const byOwner = new Map<string | null, EpisodicWithEmbedding[]>();
    for (const item of withEmb) {
      const key = item.row.ownerId;
      const list = byOwner.get(key) ?? [];
      list.push(item);
      byOwner.set(key, list);
    }

    const all: ConsolidationCluster[] = [];
    for (const group of byOwner.values()) {
      all.push(...this.clusterGroup(group));
    }
    return all;
  }
}
