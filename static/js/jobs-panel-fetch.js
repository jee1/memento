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
    ns.setStatus('새로고침 중…');
    ns.setLoading(true);
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
      ns.setStatus('갱신 ' + (stats.timestamp || new Date().toISOString()));
    } catch (err) {
      if (generation !== ns.state.refreshGeneration) {
        return;
      }
      // Keep prior successful snapshot; surface error only.
      const message = err && err.message ? String(err.message) : '배치 작업 새로고침 실패';
      ns.setError(message);
      ns.setStatus('새로고침 실패 — 이전 스냅샷 유지');
    } finally {
      if (generation === ns.state.refreshGeneration) {
        ns.setLoading(false);
      }
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
    ns.setStatus('타임라인 불러오는 중: ' + (jobName || '전체 작업') + '…');
    try {
      const runs = await fetchJson(ns.buildRunsUrl(ns.state.selectedJob));
      if (generation !== ns.state.refreshGeneration) {
        return;
      }
      ns.state.lastRuns = runs;
      ns.setError('');
      ns.renderTimeline(runs.runs, ns.state.selectedJob);
      ns.setStatus('갱신 ' + new Date().toISOString());
    } catch (err) {
      if (generation !== ns.state.refreshGeneration) {
        return;
      }
      const message = err && err.message ? String(err.message) : '타임라인 로드 실패';
      ns.setError(message);
      ns.setStatus('타임라인 로드 실패 — 이전 스냅샷 유지');
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
    ns.setStatus('로그 불러오는 중: ' + id + '…');
    try {
      const payload = await fetchJson(ns.buildLogsUrl(id));
      if (generation !== ns.state.refreshGeneration) {
        return;
      }
      ns.state.lastLogs = payload;
      ns.setError('');
      ns.renderLogs(payload.logs, id);
      ns.setStatus('로그 갱신 ' + new Date().toISOString());
    } catch (err) {
      if (generation !== ns.state.refreshGeneration) {
        return;
      }
      const message = err && err.message ? String(err.message) : '로그 로드 실패';
      ns.setError(message);
      ns.setStatus('로그 로드 실패 — 이전 스냅샷 유지');
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
      const message = err && err.message ? String(err.message) : statusLabel + ' 실패';
      ns.setError(message);
      ns.setStatus(statusLabel + ' 실패');
      return;
    } finally {
      ns.state.writeInFlight = false;
      ns.syncActionButtons();
    }
    await ns.refresh();
    ns.setStatus(statusLabel + ' 완료');
  }

  ns.pauseSelectedJob = async function () {
    const jobType = ns.state.selectedJob;
    if (!jobType) {
      return;
    }
    if (!ns.confirmWrite('"' + jobType + '" 스케줄을 일시정지할까요?')) {
      return;
    }
    await writeThenRefresh(ns.PAUSE_URL, jobType, '일시정지 ' + jobType);
  };

  ns.resumeSelectedJob = async function () {
    const jobType = ns.state.selectedJob;
    if (!jobType) {
      return;
    }
    if (!ns.confirmWrite('"' + jobType + '" 스케줄을 재개할까요?')) {
      return;
    }
    await writeThenRefresh(ns.RESUME_URL, jobType, '재개 ' + jobType);
  };

  ns.runSelectedJobNow = async function () {
    const jobType = ns.state.selectedJob;
    if (!jobType) {
      return;
    }
    if (!ns.confirmWrite('"' + jobType + '"을(를) 지금 실행할까요?')) {
      return;
    }
    await writeThenRefresh(ns.RUN_URL, jobType, '지금 실행 ' + jobType);
  };

  /** Issue #834 US4: Retry failed run = same POST /batch/run for row jobName. */
  ns.retryJob = async function (jobType) {
    if (!jobType) {
      return;
    }
    if (!ns.confirmWrite('"' + jobType + '"을(를) 재시도할까요?')) {
      return;
    }
    await writeThenRefresh(ns.RUN_URL, jobType, '재시도 ' + jobType);
  };
})(typeof window !== 'undefined' ? window : globalThis);
