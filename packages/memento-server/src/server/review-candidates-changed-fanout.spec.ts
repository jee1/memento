import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildReviewCandidatesChangedEnvelope,
  broadcastReviewCandidatesChanged,
  parseReviewCandidatesChangedRelayUrls
} from './review-candidates-changed-fanout.js';
import { resetReviewCandidatesSseHubForTests } from './review-candidates-sse-hub.js';

describe('review-candidates-changed-fanout', () => {
  const relayEnv = 'MEMENTO_REVIEW_CANDIDATES_CHANGED_RELAY_URLS';
  const secretEnv = 'MEMENTO_REVIEW_CANDIDATES_CHANGED_RELAY_SECRET';

  beforeEach(() => {
    resetReviewCandidatesSseHubForTests();
    vi.restoreAllMocks();
    delete process.env[relayEnv];
    delete process.env[secretEnv];
  });

  afterEach(() => {
    resetReviewCandidatesSseHubForTests();
    delete process.env[relayEnv];
    delete process.env[secretEnv];
  });

  it('parseReviewCandidatesChangedRelayUrls splits and trims', () => {
    expect(parseReviewCandidatesChangedRelayUrls({ [relayEnv]: ' http://a/x , http://b/y  ' })).toEqual([
      'http://a/x',
      'http://b/y'
    ]);
    expect(parseReviewCandidatesChangedRelayUrls({})).toEqual([]);
  });

  it('buildReviewCandidatesChangedEnvelope matches contract shape', () => {
    const env = buildReviewCandidatesChangedEnvelope('review', 'corr-1');
    expect(env.schema_version).toBe(1);
    expect(env.kind).toBe('review_candidates_changed');
    expect(env.correlation_id).toBe('corr-1');
    expect(env.idempotency_key).toBe('mrc:v1:changed:corr-1:review');
    expect(env.producer.name).toBe('memento-http-admin');
    expect(env.payload).toEqual({ reason: 'review', approx_pending_delta_hint: null });
  });

  it('broadcastReviewCandidatesChanged POSTs to relay URLs when configured', async () => {
    process.env[relayEnv] = 'http://127.0.0.1:9/nope';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    broadcastReviewCandidatesChanged({ reason: 'dismiss', correlationId: 'fixed-corr' });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:9/nope',
      expect.objectContaining({
        method: 'POST'
      })
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
    const body = JSON.parse(init.body as string) as { correlation_id?: string };
    expect(body.correlation_id).toBe('fixed-corr');
  });

  it('broadcastReviewCandidatesChanged adds Authorization when relay secret set', async () => {
    process.env[relayEnv] = 'http://127.0.0.1:9/hook';
    process.env[secretEnv] = 'test-secret';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    broadcastReviewCandidatesChanged({ reason: 'review' });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-secret');
  });
});
