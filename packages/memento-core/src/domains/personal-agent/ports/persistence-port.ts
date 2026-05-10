import type { KnowledgeCandidate } from '../types/agent-types.js';

export interface IPersistencePort {
  persist(candidates: KnowledgeCandidate[]): Promise<void>;
}
