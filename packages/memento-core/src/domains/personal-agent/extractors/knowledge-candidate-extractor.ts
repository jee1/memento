import type {
  KnowledgeCandidateCategory,
  KnowledgeCandidatePayload,
  SuggestedPersonalMemoryType,
} from '../types/agent-types.js';
import { isAmbiguousUserMessage } from './knowledge-candidate-text-ambiguity.js';

const BASE = 'personal-agent' as const;

function baseTags(category: KnowledgeCandidateCategory): string[] {
  return [BASE, category];
}

const CATEGORY_MEMORY: Record<KnowledgeCandidateCategory, SuggestedPersonalMemoryType> = {
  preference: 'semantic',
  decision: 'episodic',
  learning: 'semantic',
  procedure: 'procedural',
};

function pushUnique(out: KnowledgeCandidatePayload[], c: KnowledgeCandidatePayload): void {
  const key = `${c.category}:${c.content.trim()}`;
  if (out.some((x) => `${x.category}:${x.content.trim()}` === key)) return;
  out.push(c);
}

interface SingleCaptureRule {
  pattern: RegExp;
  category: Exclude<KnowledgeCandidateCategory, 'procedure'>;
  reason: string;
  importance: number;
  confidence: number;
  /** trim 후 최소 길이 (0 이면 검사 안 함) */
  minLength: number;
  /** content 에 이 문자열이 있으면 버린다 */
  exclude?: string;
}

/** 순서가 결과 순서다 */
const SINGLE_CAPTURE_RULES: SingleCaptureRule[] = [
  {
    // preference: "앞으로는 …"
    pattern: /앞으로는\s+(.{4,})/,
    category: 'preference',
    reason: "사용자 메시지에 선호·습관 변경 신호 '앞으로는'이 포함되어 있습니다.",
    importance: 0.62,
    confidence: 0.9,
    minLength: 4,
  },
  {
    pattern: /I\s+prefer\s+to\s+(.{4,})/i,
    category: 'preference',
    reason: "사용자 메시지에 영문 선호 신호 'I prefer to'가 포함되어 있습니다.",
    importance: 0.61,
    confidence: 0.88,
    minLength: 4,
  },
  {
    pattern: /(.+?)을\s+선호(?:해|한다|합니다|해요)/,
    category: 'preference',
    reason: "사용자 메시지에 '선호' 명시 표현이 포함되어 있습니다.",
    importance: 0.6,
    confidence: 0.88,
    minLength: 4,
    exclude: '앞으로는',
  },
  {
    pattern: /(.{2,}?)하기로\s*했(?:다|어|습니다|어요)?(?!면)/,
    category: 'decision',
    reason: "사용자 메시지에 결정 확정 표현 '하기로 했'이 포함되어 있습니다.",
    importance: 0.65,
    confidence: 0.9,
    minLength: 2,
  },
  {
    pattern: /I\s+decided\s+to\s+(.{4,})/i,
    category: 'decision',
    reason: "사용자 메시지에 영문 결정 신호 'I decided to'가 포함되어 있습니다.",
    importance: 0.64,
    confidence: 0.88,
    minLength: 0,
  },
  {
    pattern: /결정했(?:다|어|습니다|어요)?\s*[:\s]\s*(.{4,})/,
    category: 'decision',
    reason: "사용자 메시지에 '결정했' 결정 신호가 포함되어 있습니다.",
    importance: 0.66,
    confidence: 0.9,
    minLength: 4,
  },
  {
    pattern: /TIL\s*[:：]\s*(.{4,})/i,
    category: 'learning',
    reason: "사용자 메시지에 학습 기록 신호 'TIL:'이 포함되어 있습니다.",
    importance: 0.6,
    confidence: 0.92,
    minLength: 0,
  },
  {
    pattern: /기억해둬[,，]?\s*(.{4,})/,
    category: 'learning',
    reason: "사용자 메시지에 '기억해둬' 저장 요청 신호가 포함되어 있습니다.",
    importance: 0.61,
    confidence: 0.9,
    minLength: 0,
  },
  {
    pattern: /알게\s+됐(?:다|어|습니다|어요)\s*[,:：]?\s*(.{4,})/,
    category: 'learning',
    reason: "사용자 메시지에 '알게 됐' 학습 신호가 포함되어 있습니다.",
    importance: 0.6,
    confidence: 0.88,
    minLength: 0,
  },
];

function applySingleCaptureRule(out: KnowledgeCandidatePayload[], text: string, rule: SingleCaptureRule): void {
  const captured = text.match(rule.pattern)?.[1];
  if (!captured) return;
  const content = captured.trim();
  if (content.length < rule.minLength) return;
  if (rule.exclude && content.includes(rule.exclude)) return;
  pushUnique(out, {
    category: rule.category,
    content,
    reason: rule.reason,
    suggestedMemoryType: CATEGORY_MEMORY[rule.category],
    tags: baseTags(rule.category),
    importance: rule.importance,
    confidence: rule.confidence,
    sourceContext: text.slice(0, 200),
  });
}

/**
 * `userMessage`만 분석한다 (#234). 명시적 신호가 없으면 빈 배열.
 */
export function extractKnowledgeCandidates(userMessage: string): KnowledgeCandidatePayload[] {
  const text = userMessage.trim();
  if (text.length < 4) return [];
  if (isAmbiguousUserMessage(userMessage)) return [];

  const out: KnowledgeCandidatePayload[] = [];

  for (const rule of SINGLE_CAPTURE_RULES) {
    applySingleCaptureRule(out, text, rule);
  }

  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const numbered = lines.filter((l) => /^\d+\.\s+.+/.test(l));
  if (numbered.length >= 2) {
    const content = numbered.slice(0, 6).join('\n');
    pushUnique(out, {
      category: 'procedure',
      content,
      reason: '사용자 메시지에 둘 이상의 번호 매겨진 절차 단계가 포함되어 있습니다.',
      suggestedMemoryType: CATEGORY_MEMORY.procedure,
      tags: baseTags('procedure'),
      importance: 0.58,
      confidence: 0.9,
      sourceContext: text.slice(0, 400),
    });
  }

  const proc = text.match(/먼저\s+(.{3,}?)\s+그다음\s+(.{3,})/);
  if (proc?.[1] != null && proc[2] != null) {
    const content = `1) ${proc[1]!.trim()}\n2) ${proc[2]!.trim()}`;
    pushUnique(out, {
      category: 'procedure',
      content,
      reason: "사용자 메시지에 '먼저 … 그다음 …' 이중 단계 신호가 포함되어 있습니다.",
      suggestedMemoryType: CATEGORY_MEMORY.procedure,
      tags: baseTags('procedure'),
      importance: 0.57,
      confidence: 0.89,
      sourceContext: text.slice(0, 200),
    });
  }

  return out;
}
