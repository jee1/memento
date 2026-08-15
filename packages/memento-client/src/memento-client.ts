/**
 * MementoClient - Memento MCP Server와 통신하는 메인 클라이언트
 *
 * @example
 * ```typescript
 * import { MementoClient } from '@jee1/memento-client';
 *
 * const client = new MementoClient({
 *   serverUrl: 'http://localhost:8080',
 *   apiKey: 'your-api-key'
 * });
 *
 * await client.connect();
 *
 * const memory = await client.remember({
 *   content: 'React Hook에 대해 학습했다',
 *   type: 'episodic',
 *   importance: 0.8
 * });
 * ```
 */

import { EventEmitter } from 'events';
import type { AxiosInstance } from 'axios';
import type {
  MementoClientOptions,
  MemoryItem,
  CreateMemoryParams,
  UpdateMemoryParams,
  SearchFilters,
  RecallCallOptions,
  SearchResult,
  HybridSearchParams,
  HybridSearchResult,
  RememberResult,
  PinResult,
  ForgetResult,
  LinkResult,
  ExportResult,
  FeedbackResult,
  FeedbackCallOptions,
  RecordRecallFeedbackOptions,
  ContextInjectionParams,
  ContextInjectionResult,
  HealthCheck,
  AgentEventEnvelopeLike,
  AgentObservationQuery,
  AgentOperationsStatusQuery,
  AgentProvenanceQuery,
  AgentProvenanceLinkInput,
} from './types.js';
import type { MementoError } from './types.js';
import type { MementoClientCore } from './client/client-context.js';
import {
  createHttpClient,
  connectClient,
  disconnectClient,
  healthCheck as performHealthCheck,
  ensureConnected as ensureClientConnected,
} from './client/http-transport.js';
import * as memoryClient from './client/memory-client.js';
import * as searchClient from './client/search-client.js';
import * as toolsClient from './client/tools-client.js';
import * as agentClient from './client/agent-client.js';

export class MementoClient extends EventEmitter implements MementoClientCore {
  httpClient: AxiosInstance;
  isConnected: boolean = false;
  options: Required<MementoClientOptions>;

  constructor(options: MementoClientOptions = {}) {
    super();

    this.options = {
      serverUrl: 'http://localhost:8080',
      apiKey: '',
      timeout: 10000,
      retryCount: 3,
      logLevel: 'info',
      ...options,
    };

    this.httpClient = createHttpClient(this.options, (error: MementoError) => {
      this.emit('error', error);
    });
  }

  async connect(): Promise<void> {
    return connectClient(this);
  }

  async disconnect(): Promise<void> {
    return disconnectClient(this);
  }

  get connected(): boolean {
    return this.isConnected;
  }

  async healthCheck(): Promise<HealthCheck> {
    return performHealthCheck(this);
  }

  async remember(params: CreateMemoryParams): Promise<RememberResult> {
    return memoryClient.remember(this, params);
  }

  async recall(
    query: string,
    filters?: SearchFilters,
    limit?: number,
    recallOptions?: RecallCallOptions,
  ): Promise<SearchResult> {
    return searchClient.recall(this, query, filters, limit, recallOptions);
  }

  async hybridSearch(params: HybridSearchParams): Promise<HybridSearchResult> {
    return searchClient.hybridSearch(this, params);
  }

  async getMemory(id: string): Promise<MemoryItem> {
    return memoryClient.getMemory(this, id);
  }

  async updateMemory(id: string, params: UpdateMemoryParams): Promise<MemoryItem> {
    return memoryClient.updateMemory(this, id, params);
  }

  async forget(memoryId: string, hard: boolean = false): Promise<ForgetResult> {
    return memoryClient.forget(this, memoryId, hard);
  }

  async pin(memoryId: string): Promise<PinResult> {
    return memoryClient.pin(this, memoryId);
  }

  async unpin(memoryId: string): Promise<PinResult> {
    return memoryClient.unpin(this, memoryId);
  }

