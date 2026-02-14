/**
 * Actionable Memory Loop
 * 하는 일: User Input → Intent → Memory Injection → LLM/Tool → Remember → Response (FR-1)
 * 연관: mementoClient, ruleIntent, llmClient, ToolRegistry, contracts
 */

import * as memento from '../clients/mementoClient.js';
import { detectIntent } from '../intent/ruleIntent.js';
import { getLLMProvider } from '../clients/llmClient.js';
import type { ChatRequest, AgentResponse, MemoryPreview, ToolExecution } from '../schemas/contracts.js';
import type { ToolRegistry } from '../tools/registry.js';

function extractKeywords(injectionText: string): string {
  return injectionText
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .slice(0, 5)
    .join(' ');
}

export async function runActionableLoop(
  req: ChatRequest,
  toolRegistry: ToolRegistry
): Promise<AgentResponse> {
  const intent = detectIntent(req.message);
  const startRecall = Date.now();
  let memories: MemoryPreview[] = [];
  let injectionText = '';

  try {
    const injectResult = await memento.inject(req.message, {
      ownerId: req.ownerId,
      maxMemories: 5
    });
    memories = injectResult.memories;
    injectionText = injectResult.injectionText;
  } catch (err) {
    injectionText = '';
  }

  const recallLatency = Date.now() - startRecall;
  if (process.env.LOG_LEVEL === 'debug') {
    console.log('[agent] intent=%s recall_latency_ms=%d memory_count=%d', intent, recallLatency, memories.length);
  }
  const executedTools: ToolExecution[] = [];
  let answer: string;

  if (intent === 'action_search') {
    const searchTool = toolRegistry.get('search_web_with_memory');
    const context = extractKeywords(injectionText);
    if (searchTool) {
      const toolStart = Date.now();
      const toolResult = await searchTool.execute({
        query: req.message,
        context: context || undefined
      });
      if (process.env.LOG_LEVEL === 'debug') {
        console.log('[agent] tool_execution_time_ms=%d', Date.now() - toolStart);
      }
      executedTools.push({
        name: searchTool.name,
        summary: toolResult.summary
      });
      const llm = getLLMProvider();
      answer = await llm.summarize(toolResult.summary);
    } else {
      answer = '검색 도구가 등록되지 않았습니다.';
    }
  } else {
    const llm = getLLMProvider();
    answer = await llm.chat(req.message, { injectionText });
  }

  try {
    await memento.remember(
      `[${intent}] ${req.message.slice(0, 100)} → ${answer.slice(0, 200)}`,
      {
        ownerId: req.ownerId,
        sessionId: req.sessionId,
        source: 'memento-agent'
      }
    );
  } catch {
    // remember 실패 시에도 응답은 반환
  }

  return {
    answer,
    meta: {
      intent,
      usedMemories: memories,
      executedTools: executedTools.length > 0 ? executedTools : undefined
    }
  };
}
