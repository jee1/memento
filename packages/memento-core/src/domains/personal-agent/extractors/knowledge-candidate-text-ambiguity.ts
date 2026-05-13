/**
 * 사용자 메시지가 질문·가정절 등 **확정적 지식 후보로 다루기 어려운** 경우 true.
 * true이면 `extractKnowledgeCandidates`는 빈 배열을 반환한다 (#234 보수적 정책).
 */
export function isAmbiguousUserMessage(raw: string): boolean {
  const text = raw.trim();
  if (text.length === 0) return true;

  if (/[\uFF1F?]\s*$/.test(text)) return true;

  if (/\S(?:까|까요|습니까|나요|을까요|인가요|할까)\s*$/.test(text)) return true;

  if (/하기로\s*했(?:다|어|습니다|어요)?면/.test(text)) return true;
  if (/(?:했|였|이)다면/.test(text)) return true;

  return false;
}
