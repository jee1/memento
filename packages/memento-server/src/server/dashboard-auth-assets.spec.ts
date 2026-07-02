import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

import { describe, expect, it, vi } from 'vitest';

const dashboardHtmlPath = resolve(process.cwd(), 'static/dashboard.html');
const graphHtmlPath = resolve(process.cwd(), 'static/graph.html');
const dashboardFetchPath = resolve(process.cwd(), 'static/js/memento-admin-fetch.js');
const DASHBOARD_AUTH_SCRIPTS = [
  'dashboard-auth-state.js',
  'dashboard-auth-dom.js',
  'dashboard-auth-render-tabs.js',
  'dashboard-auth-render-message.js',
  'dashboard-auth-render-form.js',
  'dashboard-auth-render-status.js',
  'dashboard-auth-render.js',
  'dashboard-auth-ui.js',
  'dashboard-auth-error.js',
  'dashboard-auth-session-check.js',
  'dashboard-auth-sign-in.js',
  'dashboard-auth-requests.js',
  'dashboard-auth.js',
] as const;

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error?: unknown) => void;
};

class FakeElement {
  hidden = false;
  disabled = false;
  value = '';
  textContent = '';
  dataset: Record<string, string> = {};
  listeners = new Map<string, Array<(event?: any) => void>>();
  focus = vi.fn();

  addEventListener(type: string, listener: (event?: any) => void): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  dispatch(type: string, event: any = {}): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

class FakeDocument {
  private readonly elementsById: Record<string, FakeElement>;
  private readonly domContentLoadedListeners: Array<() => void> = [];
  private readonly root: FakeElement;

  constructor(elementsById: Record<string, FakeElement>, root: FakeElement) {
    this.elementsById = elementsById;
    this.root = root;
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === 'DOMContentLoaded') {
      this.domContentLoadedListeners.push(listener);
    }
  }

  dispatchDOMContentLoaded(): void {
    for (const listener of this.domContentLoadedListeners) {
      listener();
    }
  }

  querySelector(selector: string): FakeElement | null {
    if (selector === '.dashboard-container') {
      return this.root;
    }
    return null;
  }

  getElementById(id: string): FakeElement | null {
    return this.elementsById[id] ?? null;
  }
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createJsonResponse(status: number, payload?: unknown) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(payload)
  };
}

