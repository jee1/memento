/**
 * 이슈 #237: mock LLM 한 턴 + project scope 주입 + 승인/거절 persistence.
 * 비TTY 환경에서도 `AgentAskRuntimeHooks`로 동일 코드 경로를 검증한다.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  closeDatabase,
  createMementoCore,
  createToolContext,
  executeTool,
  getBatchScheduler,
  resetBatchScheduler,
} from '@memento/core';

import { runAgentAskMain } from './agent-ask.js';

async function stopBatchSchedulerSingleton(): Promise<void> {
  const bs = getBatchScheduler();
  if (bs.getStatus().isRunning) {
    await bs.stop();
  }
  resetBatchScheduler();
}

function argvAgentAsk(
  dbPath: string,
  userMessage: string,
  extraFlags: string[] = [],
): string[] {
  return ['node', 'memento', '--db-path', dbPath, 'agent', 'ask', userMessage, '--llm', 'mock', ...extraFlags];
}

function captureStdoutWrite(): { chunks: string[]; restore: () => void } {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk, ...args): boolean => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    const cb = args.find((a) => typeof a === 'function') as ((err?: Error) => void) | undefined;
    if (cb) queueMicrotask(() => cb());
    return true;
  });
  return {
    chunks,
    restore: () => spy.mockRestore(),
  };
}

async function seedTwoProjectMemories(dbPath: string): Promise<void> {
  const core = await createMementoCore({ dbPath });
  try {
    const toolContext = createToolContext(core.db, core.services);
    await executeTool(
      'remember',
      {
        content: 'proj237 aloha-seed 고유 내용',
        type: 'semantic',
        project_id: 'proj-237',
      },
      toolContext,
    );
    await executeTool(
      'remember',
      {
        content: 'otherproj-secret-다른-내용',
        type: 'semantic',
        project_id: 'other-proj',
      },
      toolContext,
    );
  } finally {
    await core.services.runtimeDiagnosticsSamplerCleanup?.().catch(() => {});
    await stopBatchSchedulerSingleton();
    await new Promise((r) => setTimeout(r, 150));
    closeDatabase(core.db);
  }
}

afterEach(async () => {
  vi.restoreAllMocks();
  await stopBatchSchedulerSingleton();
});

describe('agent ask #237 hooks E2E', () => {
  it('project scope: --project-id 가 run에 전달되고 컨텍스트가 비어 있지 않다', async () => {
    const dbPath = path.join(os.tmpdir(), `memento-i237-ctx-${Date.now()}.db`);
    await seedTwoProjectMemories(dbPath);
    const { chunks, restore } = captureStdoutWrite();
    try {
      const userMessage =
        'proj237 aloha-seed 고유 내용을 참고해서 요약해 줘. 그리고 앞으로는 커밋 메시지는 영어로 쓰자';
      const code = await runAgentAskMain(
        { dbPath },
        argvAgentAsk(dbPath, userMessage, ['--project-id', 'proj-237', '--no-save']),
        { stdinIsTTY: true },
      );
      expect(code).toBe(0);
      const tail = chunks.join('').trim();
      const obj = JSON.parse(tail) as {
        input: { projectId?: string };
        knowledgeContext: { summary: string; itemCount: number };
      };
      expect(obj.input.projectId).toBe('proj-237');
      expect(obj.knowledgeContext.itemCount).toBeGreaterThan(0);
      expect(obj.knowledgeContext.summary.length).toBeGreaterThan(0);
    } finally {
      restore();
      try {
        fs.unlinkSync(dbPath);
      } catch {
        // ignore
      }
    }
  }, 60_000);

  it('후보 승인 시 persistence 시도·저장 성공', async () => {
    const dbPath = path.join(os.tmpdir(), `memento-i237-y-${Date.now()}.db`);
    await seedTwoProjectMemories(dbPath);
    const { chunks, restore } = captureStdoutWrite();
    try {
      const userMessage = '앞으로는 커밋 메시지는 영어로 쓰자';
      const code = await runAgentAskMain(
        { dbPath },
        argvAgentAsk(dbPath, userMessage, ['--project-id', 'proj-237']),
        {
          stdinIsTTY: true,
          promptApprove: async () => 'y',
        },
      );
      expect(code).toBe(0);
      const obj = JSON.parse(chunks.join('').trim()) as {
        persistence: { attempted: boolean; persistedCount: number; items: { status: string }[] };
      };
      expect(obj.persistence.attempted).toBe(true);
      expect(obj.persistence.persistedCount).toBeGreaterThanOrEqual(1);
      expect(obj.persistence.items.some((i) => i.status === 'persisted')).toBe(true);
    } finally {
      restore();
      try {
        fs.unlinkSync(dbPath);
      } catch {
        // ignore
      }
    }
  }, 60_000);

  it('후보 거절 시 persistence 미시도', async () => {
    const dbPath = path.join(os.tmpdir(), `memento-i237-n-${Date.now()}.db`);
    await seedTwoProjectMemories(dbPath);
    const { chunks, restore } = captureStdoutWrite();
    try {
      const userMessage = '앞으로는 커밋 메시지는 영어로 쓰자';
      const code = await runAgentAskMain(
        { dbPath },
        argvAgentAsk(dbPath, userMessage, ['--project-id', 'proj-237']),
        {
          stdinIsTTY: true,
          promptApprove: async () => 'n',
        },
      );
      expect(code).toBe(0);
      const obj = JSON.parse(chunks.join('').trim()) as {
        persistence: { attempted: boolean; persistedCount: number; items: unknown[] };
      };
      expect(obj.persistence.attempted).toBe(false);
      expect(obj.persistence.persistedCount).toBe(0);
      expect(obj.persistence.items).toEqual([]);
    } finally {
      restore();
      try {
        fs.unlinkSync(dbPath);
      } catch {
        // ignore
      }
    }
  }, 60_000);
});
