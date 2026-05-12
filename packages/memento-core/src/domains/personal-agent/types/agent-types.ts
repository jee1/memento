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
}

export interface PersonalKnowledgeAgentResult {
  candidates: KnowledgeCandidate[];
  llmResponse: string;
  llmMetadata?: LLMProviderMetadata;
  persisted: boolean;
}
