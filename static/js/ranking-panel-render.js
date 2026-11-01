/**
 * Ranking weights panel — knob table, proposal result, preview table and recent proposals.
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_RANKING_PANEL__;
  if (!ns) {
    return;
  }
  const S = ns.S;

  function badge(variant, text) {
    return ns.el('span', 'm-badge m-badge--' + variant, text);
  }

  function numberInput(knob) {
    const input = ns.el('input', 'm-input ranking-input');
    input.type = 'number';
    input.step = 'any';
    input.min = String(knob.min);
    input.max = String(knob.max);
    input.value = String(knob.file_value);
    input.setAttribute('aria-label', knob.key);
    return input;
  }

  ns.renderSource = function () {
    const note = ns.$('ranking-source');
    ns.setHidden(note, !ns.state.sourcePath);
    if (note) {
      note.textContent = ns.state.sourcePath ? S.sourcePath(ns.state.sourcePath) : '';
    }
  };

  ns.renderKnobs = function () {
    const tbody = ns.$('ranking-tbody');
    ns.clearNode(tbody);
    ns.state.inputs = {};
    ns.state.knobs.forEach(function (knob) {
      const row = ns.el('tr');
      row.dataset.key = knob.key;
      row.appendChild(ns.el('td')).appendChild(ns.el('code', 'm-code-inline ranking-key', knob.key));
      row.appendChild(ns.el('td', 'ranking-num', ns.formatNumber(knob.value)));
      const fileCell = ns.el('td', 'ranking-num', ns.formatNumber(knob.file_value));
      if (knob.drift) {
        fileCell.appendChild(badge('warn', S.drift));
      }
      row.appendChild(fileCell);
      row.appendChild(ns.el('td', 'ranking-desc', S.rangePrefix + '[' + knob.min + ', ' + knob.max + ']'));
      ns.state.inputs[knob.key] = numberInput(knob);
      row.appendChild(ns.el('td', 'ranking-edit')).appendChild(ns.state.inputs[knob.key]);
      tbody.appendChild(row);
    });
  };

  function metricRow(metric, current, proposed, delta) {
    const row = ns.el('tr');
    row.dataset.metric = metric;
    row.appendChild(ns.el('td', '', S.metricLabel[metric] || metric));
    row.appendChild(ns.el('td', 'ranking-num', ns.formatNumber(current)));
    row.appendChild(ns.el('td', 'ranking-num', ns.formatNumber(proposed)));
    row.appendChild(ns.el('td', 'ranking-num', ns.formatNumber(delta)));
    return row;
  }

  function renderPreviewTable(preview) {
    const tbody = ns.$('ranking-preview-tbody');
    ns.clearNode(tbody);
    Object.keys(S.metricLabel).forEach(function (metric) {
      tbody.appendChild(metricRow(metric, preview.current[metric], preview.proposed[metric], preview.delta[metric]));
    });
    ns.$('ranking-preview-scope').textContent = S.previewScope(preview.dev_query_count, preview.split_version);
    const gate = ns.$('ranking-tie-gate');
    ns.clearNode(gate);
    gate.appendChild(badge(preview.tie_gate.passed ? 'ok' : 'crit', preview.tie_gate.passed ? S.tiePassed : S.tieFailed));
    if (preview.tie_gate.reason) {
      gate.appendChild(ns.el('span', 'ranking-desc', ' ' + preview.tie_gate.reason));
    }
    const categories = ns.$('ranking-category-tbody');
    ns.clearNode(categories);
    const perCategory = preview.per_category || {};
    Object.keys(perCategory).forEach(function (name) {
      const entry = perCategory[name];
      const row = ns.el('tr');
      row.dataset.category = name;
      row.appendChild(ns.el('td', '', name + ' (' + entry.query_count + ')'));
      row.appendChild(
        ns.el(
          'td',
          'ranking-num',
          [entry.delta.ndcg_at_10, entry.delta.mrr, entry.delta.recall_at_10].map(ns.formatNumber).join(' / '),
        ),
      );
      categories.appendChild(row);
    });
    ns.setHidden(ns.$('ranking-category'), Object.keys(perCategory).length === 0);
  }

  ns.renderResult = function () {
    const current = ns.state.current;
    ns.setHidden(ns.$('ranking-result'), !current);
    if (!current) {
      return;
    }
    ns.$('ranking-result-title').textContent = S.proposalHeading(current.id);
    const changes = ns.$('ranking-result-changes');
    ns.clearNode(changes);
    Object.keys(current.proposed).forEach(function (key) {
      changes.appendChild(ns.el('li', '', S.changeLine(key, current.current[key], current.proposed[key])));
    });

    const patch = ns.$('ranking-patch-link');
    patch.setAttribute('href', ns.PROPOSALS_URL + '/' + encodeURIComponent(current.id) + '/patch');
    ns.$('ranking-command-preview').textContent = current.commands.preview;
    ns.$('ranking-command-pr').textContent = current.commands.branch_and_pr;

    const hasPreview = Boolean(current.preview);
    ns.setHidden(ns.$('ranking-preview-result'), !hasPreview);
    if (hasPreview) {
      renderPreviewTable(current.preview);
    }
    ns.setHidden(ns.$('ranking-preview-pending'), hasPreview || ns.state.previewing);
    ns.setHidden(ns.$('ranking-preview-running'), !ns.state.previewing);
    const canRun = !hasPreview && ns.state.previewEnabled && !ns.state.previewing;
    ns.setHidden(ns.$('ranking-preview-run'), !canRun);
    ns.setHidden(ns.$('ranking-preview-disabled'), hasPreview || ns.state.previewEnabled);
  };

  ns.renderProposals = function () {
    const tbody = ns.$('ranking-proposals-tbody');
    ns.clearNode(tbody);
    ns.setHidden(ns.$('ranking-proposals-empty'), ns.state.proposals.length > 0);
    ns.state.proposals.forEach(function (proposal) {
      const row = ns.el('tr');
      row.dataset.id = proposal.id;
      row.appendChild(ns.el('td', '', ns.formatTime(proposal.created_at)));
      row.appendChild(ns.el('td', '', proposal.actor));
      row.appendChild(
        ns.el(
          'td',
          '',
          Object.keys(proposal.proposed)
            .map(function (key) {
              return S.changeLine(key, proposal.current[key], proposal.proposed[key]);
            })
            .join(', '),
        ),
      );
      row.appendChild(ns.el('td', '', proposal.reason));
      row.appendChild(ns.el('td', '', proposal.preview ? S.hasPreview : S.noPreview));
      const open = ns.el('button', 'm-button m-button--ghost ranking-btn', S.open);
      open.type = 'button';
      open.addEventListener('click', function () {
        ns.openProposal(proposal);
      });
      row.appendChild(ns.el('td')).appendChild(open);
      tbody.appendChild(row);
    });
  };
})(typeof window !== 'undefined' ? window : globalThis);
