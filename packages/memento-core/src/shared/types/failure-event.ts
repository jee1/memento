/**
 * 실패 이벤트 타입 (shared 레이어)
 * 하는 일: Shared→Domain 의존 제거. procedural-memory-extractor 등이 domain 없이 타입만 참조.
 * 연관: domains/monitoring/services/failure-detector.ts, domains/memory/procedural/procedural-memory-extractor.ts
 */

export interface FailureEvent {
  id: string;
  tool_name: string;
  error_type: 'tool_error' | 'user_feedback' | 'metric_failure';
  error_message: string;
  error_message_hash: string;
  timestamp: string;
  context: {
    params?: Record<string, unknown>;
    stack?: string;
    execution_time_ms?: number;
    [key: string]: unknown;
  };
  original_task?: string;
  priority: number;
}
