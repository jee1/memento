import type {
  AgentContextInjectionBundle,
  AgentContextInjectionRequest,
  AgentContextInjectionService,
  AgentLifecycleServiceOptions,
  ILLMPort,
  ServerServices,
} from '@memento/core';
import type {
  AgentLifecycleService,
  AgentMemoryPromotionService,
  SqliteAgentIntegrationRepository,
  TelemetryRepository,
} from '@memento/core';
import type Database from 'better-sqlite3';
import type { AgentTranscriptImporter } from './agent-transcript-import.js';

export interface AgentRouterOptions extends AgentLifecycleServiceOptions {
  contextInjectionService?: Pick<AgentContextInjectionService, 'build'>;
  initialInjectionTokenBudget?: number;
  serverServices?: ServerServices;
  personalAgentLlm?: ILLMPort;
}

export interface AgentRouterCtx {
  db: Database.Database | null;
  options: AgentRouterOptions;
  service: InstanceType<typeof AgentLifecycleService> | null;
  repository: InstanceType<typeof SqliteAgentIntegrationRepository> | null;
  telemetryRepository: InstanceType<typeof TelemetryRepository> | null;
  promotionService: InstanceType<typeof AgentMemoryPromotionService> | null;
  injectionService: Pick<AgentContextInjectionService, 'build'> | undefined;
  initialInjectionTokenBudget: number;
  summarizer: { summarize(sessionId: string): unknown } | null;
  transcriptImporter: InstanceType<typeof AgentTranscriptImporter> | null;
  recordInjection: (
    bundle: AgentContextInjectionBundle,
    ownerId: string | null,
    sessionId: string,
  ) => void;
  buildInjection: (
    request: AgentContextInjectionRequest,
  ) => Promise<AgentContextInjectionBundle | null>;
}
