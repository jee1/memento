import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_REVIEW_QUEUE_DASHBOARD_BOOT,
  buildReviewQueueBootInjectionHtml,
  injectReviewQueueBootIntoDashboardHtml,
  resolveReviewQueueDashboardBootFromEnv,
  REVIEW_QUEUE_DASHBOARD_BOOT_MARKER
} from './review-queue-dashboard-boot.js';

describe('review-queue-dashboard-boot (#274)', () => {
  const saved = { ...process.env };

  afterEach(() => {
    process.env = { ...saved };
  });

  it('defaults match legacy 60s poll and empty backoff', () => {
    delete process.env.MEMENTO_REVIEW_QUEUE_POLL_INTERVAL_MS;
    delete process.env.MEMENTO_REVIEW_QUEUE_POLL_ERROR_BACKOFF_MS;
    expect(resolveReviewQueueDashboardBootFromEnv()).toEqual(DEFAULT_REVIEW_QUEUE_DASHBOARD_BOOT);
  });

  it('parses poll interval and clamps to bounds', () => {
    process.env.MEMENTO_REVIEW_QUEUE_POLL_INTERVAL_MS = '120000';
    expect(resolveReviewQueueDashboardBootFromEnv().pollIntervalMs).toBe(120_000);

    process.env.MEMENTO_REVIEW_QUEUE_POLL_INTERVAL_MS = '1000';
    expect(resolveReviewQueueDashboardBootFromEnv().pollIntervalMs).toBe(10_000);

    process.env.MEMENTO_REVIEW_QUEUE_POLL_INTERVAL_MS = 'not-a-number';
    expect(resolveReviewQueueDashboardBootFromEnv().pollIntervalMs).toBe(60_000);
  });

  it('parses comma-separated backoff steps', () => {
    process.env.MEMENTO_REVIEW_QUEUE_POLL_ERROR_BACKOFF_MS = '30000, 90000';
    expect(resolveReviewQueueDashboardBootFromEnv().pollErrorBackoffMs).toEqual([30_000, 90_000]);
  });

  it('injects boot script at marker', () => {
    const html = `<head>${REVIEW_QUEUE_DASHBOARD_BOOT_MARKER}</head>`;
    const boot = { pollIntervalMs: 45_000, pollErrorBackoffMs: [20_000] };
    const out = injectReviewQueueBootIntoDashboardHtml(html, boot);
    expect(out).toContain('window.__MEMENTO_REVIEW_QUEUE__=');
    expect(out).not.toContain(REVIEW_QUEUE_DASHBOARD_BOOT_MARKER);
    expect(out).toContain('"pollIntervalMs":45000');
  });

  it('buildReviewQueueBootInjectionHtml wraps JSON in one script tag', () => {
    const html = buildReviewQueueBootInjectionHtml({
      pollIntervalMs: 60_000,
      pollErrorBackoffMs: [30_000]
    });
    expect(html.startsWith('<script>window.__MEMENTO_REVIEW_QUEUE__=')).toBe(true);
    expect(html.endsWith(';</script>')).toBe(true);
  });
});
