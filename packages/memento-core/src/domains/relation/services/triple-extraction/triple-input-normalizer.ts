/**
 * 트리플 추출 파이프라인용 채팅 메시지 → 단일 텍스트 정규화
 */

export interface ChatMessageInput {
  role: string;
  content: string;
}

/**
 * 각 메시지를 `role: content` 형식의 한 줄로 만들고 `\n`으로 이어 붙인다.
 */
export function normalizeChatMessagesToText(
  messages: ChatMessageInput[],
): string {
  return messages.map((m) => `${m.role}: ${m.content}`).join('\n');
}
