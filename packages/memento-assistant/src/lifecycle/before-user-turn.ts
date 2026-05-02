// packages/memento-assistant/src/lifecycle/before-user-turn.ts
import type { BeforeUserTurnInput, BeforeUserTurnResult, Policy } from '../types.js';
import type { Transport } from '../transport/transport.js';
import { shouldAutoRecall } from '../policy/auto-recall-policy.js';
import { scopeRecallFilters } from '../scoping/channel-scope.js';
import type { AssistantLogger } from '../fallback/logger.js';

interface Deps {
  transport: Transport;
  policy: Required<Policy>;
  ownerId?: string;
  channel?: string;
  logger: AssistantLogger;
  breaker: { canPass(): boolean; recordSuccess(): void; recordFailure(): void };
}

export async function beforeUserTurn(deps: Deps, input: BeforeUserTurnInput): Promise<BeforeUserTurnResult> {
  const empty: BeforeUserTurnResult = { systemContext: '', references: [], degraded: false };
  const degraded: BeforeUserTurnResult = { systemContext: '', references: [], degraded: true };

  if (!shouldAutoRecall(deps.policy.autoRecall, input.userMessage)) return empty;
  if (!deps.breaker.canPass()) {
    deps.logger.warn('memento circuit open — skipping recall');
    return degraded;
  }

  try {
    const filters = scopeRecallFilters(
      { ownerId: deps.ownerId, channel: deps.channel, crossChannelRecall: deps.policy.crossChannelRecall },
      {},
      deps.logger,
    );
    const result = await withTimeout(
      deps.transport.recall(input.userMessage, filters, deps.policy.recallLimit),
      deps.policy.recallTimeoutMs,
    );
    deps.breaker.recordSuccess();
    const body = result.items.map(i => `- ${i.content}`).join('\n');
    const systemContext = result.items.length === 0 ? '' : `<memento>\n${body}\n</memento>`;
    return {
      systemContext,
      references: result.items.map(i => ({ id: i.id, type: i.type, importance: i.importance })),
      degraded: false,
    };
  } catch (err) {
    deps.breaker.recordFailure();
    deps.logger.warn(`memento recall failed: ${err instanceof Error ? err.message : String(err)}`);
    return degraded;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    p.then(v => { clearTimeout(id); resolve(v); }, e => { clearTimeout(id); reject(e); });
  });
}
