import type { Page, Request, Response, Route } from '@playwright/test';

export const API_KEY = 'e2e-programmatic-key';
export const SECRET = 'memento-e2e-secret-value';

export interface BrowserAudit {
  consoleMessages: string[];
  pageErrors: string[];
  responseBodies: string[];
  requests: Request[];
  settleResponses: () => Promise<void>;
}

interface AgentApiOptions {
  sessions?: Array<Record<string, unknown>>;
  sessionPages?: Array<{
    sessions: Array<Record<string, unknown>>;
    next_cursor?: string | null;
  }>;
  observations?: Array<Record<string, unknown>>;
  observationPages?: Array<{
    observations: Array<Record<string, unknown>>;
    next_cursor?: string | null;
  }>;
  injections?: Array<Record<string, unknown>>;
  provenance?: Record<string, unknown>;
  sessionsStatus?: number;
  sessionsMessage?: string;
  sessionsDelayMs?: number;
}

export function session(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    status: 'ACTIVE',
    adapter_name: 'codex',
    owner_id: 'owner-1',
    project_id: 'project-1',
    started_at: '2026-06-13T00:00:00.000Z',
    last_event_at: '2026-06-13T00:01:00.000Z',
    aggregate: { total: 5, redacted: 1, dropped: 1, degraded: 0 },
    ...overrides,
  };
}

export function observation(
  id: string,
  eventType: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    event_type: eventType,
    status: 'ACCEPTED',
    occurred_at: '2026-06-13T00:00:30.000Z',
    ...overrides,
  };
}

export function createAudit(page: Page): BrowserAudit {
  const pendingResponses = new Set<Promise<void>>();
  const audit: BrowserAudit = {
    consoleMessages: [],
    pageErrors: [],
    responseBodies: [],
    requests: [],
    settleResponses: () => Promise.all([...pendingResponses]).then(() => undefined),
  };
  page.on('console', (message) => audit.consoleMessages.push(message.text()));
  page.on('pageerror', (error) => audit.pageErrors.push(error.message));
  page.on('request', (request) => audit.requests.push(request));
  page.on('response', (response: Response) => {
    if (!response.url().includes('/api/v1/agent/')) {
      return;
    }
    const pending = response
      .text()
      .then((body) => audit.responseBodies.push(body))
      .catch(() => audit.responseBodies.push(''))
      .then(() => undefined);
    pendingResponses.add(pending);
    void pending.finally(() => pendingResponses.delete(pending));
  });
  return audit;
}

async function fulfillJson(
  route: Route,
  body: Record<string, unknown>,
  status = 200,
): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

export async function installDashboardRoutes(
  page: Page,
  options: AgentApiOptions = {},
): Promise<{ importedRows: () => number }> {
  let importedRows = 0;
  const sessions = options.sessions ?? [session('session-1')];
  const observations = options.observations ?? [
    observation('observation-prompt', 'USER_PROMPT'),
  ];

  await page.route('**/static/vendor/d3.v7.min.js', (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }),
  );
  await page.route('**/api/anchors/map?agent_id=default', (route) =>
    fulfillJson(route, { anchors: [], memories: [] }),
  );
  await page.route('**/api/v1/agent/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === '/api/v1/agent/sessions') {
      if (options.sessionsDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.sessionsDelayMs));
      }
      if (options.sessionsStatus && options.sessionsStatus >= 400) {
        await fulfillJson(
          route,
          { message: options.sessionsMessage ?? 'Agent sessions unavailable.' },
          options.sessionsStatus,
        );
        return;
      }
      const sessionPageIndex = url.searchParams.has('cursor') ? 1 : 0;
      const pageResult = options.sessionPages?.[
        Math.min(sessionPageIndex, options.sessionPages.length - 1)
      ];
      await fulfillJson(route, {
        sessions: pageResult?.sessions ?? sessions,
        next_cursor: pageResult?.next_cursor ?? null,
        aggregate: {
          sessions_total: 10_000,
          observations_total: 10_000,
          redacted_total: 1,
          dropped_total: 1,
          degraded_total: sessions.filter((item) => item.status === 'DEGRADED').length,
        },
      });
      return;
    }

    const observationMatch = path.match(
      /^\/api\/v1\/agent\/sessions\/([^/]+)\/observations$/,
    );
    if (observationMatch) {
      const observationPageIndex = url.searchParams.has('cursor') ? 1 : 0;
      const pageResult = options.observationPages?.[
        Math.min(observationPageIndex, options.observationPages.length - 1)
      ];
      const requestedLimit = Number(url.searchParams.get('limit') ?? 100);
      const limit = Math.min(Number.isFinite(requestedLimit) ? requestedLimit : 100, 100);
      const cursor = Number(url.searchParams.get('cursor') ?? 0);
      const offset = Number.isFinite(cursor) ? cursor : 0;
      const eventType = url.searchParams.get('event_type');
      const status = url.searchParams.get('status');
      const filtered = observations.filter((item) =>
        (!eventType || item.event_type === eventType) &&
        (!status || item.status === status),
      );
      const pagedObservations = filtered.slice(offset, offset + limit);
      const nextCursor = offset + limit < filtered.length ? String(offset + limit) : null;
      await fulfillJson(route, {
        observations: pageResult?.observations ?? pagedObservations,
        next_cursor: pageResult?.next_cursor ?? nextCursor,
        aggregate: { total: 10_000 },
      });
      return;
    }

    const injectionMatch = path.match(
      /^\/api\/v1\/agent\/sessions\/([^/]+)\/injections$/,
    );
    if (injectionMatch) {
      await fulfillJson(route, { injections: options.injections ?? [] });
      return;
    }

    const sessionMatch = path.match(/^\/api\/v1\/agent\/sessions\/([^/]+)$/);
    if (sessionMatch) {
      const selected = sessions.find((item) => item.id === sessionMatch[1]) ??
        session(sessionMatch[1]);
      await fulfillJson(route, { session: selected });
      return;
    }

    if (path === '/api/v1/agent/provenance/detail') {
      await fulfillJson(
        route,
        options.provenance ?? {
          memories: [{ id: 'memory-1', content_preview: 'safe metadata' }],
          observations: [
            { id: 'observation-1', event_type: 'TOOL_RESULT', status: 'ACCEPTED' },
          ],
          sessions: [session('session-1')],
        },
      );
      return;
    }

    if (path === '/api/v1/agent/transcripts/import') {
      const body = request.postDataJSON() as { jsonl?: string; dry_run?: boolean };
      if (body.jsonl?.includes(SECRET) || body.jsonl?.includes('invalid-json')) {
        await fulfillJson(route, { message: 'Transcript validation failed.' }, 400);
        return;
      }
      const duplicate = body.jsonl?.includes('duplicate-event') ?? false;
      if (!body.dry_run && !duplicate) {
        importedRows += 1;
      }
      await fulfillJson(
        route,
        {
          dry_run: Boolean(body.dry_run),
          valid: true,
          accepted_count: duplicate ? 0 : 1,
          duplicate_count: duplicate ? 1 : 0,
          redacted_count: 0,
          dropped_count: 0,
        },
        body.dry_run ? 200 : 201,
      );
      return;
    }

    await fulfillJson(route, { message: 'Unhandled E2E route.' }, 404);
  });

  return { importedRows: () => importedRows };
}

export async function openAgentSessions(page: Page, apiKey = API_KEY): Promise<void> {
  await page.goto('/dashboard');
  await page.getByRole('tab', { name: 'Agent Sessions' }).click();
  await page.getByLabel('Programmatic API Key').fill(apiKey);
  await page.getByRole('button', { name: 'Connect' }).click();
}
