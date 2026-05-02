import type { ExtractedItem } from '../types.js';

export interface RememberDispatchItem {
  type: 'working' | 'episodic' | 'semantic';
  content: string;
  tags?: string[];
  importance?: number;
  at?: string;
}

export function rememberDispatch(
  mode: 'turn' | 'decision' | 'off' | undefined,
  turn: { user: string; assistant: string },
  extracted?: ReadonlyArray<ExtractedItem>,
): RememberDispatchItem[] {
  const m = mode ?? 'turn';
  if (m === 'off') return [];

  const turnEntry: RememberDispatchItem = {
    type: 'working',
    content: `User: ${turn.user}\nAssistant: ${turn.assistant}`,
  };

  if (m === 'turn') return [turnEntry];

  // m === 'decision': falls back to turn-only if no extracted items
  const out: RememberDispatchItem[] = [turnEntry];
  for (const item of extracted ?? []) {
    if (item.kind === 'fact') {
      out.push({ type: 'semantic', content: item.content, tags: item.tags });
    } else if (item.kind === 'preference') {
      out.push({ type: 'semantic', content: item.content, tags: item.tags, importance: 0.7 });
    } else if (item.kind === 'event') {
      out.push({ type: 'episodic', content: item.content, tags: item.tags, at: item.at });
    }
  }
  return out;
}
