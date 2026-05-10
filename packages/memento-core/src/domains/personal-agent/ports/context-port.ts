import type { KnowledgeCandidate } from '../types/agent-types.js';

export interface IContextPort {
  buildContext(userMessage: string, projectId?: string): Promise<string>;
  proposeCandidates(candidates: KnowledgeCandidate[]): Promise<void>;
}
