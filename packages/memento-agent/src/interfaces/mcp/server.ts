#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { MementoClient } from '@memento/client';
import { AgentCore } from '../../core/agent-core.js';
import { createLLMProvider } from '../../providers/llm/llm-factory.js';
import { createSearchProvider } from '../../providers/search/search-factory.js';
import { loadAgentConfig } from '../../core/types.js';
import { AGENT_ASK_TOOL } from './ask-tool.js';

async function main() {
  const config = loadAgentConfig();
  const client = new MementoClient({ serverUrl: config.mementoBaseUrl });
  const core = new AgentCore(client, createLLMProvider(), createSearchProvider(), {
    recallLimit: config.recallLimit,
    llmTimeoutMs: config.llmTimeoutMs,
    searchTimeoutMs: config.searchTimeoutMs,
  });

  // Connect once at startup
  await client.connect();

  const server = new Server(
    { name: 'memento-agent', version: '0.1.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [AGENT_ASK_TOOL],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name !== 'agent_ask') {
      throw new Error(`Unknown tool: ${request.params.name}`);
    }

    const { query, useSearch = true } = request.params.arguments as { query: string; useSearch?: boolean };

    try {
      const result = await core.ask(query, useSearch);
      return {
        content: [{ type: 'text', text: result.answer }],
        isError: false,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => { console.error(err); process.exit(1); });
