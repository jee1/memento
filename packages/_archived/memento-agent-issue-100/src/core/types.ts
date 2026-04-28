import type { MemorySearchResult } from '@memento/client';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface AskResult {
  answer: string;
  usedMemories: MemorySearchResult[];
  searchResults: SearchResult[];
}

export interface AgentConfig {
  mementoBaseUrl: string;
  recallLimit: number;
  llmTimeoutMs: number;
  searchTimeoutMs: number;
}

export function loadAgentConfig(): AgentConfig {
  return {
    mementoBaseUrl: process.env.MEMENTO_BASE_URL ?? 'http://localhost:3000',
    recallLimit: parseInt(process.env.MEMENTO_AGENT_RECALL_LIMIT ?? '10', 10),
    llmTimeoutMs: parseInt(process.env.MEMENTO_AGENT_LLM_TIMEOUT_MS ?? '30000', 10),
    searchTimeoutMs: parseInt(process.env.MEMENTO_AGENT_SEARCH_TIMEOUT_MS ?? '10000', 10),
  };
}
