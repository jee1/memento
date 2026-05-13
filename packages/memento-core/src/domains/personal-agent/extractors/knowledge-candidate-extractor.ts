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

/**
 * `userMessage`만 분석한다 (#234). 명시적 신호가 없으면 빈 배열.
 */
export function extractKnowledgeCandidates(userMessage: string): KnowledgeCandidatePayload[] {
  const text = userMessage.trim();
  if (text.length < 4) return [];
  if (isAmbiguousUserMessage(userMessage)) return [];

  const out: KnowledgeCandidatePayload[] = [];

  // preference: "앞으로는 …"
  const pref = text.match(/앞으로는\s+(.{4,})/);
  if (pref?.[1]) {
    const content = pref[1].trim();
    if (content.length >= 4) {
      pushUnique(out, {
        category: 'preference',
        content,
        reason: "사용자 메시지에 선호·습관 변경 신호 '앞으로는'이 포함되어 있습니다.",
        suggestedMemoryType: CATEGORY_MEMORY.preference,
        tags: baseTags('preference'),
        importance: 0.62,
        confidence: 0.9,
        sourceContext: text.slice(0, 200),
      });
    }
  }

  const prefEn = text.match(/I\s+prefer\s+to\s+(.{4,})/i);
  if (prefEn?.[1]) {
    const content = prefEn[1].trim();
    if (content.length >= 4) {
      pushUnique(out, {
        category: 'preference',
        content,
        reason: "사용자 메시지에 영문 선호 신호 'I prefer to'가 포함되어 있습니다.",
        suggestedMemoryType: CATEGORY_MEMORY.preference,
        tags: baseTags('preference'),
        importance: 0.61,
        confidence: 0.88,
        sourceContext: text.slice(0, 200),
      });
    }
  }

  const pref2 = text.match(/(.+?)을\s+선호(?:해|한다|합니다|해요)/);
  if (pref2?.[1]) {
    const content = pref2[1].trim();
    if (content.length >= 4 && !content.includes('앞으로는')) {
      pushUnique(out, {
        category: 'preference',
        content,
        reason: "사용자 메시지에 '선호' 명시 표현이 포함되어 있습니다.",
        suggestedMemoryType: CATEGORY_MEMORY.preference,
        tags: baseTags('preference'),
        importance: 0.6,
        confidence: 0.88,
        sourceContext: text.slice(0, 200),
      });
    }
  }

  const dec = text.match(/(.{2,}?)하기로\s*했(?:다|어|습니다|어요)?(?!면)/);
  if (dec?.[1]) {
    const content = dec[1].trim();
    if (content.length >= 2) {
      pushUnique(out, {
        category: 'decision',
        content,
        reason: "사용자 메시지에 결정 확정 표현 '하기로 했'이 포함되어 있습니다.",
        suggestedMemoryType: CATEGORY_MEMORY.decision,
        tags: baseTags('decision'),
        importance: 0.65,
        confidence: 0.9,
        sourceContext: text.slice(0, 200),
      });
    }
  }

  const decEn = text.match(/I\s+decided\s+to\s+(.{4,})/i);
  if (decEn?.[1]) {
    const content = decEn[1].trim();
    pushUnique(out, {
      category: 'decision',
      content,
      reason: "사용자 메시지에 영문 결정 신호 'I decided to'가 포함되어 있습니다.",
      suggestedMemoryType: CATEGORY_MEMORY.decision,
      tags: baseTags('decision'),
      importance: 0.64,
      confidence: 0.88,
      sourceContext: text.slice(0, 200),
    });
  }

  const dec2 = text.match(/결정했(?:다|어|습니다|어요)?\s*[:\s]\s*(.{4,})/);
  if (dec2?.[1]) {
    const content = dec2[1].trim();
    if (content.length >= 4) {
      pushUnique(out, {
        category: 'decision',
        content,
        reason: "사용자 메시지에 '결정했' 결정 신호가 포함되어 있습니다.",
        suggestedMemoryType: CATEGORY_MEMORY.decision,
        tags: baseTags('decision'),
        importance: 0.66,
        confidence: 0.9,
        sourceContext: text.slice(0, 200),
      });
    }
  }

  const til = text.match(/TIL\s*[:：]\s*(.{4,})/i);
  if (til?.[1]) {
    const content = til[1].trim();
    pushUnique(out, {
      category: 'learning',
      content,
      reason: "사용자 메시지에 학습 기록 신호 'TIL:'이 포함되어 있습니다.",
      suggestedMemoryType: CATEGORY_MEMORY.learning,
      tags: baseTags('learning'),
      importance: 0.6,
      confidence: 0.92,
      sourceContext: text.slice(0, 200),
    });
  }

  const mem = text.match(/기억해둬[,，]?\s*(.{4,})/);
  if (mem?.[1]) {
    const content = mem[1].trim();
    pushUnique(out, {
      category: 'learning',
      content,
      reason: "사용자 메시지에 '기억해둬' 저장 요청 신호가 포함되어 있습니다.",
      suggestedMemoryType: CATEGORY_MEMORY.learning,
      tags: baseTags('learning'),
      importance: 0.61,
      confidence: 0.9,
      sourceContext: text.slice(0, 200),
    });
  }

  const learn = text.match(/알게\s+됐(?:다|어|습니다|어요)\s*[,:：]?\s*(.{4,})/);
  if (learn?.[1]) {
    const content = learn[1].trim();
    pushUnique(out, {
      category: 'learning',
      content,
      reason: "사용자 메시지에 '알게 됐' 학습 신호가 포함되어 있습니다.",
      suggestedMemoryType: CATEGORY_MEMORY.learning,
      tags: baseTags('learning'),
      importance: 0.6,
      confidence: 0.88,
      sourceContext: text.slice(0, 200),
    });
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
