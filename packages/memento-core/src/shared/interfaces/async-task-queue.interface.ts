/**
 * 비동기 태스크 큐 인터페이스 (DIP)
 * 도메인(monitoring)은 이 인터페이스만 참조하고, 인프라 구현체를 주입받음.
 */

export interface IQueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  totalProcessed: number;
  averageProcessingTime: number;
  throughput: number;
}

/** addTask에 넣는 최소 필드 (id, createdAt, retryCount는 구현체가 채움) */
export interface IAsyncTaskQueueAddOptions {
  id?: string;
  type: string;
  data: unknown;
  priority: number;
  maxRetries?: number;
  timeout?: number;
}

export interface IAsyncTaskQueue {
  addTask<T>(task: IAsyncTaskQueueAddOptions & { data?: T }): string | false;
  getStats(): IQueueStats;
  start(): Promise<boolean>;
  stop(): Promise<boolean>;
}
