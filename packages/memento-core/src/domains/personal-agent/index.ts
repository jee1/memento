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

export { OpenAiChatLlmAdapter } from './adapters/openai-chat-llm-adapter.js';
export type { OpenAiChatLlmAdapterOptions } from './adapters/openai-chat-llm-adapter.js';

export { GeminiChatLlmAdapter } from './adapters/gemini-chat-llm-adapter.js';
export type { GeminiChatLlmAdapterOptions } from './adapters/gemini-chat-llm-adapter.js';

export {
  ToolContextKnowledgeContextAdapter,
} from './adapters/tool-context-knowledge-context-adapter.js';

export { extractKnowledgeCandidates } from './extractors/knowledge-candidate-extractor.js';

export {
  PersonalKnowledgeAgentService,
} from './services/personal-knowledge-agent-service.js';
export type { PersonalKnowledgeAgentDeps } from './services/personal-knowledge-agent-service.js';

export {
  PersonalAgentLlmError,
  isPersonalAgentLlmError,
} from './errors/personal-agent-llm-error.js';
export type { PersonalAgentLlmErrorCode } from './errors/personal-agent-llm-error.js';

export { parsePersonalAgentLlmEnv } from './config/personal-agent-llm-env.js';
export type {
  ParsedPersonalAgentLlmEnv,
  ParsePersonalAgentLlmEnvKeys,
} from './config/personal-agent-llm-env.js';

export { createPersonalAgentLlmPort } from './services/create-personal-agent-llm-port.js';
export type { CreatePersonalAgentLlmPortDeps } from './services/create-personal-agent-llm-port.js';
