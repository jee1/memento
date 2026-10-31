import type { LLMProvider } from '../../../shared/types/memory.types.js';
import type { MemoryItem } from '../../../shared/types/memory.types.js';
import type { RelationCandidate } from '../../../shared/types/relation.js';
import type { SystemOneFailureReason } from '../../../shared/services/typesafe/system-one-client.js';
import { SystemOneClient } from '../../../shared/services/typesafe/system-one-client.js';
import { LIMITS } from '../../../shared/constants/relation-constants.js';
import {
  resolveRelationExtractionSeat,
  type RelationExtractionOverride,
} from '../../../shared/config/relation-extraction-seat.js';
import { UnifiedEmbeddingService } from '../../embedding/services/unified-embedding-service.js';
import { JevRelationJudge, RELATION_JEV_TIMEOUT_MS } from './jev-relation-judge.js';
import { LLMBasedRelationExtractor } from './llm-based-relation-extractor.js';
import { RelationExtractor } from './relation-extractor.js';
import { runWithLlmUsageLogicalContext } from '../../../shared/services/llm-usage/llm-usage-logical-context.js';
import { recordLlmUsageLogicalFinal } from '../../../shared/services/llm-usage/llm-usage-recorder.js';

export type RememberRelationOutcome =
  | { readonly status: 'extracted'; readonly candidates: readonly RelationCandidate[] }
  | { readonly status: 'none' }
  | { readonly status: 'unavailable' }
  | {
      readonly status: 'failed';
      readonly reason: SystemOneFailureReason | 'chat_failed';
    };

function hasTypesafeKey(apiKey: string | undefined): apiKey is string {
  return typeof apiKey === 'string' && apiKey.trim() !== '';
}

async function extractWithChat(
  source: MemoryItem,
  existing: readonly MemoryItem[],
): Promise<RememberRelationOutcome> {
  const llmExtractor = new LLMBasedRelationExtractor();
  if (!(await llmExtractor.isAvailableAsync())) {
    return { status: 'unavailable' };
  }
  try {
    const candidates = await new RelationExtractor(undefined, llmExtractor).extractRelations(
      source,
      [...existing],
      // hybrid+rule draws an edge to every template peer. Remember asks the chat model only (#1378).
      {
        method: 'llm',
        minConfidence: 0.5,
        candidateLimit: LIMITS.LLM_CANDIDATE_DEFAULT,
        immediate: true,
      },
    );
    const allowedTargetIds = new Set(existing.map((m) => m.id).filter((id) => id !== source.id));
    const validCandidates = candidates.filter((c) => allowedTargetIds.has(c.target_id));
    if (validCandidates.length === 0) {
      return { status: 'none' };
    }
    return { status: 'extracted', candidates: validCandidates };
  } catch {
    return { status: 'failed', reason: 'chat_failed' };
  }
}

let sharedRememberEmbeddingService: UnifiedEmbeddingService | null = null;
let cachedJevJudge: {
  key: string;
  judge: JevRelationJudge;
} | null = null;

function getSharedRememberEmbeddingService(): UnifiedEmbeddingService {
  if (!sharedRememberEmbeddingService) {
    sharedRememberEmbeddingService = new UnifiedEmbeddingService();
  }
  return sharedRememberEmbeddingService;
}

function getOrCreateJevJudge(apiKey: string, model: string): JevRelationJudge {
  const cacheKey = `${apiKey}\u0000${model}`;
  if (!cachedJevJudge || cachedJevJudge.key !== cacheKey) {
    const client = new SystemOneClient({
      apiKey,
      model,
      timeoutMs: RELATION_JEV_TIMEOUT_MS,
    });
    cachedJevJudge = {
      key: cacheKey,
      judge: new JevRelationJudge(client, getSharedRememberEmbeddingService(), model),
    };
  }
  return cachedJevJudge.judge;
}

/**
 * Remember's configured relation engine. Never throws.
 * A jev seat does not construct a chat extractor and does not fall back to one.
 */
export async function extractForRemember(
  source: MemoryItem,
  existing: readonly MemoryItem[],
  config: {
    readonly llmProvider: LLMProvider;
    readonly relationExtractionOverride: RelationExtractionOverride;
    readonly typesafeApiKey: string | undefined;
    readonly typesafeModel: string;
  },
): Promise<RememberRelationOutcome> {
  const seat = resolveRelationExtractionSeat(config);
  if (seat.kind === 'jev') {
    if (!hasTypesafeKey(config.typesafeApiKey)) {
      return { status: 'unavailable' };
    }
    const model = config.typesafeModel;
    return runWithLlmUsageLogicalContext('relation_extraction', null, async () => {
      const judge = getOrCreateJevJudge(config.typesafeApiKey!.trim(), model);
      const judged = await judge.judge(source, existing);
      if (judged.ok === false) {
        recordLlmUsageLogicalFinal({
          finalPath: 'deferred',
          finalReason: judged.reason,
          provider: 'typesafe',
          model,
        });
        return { status: 'failed', reason: judged.reason };
      }
      recordLlmUsageLogicalFinal({
        finalPath: 'llm',
        provider: 'typesafe',
        model,
      });
      if (judged.candidates.length === 0) {
        return { status: 'none' };
      }
      return { status: 'extracted', candidates: judged.candidates };
    });
  }
  return extractWithChat(source, existing);
}
