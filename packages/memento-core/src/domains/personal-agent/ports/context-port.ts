import type { MemoryType } from '../../../shared/types/index.js';
import type { KnowledgeCandidate } from '../types/agent-types.js';
import type { KnowledgeContextBundle } from '../../memory/services/knowledge-context-bundle-builder.js';

export type { KnowledgeContextBundle } from '../../memory/services/knowledge-context-bundle-builder.js';

/** 인프로세스 context builder 입력 (#232) */
export interface KnowledgeContextRequest {
  userMessage: string;
  projectId?: string;
  ownerId?: string | string[];
  tokenBudget?: number;
  maxMemories?: number;
  memoryTypes?: MemoryType[];
}

export interface IContextPort {
  buildContext(request: KnowledgeContextRequest): Promise<KnowledgeContextBundle>;
  proposeCandidates(candidates: KnowledgeCandidate[]): Promise<void>;
}
