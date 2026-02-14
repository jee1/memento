/**
 * Agent ↔ Client / Memento 계약 타입
 * 하는 일: AgentResponse, MemoryPreview, ChatRequest 등 공유 타입
 * 연관: server.ts, actionableLoop, mementoClient
 */

export interface ChatRequest {
  message: string;
  ownerId: string;
  sessionId?: string;
}

export interface MemoryPreview {
  id: string;
  preview: string;
  score: number;
  why: {
    matchedTerms: string[];
    type: string;
  };
}

export interface ToolExecution {
  name: string;
  summary: string;
}

export interface AgentResponse {
  answer: string;
  meta: {
    intent: 'chat' | 'action_search';
    usedMemories: MemoryPreview[];
    executedTools?: ToolExecution[];
  };
}

/** Memento recall 응답 항목 (Core /tools/recall 반환 형식에 맞춤) */
export interface RecallItem {
  id: string;
  content?: string;
  type?: string;
  finalScore?: number;
  owner_id?: string;
}

export interface MementoRecallResponse {
  items?: RecallItem[];
  total_count?: number;
}

export interface MementoRememberResponse {
  memory_id?: string;
  created_at?: string;
  type?: string;
}
