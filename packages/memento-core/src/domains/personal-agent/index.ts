export type {
  KnowledgeCandidate,
  KnowledgeCandidateCategory,
  KnowledgeCandidatePayload,
  PersonalKnowledgeAgentInput,
  PersonalKnowledgeAgentResult,
  PersonalKnowledgeContextMeta,
  PersonalKnowledgePersistInput,
  PersonalKnowledgePersistItemResult,
  PersonalKnowledgePersistItemStatus,
  PersonalKnowledgePersistResult,
  SuggestedPersonalMemoryType,
} from './types/agent-types.js';

export type {
  LLMCompletionResult,
  LLMMessage,
  LLMProviderMetadata,
  ILLMPort,
} from './ports/llm-port.js';
export type {
  IContextPort,
  KnowledgeContextBundle,
  KnowledgeContextRequest,
} from './ports/context-port.js';
export type { IPersistencePort } from './ports/persistence-port.js';

export {
  mapKnowledgeCandidateToRememberParams,
  buildProceduralStepsJson,
} from './mappers/knowledge-candidate-to-remember-params.js';
export type { RememberParamsMappingContext, MapKnowledgeCandidateToRememberParamsResult } from './mappers/knowledge-candidate-to-remember-params.js';

export { ToolContextRememberPersistenceAdapter } from './adapters/tool-context-remember-persistence-adapter.js';

export {
  DeterministicMockLlmAdapter,
} from './adapters/deterministic-mock-llm-adapter.js';
export type {
  DeterministicMockLlmAdapterOptions,
} from './adapters/deterministic-mock-llm-adapter.js';

export {
  ToolContextKnowledgeContextAdapter,
} from './adapters/tool-context-knowledge-context-adapter.js';

export { extractKnowledgeCandidates } from './extractors/knowledge-candidate-extractor.js';

export {
  PersonalKnowledgeAgentService,
} from './services/personal-knowledge-agent-service.js';
export type { PersonalKnowledgeAgentDeps } from './services/personal-knowledge-agent-service.js';
