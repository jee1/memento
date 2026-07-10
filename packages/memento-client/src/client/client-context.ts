import type { AxiosInstance } from 'axios';
import type { EventEmitter } from 'events';
import type { MementoClientOptions, HealthCheck } from '../types.js';

/**
 * MementoClient 내부 모듈이 공유하는 컨텍스트 인터페이스
 */
export type MementoClientCore = EventEmitter & {
  httpClient: AxiosInstance;
  isConnected: boolean;
  options: Required<MementoClientOptions>;
  healthCheck(): Promise<HealthCheck>;
  ensureConnected(): void;
};
