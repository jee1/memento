import { LIMITS } from '../../../shared/constants/relation-constants.js';
import type { MemoryItem } from '../../../shared/types/memory.types.js';
import type { UnifiedEmbeddingService } from '../../embedding/index.js';
import { filterRelationCandidatesByEmbedding } from './llm-relation-extractor/embedding-candidate-filter.js';

/** Chat prompts already append '...' past this length. Jev state uses the same clip. */
export const RELATION_TEXT_CHARS = 200;

const AVG_TOKENS_PER_MEMORY = 50;

export function clipRelationText(text: string, chars: number): string {
  if (text.length <= chars) {
    return text;
  }
  // A cut inside a surrogate pair leaves a lone surrogate, which System One rejects as invalid Unicode.
  const end = /[\uD800-\uDBFF]/.test(text.charAt(chars - 1)) ? chars - 1 : chars;
  return `${text.substring(0, end)}...`;
}

export function compressRelationMemories(
  memories: readonly MemoryItem[],
  maxTokens: number = LIMITS.MAX_PROMPT_TOKENS,
): MemoryItem[] {
  const maxMemories = Math.floor(maxTokens / AVG_TOKENS_PER_MEMORY);
  return memories.slice(0, maxMemories).map((memory) => ({
    ...memory,
    content: clipRelationText(memory.content, RELATION_TEXT_CHARS),
  }));
}

/** Same shrink the chat extractor uses: embedding top-N, then ~10 items × 200 chars. */
export async function prepareRelationCandidatePool(
  embedding: UnifiedEmbeddingService,
  source: MemoryItem,
  existing: readonly MemoryItem[],
  candidateLimit: number,
): Promise<MemoryItem[]> {
  const filtered = await filterRelationCandidatesByEmbedding(
    embedding,
    source,
    [...existing],
    candidateLimit,
  );
  return compressRelationMemories(filtered);
}
