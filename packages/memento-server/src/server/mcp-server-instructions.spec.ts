import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CORE_TOOLSET, getAllTools } from '@memento/core';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';

import { MEMENTO_SERVER_INSTRUCTIONS } from './mcp-instructions.js';
import { processMcpMessage } from './routes/mcp/message-processor.js';

const mentions = (text: string) => getAllTools()
  .map((tool) => tool.name)
  .filter((name) => new RegExp(`\\b${name}\\b`).test(text))
  .sort();

const ENTRY = resolve('packages/memento-server/src/server/index.ts');
const stdioEnv = (dir: string, era: string) => ({
  HOME: dir,
  NODE_ENV: 'test',
  DB_PATH: join(dir, 'memory.db'),
  MEMENTO_CONFIG_DIR: dir,
  MEMENTO_MCP_ERA: era,
  EMBEDDING_PROVIDER: 'tfidf',
  BATCH_SCHEDULER_ENABLED: 'false',
  OLLAMA_BASE_URL: 'http://127.0.0.1:1',
});

describe('server instructions (#1849, #1836)', () => {
  it('name exactly the tools listed by default, all within the first 512 characters', () => {
    expect(mentions(MEMENTO_SERVER_INSTRUCTIONS)).toEqual([...CORE_TOOLSET].sort());
    expect(mentions(MEMENTO_SERVER_INSTRUCTIONS.slice(0, 512))).toEqual([...CORE_TOOLSET].sort());
  });

  // 모든 세션의 컨텍스트에 더해지는 글이라 상한을 둔다
  it('stay within 1,000 characters', () => {
    expect(MEMENTO_SERVER_INSTRUCTIONS.length).toBeLessThanOrEqual(1000);
  });

  it.each(['README.md', 'README.en.md'])('are copied verbatim into %s', async (file) => {
    expect(await readFile(resolve(file), 'utf8')).toContain(MEMENTO_SERVER_INSTRUCTIONS);
  });

  it.each(['initialize', 'server/discover'])('are returned by HTTP %s', async (method) => {
    const response = await processMcpMessage({ id: 1, method, params: {} }, null, null);

    expect(response.result).toMatchObject({ instructions: MEMENTO_SERVER_INSTRUCTIONS });
  });

  it('are returned by stdio server/discover (2026-07-28)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'memento-instructions-'));
    const child = spawn(process.execPath, ['--import', 'tsx', ENTRY], {
      cwd: resolve('.'), stdio: ['pipe', 'pipe', 'ignore'], env: stdioEnv(dir, 'dual'),
    });
    try {
      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'server/discover',
        params: { _meta: {
          'io.modelcontextprotocol/protocolVersion': '2026-07-28',
          'io.modelcontextprotocol/clientCapabilities': {},
        } },
      })}\n`);
      const [line] = await once(createInterface({ input: child.stdout }), 'line') as [string];

      expect(JSON.parse(line)).toMatchObject({ result: { instructions: MEMENTO_SERVER_INSTRUCTIONS } });
    } finally {
      child.kill();
      await once(child, 'exit');
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it.each(['legacy', 'dual'])('are returned by stdio in %s mode', async (era) => {
    const dir = await mkdtemp(join(tmpdir(), 'memento-instructions-'));
    const client = new Client({ name: 'instructions-test', version: '1.0.0' });
    try {
      await client.connect(new StdioClientTransport({
        command: process.execPath,
        args: ['--import', 'tsx', ENTRY],
        cwd: resolve('.'),
        stderr: 'ignore',
        env: stdioEnv(dir, era),
      }));

      expect(client.getInstructions()).toBe(MEMENTO_SERVER_INSTRUCTIONS);
    } finally {
      await client.close();
      await rm(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
