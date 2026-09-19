import { readFileSync } from 'fs';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function loadStrip(): { render: (data: unknown) => void; dots: Record<string, string> } {
  const source = readFileSync(join(process.cwd(), 'static/js/ops-strip.js'), 'utf-8');
  const dots: Record<string, string> = {};
  const texts: Record<string, string> = {};
  const elements: Record<string, unknown> = {};

  function element(id: string) {
    if (!elements[id]) {
      elements[id] = {
        set className(value: string) {
          dots[id] = value;
        },
        set textContent(value: string) {
          texts[id] = value;
        },
        setAttribute: () => undefined,
        getAttribute: () => 'true',
        addEventListener: () => undefined,
        hidden: false,
      };
    }
    return elements[id];
  }

  const win: Record<string, unknown> = {
    document: {
      readyState: 'complete',
      getElementById: (id: string) => element(id),
      addEventListener: () => undefined,
    },
    localStorage: null,
    fetch: () => Promise.reject(new Error('not used')),
  };

  // eslint-disable-next-line no-new-func
  new Function('window', source + '\n//# sourceURL=ops-strip.js')(win);

  const api = win.__MEMENTO_OPS_STRIP__ as { load: () => Promise<void> };
  expect(api).toBeTruthy();

  // render is private; reach it through the module's own load path is overkill,
  // so re-evaluate with a hook that exposes it.
  const exposed = new Function(
    'window',
    source.replace('global.__MEMENTO_OPS_STRIP__ = { load: load, init: init };', 'global.__MEMENTO_OPS_STRIP__ = { load: load, init: init, render: render };')
  );
  const win2: Record<string, unknown> = {
    document: win.document,
    localStorage: null,
    fetch: win.fetch,
  };
  exposed(win2);
  const api2 = win2.__MEMENTO_OPS_STRIP__ as { render: (data: unknown) => void };
  return { render: api2.render, dots };
}

function statusPayload(lastFailedAt: string | null, status = 'ok') {
  return {
    timestamp: new Date().toISOString(),
    process: { status: 'ok' },
    batchImpact: { status, failedRunCount: lastFailedAt ? 1 : 0, lastFailedAt },
    review: { status: 'ok', pendingTotal: 0 },
    embedding: { status: 'ok', problemCount: 0 },
  };
}

describe('이슈 #1054 실패 실행 점은 최근성으로 칠한다', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('24시간 이내 실패는 degraded 로 표시한다', () => {
    const { render, dots } = loadStrip();

    render(statusPayload(new Date(Date.now() - 60 * 60 * 1000).toISOString()));

    expect(dots['ops-strip-failed-dot']).toContain('ops-strip__dot--degraded');
  });

  it('24시간보다 오래된 실패는 ok 로 되돌린다 — 30일 창이 한 달 내내 경고를 켜 두지 않도록', () => {
    const { render, dots } = loadStrip();

    render(statusPayload(new Date(Date.now() - 40 * 60 * 60 * 1000).toISOString()));

    expect(dots['ops-strip-failed-dot']).toContain('ops-strip__dot--ok');
  });

  it('실패 기록이 없으면 ok 다', () => {
    const { render, dots } = loadStrip();

    render(statusPayload(null));

    expect(dots['ops-strip-failed-dot']).toContain('ops-strip__dot--ok');
  });

  it('섹션을 읽지 못했으면 unavailable 이다', () => {
    const { render, dots } = loadStrip();

    render(statusPayload(new Date().toISOString(), 'degraded'));

    expect(dots['ops-strip-failed-dot']).toContain('ops-strip__dot--unavailable');
  });
});
