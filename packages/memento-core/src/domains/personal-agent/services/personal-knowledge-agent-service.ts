import type { ILLMPort } from '../ports/llm-port.js';
import type { IContextPort } from '../ports/context-port.js';
import type { IPersistencePort } from '../ports/persistence-port.js';
import type {
  KnowledgeCandidate,
  PersonalKnowledgeAgentInput,
  PersonalKnowledgeAgentResult,
} from '../types/agent-types.js';
import { extractKnowledgeCandidates } from '../extractors/knowledge-candidate-extractor.js';

export interface PersonalKnowledgeAgentDeps {
  llm: ILLMPort;
  context: IContextPort;
  persistence: IPersistencePort;
}

export class PersonalKnowledgeAgentService {
  constructor(private readonly deps: PersonalKnowledgeAgentDeps) {}

  async runOneTurn(input: PersonalKnowledgeAgentInput): Promise<PersonalKnowledgeAgentResult> {
    const bundle = await this.deps.context.buildContext({
      userMessage: input.userMessage,
      projectId: input.projectId,
      ownerId: input.ownerId,
      tokenBudget: input.tokenBudget,
      maxMemories: input.maxMemories,
      memoryTypes: input.memoryTypes,
    });

    const candidates: KnowledgeCandidate[] = extractKnowledgeCandidates(input.userMessage);

    const llmResult = await this.deps.llm.complete([
      { role: 'system', content: bundle.promptText },
      { role: 'user', content: input.userMessage },
    ]);

    await this.deps.context.proposeCandidates(candidates);

    // #235에서 승인 흐름 구현
    await this.deps.persistence.persist(candidates);

    return {
      candidates,
      llmResponse: llmResult.content,
      llmMetadata: llmResult.metadata,
      persisted: false,
      knowledgeContext: {
        itemCount: bundle.itemCount,
        tokenEstimate: bundle.tokenEstimate,
        summary: bundle.contextSummary,
      },
    };
  }
}
