import { randomUUID } from 'node:crypto';

import {
  readServerInfo,
  resolveServerInfoConfigDir,
} from '../server/server-info.js';
import {
  humanResult,
  reasonGuide,
  runDoctor,
  runStatus,
  type AgentOpsOptions,
  type AgentOpsRequest,
  type ReasonGuide,
} from './agent-ops-core.js';
import { runDemo } from './agent-ops-demo.js';

export type { AgentOpsRequest, ReasonGuide };
export { reasonGuide };

type AgentOpsCommand = 'doctor' | 'status' | 'demo';

interface AgentOpsDependencies {
  request?: AgentOpsRequest;
  resolveEndpoint?: (
    explicitEndpoint: string | undefined,
    env: NodeJS.ProcessEnv,
  ) => Promise<string>;
  now?: () => Date;
  randomId?: () => string;
  writeStdout?: (message: string) => void | Promise<void>;
  writeStderr?: (message: string) => void | Promise<void>;
  env?: NodeJS.ProcessEnv;
}

function parsePositiveInteger(value: string, name: string, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be between 1 and ${maximum}`);
  }
  return parsed;
}

function parseOptions(argv: readonly string[]): AgentOpsOptions {
  const parsed: AgentOpsOptions = {
    json: false,
    timeoutMs: 5_000,
    since: '24h',
    limit: 20,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      parsed.json = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value) throw new Error(`${arg} requires a value`);
    if (arg === '--endpoint') parsed.endpoint = value;
    else if (arg === '--api-key') parsed.apiKey = value;
    else if (arg === '--timeout-ms') {
      parsed.timeoutMs = parsePositiveInteger(value, '--timeout-ms', 60_000);
    } else if (arg === '--since') parsed.since = value;
    else if (arg === '--limit') parsed.limit = parsePositiveInteger(value, '--limit', 100);
    else throw new Error(`Unknown agent operations option: ${arg}`);
    index += 1;
  }
  return parsed;
}

function normalizeEndpoint(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('endpoint must use http or https');
  }
  return url.origin;
}

async function defaultResolveEndpoint(
  explicitEndpoint: string | undefined,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  if (explicitEndpoint) return normalizeEndpoint(explicitEndpoint);
  if (env.MEMENTO_ENDPOINT?.trim()) return normalizeEndpoint(env.MEMENTO_ENDPOINT.trim());
  const serverInfo = await readServerInfo(resolveServerInfoConfigDir({ env }));
  if (!serverInfo) throw new Error('Memento server endpoint is unavailable');
  return `http://127.0.0.1:${serverInfo.port}`;
}

function createRequest(
  endpoint: string,
  apiKey: string | undefined,
  timeoutMs: number,
): AgentOpsRequest {
  return async (path, init = {}) => {
    try {
      const response = await fetch(`${endpoint}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
          ...init.headers,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = response.status === 204 ? '' : await response.text();
      let body: unknown = null;
      if (text) {
        try {
          body = JSON.parse(text) as unknown;
        } catch {
          body = null;
        }
      }
      return { status: response.status, body };
    } catch {
      return { status: 0, body: { reason_code: 'SERVER_UNAVAILABLE' } };
    }
  };
}

export async function runAgentOpsCommand(
  command: AgentOpsCommand,
  argv: readonly string[],
  dependencies: AgentOpsDependencies = {},
): Promise<number> {
  const writeStdout = dependencies.writeStdout ?? (message => process.stdout.write(message));
  const writeStderr = dependencies.writeStderr ?? (message => process.stderr.write(message));
  try {
    const options = parseOptions(argv);
    const env = dependencies.env ?? process.env;
    const endpoint = await (dependencies.resolveEndpoint ?? defaultResolveEndpoint)(
      options.endpoint,
      env,
    );
    const apiKey = options.apiKey
      ?? env.ADMIN_API_KEY?.trim()
      ?? env.MEMENTO_API_KEY?.trim();
    const request = dependencies.request
      ?? createRequest(endpoint, apiKey, options.timeoutMs);
    const now = dependencies.now ?? (() => new Date());
    const randomId = dependencies.randomId ?? randomUUID;
    const result = command === 'doctor'
      ? await runDoctor(endpoint, request, now, randomId)
      : command === 'status'
        ? await runStatus(endpoint, request, options, now)
        : await runDemo(endpoint, request, now, randomId);
    await writeStdout(
      options.json
        ? `${JSON.stringify(result)}\n`
        : humanResult(result as unknown as Record<string, unknown>),
    );
    return result.ok ? 0 : 1;
  } catch (error) {
    const result = {
      command,
      ok: false,
      checked_at: new Date().toISOString(),
      reason_code: 'INVALID_ARGUMENT',
      message: error instanceof Error ? error.message : 'Agent operations command failed',
      guidance: [reasonGuide('INTERNAL_ERROR')],
    };
    if (argv.includes('--json')) {
      await writeStdout(`${JSON.stringify(result)}\n`);
    } else {
      await writeStderr(`${result.message}\n`);
    }
    return 1;
  }
}
