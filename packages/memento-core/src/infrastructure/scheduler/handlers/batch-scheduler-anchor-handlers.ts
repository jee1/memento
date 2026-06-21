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
}

/**
 * Periodically refreshes anchor slots with recent high-importance memories.
 *
 * Rationale: `autoReanchor` only discovers candidates via N-hop traversal from the
 * *current* anchor embedding, so it can never reach memories that have no relation
 * path back to a stale anchor.  This job bypasses that limitation by querying the
 * DB directly for recent/important memories and calling setAnchor explicitly.
 *
 * Staleness threshold: 7 days.  Only slots whose `updated_at` is older than that
 * are touched, so anchors updated by normal recall flow are never overwritten.
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
    const stalenessThresholdDays = 7;
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
            `SELECT id FROM memory_item
             WHERE (owner_id = ? OR owner_id IS NULL)
               AND deleted_at IS NULL
             ORDER BY importance DESC, created_at DESC
             LIMIT ?`
          )
          .all(agentId, slotIndex + 3) as MemoryCandidate[];

        const candidate = candidates[slotIndex] ?? candidates[candidates.length - 1];
        if (!candidate) {
          continue;
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
    ctx.log('anchor_auto_refresh completed', { moved: totalMoved, agents: agentIds.length });
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : String(error));
    ctx.log('anchor_auto_refresh failed', error, 'error');
  } finally {
    finalizeBatchJobTiming(result);
  }

  return result;
}
