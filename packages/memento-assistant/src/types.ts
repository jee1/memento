// packages/memento-assistant/src/types.ts
// 공개 타입을 한 파일에 모은다 — 다른 SDK 파일은 여기서만 타입을 import한다.

export type ExtractedItem =
  | { kind: 'fact';       content: string; tags?: string[] }
  | { kind: 'preference'; content: string; tags?: string[] }
  | { kind: 'event';      content: string; at?: string; tags?: string[] };
// 'commitment' 의도적으로 제외 (spec § 6, v0.1) — kind:'event' + tags:['commitment']로 표현.

export interface Policy {
  autoRecall?: 'always' | 'heuristic' | 'off';
  autoRemember?: 'turn' | 'decision' | 'off';
  crossChannelRecall?: 'on' | 'off' | 'sameContext';
  tokenBudget?: number;
  recallLimit?: number;
  recallTimeoutMs?: number;
  degradeOnError?: boolean;
}

export interface MementoAssistantOptions {
  ownerId?: string;
  channel?: string;
  userTags?: string[];
  policy?: Policy;
  transport?: import('./transport/transport.js').Transport;  // 테스트에서 주입
}

export interface BeforeUserTurnInput {
  userMessage: string;
  conversationId: string;
}

export interface BeforeUserTurnResult {
  systemContext: string;
  references: ReadonlyArray<{ id: string; type: string; importance?: number }>;
  degraded: boolean;
}

export interface AfterAssistantTurnInput {
  userMessage: string;
  assistantReply: string;
  conversationId: string;
  extracted?: ReadonlyArray<ExtractedItem>;
}
