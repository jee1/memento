import type { MemoryType } from '../../../shared/types/index.js';
import type { LLMProviderMetadata } from '../ports/llm-port.js';

export interface KnowledgeCandidate {
  content: string;
  type: 'episodic' | 'semantic' | 'procedural';
  importance: number;
  tags: string[];
  sourceContext?: string;
}

export interface PersonalKnowledgeAgentInput {
  userMessage: string;
  sessionId?: string;
  projectId?: string;
  ownerId?: string | string[];
  tokenBudget?: number;
  maxMemories?: number;
  memoryTypes?: MemoryType[];
}

/** Agent Loop에 넘길 수 있는 컨텍스트 메타 (#232) */
export interface PersonalKnowledgeContextMeta {
  itemCount: number;
  tokenEstimate: number;
  summary: string;
}

export interface PersonalKnowledgeAgentResult {
  candidates: KnowledgeCandidate[];
  llmResponse: string;
  llmMetadata?: LLMProviderMetadata;
  persisted: boolean;
  knowledgeContext: PersonalKnowledgeContextMeta;
}
