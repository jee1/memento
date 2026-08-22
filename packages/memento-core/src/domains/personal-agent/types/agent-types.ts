import type { MemoryType } from '../../../shared/types/memory.types.js';
import type { LLMProviderMetadata } from '../ports/llm-port.js';

export type KnowledgeCandidateCategory = 'preference' | 'decision' | 'learning' | 'procedure';

/** 개인 지식 후보가 제안할 수 있는 저장 타입 (#234: working 제외) */
export type SuggestedPersonalMemoryType = Exclude<MemoryType, 'working'>;

export interface KnowledgeCandidate {
  /** `kc_` + UUID, `runOneTurn`에서 부여 */
  id: string;
  category: KnowledgeCandidateCategory;
  content: string;
  reason: string;
  suggestedMemoryType: SuggestedPersonalMemoryType;
  tags: string[];
  importance: number;
  confidence: number;
  sourceContext?: string;
}

/** 추출기 출력(#234). `runOneTurn`에서 `id`를 부여해 `KnowledgeCandidate`로 승격한다. */
export type KnowledgeCandidatePayload = Omit<KnowledgeCandidate, 'id'>;

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
  /** `runOneTurn`에서는 remember를 호출하지 않으므로 항상 `false` */
  persisted: boolean;
  knowledgeContext: PersonalKnowledgeContextMeta;
}

/** 2단계: 승인된 후보만 저장 (#235) */
export interface PersonalKnowledgePersistInput {
  candidates: KnowledgeCandidate[];
  approvedCandidateIds: string[];
  projectId?: string;
  ownerId?: string | string[];
  sessionId?: string;
  processId?: string;
}

export type PersonalKnowledgePersistItemStatus = 'persisted' | 'error';

export interface PersonalKnowledgePersistItemResult {
  candidateId: string;
  status: PersonalKnowledgePersistItemStatus;
  memoryId?: string;
  errorMessage?: string;
}

export interface PersonalKnowledgePersistResult {
  items: PersonalKnowledgePersistItemResult[];
  persistedCount: number;
  errorCount: number;
}
