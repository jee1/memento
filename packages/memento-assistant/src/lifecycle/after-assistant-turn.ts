// packages/memento-assistant/src/lifecycle/after-assistant-turn.ts
import type { AfterAssistantTurnInput, Policy } from '../types.js';
import type { Transport } from '../transport/transport.js';
import { rememberDispatch, type RememberDispatchItem } from '../policy/auto-remember-policy.js';
import { scopeRememberTags } from '../scoping/channel-scope.js';
import type { AssistantLogger } from '../fallback/logger.js';
import type { RetryQueue } from '../fallback/retry-queue.js';

interface Deps {
  transport: Transport;
  policy: Required<Policy>;
  ownerId?: string;
  channel?: string;
  userTags?: string[];
  logger: AssistantLogger;
  retryQueue: RetryQueue;
}

export async function afterAssistantTurn(deps: Deps, input: AfterAssistantTurnInput): Promise<void> {
  const items = rememberDispatch(deps.policy.autoRemember, { user: input.userMessage, assistant: input.assistantReply }, input.extracted);
  if (items.length === 0) return;

  const tags = scopeRememberTags({ channel: deps.channel, userTags: deps.userTags }, { conversationId: input.conversationId });

  const SIM_THRESHOLD = 0.85;

  for (const item of items) {
    let updateExisting: { id: string } | undefined;
    const isExtracted = item.type !== 'working';
    if (isExtracted) {
      try {
        const probe = await deps.transport.recall(item.content, { ownerId: deps.ownerId, tags }, 1);
        const top = probe.items[0];
        if (top && (top.score ?? 0) >= SIM_THRESHOLD) updateExisting = { id: top.id };
      } catch {
        // ignore probe failure — save as new
      }
    }
    deps.retryQueue.enqueue(async () => {
      await deps.transport.remember({
        content: item.content,
        type: item.type,
        tags: Array.from(new Set([...(item.tags ?? []), ...tags])),
        importance: item.importance,
        ownerId: deps.ownerId,
        updateExisting,
      });
    });
  }
}
