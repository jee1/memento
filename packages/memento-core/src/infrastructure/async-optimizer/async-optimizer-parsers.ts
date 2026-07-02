import type { Task } from './async-optimizer.types.js';

/** Snapshot stored in failed TaskResult.data for retryTask */
export function failedTaskDataToTaskFields(data: unknown): {
  type: string;
  data: unknown;
  priority: number;
  createdAt: Date;
  maxRetries: number;
  timeout: number;
} {
  if (data === null || typeof data !== 'object') {
    return {
      type: 'unknown',
      data: {},
      priority: 0,
      createdAt: new Date(),
      maxRetries: 3,
      timeout: 30000,
    };
  }
  const o = data as Record<string, unknown>;
  const createdAtRaw = o.createdAt;
  let createdAt: Date;
  if (createdAtRaw instanceof Date) {
    createdAt = createdAtRaw;
  } else if (typeof createdAtRaw === 'string' || typeof createdAtRaw === 'number') {
    createdAt = new Date(createdAtRaw);
  } else {
    createdAt = new Date();
  }
  return {
    type: typeof o.type === 'string' ? o.type : 'unknown',
    data: o.data !== undefined && o.data !== null ? o.data : {},
    priority: typeof o.priority === 'number' ? o.priority : 0,
    createdAt,
    maxRetries: typeof o.maxRetries === 'number' ? o.maxRetries : 3,
    timeout: typeof o.timeout === 'number' ? o.timeout : 30000,
  };
}

interface MemoryOperationTaskData {
  operation: unknown;
  content: unknown;
  type: unknown;
  tags: unknown;
  importance: unknown;
}

export function parseMemoryOperationTaskData(data: unknown): MemoryOperationTaskData {
  if (data === null || typeof data !== 'object') {
    throw new Error('Invalid memory operation task data');
  }
  const o = data as Record<string, unknown>;
  return {
    operation: o.operation,
    content: o.content,
    type: o.type,
    tags: o.tags,
    importance: o.importance,
  };
}

interface FailureEventTaskData {
  event: unknown;
  handler: (event: unknown) => Promise<void>;
}

export function parseFailureEventTaskData(data: unknown): FailureEventTaskData {
  if (data === null || typeof data !== 'object') {
    throw new Error('Invalid failure event task data');
  }
  const o = data as Record<string, unknown>;
  const handler = o.handler;
  if (typeof handler !== 'function') {
    throw new Error('Failure event handler is not a function');
  }
  return {
    event: o.event,
    handler: handler as (event: unknown) => Promise<void>,
  };
}

export type { Task };
