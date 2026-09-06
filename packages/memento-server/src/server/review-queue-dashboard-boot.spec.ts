import { afterEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_REVIEW_QUEUE_DASHBOARD_BOOT,
  buildReviewQueueBootInjectionHtml,
  injectReviewQueueBootIntoDashboardHtml,
  resolveReviewQueueDashboardBootFromEnv,
  REVIEW_QUEUE_DASHBOARD_BOOT_ELEMENT_ID,
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
    expect(out).toContain(`id="${REVIEW_QUEUE_DASHBOARD_BOOT_ELEMENT_ID}"`);
    expect(out).not.toContain(REVIEW_QUEUE_DASHBOARD_BOOT_MARKER);
    expect(out).toContain('"pollIntervalMs":45000');
  });

  it('buildReviewQueueBootInjectionHtml emits a non-executable JSON data block (#875)', () => {
    const html = buildReviewQueueBootInjectionHtml({
      pollIntervalMs: 60_000,
      pollErrorBackoffMs: [30_000]
    });
    // 실행되는 인라인 스크립트는 CSP script-src 'self' 에 막힌다 — 데이터 블록이어야 한다
    expect(html.startsWith(`<script type="application/json" id="${REVIEW_QUEUE_DASHBOARD_BOOT_ELEMENT_ID}">`)).toBe(true);
    expect(html.endsWith('</script>')).toBe(true);
    expect(html).not.toContain('window.');

    const json = html.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    expect(JSON.parse(json)).toEqual({ pollIntervalMs: 60_000, pollErrorBackoffMs: [30_000] });
  });

});
