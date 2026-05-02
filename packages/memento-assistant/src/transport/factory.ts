// packages/memento-assistant/src/transport/factory.ts
import { StdioTransport } from './stdio-transport.js';
import { HttpTransport } from './http-transport.js';
import type { Transport } from './transport.js';

const DEFAULT_STDIO_COMMAND = 'npx';
const DEFAULT_STDIO_ARGS = ['-y', 'memento-mcp-server@latest'];

interface FactoryOptions {
  transport?: Transport;
}

export function createTransportFromEnv(opts: FactoryOptions, env: NodeJS.ProcessEnv): Transport {
  if (opts.transport) return opts.transport;

  const kind = (env.MEMENTO_TRANSPORT ?? 'stdio').toLowerCase();
  if (kind === 'http') {
    const baseUrl = env.MEMENTO_URL;
    if (!baseUrl) throw new Error('MEMENTO_URL is required when MEMENTO_TRANSPORT=http');
    return new HttpTransport({ baseUrl, token: env.MEMENTO_TOKEN });
  }
  if (kind === 'stdio') {
    const cmdLine = env.MEMENTO_STDIO_COMMAND;
    if (cmdLine && cmdLine.trim().length > 0) {
      const [command, ...args] = cmdLine.split(/\s+/);
      return new StdioTransport({ command, args });
    }
    return new StdioTransport({ command: DEFAULT_STDIO_COMMAND, args: DEFAULT_STDIO_ARGS });
  }
  throw new Error(`Unknown MEMENTO_TRANSPORT="${kind}"`);
}
