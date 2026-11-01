/**
 * Ranking weights panel — load, propose (reason required), preview, patch download and command copy.
 * A proposal never changes the running ranking; it only stores a patch for a PR.
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_RANKING_PANEL__;
  if (!ns) {
    return;
  }
  const S = ns.S;

  ns.loadProposals = function () {
    return ns.request('GET', ns.PROPOSALS_URL).then(function (result) {
      if (!result.ok) {
        ns.setError(S.failure(result.data, result.status));
        return;
      }
      ns.state.proposals = result.data.proposals || [];
      ns.renderProposals();
    });
  };

  ns.refresh = function () {
    const generation = ++ns.state.refreshGeneration;
    ns.setLoading(true);
    ns.setError('');
    return ns
      .request('GET', ns.WEIGHTS_URL)
      .then(function (result) {
        if (generation !== ns.state.refreshGeneration) {
          return null;
        }
        if (!result.ok) {
          ns.setError(S.failure(result.data, result.status));
          return null;
        }
        ns.state.knobs = result.data.knobs || [];
        ns.state.previewEnabled = Boolean(result.data.preview_enabled);
        ns.state.sourcePath = result.data.source_path || null;
        ns.renderSource();
        ns.renderKnobs();
        ns.renderResult();
        return ns.loadProposals();
      })
      .catch(function () {
        ns.setError(S.loadFailed);
      })
      .then(function () {
        if (generation === ns.state.refreshGeneration) {
          ns.setLoading(false);
        }
      });
  };

  ns.openProposal = function (proposal) {
    ns.state.current = proposal;
    ns.renderResult();
  };

  /** Inputs whose value differs from the file value. A non-number stops the whole request. */
  function collectChanges() {
    const changes = {};
    for (let i = 0; i < ns.state.knobs.length; i += 1) {
      const knob = ns.state.knobs[i];
      const raw = String(ns.state.inputs[knob.key].value).trim();
      if (raw === '') {
        continue;
      }
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        return { error: S.invalidNumber(knob.key) };
      }
      if (value !== knob.file_value) {
        changes[knob.key] = value;
      }
    }
    return { changes: changes };
  }

  function showDialog(changes) {
    ns.state.dialog = { changes: changes };
    const summary = ns.$('ranking-dialog-summary');
    ns.clearNode(summary);
    Object.keys(changes).forEach(function (key) {
      const knob = ns.state.knobs.find(function (candidate) {
        return candidate.key === key;
      });
      summary.appendChild(ns.el('li', '', S.changeLine(key, knob.file_value, changes[key])));
    });
    ns.$('ranking-dialog-reason').value = '';
    ns.setDialogError('');
    const dialog = ns.$('ranking-dialog');
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  ns.setDialogError = function (message) {
    const el = ns.$('ranking-dialog-error');
    el.textContent = message || '';
    ns.setHidden(el, !message);
  };

  function closeDialog() {
    const dialog = ns.$('ranking-dialog');
    ns.state.dialog = null;
    if (typeof dialog.close === 'function') {
      dialog.close();
    } else {
      dialog.removeAttribute('open');
    }
  }

  ns.requestProposal = function () {
    const collected = collectChanges();
    if (collected.error) {
      ns.setError(collected.error);
      return;
    }
    if (Object.keys(collected.changes).length === 0) {
      ns.setError(S.noChange);
      return;
    }
    ns.setError('');
    showDialog(collected.changes);
  };

  ns.confirmDialog = function () {
    const context = ns.state.dialog;
    if (!context || ns.state.inFlight) {
      return Promise.resolve();
    }
    const reason = ns.$('ranking-dialog-reason').value.trim();
    if (reason === '') {
      ns.setDialogError(S.reasonRequired);
      return Promise.resolve();
    }
    ns.state.inFlight = true;
    ns.setDialogError('');
    return ns
      .request('POST', ns.PROPOSALS_URL, { changes: context.changes, reason: reason })
      .then(function (result) {
        if (!result.ok) {
          ns.setDialogError(S.failure(result.data, result.status));
          return null;
        }
        closeDialog();
        ns.state.current = Object.assign({ preview: null, previewed_at: null }, result.data);
        ns.renderResult();
        return ns.loadProposals();
      })
      .catch(function () {
        ns.setDialogError(S.loadFailed);
      })
      .then(function () {
        ns.state.inFlight = false;
      });
  };

  ns.runPreview = function () {
    const current = ns.state.current;
    if (!current || ns.state.previewing) {
      return Promise.resolve();
    }
    ns.state.previewing = true;
    ns.setError('');
    ns.renderResult();
    return ns
      .request('POST', ns.PROPOSALS_URL + '/' + encodeURIComponent(current.id) + '/preview')
      .then(function (result) {
        if (!result.ok) {
          ns.setError(S.failure(result.data, result.status));
          return null;
        }
        current.preview = result.data.preview;
        current.previewed_at = result.data.previewed_at;
        current.commands = result.data.commands;
        return ns.loadProposals();
      })
      .catch(function () {
        ns.setError(S.loadFailed);
      })
      .then(function () {
        ns.state.previewing = false;
        ns.renderResult();
      });
  };

  function copyText(text, statusId) {
    const status = ns.$(statusId);
    const clipboard = global.navigator && global.navigator.clipboard;
    const done = function (message) {
      status.textContent = message;
    };
    if (!clipboard || typeof clipboard.writeText !== 'function') {
      done(S.copyFailed);
      return Promise.resolve();
    }
    return clipboard.writeText(text).then(
      function () {
        done(S.copied);
      },
      function () {
        done(S.copyFailed);
      },
    );
  }

  function wirePanel() {
    ns.$('ranking-refresh-btn').addEventListener('click', function () {
      void ns.refresh();
    });
    ns.$('ranking-propose-btn').addEventListener('click', ns.requestProposal);
    ns.$('ranking-preview-run').addEventListener('click', function () {
      void ns.runPreview();
    });
    ns.$('ranking-dialog-confirm').addEventListener('click', function () {
      void ns.confirmDialog();
    });
    ns.$('ranking-dialog-cancel').addEventListener('click', closeDialog);
    ns.$('ranking-copy-preview').addEventListener('click', function () {
      void copyText(ns.state.current.commands.preview, 'ranking-copy-status');
    });
    ns.$('ranking-copy-pr').addEventListener('click', function () {
      void copyText(ns.state.current.commands.branch_and_pr, 'ranking-copy-status');
    });
  }

  function initRankingPanel() {
    if (!ns.state.wired) {
      ns.state.wired = true;
      wirePanel();
    }
    if (!ns.state.loadedOnce) {
      ns.state.loadedOnce = true;
      void ns.refresh();
    }
  }

  global.initRankingPanel = initRankingPanel;
})(typeof window !== 'undefined' ? window : globalThis);
