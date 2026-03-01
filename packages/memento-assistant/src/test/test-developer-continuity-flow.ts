/**
 * E2E: Developer continuity flow.
 * Prerequisite: memento-core HTTP server and memento-assistant runtime must be running.
 * Assistant runtime is wired to core via run-assistant-server (MEMENTO_CORE_URL).
 *
 * Usage:
 *   # Terminal 1: core
 *   npm run dev:http
 *   # Terminal 2: assistant
 *   MEMENTO_CORE_URL=http://localhost:3000 npm run dev:assistant
 *   # Terminal 3: E2E
 *   MEMENTO_CORE_URL=http://localhost:3000 MEMENTO_ASSISTANT_URL=http://localhost:8090 \
 *   tsx packages/memento-assistant/src/test/test-developer-continuity-flow.ts
 */
import { AssistantClient } from '../client/assistant-client.js';

const URL = process.env.MEMENTO_ASSISTANT_URL ?? 'http://localhost:8090';
const PROJECT = 'memento';
const SESSION_ID = `e2e-${Date.now()}`;
const PROCESS_ID = 'cursor';
const BRANCH = 'feature/resume';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error('E2E assert failed:', message);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const client = new AssistantClient({ assistantServerUrl: URL });
  try {
    // 1. start_session
    await client.startSession({
      project: PROJECT,
      process_id: PROCESS_ID,
      session_id: SESSION_ID,
      branch: BRANCH,
    });
    // 2. save_context(decision)
    await client.saveContext({
      kind: 'decision',
      content: 'resume 엔진은 recall 기반으로 간다',
      project: PROJECT,
      session_id: SESSION_ID,
      process_id: PROCESS_ID,
      branch: BRANCH,
    });
    // 3. save_context(next-step)
    await client.saveContext({
      kind: 'next-step',
      content: 'E2E 테스트 및 문서화 완료',
      project: PROJECT,
      session_id: SESSION_ID,
      process_id: PROCESS_ID,
      branch: BRANCH,
    });
    // 4. end_session
    await client.endSession({
      project: PROJECT,
      session_id: SESSION_ID,
      process_id: PROCESS_ID,
      summary: 'Phase 1 E2E 검증 완료',
    });
    // 5. resume_session (branch를 넘겨 같은 브랜치 continuity만 조회)
    const { snapshot } = await client.resumeSession({
      project: PROJECT,
      process_id: PROCESS_ID,
      session_id: SESSION_ID,
      branch: BRANCH,
    });
    // 6. assert snapshot sections
    assert(snapshot.recentDecisions.length > 0, 'recent decisions should not be empty');
    assert(snapshot.nextActions.length > 0, 'next actions should not be empty');
    console.log('E2E developer continuity flow: PASS');
  } catch (err) {
    console.error('E2E failed:', err instanceof Error ? err.message : err);
    console.error('Ensure memento-core and memento-assistant servers are running.');
    process.exit(1);
  }
}

main();
