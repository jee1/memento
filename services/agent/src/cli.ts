#!/usr/bin/env node
/**
 * CLI 진입점 (chat, doctor)
 * 하는 일: npx memento-agent chat | doctor. chat은 로컬 루프로 동작(서버 불필요).
 * 연관: config, actionableLoop, mementoClient
 */

import { createInterface } from 'readline';
import { config } from './config.js';
import { runActionableLoop } from './loop/actionableLoop.js';
import { ToolRegistry } from './tools/registry.js';
import { createSearchTool } from './tools/searchTool.js';
import { StubSearchProvider } from './clients/searchClient.js';

const args = process.argv.slice(2);
const command = args[0] ?? 'chat';

const toolRegistry = new ToolRegistry();
toolRegistry.register(createSearchTool(new StubSearchProvider()));

async function chat(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ownerId = process.env.AGENT_OWNER_ID ?? 'default';
  const sessionId = process.env.AGENT_SESSION_ID ?? `s_${Date.now()}`;

  console.log('Memento Agent (CLI). 종료: exit 또는 Ctrl+C\n');

  const ask = (): void => {
    rl.question('You: ', async (line) => {
      const msg = line?.trim() ?? '';
      if (msg.toLowerCase() === 'exit') {
        rl.close();
        process.exit(0);
      }
      if (!msg) {
        ask();
        return;
      }
      try {
        const response = await runActionableLoop(
          { message: msg, ownerId, sessionId },
          toolRegistry
        );
        console.log('\nAgent:', response.answer);
        if (response.meta?.usedMemories?.length) {
          console.log('  [기억 사용:', response.meta.usedMemories.length, '건]');
        }
        if (response.meta?.executedTools?.length) {
          console.log('  [실행 도구:', response.meta.executedTools.map((t) => t.name).join(', '), ']');
        }
      } catch (e) {
        console.log('\nAgent error:', e instanceof Error ? e.message : e);
      }
      console.log('');
      ask();
    });
  };
  ask();
}

async function doctor(): Promise<void> {
  const base = config.mementoBaseUrl;
  console.log('Memento Agent doctor — 연결 확인');
  console.log('  MEMENTO_BASE_URL:', base);
  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/health`, { method: 'GET' });
    if (res.ok) {
      console.log('  Core health: OK');
    } else {
      console.log('  Core health: FAIL', res.status);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const cause = e instanceof Error && e.cause && typeof (e.cause as NodeJS.ErrnoException).code === 'string'
      ? (e.cause as NodeJS.ErrnoException).code
      : null;
    console.log('  Core: 연결 실패', cause ? `${msg} (${cause})` : msg);
    console.log('  안내: Core가 실행 중인지, MEMENTO_BASE_URL이 이 환경에서 접근 가능한지 확인하세요.');
  }
  process.exit(0);
}

if (command === 'doctor') {
  doctor();
} else if (command === 'chat') {
  chat();
} else {
  console.log('Usage: memento-agent chat | doctor');
  process.exit(1);
}
