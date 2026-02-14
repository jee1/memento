/**
 * Memento Core HTTP 클라이언트
 * 하는 일: inject(recall), remember 호출. Core import 금지, HTTP만 사용.
 * 주의: MEMENTO_BASE_URL 필수. 연관: config, contracts, actionableLoop
 */

import { config } from '../config.js';
import type { MemoryPreview, RecallItem } from '../schemas/contracts.js';

const baseUrl = () => config.mementoBaseUrl.replace(/\/$/, '');

export interface InjectOptions {
  ownerId: string;
  tokenBudget?: number;
  maxMemories?: number;
}

export interface InjectResult {
  memories: MemoryPreview[];
  injectionText: string;
}

export interface RememberOptions {
  ownerId: string;
  sessionId?: string;
}

/**
 * 관련 기억 주입용 — Core /tools/recall 호출 후 injectionText·MemoryPreview[] 생성
 */
export async function inject(query: string, options: InjectOptions): Promise<InjectResult> {
  const { ownerId, maxMemories = 5 } = options;
  const url = `${baseUrl()}/tools/recall`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      owner_id: ownerId,
      limit: maxMemories,
      include_metadata: true
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Memento recall failed: ${res.status} ${text}`);
  }
  const data = await res.json() as Record<string, unknown>;
  const raw = (data.result ?? data) as { items?: RecallItem[]; total_count?: number };
  const items: RecallItem[] = Array.isArray(raw.items) ? raw.items : [];
  const memories: MemoryPreview[] = items.map((item) => ({
    id: item.id,
    preview: (item.content ?? '').slice(0, 200),
    score: item.finalScore ?? 0,
    why: { matchedTerms: [], type: item.type ?? 'episodic' }
  }));
  const injectionText = items.map((i) => i.content).filter(Boolean).join('\n\n');
  return { memories, injectionText };
}

/**
 * 기억 저장 — Core /tools/remember 호출
 */
export async function remember(
  content: string,
  options: RememberOptions & { type?: string; tags?: string[]; source?: string }
): Promise<{ memory_id: string }> {
  const { ownerId, sessionId, type = 'episodic', tags, source } = options;
  const url = `${baseUrl()}/tools/remember`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content,
      type,
      owner_id: ownerId,
      session_id: sessionId,
      tags: tags ?? ['memento-agent'],
      source: source ?? 'memento-agent'
    })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Memento remember failed: ${res.status} ${text}`);
  }
  const data = await res.json() as Record<string, unknown>;
  const raw = (data.result ?? data) as { memory_id?: string };
  const memory_id = raw.memory_id ?? '';
  return { memory_id };
}
