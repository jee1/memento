export type {
  KnowledgeCandidate,
  PersonalKnowledgeAgentInput,
  PersonalKnowledgeAgentResult,
} from './types/agent-types.js';

export type { LLMMessage, ILLMPort } from './ports/llm-port.js';
export type { IContextPort } from './ports/context-port.js';
export type { IPersistencePort } from './ports/persistence-port.js';

export {
  PersonalKnowledgeAgentService,
} from './services/personal-knowledge-agent-service.js';
export type { PersonalKnowledgeAgentDeps } from './services/personal-knowledge-agent-service.js';
