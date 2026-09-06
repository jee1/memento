import { expect, test } from '@playwright/test';

const d3Stub = `
(function () {
  var svgNs = 'http://www.w3.org/2000/svg';

  function createElement(parent, tag) {
    return document.createElementNS(svgNs, tag);
  }

  function Selection(elements, parents) {
    this.elements = elements || [];
    this.parents = parents || [];
    this._data = [];
  }

  Selection.prototype.node = function () {
    return this.elements[0] || null;
  };

  Selection.prototype.append = function (tag) {
    var created = [];
    this.elements.forEach(function (element) {
      var child = createElement(element, tag);
      child.__data__ = element.__data__;
      element.appendChild(child);
      created.push(child);
    });
    return new Selection(created, this.elements);
  };

  Selection.prototype.attr = function (name, value) {
    this.elements.forEach(function (element, index) {
      var next = typeof value === 'function' ? value(element.__data__, index) : value;
      if (next == null) {
        element.removeAttribute(name);
      } else {
        element.setAttribute(name, String(next));
      }
    });
    return this;
  };

  Selection.prototype.style = function (name, value) {
    this.elements.forEach(function (element, index) {
      element.style[name] = typeof value === 'function' ? value(element.__data__, index) : value;
    });
    return this;
  };

  Selection.prototype.text = function (value) {
    this.elements.forEach(function (element, index) {
      element.textContent = typeof value === 'function' ? value(element.__data__, index) : value;
    });
    return this;
  };

  Selection.prototype.classed = function (className, value) {
    this.elements.forEach(function (element, index) {
      var enabled = typeof value === 'function' ? value(element.__data__, index) : value;
      element.classList.toggle(className, Boolean(enabled));
    });
    return this;
  };

  Selection.prototype.select = function (selector) {
    var found = [];
    this.elements.forEach(function (element) {
      var match = element.querySelector(selector);
      if (match) found.push(match);
    });
    return new Selection(found, this.elements);
  };

  Selection.prototype.selectAll = function (selector) {
    var found = [];
    this.elements.forEach(function (element) {
      found = found.concat(Array.from(element.querySelectorAll(selector)));
    });
    return new Selection(found, this.elements);
  };

  Selection.prototype.remove = function () {
    this.elements.forEach(function (element) {
      if (element.parentNode) element.parentNode.removeChild(element);
    });
    return this;
  };

  Selection.prototype.data = function (data) {
    this._data = data || [];
    this.elements.forEach(function (element, index) {
      element.__data__ = data[index];
    });
    return this;
  };

  Selection.prototype.enter = function () {
    return new EnterSelection(this.parents, this._data);
  };

  Selection.prototype.call = function (fn) {
    if (typeof fn === 'function') fn(this);
    return this;
  };

  Selection.prototype.on = function (eventName, handler) {
    this.elements.forEach(function (element) {
      element.addEventListener(eventName, function (event) {
        handler(event, element.__data__);
      });
    });
    return this;
  };

  Selection.prototype.transition = function () { return this; };
  Selection.prototype.duration = function () { return this; };

  function EnterSelection(parents, data) {
    this.parents = parents || [];
    this.dataItems = data || [];
  }

  EnterSelection.prototype.append = function (tag) {
    var parent = this.parents[0];
    var created = [];
    this.dataItems.forEach(function (item) {
      var child = createElement(parent, tag);
      child.__data__ = item;
      parent.appendChild(child);
      created.push(child);
    });
    return new Selection(created, [parent]);
  };

  function forceSimulation() {
    var items = [];
    var forces = {};
    var tickHandler = null;
    var api = {
      force: function (name, value) {
        if (arguments.length === 1) return forces[name];
        forces[name] = value;
        return api;
      },
      nodes: function (next) { items = next || []; return api; },
      on: function (eventName, handler) {
        if (eventName === 'tick') tickHandler = handler;
        return api;
      },
      alpha: function () { return api; },
      alphaTarget: function () { return api; },
      restart: function () {
        items.forEach(function (item, index) {
          if (item.x == null) item.x = item.fx != null ? item.fx : 80 + index * 40;
          if (item.y == null) item.y = item.fy != null ? item.fy : 80 + index * 30;
        });
        if (tickHandler) tickHandler();
        return api;
      },
    };
    return api;
  }

  function forceLink() {
    return {
      id: function () { return this; },
      distance: function () { return this; },
      links: function () { return this; },
    };
  }

  function chainableForce() {
    return { strength: function () { return this; }, radius: function () { return this; } };
  }

  function zoom() {
    var fn = function () {};
    fn.scaleExtent = function () { return fn; };
    fn.on = function () { return fn; };
    fn.transform = function () {};
    return fn;
  }

  function drag() {
    var fn = function () {};
    fn.on = function () { return fn; };
    return fn;
  }

  window.d3 = {
    select: function (selector) { return new Selection([document.querySelector(selector)].filter(Boolean)); },
    forceSimulation: forceSimulation,
    forceLink: forceLink,
    forceManyBody: chainableForce,
    forceCenter: function () { return {}; },
    forceCollide: chainableForce,
    zoom: zoom,
    zoomIdentity: {
      translate: function () { return this; },
      scale: function () { return this; },
    },
    drag: drag,
  };
})();
`;

