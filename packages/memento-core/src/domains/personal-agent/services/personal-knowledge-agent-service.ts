import { randomUUID } from 'node:crypto';
import type { ILLMPort } from '../ports/llm-port.js';
import type { IContextPort } from '../ports/context-port.js';
import type { IPersistencePort } from '../ports/persistence-port.js';
import type {
  KnowledgeCandidate,
  PersonalKnowledgeAgentInput,
  PersonalKnowledgeAgentResult,
  PersonalKnowledgePersistInput,
  PersonalKnowledgePersistResult,
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

    const raw = extractKnowledgeCandidates(input.userMessage);
    const candidates: KnowledgeCandidate[] = raw.map((c) => ({
      ...c,
      id: `kc_${randomUUID()}`,
    }));

    const llmResult = await this.deps.llm.complete([
      { role: 'system', content: bundle.promptText },
      { role: 'user', content: input.userMessage },
    ]);

    await this.deps.context.proposeCandidates(candidates);

    // #235: remember는 `persistApprovedCandidates`에서만 호출

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

  /**
   * 승인된 후보만 저장한다. LLM·proposeCandidates는 호출하지 않는다 (#235).
   */
  async persistApprovedCandidates(input: PersonalKnowledgePersistInput): Promise<PersonalKnowledgePersistResult> {
    if (input.candidates.length === 0 && input.approvedCandidateIds.length > 0) {
      throw new Error('personal-knowledge-agent: candidates가 비어 있는데 승인 id가 있습니다');
    }
    for (const c of input.candidates) {
      if (!c.id) {
        throw new Error('personal-knowledge-agent: 후보에 id가 없습니다');
      }
    }
    return this.deps.persistence.persistApproved(input);
  }
}
