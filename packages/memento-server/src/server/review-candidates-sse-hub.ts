/**
 * In-process SSE fan-out for Admin review queue (#276). Single-node only; no Redis.
 * Admin routes should call `broadcastReviewCandidatesChanged` (#297) so optional HTTP relay runs too.
 */
import type { Response } from 'express';

const clients = new Set<Response>();

const PING_MS = 25_000;

/** Test helper: close all connections and clear registry. */
export function resetReviewCandidatesSseHubForTests(): void {
  for (const res of clients) {
    try {
      res.end();
    } catch {
      /* ignore */
    }
  }
  clients.clear();
}

function writeSafe(res: Response, chunk: string): boolean {
  try {
    if (res.writableEnded) {
      return false;
    }
    res.write(chunk);
    return true;
  } catch {
    return false;
  }
}

/**
 * Starts SSE response: headers, retry hint, `ready` event, periodic comment ping.
 * Caller must mount this only behind the same auth as other `/admin` JSON routes.
 */
export function attachReviewCandidatesSse(res: Response): void {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }

  clients.add(res);

  const ping = setInterval(() => {
    if (!writeSafe(res, ': ping\n\n')) {
      clearInterval(ping);
      clients.delete(res);
    }
  }, PING_MS);

  const cleanup = (): void => {
    clearInterval(ping);
    clients.delete(res);
  };

  res.on('close', cleanup);

  writeSafe(res, 'retry: 3000\n\n');
  writeSafe(res, `event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
}

export function notifyReviewCandidatesChanged(reason: string): void {
  const frame = `event: changed\ndata: ${JSON.stringify({ reason })}\n\n`;
  const dead: Response[] = [];
  for (const res of clients) {
    if (!writeSafe(res, frame)) {
      dead.push(res);
    }
  }
  for (const r of dead) {
    clients.delete(r);
  }
}
