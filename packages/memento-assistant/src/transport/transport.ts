// packages/memento-assistant/src/transport/transport.ts

/** Types the assistant writes (auto-remember-policy); recall searches them when the caller gives no type filter (#1242). */
export const DEFAULT_RECALL_MEMORY_TYPES = ['working', 'episodic', 'semantic'] as const;

export interface RecallParams {
  query: string;
  filters?: { tags?: string[]; ownerId?: string; type?: string[] };
  limit?: number;
}

export interface RememberParams {
  content: string;
  type: 'working' | 'episodic' | 'semantic' | 'procedural';
  tags?: string[];
  importance?: number;
  ownerId?: string;
  updateExisting?: { id: string };
}

export interface RecallResult {
  items: ReadonlyArray<{ id: string; content: string; type: string; importance?: number; score?: number }>;
}

export interface RememberResult {
  id: string;
}

export interface Transport {
  recall(query: string, filters?: RecallParams['filters'], limit?: number): Promise<RecallResult>;
  remember(params: RememberParams): Promise<RememberResult>;
  close(): Promise<void>;
}
