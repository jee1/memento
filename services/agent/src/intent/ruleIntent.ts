/**
 * 규칙 기반 Intent 감지 (v0.1)
 * 하는 일: 검색 트리거 패턴 매칭 → action_search | chat
 * 연관: actionableLoop, PRD FR-2
 */

const SEARCH_PATTERNS = [
  /^\/search\b/i,
  /\b검색해줘\b/,
  /\b찾아줘\b/,
  /\b요즘 뭐가 핫해\b/
];

export type Intent = 'chat' | 'action_search';

export function detectIntent(message: string): Intent {
  const trimmed = message.trim();
  for (const re of SEARCH_PATTERNS) {
    if (re.test(trimmed)) return 'action_search';
  }
  return 'chat';
}
