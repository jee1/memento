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

  /**
   * Issue #1158: 429 는 원문(`HTTP 429 for /admin/...`)을 그대로 보여주면
   * 운영자가 언제 다시 시도할지 알 수 없다. 서버가 주는 재시도 대기시간을 쓴다.
   */
  function retryAfterSeconds(response, data) {
    const fromBody = data ? Number(data.retry_after_seconds) : NaN;
    if (Number.isFinite(fromBody) && fromBody > 0) {
      return Math.ceil(fromBody);
    }
    const headers = response && response.headers;
    const header = headers && typeof headers.get === 'function' ? headers.get('Retry-After') : null;
    const parsed = header ? Number.parseInt(header, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  function rateLimitMessage(response, data) {
    const seconds = retryAfterSeconds(response, data);
    if (seconds === null) {
      return '요청이 너무 많습니다 — 잠시 후 다시 시도하세요.';
    }
    return '요청이 너무 많습니다 — ' + seconds + '초 후 다시 시도하세요.';
  }

  async function readJsonBody(response) {
    try {
      return await response.json();
    } catch (_err) {
      return {};
    }
  }

  async function fetchJson(url) {
    const response = await global.fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
    });
    if (!response.ok) {
      if (response.status === 429) {
        throw new Error(rateLimitMessage(response, await readJsonBody(response)));
      }
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
    const data = await readJsonBody(response);
    if (!response.ok) {
      if (response.status === 429) {
        throw new Error(rateLimitMessage(response, data));
      }
      const message = data.error || data.message || 'HTTP ' + response.status;
      throw new Error(String(message));
    }
    return data;
  }

  /**
   * @returns {Promise<'ok'|'failed'|'superseded'>} 호출자가 상태줄을 덮어써도 되는지 판단한다 (#1158).
   */
  ns.refresh = async function () {
    const generation = ++ns.state.refreshGeneration;
    // loadLogs 가 자기 generation 을 올리므로 finally 의 generation 비교로는 로딩을 끌 수 없다.
    let outcome = 'superseded';
    ns.setStatus('새로고침 중…');
    ns.setLoading(true);
    try {
      const results = await Promise.all([
        fetchJson(ns.STATS_URL),
        fetchJson(ns.RUN_HISTORY_URL),
        fetchJson(ns.buildRunsUrl(ns.state.selectedJob)),
      ]);
      if (generation !== ns.state.refreshGeneration) {
        return outcome;
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
      outcome = 'ok';
    } catch (err) {
      if (generation !== ns.state.refreshGeneration) {
        return outcome;
      }
      // Keep prior successful snapshot; surface error only.
      const message = err && err.message ? String(err.message) : '배치 작업 새로고침 실패';
      ns.setError(message);
      ns.setStatus('새로고침 실패 — 이전 스냅샷 유지');
      outcome = 'failed';
    } finally {
      if (outcome !== 'superseded') {
        ns.setLoading(false);
      }
    }
    return outcome;
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
    // #1158: 갱신이 실패했는데도 '완료'로 덮으면 오류 배너와 상태줄이 서로 다른 말을 한다.
    const outcome = await ns.refresh();
    if (outcome === 'ok') {
      ns.setStatus(statusLabel + ' 완료');
    } else if (outcome === 'failed') {
      ns.setStatus(statusLabel + ' 완료 — 화면 갱신 실패, 새로고침하세요');
    }
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
