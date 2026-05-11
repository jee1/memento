import type { ILLMPort } from '../ports/llm-port.js';
import type { IContextPort } from '../ports/context-port.js';
import type { IPersistencePort } from '../ports/persistence-port.js';
import type {
  KnowledgeCandidate,
  PersonalKnowledgeAgentInput,
  PersonalKnowledgeAgentResult,
} from '../types/agent-types.js';

export interface PersonalKnowledgeAgentDeps {
  llm: ILLMPort;
  context: IContextPort;
  persistence: IPersistencePort;
}

export class PersonalKnowledgeAgentService {
  constructor(private readonly deps: PersonalKnowledgeAgentDeps) {}

  async runOneTurn(input: PersonalKnowledgeAgentInput): Promise<PersonalKnowledgeAgentResult> {
    const contextText = await this.deps.context.buildContext(
      input.userMessage,
      input.projectId,
    );

    const llmResult = await this.deps.llm.complete([
      { role: 'system', content: contextText },
      { role: 'user', content: input.userMessage },
    ]);

    // #234에서 실제 후보 추출 구현
    const candidates: KnowledgeCandidate[] = [];
    await this.deps.context.proposeCandidates(candidates);

    // #235에서 승인 흐름 구현
    await this.deps.persistence.persist(candidates);

    return {
      candidates,
      llmResponse: llmResult.content,
      llmMetadata: llmResult.metadata,
      persisted: false,
    };
  }
}
