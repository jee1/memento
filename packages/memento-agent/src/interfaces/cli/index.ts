#!/usr/bin/env node
import { MementoClient } from '@memento/client';
import { AgentCore } from '../../core/agent-core.js';
import { createLLMProvider } from '../../providers/llm/llm-factory.js';
import { createSearchProvider } from '../../providers/search/search-factory.js';
import { loadAgentConfig } from '../../core/types.js';

export function parseArgs(argv: string[]): { query: string; useSearch: boolean; json: boolean } {
  const args = argv.slice(2);

  if (args[0] === 'serve-mcp') {
    // serve-mcp: MCP 서버를 기동하고 return
    // process.exit 호출 금지 — server.ts가 장기 실행 stdio 서버
    import('../../interfaces/mcp/server.js').catch((e) => {
      console.error(e); process.exit(1);
    });
    return { query: '', useSearch: false, json: false };
  }

  if (args[0] !== 'ask') {
    console.error('Usage: memento-agent ask [--no-search] [--json] "<query>"\n       memento-agent serve-mcp');
    process.exit(1);
  }

  const flags = args.filter((a) => a.startsWith('--'));
  const words = args.filter((a) => !a.startsWith('--') && a !== 'ask');

  return {
    query: words.join(' '),
    useSearch: !flags.includes('--no-search'),
    json: flags.includes('--json'),
  };
}

async function main() {
  const parsed = parseArgs(process.argv);

  // serve-mcp was handled in parseArgs (dynamic import + return)
  if (!parsed.query && process.argv[2] === 'serve-mcp') return;

  const { query, useSearch, json } = parsed;

  if (!query) {
    console.error('Error: query is required');
    process.exit(1);
  }

  const config = loadAgentConfig();
  const client = new MementoClient({ serverUrl: config.mementoBaseUrl });

  try {
    await client.connect();
  } catch {
    console.error(`Error: cannot connect to Memento at ${config.mementoBaseUrl}`);
    process.exit(1);
  }

  const core = new AgentCore(client, createLLMProvider(), createSearchProvider(), {
    recallLimit: config.recallLimit,
    llmTimeoutMs: config.llmTimeoutMs,
    searchTimeoutMs: config.searchTimeoutMs,
  });

  try {
    const result = await core.ask(query, useSearch);
    if (json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(result.answer);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}

// Only run main if this is the entry point (not imported in tests)
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
