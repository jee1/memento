import type OpenAI from 'openai';
import type { GoogleGenAI } from '@google/genai';

export type ResolvedLlmProvider = 'openai' | 'gemini' | 'ollama' | null;
export type RequestedLlmProvider = 'openai' | 'gemini' | 'ollama' | 'auto';

export interface RelationProviderSelectionContext {
  openaiClient: OpenAI | null;
  geminiClient: GoogleGenAI | null;
  preferredProvider: ResolvedLlmProvider;
  /** mementoConfig.llmProvider */
  llmProviderConfig: string;
}

export function isOllamaPreferredSlotAvailable(ctx: RelationProviderSelectionContext): boolean {
  return ctx.preferredProvider === 'ollama' && ctx.llmProviderConfig === 'ollama';
}

export function determineRelationLlmProvider(
  ctx: RelationProviderSelectionContext,
  requestedProvider: RequestedLlmProvider
): ResolvedLlmProvider {
  if (requestedProvider === 'auto') {
    if (ctx.openaiClient) return 'openai';
    if (ctx.geminiClient) return 'gemini';
    if (isOllamaPreferredSlotAvailable(ctx)) return 'ollama';
    return null;
  }

  if (requestedProvider === 'openai' && ctx.openaiClient) {
    return 'openai';
  }
  if (requestedProvider === 'gemini' && ctx.geminiClient) {
    return 'gemini';
  }
  if (requestedProvider === 'ollama' && isOllamaPreferredSlotAvailable(ctx)) {
    return 'ollama';
  }

  if (requestedProvider === 'openai') {
    if (ctx.geminiClient) return 'gemini';
    if (isOllamaPreferredSlotAvailable(ctx)) return 'ollama';
  } else if (requestedProvider === 'gemini') {
    if (ctx.openaiClient) return 'openai';
    if (isOllamaPreferredSlotAvailable(ctx)) return 'ollama';
  } else if (requestedProvider === 'ollama') {
    if (ctx.openaiClient) return 'openai';
    if (ctx.geminiClient) return 'gemini';
  }

  return null;
}
