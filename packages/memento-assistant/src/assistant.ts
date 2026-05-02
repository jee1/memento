// packages/memento-assistant/src/assistant.ts
import type { MementoAssistantOptions, Policy, BeforeUserTurnInput, BeforeUserTurnResult, AfterAssistantTurnInput } from './types.js';
import type { Transport, RecallResult, RememberResult, RememberParams } from './transport/transport.js';
import { createTransportFromEnv } from './transport/factory.js';
import { createRateLimitedLogger, levelFromEnv, consoleSink, type AssistantLogger } from './fallback/logger.js';
import { CircuitBreaker } from './fallback/circuit-breaker.js';
import { beforeUserTurn as _beforeUserTurn } from './lifecycle/before-user-turn.js';

const DEFAULT_POLICY: Required<Policy> = {
  autoRecall: 'always',
  autoRemember: 'turn',
  crossChannelRecall: 'on',
  tokenBudget: 1200,
  recallLimit: 8,
  recallTimeoutMs: 1500,
  degradeOnError: true,
};

export class MementoAssistant {
  readonly ownerId?: string;
  readonly channel?: string;
  readonly userTags: string[];
  readonly policy: Required<Policy>;
  readonly transport: Transport;
  readonly logger: AssistantLogger;
  private readonly breaker = new CircuitBreaker({ failureThreshold: 5, openMs: 30_000 });

  private constructor(args: {
    ownerId?: string; channel?: string; userTags?: string[];
    policy: Required<Policy>; transport: Transport; logger: AssistantLogger;
  }) {
    this.ownerId = args.ownerId;
    this.channel = args.channel;
    this.userTags = args.userTags ?? [];
    this.policy = args.policy;
    this.transport = args.transport;
    this.logger = args.logger;
  }

  static fromEnv(opts: MementoAssistantOptions, env: NodeJS.ProcessEnv): MementoAssistant {
    const transport = createTransportFromEnv({ transport: opts.transport }, env);
    const logger = createRateLimitedLogger({ level: levelFromEnv(env), sink: consoleSink });
    const policy: Required<Policy> = { ...DEFAULT_POLICY, ...(opts.policy ?? {}) };
    return new MementoAssistant({
      ownerId: opts.ownerId ?? env.MEMENTO_OWNER_ID,
      channel: opts.channel ?? env.MEMENTO_CHANNEL,
      userTags: opts.userTags,
      policy,
      transport,
      logger,
    });
  }

  // Lifecycle methods
  async beforeUserTurn(input: BeforeUserTurnInput): Promise<BeforeUserTurnResult> {
    return _beforeUserTurn(
      { transport: this.transport, policy: this.policy, ownerId: this.ownerId, channel: this.channel, logger: this.logger, breaker: this.breaker },
      input,
    );
  }
  async afterAssistantTurn(_input: AfterAssistantTurnInput): Promise<void> {
    throw new Error('not implemented');
  }

  // Passthrough methods
  async recall(query: string, filters?: any, limit?: number): Promise<RecallResult> {
    return this.transport.recall(query, filters, limit);
  }
  async remember(params: RememberParams): Promise<RememberResult> {
    return this.transport.remember(params);
  }
  async close(): Promise<void> {
    return this.transport.close();
  }
}
