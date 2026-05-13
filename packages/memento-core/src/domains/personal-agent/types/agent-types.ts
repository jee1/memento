import type { MemoryType } from '../../../shared/types/index.js';
import type { LLMProviderMetadata } from '../ports/llm-port.js';

export type KnowledgeCandidateCategory = 'preference' | 'decision' | 'learning' | 'procedure';

/** 개인 지식 후보가 제안할 수 있는 저장 타입 (#234: working 제외) */
export type SuggestedPersonalMemoryType = Exclude<MemoryType, 'working'>;

export interface KnowledgeCandidate {
  category: KnowledgeCandidateCategory;
  content: string;
  reason: string;
  suggestedMemoryType: SuggestedPersonalMemoryType;
  tags: string[];
  importance: number;
  confidence: number;
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
