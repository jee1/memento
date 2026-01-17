/**
 * MementoClient - Memento MCP Server와 통신하는 메인 클라이언트
 * 
 * @example
 * ```typescript
 * import { MementoClient } from '@memento/client';
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

import axios from 'axios';
import { EventEmitter } from 'events';
import { logger } from '../shared/utils/logger.js';
import type {
  MementoClientOptions,
  MemoryItem,
  CreateMemoryParams,
  UpdateMemoryParams,
  SearchFilters,
  SearchResult,
  HybridSearchParams,
  HybridSearchResult,
  RememberResult,
  PinResult,
  ForgetResult,
  LinkResult,
  ExportResult,
  FeedbackResult,
  ContextInjectionParams,
  ContextInjectionResult,
  HealthCheck
} from './types.js';
import {
  MementoError,
  ConnectionError,
  AuthenticationError,
  ValidationError,
  NotFoundError
} from './types.js';

import type { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';

export class MementoClient extends EventEmitter {
  private httpClient: AxiosInstance;
  private isConnected: boolean = false;
  private options: Required<MementoClientOptions>;

  constructor(options: MementoClientOptions = {}) {
    super();
    
    this.options = {
      serverUrl: 'http://localhost:8080',
      apiKey: '',
      timeout: 10000,
      retryCount: 3,
      logLevel: 'info',
      ...options
    };

    this.httpClient = this.createHttpClient();
  }

  /**
   * HTTP 클라이언트 생성
   */
  private createHttpClient(): AxiosInstance {
    const client = axios.create({
      baseURL: this.options.serverUrl,
      timeout: this.options.timeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': '@memento/client/0.1.0'
      }
    });

    // 요청 인터셉터
    client.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        if (this.options.apiKey && config.headers) {
          config.headers.Authorization = `Bearer ${this.options.apiKey}`;
        }
        
        if (this.options.logLevel === 'debug') {
          logger.debug('[MementoClient] Request:', {
            method: config.method?.toUpperCase(),
            url: config.url,
            data: config.data
          });
        }
        
        return config;
      },
      (error: AxiosError) => {
        this.emit('error', new ConnectionError('Request failed', error as unknown as Record<string, unknown>));
        return Promise.reject(error);
      }
    );

    // 응답 인터셉터
    client.interceptors.response.use(
      (response: AxiosResponse) => {
        if (this.options.logLevel === 'debug') {
          logger.debug('[MementoClient] Response:', {
            status: response.status,
            data: response.data
          });
        }
        return response;
      },
      (error: AxiosError) => {
        const mementoError = this.handleHttpError(error);
        this.emit('error', mementoError);
        return Promise.reject(mementoError);
      }
    );

    return client;
  }

  /**
   * HTTP 에러를 MementoError로 변환
   */
  private handleHttpError(error: AxiosError): MementoError {
    if (error.response) {
      const { status, data } = error.response;
      const errorData = data as Record<string, unknown> | undefined;
      const message = (errorData?.error && typeof errorData.error === 'object' && 'message' in errorData.error && typeof errorData.error.message === 'string')
        ? errorData.error.message
        : (errorData?.message && typeof errorData.message === 'string')
        ? errorData.message
        : error.message;
      
      switch (status) {
        case 400:
          return new ValidationError(message, errorData);
        case 401:
          return new AuthenticationError(message, errorData);
        case 404:
          return new NotFoundError(message, errorData);
        case 500:
          return new MementoError(message, 'INTERNAL_ERROR', status, errorData);
        default:
          return new MementoError(message, 'HTTP_ERROR', status, errorData);
      }
    } else if (error.request) {
      return new ConnectionError('Network error - no response received', error as unknown as Record<string, unknown>);
    } else {
      return new ConnectionError('Request setup error', error as unknown as Record<string, unknown>);
    }
  }

  /**
   * 서버에 연결
   */
  async connect(): Promise<void> {
    try {
      const health = await this.healthCheck();
      this.isConnected = true;
      this.emit('connected');
      
      if (this.options.logLevel !== 'silent') {
        logger.info('✅ Memento 서버에 연결되었습니다:', {
          version: health.version,
          status: health.status
        });
      }
    } catch (error) {
      this.isConnected = false;
      this.emit('error', error);
      throw new ConnectionError('Failed to connect to Memento server', error as unknown as Record<string, unknown>);
    }
  }

  /**
   * 연결 해제
   */
  async disconnect(): Promise<void> {
    this.isConnected = false;
    this.emit('disconnected');
    
    if (this.options.logLevel !== 'silent') {
      logger.info('🔌 Memento 서버 연결이 해제되었습니다');
    }
  }

  /**
   * 연결 상태 확인
   */
  get connected(): boolean {
    return this.isConnected;
  }

  /**
   * 서버 상태 확인
   */
  async healthCheck(): Promise<HealthCheck> {
    const response = await this.httpClient.get('/health');
    return response.data;
  }

  // ============================================================================
  // 기억 관리 메서드들
  // ============================================================================

  /**
   * 기억 저장
   */
  async remember(params: CreateMemoryParams): Promise<RememberResult> {
    this.ensureConnected();
    
    const response = await this.httpClient.post('/tools/remember', params);
    const result = response.data.result;
    
    this.emit('memory:created', result);
    return result;
  }

  /**
   * 기억 검색
   */
  async recall(
    query: string, 
    filters?: SearchFilters, 
    limit?: number
  ): Promise<SearchResult> {
    this.ensureConnected();
    
    const response = await this.httpClient.post('/tools/recall', {
      query,
      filters,
      limit
    });
    
    // 서버 응답에서 result 객체 추출
    const result = response.data.result;
    
    // 중첩된 구조 처리: { items: { items: [...] } }
    if (result.items && result.items.items && Array.isArray(result.items.items)) {
      // 중첩된 구조를 평면화
      return {
        ...result,
        items: result.items.items,
        total_count: result.items.total_count || result.items.items.length,
        query_time: result.items.query_time || 0
      };
    }
    
    return result;
  }

  /**
   * 하이브리드 검색
   */
  async hybridSearch(params: HybridSearchParams): Promise<HybridSearchResult> {
    this.ensureConnected();
    
    // recall API를 사용하여 하이브리드 검색 수행
    const searchResult = await this.recall(params.query, params.filters, params.limit);
    
    // SearchResult를 HybridSearchResult로 변환
    return {
      items: searchResult.items.map(item => ({
        ...item,
        textScore: item.score || 0,
        vectorScore: 0, // 벡터 점수는 현재 사용하지 않음
        finalScore: item.score || 0
      })),
      total_count: searchResult.total_count,
      query_time: searchResult.query_time,
      search_type: 'hybrid'
    };
  }

  /**
   * 기억 조회
   */
  async getMemory(id: string): Promise<MemoryItem> {
    this.ensureConnected();
    
    // MCP 서버는 개별 기억 조회를 지원하지 않으므로 검색으로 대체
    // ID로 직접 검색하기 위해 의미있는 쿼리 사용
    const searchResult = await this.recall('memory', { id: [id] }, 1);
    
    // 서버 응답 구조 처리: { items: { items: [...] } }
    let items: MemoryItem[];
    if (searchResult.items && Array.isArray(searchResult.items)) {
      // 정상적인 구조: { items: [...] }
      items = searchResult.items;
    } else if (searchResult.items && typeof searchResult.items === 'object' && 'items' in searchResult.items) {
      // 중첩된 구조: { items: { items: [...] } }
      const nestedItems = searchResult.items as { items: MemoryItem[] };
      items = Array.isArray(nestedItems.items) ? nestedItems.items : [];
    } else {
      throw new Error(`Memory with ID ${id} not found`);
    }
    
    if (items.length === 0) {
      throw new Error(`Memory with ID ${id} not found`);
    }
    const memory = items[0];
    if (!memory || memory.id !== id) {
      throw new Error(`Memory with ID ${id} not found`);
    }
    return memory;
  }

  /**
   * 기억 업데이트
   */
  async updateMemory(id: string, params: UpdateMemoryParams): Promise<MemoryItem> {
    this.ensureConnected();
    
    // 기존 기억 정보 가져오기
    const existingMemory = await this.getMemory(id);
    const memoryType = params.type || existingMemory.type;
    
    // MCP 서버는 기억 업데이트를 지원하지 않으므로 삭제 후 재생성
    await this.forget(id);
    
    // UpdateMemoryParams를 CreateMemoryParams로 변환 (기존 값과 병합)
    // 타입에 따라 다른 필드를 병합해야 함
    // 일관성: 모든 필드는 !== undefined 체크를 사용하여 명시적으로 제공된 값(빈 문자열, false 등 포함)을 업데이트
    const createParams: CreateMemoryParams = {
      type: memoryType,
      // 공통 필드 - 일관된 병합 로직 사용
      tags: params.tags !== undefined ? params.tags : existingMemory.tags,
      importance: params.importance !== undefined ? params.importance : existingMemory.importance,
      source: params.source !== undefined ? params.source : existingMemory.source,
      privacy_scope: params.privacy_scope !== undefined ? params.privacy_scope : existingMemory.privacy_scope,
      project_id: params.project_id !== undefined ? params.project_id : existingMemory.project_id,
      metadata: params.metadata !== undefined ? params.metadata : existingMemory.metadata
    };
    
    // 타입별 필드 병합
    // MemoryItem에 없는 필드에 접근하기 위해 타입 단언 사용
    const existingMemoryExtended = existingMemory as MemoryItem & {
      key?: string;
      value?: string;
      always_load?: boolean;
      immutable?: boolean;
      task_goal?: string;
      steps?: string;
      reflection_notes?: string;
    };
    
    if (memoryType === 'core') {
      // Core Memory: key, value, always_load 사용
      createParams.key = params.key !== undefined ? params.key : existingMemoryExtended.key;
      createParams.value = params.value !== undefined ? params.value : existingMemoryExtended.value;
      createParams.always_load = params.always_load !== undefined ? params.always_load : existingMemoryExtended.always_load;
      // content는 사용하지 않음
    } else if (memoryType === 'vault') {
      // Knowledge Vault: key, value, immutable 사용
      createParams.key = params.key !== undefined ? params.key : existingMemoryExtended.key;
      createParams.value = params.value !== undefined ? params.value : existingMemoryExtended.value;
      createParams.immutable = params.immutable !== undefined ? params.immutable : existingMemoryExtended.immutable;
      // content는 사용하지 않음
    } else {
      // 기타 타입 (working, episodic, semantic, procedural): content 사용
      createParams.content = params.content !== undefined ? params.content : existingMemory.content;
      // Procedural Memory 특화 필드
      if (memoryType === 'procedural') {
        createParams.task_goal = params.task_goal !== undefined ? params.task_goal : existingMemoryExtended.task_goal;
        createParams.steps = params.steps !== undefined ? params.steps : existingMemoryExtended.steps;
        createParams.reflection_notes = params.reflection_notes !== undefined ? params.reflection_notes : existingMemoryExtended.reflection_notes;
      }
    }
    
    const rememberResult = await this.remember(createParams);
    
    // RememberResult를 MemoryItem으로 변환
    const memoryItem: MemoryItem = {
      id: rememberResult.memory_id,
      content: createParams.content || '', // content가 없을 수 있으므로 기본값 설정
      type: createParams.type || 'episodic',
      importance: createParams.importance || 0.5,
      created_at: rememberResult.created_at,
      pinned: false,
      privacy_scope: createParams.privacy_scope || 'private',
      tags: createParams.tags,
      source: createParams.source,
      project_id: createParams.project_id,
      metadata: createParams.metadata
    };
    
    this.emit('memory:updated', memoryItem);
    return memoryItem;
  }

  /**
   * 기억 삭제
   */
  async forget(memoryId: string, hard: boolean = false): Promise<ForgetResult> {
    this.ensureConnected();
    
    const response = await this.httpClient.post('/tools/forget', {
      id: memoryId,
      hard
    });
    
    const result = response.data.result;
    this.emit('memory:deleted', memoryId);
    return result;
  }

  /**
   * 기억 고정
   */
  async pin(memoryId: string): Promise<PinResult> {
    this.ensureConnected();
    
    const response = await this.httpClient.post('/tools/pin', {
      id: memoryId
    });
    
    const result = response.data.result;
    this.emit('memory:pinned', memoryId);
    return result;
  }

  /**
   * 기억 고정 해제
   */
  async unpin(memoryId: string): Promise<PinResult> {
    this.ensureConnected();
    
    const response = await this.httpClient.post('/tools/unpin', {
      id: memoryId
    });
    
    const result = response.data.result;
    this.emit('memory:unpinned', memoryId);
    return result;
  }

  // ============================================================================
  // 고급 기능들
  // ============================================================================

  /**
   * 기억 간 관계 생성
   */
  async link(
    sourceId: string, 
    targetId: string, 
    relationType: 'cause_of' | 'derived_from' | 'duplicates' | 'contradicts'
  ): Promise<LinkResult> {
    this.ensureConnected();
    
    const response = await this.httpClient.post('/tools/link', {
      source_id: sourceId,
      target_id: targetId,
      relation_type: relationType
    });
    
    return response.data;
  }

  /**
   * 기억 내보내기
   */
  async export(
    format: 'json' | 'csv' | 'markdown',
    filters?: SearchFilters
  ): Promise<ExportResult> {
    this.ensureConnected();
    
    const response = await this.httpClient.post('/tools/export', {
      format,
      filters
    });
    
    return response.data;
  }

  /**
   * 피드백 제공
   */
  async feedback(
    memoryId: string,
    helpful: boolean,
    comment?: string,
    score?: number
  ): Promise<FeedbackResult> {
    this.ensureConnected();
    
    const response = await this.httpClient.post('/tools/feedback', {
      memory_id: memoryId,
      helpful,
      comment,
      score
    });
    
    return response.data;
  }

  /**
   * 컨텍스트 주입
   */
  async injectContext(params: ContextInjectionParams): Promise<ContextInjectionResult> {
    this.ensureConnected();
    
    const response = await this.httpClient.post('/prompts/memory_injection', params);
    return response.data;
  }

  // ============================================================================
  // 유틸리티 메서드들
  // ============================================================================

  /**
   * 연결 상태 확인
   */
  private ensureConnected(): void {
    if (!this.isConnected) {
      throw new ConnectionError('Client is not connected. Call connect() first.');
    }
  }



  /**
   * 클라이언트 설정 업데이트
   */
  updateOptions(newOptions: Partial<MementoClientOptions>): void {
    this.options = { ...this.options, ...newOptions };
    this.httpClient = this.createHttpClient();
  }

  /**
   * 현재 설정 조회
   */
  getOptions(): Readonly<MementoClientOptions> {
    return { ...this.options };
  }
}
