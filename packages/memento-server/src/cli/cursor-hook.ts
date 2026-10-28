import { homedir } from 'node:os';
import type { Readable } from 'node:stream';

import {
  parseDirectiveConfig,
  runCursorHook,
} from '@memento/agent-integration';

import {
  readServerInfo,
  resolveServerInfoConfigDir,
} from '../server/server-info.js';
import { resolveDirectiveRecallPort } from './resolve-directive-recall.js';

async function readStream(stream: Readable): Promise<string> {
  let input = '';
  for await (const chunk of stream) input += String(chunk);
  return input;
}

/** Cursor beforeSubmitPrompt → case 지침 주입 (capture 없음). */
export async function runCursorHookCommand(
  stream: Readable = process.stdin,
): Promise<number> {
  const input = await readStream(stream);
  const configDir = resolveServerInfoConfigDir();
  const serverInfo = await readServerInfo(configDir);
  const apiKey = process.env.MEMENTO_API_KEY?.trim() || process.env.ADMIN_API_KEY?.trim();
  const result = await runCursorHook({
    input,
    directives: {
      config: parseDirectiveConfig(process.env, homedir()),
      recall: resolveDirectiveRecallPort({
        env: process.env,
        home: homedir(),
        ...(serverInfo ? { serverPort: serverInfo.port } : {}),
        apiKey,
      }),
      now: Date.now,
    },
  });
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.stdout) {
    await new Promise<void>((resolve) => process.stdout.write(result.stdout, () => resolve()));
  }
  return result.exitCode;
}
