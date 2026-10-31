import {
  readServerInfo,
  resolveServerInfoConfigDir,
} from './server/server-info.js';
import {
  runOpsReport,
  type OpsReportOptions,
  type OpsReportPeriod,
  type OpsReportRequest,
} from './cli/ops-report-core.js';

const ALLOWED_PERIODS: OpsReportPeriod[] = ['24h', '7d', '30d'];

function parseOptions(argv: readonly string[]): OpsReportOptions {
  const parsed: OpsReportOptions = {
    endpoint: '',
    apiKey: '',
    period: '24h',
    json: false,
    timeoutMs: 10_000,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      parsed.json = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    const value = argv[i + 1];
    if (!value) throw new Error(`${arg} requires a value`);
    if (arg === '--endpoint') parsed.endpoint = value;
    else if (arg === '--api-key') parsed.apiKey = value;
    else if (arg === '--period') {
      if (!ALLOWED_PERIODS.includes(value as OpsReportPeriod)) {
        throw new Error(`Invalid --period: ${value}`);
      }
      parsed.period = value as OpsReportPeriod;
    } else if (arg === '--timeout-ms') {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 1) throw new Error('--timeout-ms must be positive');
      parsed.timeoutMs = n;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
    i += 1;
  }
  return parsed;
}

function printHelp(): void {
  process.stdout.write(
    [
      'Usage: npm run ops-report -- [--options]',
      '',
      'Read-only ops summary via GET /admin/ops/summary (no local DB bootstrap).',
      '',
      'Options:',
      '  --endpoint   HTTP admin base (default: server-info or http://127.0.0.1:PORT)',
      '  --api-key    Admin/programmatic API key',
      '  --period     24h | 7d | 30d (default 24h)',
      '  --json       Machine-readable output',
      '  --timeout-ms Request timeout (default 10000)',
      '',
    ].join('\n'),
  );
}

async function resolveEndpoint(explicit: string | undefined, env: NodeJS.ProcessEnv): Promise<string> {
  if (explicit) return new URL(explicit).origin;
  const fromEnv = env.MEMENTO_HTTP_URL ?? env.MEMENTO_ADMIN_URL;
  if (fromEnv) return new URL(fromEnv).origin;
  const info = await readServerInfo(resolveServerInfoConfigDir({ env }));
  if (info) return `http://127.0.0.1:${info.port}`;
  const port = env.MEMENTO_HTTP_PORT ?? '3000';
  return `http://127.0.0.1:${port}`;
}

function resolveApiKey(explicit: string | undefined, env: NodeJS.ProcessEnv): string {
  return explicit ?? env.MEMENTO_API_KEY ?? env.ADMIN_API_KEY ?? '';
}

export function createOpsReportRequest(
  endpoint: string,
  apiKey: string,
  timeoutMs: number,
): OpsReportRequest {
  return async (path, init) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers = new Headers(init?.headers);
      if (apiKey) headers.set('X-API-Key', apiKey);
      const response = await fetch(`${endpoint}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
      const text = await response.text();
      let body: unknown = text;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }
      return { status: response.status, body };
    } finally {
      clearTimeout(timer);
    }
  };
}

export async function runOpsReportCommand(argv: string[]): Promise<number> {
  const { loadEnv } = await import('./cli/env-loader.js');
  loadEnv();
  let options: OpsReportOptions;
  try {
    options = parseOptions(argv);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }

  options.endpoint = await resolveEndpoint(options.endpoint || undefined, process.env);
  options.apiKey = resolveApiKey(options.apiKey || undefined, process.env);
  if (!options.apiKey) {
    process.stderr.write('Missing API key (--api-key, MEMENTO_API_KEY, or ADMIN_API_KEY)\n');
    return 1;
  }

  const request = createOpsReportRequest(options.endpoint, options.apiKey, options.timeoutMs);
  const result = await runOpsReport(options, request);
  if (result.stderr) process.stderr.write(`${result.stderr}\n`);
  if (result.stdout) process.stdout.write(result.stdout);
  return result.exitCode;
}

const isDirectRun =
  process.argv[1]?.endsWith('ops-report-cli.ts') || process.argv[1]?.endsWith('ops-report-cli.js');

if (isDirectRun) {
  runOpsReportCommand(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((err) => {
      process.stderr.write(String(err?.message ?? err) + '\n');
      process.exit(1);
    });
}
