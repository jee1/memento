/**
 * Jobs panel — manual refresh + Phase 3 writes/logs (#832 / #834).
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

  async function postJson(url, body) {
    const response = await global.fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
    let data = {};
    try {
      data = await response.json();
    } catch (_err) {
      data = {};
    }
    if (!response.ok) {
      const message = data.error || data.message || 'HTTP ' + response.status;
      throw new Error(String(message));
    }
    return data;
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
      if (ns.state.selectedRunId) {
        await ns.loadLogs(ns.state.selectedRunId);
      } else {
        ns.renderLogs([], null);
      }
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
    ns.state.selectedRunId = null;
    ns.state.selectedRunJobName = null;
    ns.renderSchedule((ns.state.lastStats || {}).jobs);
    ns.renderLogs([], null);
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

  /** Issue #834: select a durable run → load Logs panel. */
  ns.loadLogs = async function (runId) {
    const id = runId || ns.state.selectedRunId;
    if (!id) {
      ns.renderLogs([], null);
      return;
    }
    const generation = ++ns.state.refreshGeneration;
    ns.setStatus('Loading logs for ' + id + '…');
    try {
      const payload = await fetchJson(ns.buildLogsUrl(id));
      if (generation !== ns.state.refreshGeneration) {
        return;
      }
      ns.state.lastLogs = payload;
      ns.setError('');
      ns.renderLogs(payload.logs, id);
      ns.setStatus('Logs updated ' + new Date().toISOString());
    } catch (err) {
      if (generation !== ns.state.refreshGeneration) {
        return;
      }
      const message = err && err.message ? String(err.message) : 'Logs load failed';
      ns.setError(message);
      ns.setStatus('Logs load failed — previous snapshot kept');
    }
  };

  ns.selectRun = async function (runId, jobName) {
    if (!runId) {
      return;
    }
    ns.state.selectedRunId = runId;
    ns.state.selectedRunJobName = jobName || null;
    ns.renderTimeline((ns.state.lastRuns || {}).runs, ns.state.selectedJob);
    await ns.loadLogs(runId);
  };

  async function writeThenRefresh(url, jobType, statusLabel) {
    if (!jobType || ns.state.writeInFlight) {
      return;
    }
    ns.state.writeInFlight = true;
    ns.syncActionButtons();
    ns.setStatus(statusLabel + '…');
    try {
      await postJson(url, { jobType: jobType });
      ns.setError('');
    } catch (err) {
      const message = err && err.message ? String(err.message) : statusLabel + ' failed';
      ns.setError(message);
      ns.setStatus(statusLabel + ' failed');
      return;
    } finally {
      ns.state.writeInFlight = false;
      ns.syncActionButtons();
    }
    await ns.refresh();
    ns.setStatus(statusLabel + ' done');
  }

  ns.pauseSelectedJob = async function () {
    const jobType = ns.state.selectedJob;
    if (!jobType) {
      return;
    }
    if (!ns.confirmWrite('Pause schedule for ' + jobType + '?')) {
      return;
    }
    await writeThenRefresh(ns.PAUSE_URL, jobType, 'Pause ' + jobType);
  };

  ns.resumeSelectedJob = async function () {
    const jobType = ns.state.selectedJob;
    if (!jobType) {
      return;
    }
    if (!ns.confirmWrite('Resume schedule for ' + jobType + '?')) {
      return;
    }
    await writeThenRefresh(ns.RESUME_URL, jobType, 'Resume ' + jobType);
  };

  ns.runSelectedJobNow = async function () {
    const jobType = ns.state.selectedJob;
    if (!jobType) {
      return;
    }
    if (!ns.confirmWrite('Run ' + jobType + ' now?')) {
      return;
    }
    await writeThenRefresh(ns.RUN_URL, jobType, 'Run now ' + jobType);
  };

  /** Issue #834 US4: Retry failed run = same POST /batch/run for row jobName. */
  ns.retryJob = async function (jobType) {
    if (!jobType) {
      return;
    }
    if (!ns.confirmWrite('Retry ' + jobType + '?')) {
      return;
    }
    await writeThenRefresh(ns.RUN_URL, jobType, 'Retry ' + jobType);
  };
})(typeof window !== 'undefined' ? window : globalThis);
