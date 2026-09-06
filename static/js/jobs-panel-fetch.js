/**
 * Jobs panel — manual refresh fetch (stats + run-history) (#832).
 * Refresh is user-driven only (no timers, no SSE).
 */
(function (global) {
  'use strict';

  const ns = global.__MEMENTO_JOBS_PANEL__;
  if (!ns) {
    return;
  }

  async function fetchJson(url) {
    const response = await global.fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    if (!response.ok) {
      throw new Error('HTTP ' + response.status + ' for ' + url);
    }
    return response.json();
  }

  ns.refresh = async function () {
    const generation = ++ns.state.refreshGeneration;
    ns.setStatus('Refreshing…');
    try {
      const results = await Promise.all([
        fetchJson(ns.STATS_URL),
        fetchJson(ns.RUN_HISTORY_URL),
        fetchJson(ns.buildRunsUrl(ns.state.selectedJob)),
      ]);
      if (generation !== ns.state.refreshGeneration) {
        return;
      }
      const stats = results[0] || {};
      const history = results[1] || {};
      const runs = results[2] || {};
      ns.state.lastStats = stats;
      ns.state.lastHistory = history;
      ns.state.lastRuns = runs;
      ns.setError('');
      ns.renderHealth(stats.health, stats.schedulerRunning);
      ns.renderSchedule(stats.jobs);
      ns.renderQueue(stats.queue);
      ns.renderRunHistory(history.entries);
      ns.renderTimeline(runs.runs, ns.state.selectedJob);
      ns.setStatus('Updated ' + (stats.timestamp || new Date().toISOString()));
    } catch (err) {
      if (generation !== ns.state.refreshGeneration) {
        return;
      }
      // Keep prior successful snapshot; surface error only.
      const message = err && err.message ? String(err.message) : 'Jobs refresh failed';
      ns.setError(message);
      ns.setStatus('Refresh failed — previous snapshot kept');
    }
  };

  /** Issue #833: click/select a schedule job row → fetch durable timeline for that job only. */
  ns.selectJob = async function (jobName) {
    const generation = ++ns.state.refreshGeneration;
    ns.state.selectedJob = jobName || null;
    ns.renderSchedule((ns.state.lastStats || {}).jobs);
    ns.setStatus('Loading timeline for ' + (jobName || 'all jobs') + '…');
    try {
      const runs = await fetchJson(ns.buildRunsUrl(ns.state.selectedJob));
      if (generation !== ns.state.refreshGeneration) {
        return;
      }
      ns.state.lastRuns = runs;
      ns.setError('');
      ns.renderTimeline(runs.runs, ns.state.selectedJob);
      ns.setStatus('Updated ' + new Date().toISOString());
    } catch (err) {
      if (generation !== ns.state.refreshGeneration) {
        return;
      }
      const message = err && err.message ? String(err.message) : 'Timeline load failed';
      ns.setError(message);
      ns.setStatus('Timeline load failed — previous snapshot kept');
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
