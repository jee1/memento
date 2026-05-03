const PRONOUN_RE = /\b(it|that|those|these|this|he|she|they|him|her|them)\b|그거|그것|저번|지난번/i;
const HEURISTIC_MIN_LEN = 50;

export function shouldAutoRecall(mode: 'always' | 'heuristic' | 'off' | undefined, msg: string): boolean {
  const m = mode ?? 'always';
  if (m === 'off') return false;
  if (m === 'always') return true;
  // heuristic
  if (msg.includes('?') || msg.includes('？')) return true;
  if (msg.length >= HEURISTIC_MIN_LEN) return true;
  if (PRONOUN_RE.test(msg)) return true;
  return false;
}
