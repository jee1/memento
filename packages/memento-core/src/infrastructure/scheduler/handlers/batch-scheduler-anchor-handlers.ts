import type { BatchJobResult } from '../batch-scheduler-types.js';
import { createEmptyBatchJobResult, finalizeBatchJobTiming } from '../batch-scheduler-internal-helpers.js';
import type { BatchSchedulerRunContext } from './batch-scheduler-run-context.js';

const SLOTS = ['A', 'B', 'C'] as const;
type Slot = (typeof SLOTS)[number];

interface AnchorRow {
  agent_id: string;
  slot: string;
  updated_at: string;
}

interface MemoryCandidate {
  id: string;
  has_relation: number;
  has_embedding: number;
}

/**
 * A candidate is "isolated" only when it has neither a relation edge nor an
 * embedding (GitHub #714). A candidate with a relation must never be
 * disadvantaged solely for missing an embedding, since relation-based n-hop
 * recovery (#708/#709) does not require one.
 */
function isIsolatedCandidate(candidate: MemoryCandidate): boolean {
  return !candidate.has_relation && !candidate.has_embedding;
}

/**
 * Periodically refreshes anchor slots with recent high-importance memories.
 *
 * Rationale: `autoReanchor` only discovers candidates via N-hop traversal from the
 * *current* anchor embedding, so it can never reach memories that have no relation
 * path back to a stale anchor.  This job bypasses that limitation by querying the
 * DB directly for recent/important memories and calling setAnchor explicitly.
 *
 * Staleness threshold: 1 day.  Only slots whose `updated_at` is older than that
 * are touched, so anchors updated by normal recall flow are never overwritten.
 *
 * Candidate scoring (#714): candidates with neither a relation nor an embedding
 * ("isolated") are deprioritized behind every other candidate, so a slot is only
 * ever pinned to an isolated memory when no connected alternative exists. The
 * isolation flag is the *first* SQL `ORDER BY` key (PR #721 review) so a
 * connected candidate ranked outside the old LIMIT window by
 * importance/created_at alone is still fetched ahead of higher-importance
 * isolated candidates, instead of being cut off before a JS-side sort ever
 * sees it.
 */
export async function runAnchorAutoRefresh(ctx: BatchSchedulerRunContext): Promise<BatchJobResult> {
  const result = createEmptyBatchJobResult('anchor_auto_refresh');

  try {
    if (!ctx.anchorManager || !ctx.db) {
      ctx.log('anchor_auto_refresh skipped: anchorManager or db not available');
      result.success = true;
      result.processed = 0;
      finalizeBatchJobTiming(result);
      return result;
    }

    const db = ctx.db;

    const agentIds = (
      db.prepare('SELECT DISTINCT agent_id FROM anchor').all() as { agent_id: string }[]
    ).map(r => r.agent_id);

    if (agentIds.length === 0) {
      result.success = true;
      result.processed = 0;
      finalizeBatchJobTiming(result);
      return result;
    }

    let totalMoved = 0;
    let isolatedPicks = 0;
    const stalenessThresholdDays = 1;
    const now = Date.now();

    for (const agentId of agentIds) {
      const existingAnchors = db
        .prepare('SELECT agent_id, slot, updated_at FROM anchor WHERE agent_id = ?')
        .all(agentId) as AnchorRow[];

      for (const slot of SLOTS) {
        const existing = existingAnchors.find(a => a.slot === slot);
        if (existing) {
          const updatedAt = new Date(existing.updated_at).getTime();
          const daysSince = (now - updatedAt) / (1000 * 60 * 60 * 24);
          if (daysSince < stalenessThresholdDays) {
            continue;
          }
        }

        // Pick the most recent high-importance memory for this agent.
        // NULL owner_id memories are shared across all agents (the common case).
        const slotIndex = SLOTS.indexOf(slot as Slot);
        const candidates = db
          .prepare(
            `SELECT
               m.id AS id,
               EXISTS(SELECT 1 FROM memory_relation r WHERE r.source_id = m.id OR r.target_id = m.id) AS has_relation,
               EXISTS(SELECT 1 FROM memory_embedding e WHERE e.memory_id = m.id) AS has_embedding
             FROM memory_item m
             WHERE (m.owner_id = ? OR m.owner_id IS NULL)
               AND m.deleted_at IS NULL
             ORDER BY (has_relation = 0 AND has_embedding = 0) ASC, m.importance DESC, m.created_at DESC
             LIMIT ?`
          )
          .all(agentId, slotIndex + 3) as MemoryCandidate[];

        const candidate = candidates[slotIndex] ?? candidates[candidates.length - 1];
        if (!candidate) {
          continue;
        }

        if (isIsolatedCandidate(candidate)) {
          isolatedPicks++;
          ctx.log(`anchor_auto_refresh: isolated candidate selected for ${agentId}/${slot} → ${candidate.id} (no connected alternative)`, undefined, 'warn');
        }

        try {
          await ctx.anchorManager.setAnchor(agentId, candidate.id, slot as Slot);
          totalMoved++;
          ctx.log(`anchor_auto_refresh: moved ${agentId}/${slot} → ${candidate.id}`);
        } catch (err) {
          result.errors.push(
            `Failed to set anchor ${agentId}/${slot}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }

    result.success = result.errors.length === 0;
    result.processed = totalMoved;
    result.details = { moved: totalMoved, isolatedPicks };
    ctx.log('anchor_auto_refresh completed', { moved: totalMoved, agents: agentIds.length, isolatedPicks });
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
    ctx.log('anchor_auto_refresh failed', error, 'error');
  } finally {
    finalizeBatchJobTiming(result);
  }

  return result;
}