const mapPayload = {
  agent_id: 'default',
  anchors: [
    { agent_id: 'default', slot: 'A', memory_id: 'anchor-a', created_at: '2026-06-21T00:00:00.000Z', updated_at: '2026-06-21T00:00:00.000Z' },
    { agent_id: 'default', slot: 'B', memory_id: 'anchor-b', created_at: '2026-06-21T00:00:00.000Z', updated_at: '2026-06-21T00:00:00.000Z' },
    { agent_id: 'default', slot: 'C', memory_id: 'anchor-c', created_at: '2026-06-21T00:00:00.000Z', updated_at: '2026-06-21T00:00:00.000Z' },
  ],
  nodes: [
    { id: 'anchor-a', type: 'anchor', slot: 'A', content: 'Slot A anchor', importance: 0.9, created_at: '2026-06-21T00:00:00.000Z' },
    { id: 'anchor-b', type: 'anchor', slot: 'B', content: 'Slot B anchor', importance: 0.8, created_at: '2026-06-21T00:00:00.000Z' },
    { id: 'anchor-c', type: 'anchor', slot: 'C', content: 'Slot C anchor', importance: 0.7, created_at: '2026-06-21T00:00:00.000Z' },
    { id: 'mem-a', type: 'memory', content: 'alpha searchable memory', hop_distance: 1, similarity: 0.93, importance: 0.6, created_at: '2026-06-21T00:00:00.000Z' },
    { id: 'mem-b', type: 'memory', content: 'beta related memory', hop_distance: 2, similarity: 0.72, importance: 0.4, created_at: '2026-06-21T00:00:00.000Z' },
  ],
  links: [
    { source: 'anchor-a', target: 'mem-a', type: 'hop', hop_distance: 1, similarity: 0.93 },
    { source: 'anchor-b', target: 'mem-b', type: 'hop', hop_distance: 2, similarity: 0.72 },
    { source: 'anchor-c', target: 'missing-node', type: 'hop', hop_distance: 1, similarity: 0.5 },
  ],
  timestamp: '2026-06-21T00:00:00.000Z',
};

test.describe('Anchor Map dashboard', () => {
  test('renders slots, searches selected slot, and highlights results on the map', async ({ page }) => {
    const searchBodies: Array<Record<string, unknown>> = [];

    await page.route('**/static/vendor/d3.v7.min.js', (route) =>
      route.fulfill({ status: 200, contentType: 'text/javascript', body: d3Stub }),
    );
    await page.route('**/api/anchors/agents', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          agents: [{ agent_id: 'default', anchor_count: 3 }],
          agent_ids: ['default'],
          timestamp: '2026-06-21T00:00:00.000Z',
        }),
      }),
    );
    await page.route('**/api/anchors/map?**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mapPayload) }),
    );
    await page.route('**/api/anchors/search', async (route) => {
      searchBodies.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          result: {
            items: [
              { id: 'mem-a', content: 'alpha searchable memory', similarity: 0.93, hop_distance: 1, importance: 0.6, created_at: '2026-06-21T00:00:00.000Z' },
              { memory_id: 'mem-off-map', content: 'off map fallback memory', similarity: 0.51, importance: 0.3, created_at: '2026-06-21T00:00:00.000Z' },
            ],
            local_results_count: 2,
            fallback_used: false,
          },
        }),
      });
    });

    await page.goto('/dashboard');

    await expect(page.locator('#anchor-list .anchor-item')).toHaveCount(3);
    await expect(page.locator('#anchor-list .slot-a')).toContainText('Slot A');
    await expect(page.locator('#anchor-list .slot-b')).toContainText('Slot B');
    await expect(page.locator('#anchor-list .slot-c')).toContainText('Slot C');
    await expect(page.locator('#anchor-map svg .node')).toHaveCount(5);
    await expect(page.locator('#anchor-map svg .link')).toHaveCount(2);

    await page.locator('#search-slot-select').selectOption('B');
    await page.locator('#search-query-input').fill('alpha');
    await page.locator('#search-btn').click();

    await expect(page.locator('#anchor-search-status')).toContainText('2건 검색됨');
    await expect(page.locator('#anchor-search-status')).toContainText('맵 1건 표시');
    await expect(page.locator('#anchor-search-status')).toContainText('국소 2건');
    await expect(page.locator('#anchor-search-results .anchor-search-result-item')).toHaveCount(2);
    await expect(page.locator('#anchor-search-results .anchor-search-result-item.is-on-map')).toHaveCount(1);
    await expect(page.locator('#anchor-map svg .node.highlighted')).toHaveCount(1);
    await expect(page.locator('#memory-details')).toContainText('mem-a');
    expect(searchBodies[0]).toMatchObject({ query: 'alpha', slot: 'B', agent_id: 'default', limit: 100 });

    await page.locator('#anchor-list .slot-c').click();
    await expect(page.locator('#memory-details')).toContainText('Anchor (Slot C)');

    await page.locator('#search-slot-select').selectOption('C');
    await page.locator('#search-btn').click();
    await expect.poll(() => searchBodies.length).toBe(2);
    expect(searchBodies[1]).toMatchObject({ query: 'alpha', slot: 'C', agent_id: 'default', limit: 100 });
  });
});
