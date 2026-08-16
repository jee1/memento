import axios from 'axios';
import { logger } from '../logger.js';
import type { MementoClientOptions, HealthCheck } from '../types.js';
import {
  MementoError,
  ConnectionError,
  AuthenticationError,
  ValidationError,
  NotFoundError,
} from '../types.js';
import type { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import type { MementoClientCore } from './client-context.js';

/**
 * HTTP 클라이언트 생성
 */
export function createHttpClient(
  options: Required<MementoClientOptions>,
  onError: (error: MementoError) => void,
): AxiosInstance {
  const client = axios.create({
    baseURL: options.serverUrl,
    timeout: options.timeout,
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': '@jee1/memento-client/0.1.0',
    },
  });

  client.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      if (options.apiKey && config.headers) {
        config.headers.Authorization = `Bearer ${options.apiKey}`;
      }

      if (options.logLevel === 'debug') {
        logger.debug('[MementoClient] Request:', {
          method: config.method?.toUpperCase(),
          url: config.url,
        });
      }

      return config;
    },
    (error: AxiosError) => {
      onError(new ConnectionError('Request failed', error as unknown as Record<string, unknown>));
      return Promise.reject(error);
    },
  );

  client.interceptors.response.use(
    (response: AxiosResponse) => {
      if (options.logLevel === 'debug') {
        logger.debug('[MementoClient] Response:', {
          status: response.status,
        });
      }
      return response;
    },
    (error: AxiosError) => {
      const mementoError = handleHttpError(error);
      onError(mementoError);
      return Promise.reject(mementoError);
    },
  );

  return client;
}

/**
 * HTTP 에러를 MementoError로 변환
 */
export function handleHttpError(error: AxiosError): MementoError {
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
 * 연결 상태 확인
 */
export function ensureConnected(client: MementoClientCore): void {
  if (!client.isConnected) {
    throw new ConnectionError('Client is not connected. Call connect() first.');
  }
}

/**
 * 서버에 연결
 */
export async function connectClient(client: MementoClientCore): Promise<void> {
  try {
    const health = await client.healthCheck();
    client.isConnected = true;
    client.emit('connected');

    if (client.options.logLevel !== 'silent') {
      logger.info('✅ Memento 서버에 연결되었습니다:', {
        version: health.version,
        status: health.status,
      });
    }
  } catch (error) {
    client.isConnected = false;
    client.emit('error', error);
    throw new ConnectionError('Failed to connect to Memento server', error as unknown as Record<string, unknown>);
  }
}

/**
 * 연결 해제
 */
export async function disconnectClient(client: MementoClientCore): Promise<void> {
  client.isConnected = false;
  client.emit('disconnected');

  if (client.options.logLevel !== 'silent') {
    logger.info('🔌 Memento 서버 연결이 해제되었습니다');
  }
}

/**
 * 서버 상태 확인
 */
export async function healthCheck(client: MementoClientCore): Promise<HealthCheck> {
  const response = await client.httpClient.get('/health');
  return response.data;
}
