import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { LlmUsageFeature } from './llm-usage-types.js';

export interface LlmUsageLogicalContext {
  logicalRequestId: string;
  feature: LlmUsageFeature;
  runId?: string | null;
  attemptCounter: { value: number };
  rateLimitedCounter: { value: number };
}

const storage = new AsyncLocalStorage<LlmUsageLogicalContext>();

export function getLlmUsageLogicalContext(): LlmUsageLogicalContext | undefined {
  return storage.getStore();
}

export async function runWithLlmUsageLogicalContext<T>(
  feature: LlmUsageFeature,
  runId: string | null | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  const ctx: LlmUsageLogicalContext = {
    logicalRequestId: randomUUID(),
    feature,
    runId: runId ?? null,
    attemptCounter: { value: 0 },
    rateLimitedCounter: { value: 0 },
  };
  return storage.run(ctx, fn);
}
