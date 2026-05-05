/**
 * HTTP 대시보드 Review Queue 패널 폴링 부트 설정 (#274).
 * `GET /dashboard` 응답에 인라인 스크립트로 `window.__MEMENTO_REVIEW_QUEUE__`를 주입한다.
 */

export type ReviewQueueDashboardBoot = {
  pollIntervalMs: number;
  pollErrorBackoffMs: number[];
};

export const DEFAULT_REVIEW_QUEUE_DASHBOARD_BOOT: ReviewQueueDashboardBoot = {
  pollIntervalMs: 60_000,
  pollErrorBackoffMs: []
};

/** dashboard.html에 두는 플레이스홀더(서버가 치환). */
export const REVIEW_QUEUE_DASHBOARD_BOOT_MARKER = '<!--MEMENTO_REVIEW_QUEUE_BOOT-->';

const MIN_POLL_MS = 10_000;
const MAX_POLL_MS = 24 * 60 * 60 * 1000;

function parsePositiveIntMs(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') {
    return fallback;
  }
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return n;
}

function clampIntervalMs(n: number): number {
  return Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, n));
}

function parseBackoffCsv(raw: string | undefined): number[] {
  if (raw == null || raw.trim() === '') {
    return [];
  }
  const out: number[] = [];
  for (const part of raw.split(',')) {
    const n = Number.parseInt(part.trim(), 10);
    if (Number.isFinite(n) && n > 0) {
      out.push(clampIntervalMs(n));
    }
  }
  return out;
}

/** 환경 변수에서 Review Queue 대시보드 부트 설정을 해석한다. */
export function resolveReviewQueueDashboardBootFromEnv(
  env: NodeJS.ProcessEnv = process.env
): ReviewQueueDashboardBoot {
  const pollIntervalMs = clampIntervalMs(
    parsePositiveIntMs(
      env.MEMENTO_REVIEW_QUEUE_POLL_INTERVAL_MS,
      DEFAULT_REVIEW_QUEUE_DASHBOARD_BOOT.pollIntervalMs
    )
  );
  const pollErrorBackoffMs = parseBackoffCsv(env.MEMENTO_REVIEW_QUEUE_POLL_ERROR_BACKOFF_MS);
  return { pollIntervalMs, pollErrorBackoffMs };
}

/** 인라인 스크립트(한 줄). JSON은 `<`를 이스케이프해 `</script>` 조각 주입을 방지한다. */
export function buildReviewQueueBootInjectionHtml(boot: ReviewQueueDashboardBoot): string {
  const json = JSON.stringify(boot).replace(/</g, '\\u003c');
  return `<script>window.__MEMENTO_REVIEW_QUEUE__=${json};</script>`;
}

export function injectReviewQueueBootIntoDashboardHtml(
  dashboardHtml: string,
  boot: ReviewQueueDashboardBoot
): string {
  if (!dashboardHtml.includes(REVIEW_QUEUE_DASHBOARD_BOOT_MARKER)) {
    return dashboardHtml;
  }
  return dashboardHtml.replace(REVIEW_QUEUE_DASHBOARD_BOOT_MARKER, buildReviewQueueBootInjectionHtml(boot));
}
