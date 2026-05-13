import type {
  PersonalKnowledgePersistInput,
  PersonalKnowledgePersistResult,
} from '../types/agent-types.js';

export interface IPersistencePort {
  persistApproved(input: PersonalKnowledgePersistInput): Promise<PersonalKnowledgePersistResult>;
}
