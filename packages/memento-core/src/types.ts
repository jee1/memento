export type CoreMemoryType =
  | 'working'
  | 'episodic'
  | 'semantic'
  | 'procedural'
  | 'core'
  | 'vault';

export interface CoreRememberParams {
  content?: string;
  type?: CoreMemoryType;
  tags?: string[];
  importance?: number;
  process_id?: string;
  session_id?: string;
  source_session_id?: string;
  origin_source?: string;
}

export interface CoreRecallParams {
  query: string;
  filters?: {
    tags?: string[];
  };
  limit?: number;
  process_id?: string;
  session_id?: string;
}

export interface CoreRecallItem {
  id: string;
  content: string;
  tags?: string[];
}

export interface CoreRememberResult {
  memory_id: string;
}

export interface CoreRecallResult {
  items: CoreRecallItem[];
}
