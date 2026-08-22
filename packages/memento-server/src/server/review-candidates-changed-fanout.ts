/**
 * Review queue `review_candidates_changed` fan-out PoC (#297).
 *
 * Keeps in-process SSE (single-node) and optionally POSTs the same logical event
 * to comma-separated webhook URLs — simulating a broker hop for loss/latency experiments.
 *
 * Envelope aligns with the immutable baseline contract §3.3:
 * https://github.com/jee1/memento/blob/44ad88e2583b6486a30ca362729c68ebdeb45702/docs/_work/solutions/2026-05-09-review-queue-boundary-idempotency-contract.md
 */
import { randomUUID } from 'node:crypto';
import { notifyReviewCandidatesChanged } from './review-candidates-sse-hub.js';
import { logger } from '@memento/core';

const RELAY_ENV = 'MEMENTO_REVIEW_CANDIDATES_CHANGED_RELAY_URLS';
const RELAY_SECRET_ENV = 'MEMENTO_REVIEW_CANDIDATES_CHANGED_RELAY_SECRET';
const RELAY_TIMEOUT_MS = 3000;

export type ReviewCandidatesChangedReason =
  | 'review'
  | 'dismiss'
  | 'bulk_dismiss'
  | 'bulk_expire'
  | 'batch_memory_review_candidates';

/** Wire contract: `kind: review_candidates_changed` (schema v1). */
export type ReviewCandidatesChangedEnvelope = {
  schema_version: 1;
  kind: 'review_candidates_changed';
  idempotency_key: string;
  correlation_id: string;
  occurred_at: string;
  producer: { name: 'memento-http-admin'; instance_id?: string };
  payload: {
    reason: string;
    approx_pending_delta_hint: null;
  };
};

export function parseReviewCandidatesChangedRelayUrls(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = env[RELAY_ENV]?.trim();
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

export function buildReviewCandidatesChangedEnvelope(
  reason: ReviewCandidatesChangedReason,
  correlationId: string
): ReviewCandidatesChangedEnvelope {
  const idempotencyKey = `mrc:v1:changed:${correlationId}:${reason}`;
  const instance_id = typeof process.env.HOSTNAME === 'string' && process.env.HOSTNAME.trim() !== ''
    ? process.env.HOSTNAME.trim()
    : undefined;

  return {
    schema_version: 1,
    kind: 'review_candidates_changed',
    idempotency_key: idempotencyKey,
    correlation_id: correlationId,
    occurred_at: new Date().toISOString(),
    producer: { name: 'memento-http-admin', ...(instance_id ? { instance_id } : {}) },
    payload: {
      reason,
      approx_pending_delta_hint: null
    }
  };
}

async function relayPost(url: string, body: ReviewCandidatesChangedEnvelope, secret?: string): Promise<void> {
  const started = performance.now();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
  }
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    /* keep raw for logging if malformed — fetch will fail */
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(RELAY_TIMEOUT_MS)
    });
    const relayMs = Math.round(performance.now() - started);
    logger.info('review_candidates_changed fan-out relay finished', {
      relayHost: host,
      relayMs,
      relayOk: res.ok,
      relayStatus: res.status
    });
  } catch (error) {
    const relayMs = Math.round(performance.now() - started);
    logger.warn('review_candidates_changed fan-out relay failed', {
      relayHost: host,
      relayMs,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

/** Fire SSE notify, then optionally POST envelope to relay URLs (non-blocking). */
export function broadcastReviewCandidatesChanged(opts: {
  reason: ReviewCandidatesChangedReason;
  correlationId?: string;
}): void {
  const { reason, correlationId: correlationIdOpt } = opts;
  const correlationId = correlationIdOpt ?? randomUUID();

  notifyReviewCandidatesChanged(reason);

  const urls = parseReviewCandidatesChangedRelayUrls();
  if (urls.length === 0) {
    return;
  }

  const envelope = buildReviewCandidatesChangedEnvelope(reason, correlationId);
  const secret = process.env[RELAY_SECRET_ENV]?.trim() || undefined;

  void Promise.all(urls.map(u => relayPost(u, envelope, secret)));
}