  async link(
    sourceId: string,
    targetId: string,
    relationType: 'cause_of' | 'derived_from' | 'duplicates' | 'contradicts',
  ): Promise<LinkResult> {
    return toolsClient.link(this, sourceId, targetId, relationType);
  }

  async export(
    format: 'json' | 'csv' | 'markdown',
    filters?: SearchFilters,
  ): Promise<ExportResult> {
    return toolsClient.exportMemories(this, format, filters);
  }

  async feedback(
    memoryId: string,
    helpful: boolean,
    comment?: string,
    score?: number,
    score_breakdown?: unknown,
    options?: FeedbackCallOptions,
  ): Promise<FeedbackResult> {
    return toolsClient.feedback(this, memoryId, helpful, comment, score, score_breakdown, options);
  }

  async recordRecallFeedback(
    recallResult: SearchResult,
    memoryId: string,
    helpful: boolean,
    options?: RecordRecallFeedbackOptions,
  ): Promise<FeedbackResult> {
    return toolsClient.recordRecallFeedback(this, recallResult, memoryId, helpful, options);
  }

  async injectContext(params: ContextInjectionParams): Promise<ContextInjectionResult> {
    return toolsClient.injectContext(this, params);
  }

  async getAgentCapabilities<T = Record<string, unknown>>(): Promise<T> {
    return agentClient.getAgentCapabilities<T>(this);
  }

  async getAgentOperationsStatus<T = Record<string, unknown>>(
    query: AgentOperationsStatusQuery = {},
  ): Promise<T> {
    return agentClient.getAgentOperationsStatus<T>(this, query);
  }

  async startAgentSession<T = Record<string, unknown>>(
    event: AgentEventEnvelopeLike,
  ): Promise<T> {
    return agentClient.startAgentSession<T>(this, event);
  }

  async ingestAgentObservations<T = Record<string, unknown>>(
    events: AgentEventEnvelopeLike[],
  ): Promise<T> {
    return agentClient.ingestAgentObservations<T>(this, events);
  }

  async preCompactAgentSession<T = Record<string, unknown>>(
    sessionId: string,
    event: AgentEventEnvelopeLike,
  ): Promise<T> {
    return agentClient.preCompactAgentSession<T>(this, sessionId, event);
  }

  async stopAgentSession<T = Record<string, unknown>>(
    sessionId: string,
    event: AgentEventEnvelopeLike,
  ): Promise<T> {
    return agentClient.stopAgentSession<T>(this, sessionId, event);
  }

  async getAgentSession<T = Record<string, unknown>>(sessionId: string): Promise<T> {
    return agentClient.getAgentSession<T>(this, sessionId);
  }

  async listAgentObservations<T = Record<string, unknown>>(
    sessionId: string,
    query: AgentObservationQuery = {},
  ): Promise<T> {
    return agentClient.listAgentObservations<T>(this, sessionId, query);
  }

  async getAgentProvenance<T = Record<string, unknown>>(
    query: AgentProvenanceQuery,
  ): Promise<T> {
    return agentClient.getAgentProvenance<T>(this, query);
  }

  async linkAgentProvenance<T = Record<string, unknown>>(
    input: AgentProvenanceLinkInput,
  ): Promise<T> {
    return agentClient.linkAgentProvenance<T>(this, input);
  }

  async exportAgentSession<T = Record<string, unknown>>(sessionId: string): Promise<T> {
    return agentClient.exportAgentSession<T>(this, sessionId);
  }

  async deleteAgentSession(sessionId: string): Promise<void> {
    return agentClient.deleteAgentSession(this, sessionId);
  }

  ensureConnected(): void {
    ensureClientConnected(this);
  }

  updateOptions(newOptions: Partial<MementoClientOptions>): void {
    this.options = { ...this.options, ...newOptions };
    this.httpClient = createHttpClient(this.options, (error: MementoError) => {
      this.emit('error', error);
    });
  }

  getOptions(): Readonly<MementoClientOptions> {
    return { ...this.options };
  }
}
