import type { MementoClient } from '@memento/client';
import type { LLMProvider } from '../providers/llm/llm-provider.js';
import type { SearchProvider } from '../providers/search/search-provider.js';
import type { AskResult, Message } from './types.js';
import { SYSTEM_PROMPT_TEMPLATE } from '../prompts/system-prompt.js';

export class AgentCore {
  constructor(
    private readonly memento: MementoClient,
    private readonly llm: LLMProvider,
    private readonly search: SearchProvider,
    private readonly config = {
      recallLimit: 10,
      llmTimeoutMs: 30000,
      searchTimeoutMs: 10000,
    }
  ) {}

  async ask(query: string, useSearch = true): Promise<AskResult> {
    // 1. Recall memories
    const recallResult = await this.memento.recall(query, undefined, this.config.recallLimit);
    const usedMemories = recallResult.items;

    // 2. Web search (best-effort)
    let searchResults: AskResult['searchResults'] = [];
    if (useSearch) {
      try {
        searchResults = await this.search.search(query, this.config.searchTimeoutMs);
      } catch {
        // silent: continue with memories only
      }
    }

    // 3. Build system prompt
    const memoriesText = usedMemories.length > 0
      ? `[MEMORIES]\n${usedMemories.map((m) => `- ${m.content}`).join('\n')}`
      : '';
    const searchText = searchResults.length > 0
      ? `[SEARCH_RESULTS]\n${searchResults.map((r) => `- ${r.title}: ${r.snippet}`).join('\n')}`
      : '';
    const systemContent = SYSTEM_PROMPT_TEMPLATE
      .replace('{{memories}}', memoriesText)
      .replace('{{searchResults}}', searchText)
      .trim();

    // 4. LLM complete
    const messages: Message[] = [
      { role: 'system', content: systemContent },
      { role: 'user', content: query },
    ];
    const answer = await this.llm.complete(messages, { timeoutMs: this.config.llmTimeoutMs });

    // 5. Save answer as episodic memory
    await this.memento.remember({ content: `Q: ${query}\nA: ${answer}`, type: 'episodic' });

    return { answer, usedMemories, searchResults };
  }
}
