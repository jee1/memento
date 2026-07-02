export interface Task<T = unknown> {
  id: string;
  type: string;
  data: T;
  priority: number;
  createdAt: Date;
  maxRetries: number;
  retryCount: number;
  timeout: number;
}

export interface TaskResult<T = unknown> {
  taskId: string;
  success: boolean;
  data?: T;
  error?: string;
  executionTime: number;
  retryCount: number;
}

export interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  totalProcessed: number;
  averageProcessingTime: number;
  throughput: number;
}