function createNoContentResponse() {
  return {
    status: 204,
    ok: true,
    json: () => Promise.reject(new Error('No JSON body'))
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createDashboardHarness(fetchImpl: (url: string, opts?: Record<string, any>) => Promise<any>) {
  const root = new FakeElement();
  const form = new FakeElement();
  const apiKeyInput = new FakeElement();
  const signInButton = new FakeElement();
  const signOutButton = new FakeElement();
  const sessionBox = new FakeElement();
  const status = new FakeElement();
  const message = new FakeElement();

  const document = new FakeDocument(
    {
      'dashboard-auth-form': form,
      'dashboard-api-key': apiKeyInput,
      'dashboard-sign-in-btn': signInButton,
      'dashboard-sign-out-btn': signOutButton,
      'dashboard-auth-session': sessionBox,
      'dashboard-auth-status': status,
      'dashboard-auth-message': message
    },
    root
  );

  const location = {
    reload: vi.fn()
  };

  const sandbox: Record<string, any> = {
    console,
    Promise,
    document,
    fetch: vi.fn(fetchImpl),
    location,
    setTimeout,
    clearTimeout
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;

  const context = vm.createContext(sandbox);
  const authSource = DASHBOARD_AUTH_SCRIPTS.map((name) =>
    readFileSync(resolve(process.cwd(), 'static/js', name), 'utf8'),
  ).join('\n');
  const fetchSource = readFileSync(dashboardFetchPath, 'utf8');
  vm.runInContext(authSource, context, { filename: 'dashboard-auth.js' });
  vm.runInContext(fetchSource, context, { filename: 'memento-admin-fetch.js' });
  document.dispatchDOMContentLoaded();

  return {
    apiKeyInput,
    context,
    document,
    form,
    location,
    message,
    root,
    sessionBox,
    signInButton,
    signOutButton,
    status
  };
}

describe('dashboard auth assets', () => {
  it('does not load the browser key config script from dashboard.html', () => {
    const dashboardHtml = readFileSync(dashboardHtmlPath, 'utf8');

    expect(dashboardHtml).not.toContain('/static/js/memento-admin-config.js');
  });

  it('does not load the browser key config script from graph.html', () => {
    const graphHtml = readFileSync(graphHtmlPath, 'utf8');

    expect(graphHtml).not.toContain('/static/js/memento-admin-config.js');
  });

  it('loads the shared dashboard re-auth script from graph.html', () => {
    const graphHtml = readFileSync(graphHtmlPath, 'utf8');

    expect(graphHtml).toContain('/static/js/dashboard-auth.js');
  });

  it('loads dashboard auth companion scripts before the auth bootstrap', () => {
    const dashboardHtml = readFileSync(dashboardHtmlPath, 'utf8');
    const graphHtml = readFileSync(graphHtmlPath, 'utf8');

    for (const name of DASHBOARD_AUTH_SCRIPTS) {
      expect(dashboardHtml).toContain(`/static/js/${name}`);
      expect(graphHtml).toContain(`/static/js/${name}`);
    }
    expect(dashboardHtml.indexOf('/static/js/dashboard-auth-requests.js')).toBeLessThan(
      dashboardHtml.indexOf('/static/js/dashboard-auth.js'),
    );
    expect(graphHtml.indexOf('/static/js/dashboard-auth-requests.js')).toBeLessThan(
      graphHtml.indexOf('/static/js/dashboard-auth.js'),
    );
  });

  it('renders a graph auth form so signed-out users can start a session from /graph', () => {
    const graphHtml = readFileSync(graphHtmlPath, 'utf8');

    expect(graphHtml).toContain('graph-auth-form');
    expect(graphHtml).toContain('graph-api-key');
    expect(graphHtml).toContain('graph-sign-in-btn');
    expect(graphHtml).toContain('graph-sign-out-btn');
    expect(graphHtml).toContain('graph-auth-message');
  });

  it('keeps the graph controls gated behind a browser session', () => {
    const graphHtml = readFileSync(graphHtmlPath, 'utf8');

    expect(graphHtml).toContain('graph-auth-required');
    expect(graphHtml).toContain('graph-session-only');
    expect(graphHtml).toContain('/graph`는 브라우저 세션이 생긴 뒤에만 그래프를 표시합니다.');
  });

  it('does not keep browser api key fallback logic in memento-admin-fetch.js', () => {
    const dashboardFetch = readFileSync(dashboardFetchPath, 'utf8');

    expect(dashboardFetch).not.toContain('sessionStorage');
    expect(dashboardFetch).not.toContain('__MEMENTO_ADMIN_FETCH_CONFIG__');
    expect(dashboardFetch).not.toContain('Authorization');
  });

  it('ignores a stale startup 401 after a newer sign-in succeeds', async () => {
    const startupProbe = createDeferred<any>();
    const signInRequest = createDeferred<any>();

    const harness = createDashboardHarness((url, opts) => {
      if (url === '/api/anchors/map?agent_id=default') {
        return startupProbe.promise;
      }
      if (url === '/auth/session' && opts?.method === 'POST') {
        return signInRequest.promise;
      }
      throw new Error('Unexpected fetch: ' + url);
    });

    harness.apiKeyInput.value = 'fresh-session-key';
    harness.form.dispatch('submit', {
      preventDefault() {}
    });

    signInRequest.resolve(createNoContentResponse());
    await flushPromises();

    expect(harness.context.__MEMENTO_DASHBOARD_AUTH__.getState()).toBe('signed-in');
    expect(harness.root.dataset.authState).toBe('signed-in');
    expect(harness.sessionBox.hidden).toBe(false);

    startupProbe.resolve(
      createJsonResponse(401, {
        message: 'Admin dashboard session is missing or expired.'
      })
    );
    await flushPromises();

    expect(harness.context.__MEMENTO_DASHBOARD_AUTH__.getState()).toBe('signed-in');
    expect(harness.root.dataset.authState).toBe('signed-in');
    await expect(harness.context.__MEMENTO_DASHBOARD_AUTH__.waitForSession()).resolves.toBeUndefined();
  });

  it('retries mementoAdminFetch after the dashboard re-auth flow restores the session', async () => {
    let protectedCallCount = 0;

    const harness = createDashboardHarness((url, opts) => {
      if (url === '/api/anchors/map?agent_id=default') {
        return Promise.resolve(createJsonResponse(200, { anchors: [], nodes: [], links: [] }));
      }
      if (url === '/api/protected') {
        protectedCallCount += 1;
        if (protectedCallCount === 1) {
          return Promise.resolve(
            createJsonResponse(401, {
              message: 'Admin dashboard session is missing or expired.'
            })
          );
        }
        return Promise.resolve(createJsonResponse(200, { ok: true }));
      }
      if (url === '/auth/session' && opts?.method === 'POST') {
        return Promise.resolve(createNoContentResponse());
      }
      throw new Error('Unexpected fetch: ' + url);
    });

    await flushPromises();
    expect(harness.context.__MEMENTO_DASHBOARD_AUTH__.getState()).toBe('signed-in');

    let resolved = false;
    const protectedRequest = harness.context.mementoAdminFetch('/api/protected').then((response: any) => {
      resolved = true;
      return response;
    });

    await flushPromises();

    expect(harness.context.__MEMENTO_DASHBOARD_AUTH__.getState()).toBe('signed-out');
    expect(resolved).toBe(false);

    harness.apiKeyInput.value = 'restored-session-key';
    harness.form.dispatch('submit', {
      preventDefault() {}
    });

    const response = await protectedRequest;
    await flushPromises();

    expect(response.status).toBe(200);
    expect(protectedCallCount).toBe(2);
    expect(harness.context.__MEMENTO_DASHBOARD_AUTH__.getState()).toBe('signed-in');
  });

  it('does not treat /tools/* 401 as dashboard session expiration', async () => {
    const harness = createDashboardHarness((url) => {
      if (url === '/api/anchors/map?agent_id=default') {
        return Promise.resolve(createJsonResponse(200, { anchors: [], nodes: [], links: [] }));
      }
      if (url === '/tools/search_local') {
        return Promise.resolve(
          createJsonResponse(401, {
            message: 'Programmatic routes require Authorization: Bearer <key> or X-API-Key.'
          })
        );
      }
      throw new Error('Unexpected fetch: ' + url);
    });

    await flushPromises();
    expect(harness.context.__MEMENTO_DASHBOARD_AUTH__.getState()).toBe('signed-in');

    const response = await harness.context.mementoAdminFetch('/tools/search_local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'test', slot: 'A', agent_id: 'default' })
    });

    expect(response.status).toBe(401);
    expect(harness.context.__MEMENTO_DASHBOARD_AUTH__.getState()).toBe('signed-in');
    expect(harness.root.dataset.authState).toBe('signed-in');
  });
});
