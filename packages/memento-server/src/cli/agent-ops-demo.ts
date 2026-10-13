import {
  envelope,
  item,
  objectBody,
  responseReason,
  uniqueGuidance,
  type AgentOpsRequest,
  type ResultItem,
} from './agent-ops-core.js';

/** 통과면 pass·NONE, 아니면 failStatus·응답 reason. */
function checkItem(
  name: string,
  ok: boolean,
  failReason: () => string,
  messages: { pass: string; fail: string },
  failStatus: 'fail' | 'warn' = 'fail',
): ResultItem {
  return ok
    ? item(name, 'pass', 'NONE', messages.pass)
    : item(name, failStatus, failReason(), messages.fail);
}

async function cleanupDemo(
  request: AgentOpsRequest,
  sessions: ReadonlyArray<readonly [sessionId: string, created: boolean, label: string]>,
  summaryMemoryId: string | null,
  steps: ResultItem[],
): Promise<void> {
  for (const [sessionId, created, label] of sessions) {
    if (!created) continue;
    const cleanup = await request(
      `/api/v1/agent/sessions/${encodeURIComponent(sessionId)}`,
      { method: 'DELETE' },
    );
    steps.push(checkItem(
      `cleanup_${label}`,
      cleanup.status === 204,
      () => responseReason(cleanup.status, cleanup.body),
      { pass: 'Demo session을 삭제했습니다.', fail: 'Demo session 정리를 확인하세요.' },
      'warn',
    ));
  }
  if (summaryMemoryId) {
    const cleanup = await request('/tools/forget', {
      method: 'POST',
      body: JSON.stringify({ id: summaryMemoryId, hard: true, confirm: true }),
    });
    steps.push(checkItem(
      'cleanup_summary',
      cleanup.status === 200,
      () => responseReason(cleanup.status, cleanup.body),
      { pass: 'Demo summary memory를 삭제했습니다.', fail: 'Demo summary memory 정리를 확인하세요.' },
      'warn',
    ));
  }
}

export async function runDemo(
  endpoint: string,
  request: AgentOpsRequest,
  now: () => Date,
  randomId: () => string,
) {
  const rootId = randomId();
  const firstSession = `memento-demo-${rootId}-1`;
  const secondSession = `memento-demo-${rootId}-2`;
  const scope = {
    owner_id: `memento-demo-${rootId}`,
    project_id: `memento-demo-${rootId}`,
    process_id: `memento-demo-${rootId}`,
  };
  const steps: ResultItem[] = [];
  let firstCreated = false;
  let secondCreated = false;
  let summaryMemoryId: string | null = null;
  let injectionStatus = 'unavailable';
  let selectedCount = 0;
  let summaryReused = false;
  try {
    const startAt = now().toISOString();
    const firstStart = await request('/api/v1/agent/sessions', {
      method: 'POST',
      body: JSON.stringify(envelope(
        'SESSION_START',
        firstSession,
        0,
        startAt,
        {
          client_version: '1.0.0',
          initial_context: 'Memento agent operations demo',
        },
        scope,
      )),
    });
    firstCreated = firstStart.status === 201;
    steps.push(item(
      'first_session_start',
      firstCreated ? 'pass' : 'fail',
      responseReason(firstStart.status, firstStart.body),
      firstCreated ? '첫 session을 시작했습니다.' : '첫 session 시작에 실패했습니다.',
    ));
    if (!firstCreated) throw new Error('first session start failed');

    const observations = [
      envelope(
        'USER_PROMPT',
        firstSession,
        1,
        now().toISOString(),
        {
          content: 'Use the established agent operations CLI workflow.',
          content_format: 'text/plain',
        },
        scope,
      ),
      envelope(
        'TOOL_RESULT',
        firstSession,
        2,
        now().toISOString(),
        {
          tool_name: 'memento_demo',
          outcome: 'success',
          input: { operation: 'capture' },
          output: { result: 'verified' },
        },
        scope,
      ),
    ];
    const ingest = await request('/api/v1/agent/observations:ingest', {
      method: 'POST',
      body: JSON.stringify({ events: observations }),
    });
    const ingestBody = objectBody(ingest.body);
    const results = Array.isArray(ingestBody.results) ? ingestBody.results : [];
    const captured = ingest.status === 200
      && results.length === observations.length
      && results.every(result => {
        const status = objectBody(result).status;
        return status === 'ACCEPTED' || status === 'REDACTED';
      });
    steps.push(checkItem(
      'capture',
      captured,
      () => responseReason(ingest.status, ingest.body),
      { pass: 'Prompt와 tool result를 수집했습니다.', fail: 'Observation 수집에 실패했습니다.' },
    ));
    if (!captured) throw new Error('capture failed');

    const stop = await request(
      `/api/v1/agent/sessions/${encodeURIComponent(firstSession)}:stop`,
      {
        method: 'POST',
        body: JSON.stringify(envelope(
          'STOP',
          firstSession,
          3,
          now().toISOString(),
          {
            outcome: 'completed',
            summary: 'Agent operations CLI workflow verified.',
          },
          scope,
        )),
      },
    );
    const stopBody = objectBody(stop.body);
    summaryMemoryId = typeof stopBody.summary_job_id === 'string'
      ? stopBody.summary_job_id
      : null;
    const summarized = stop.status === 200 && summaryMemoryId !== null;
    steps.push(checkItem(
      'summary',
      summarized,
      () => responseReason(stop.status, stop.body),
      { pass: '첫 session summary memory를 생성했습니다.', fail: 'Session summary 생성에 실패했습니다.' },
    ));
    if (!summarized) throw new Error('summary failed');

    const secondStart = await request('/api/v1/agent/sessions', {
      method: 'POST',
      body: JSON.stringify(envelope(
        'SESSION_START',
        secondSession,
        0,
        now().toISOString(),
        {
          client_version: '1.0.0',
          initial_context: 'Use the established agent operations CLI workflow.',
        },
        scope,
      )),
    });
    secondCreated = secondStart.status === 201;
    const secondBody = objectBody(secondStart.body);
    const initialInjection = objectBody(secondBody.initial_injection);
    injectionStatus = typeof initialInjection.status === 'string'
      ? initialInjection.status
      : 'unavailable';
    const selected = Array.isArray(initialInjection.items) ? initialInjection.items : [];
    selectedCount = selected.length;
    summaryReused = summaryMemoryId !== null && selected.some(selectedItem =>
      objectBody(selectedItem).memory_id === summaryMemoryId
    );
    steps.push(checkItem(
      'next_session_injection',
      secondCreated && summaryReused,
      () => responseReason(secondStart.status, secondStart.body),
      {
        pass: '두 번째 session에 첫 summary memory가 주입되었습니다.',
        fail: '두 번째 session에서 첫 summary memory를 확인하지 못했습니다.',
      },
    ));
  } catch {
    // Step results preserve the actionable failure without exposing request payloads.
  } finally {
    await cleanupDemo(
      request,
      [[secondSession, secondCreated, 'second'], [firstSession, firstCreated, 'first']],
      summaryMemoryId,
      steps,
    );
  }
  const ok = summaryReused
    && steps.every(step => step.status === 'pass' || step.status === 'skip');
  return {
    command: 'demo',
    ok,
    checked_at: now().toISOString(),
    endpoint,
    steps,
    injection: {
      status: injectionStatus,
      selected_count: selectedCount,
      summary_reused: summaryReused,
    },
    guidance: uniqueGuidance(steps),
  };
}
