/**
 * triple-input-normalizer 단위 테스트
 *
 * Given/When/Then 패턴을 따릅니다.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeChatMessagesToText,
  type ChatMessageInput,
} from './triple-input-normalizer.js';

describe('normalizeChatMessagesToText', () => {
  it('빈 배열이면 빈 문자열을 반환한다', () => {
    const messages: ChatMessageInput[] = [];

    const result = normalizeChatMessagesToText(messages);

    expect(result).toBe('');
  });

  it('단일 메시지를 role: content 한 줄로 만든다', () => {
    const messages: ChatMessageInput[] = [
      { role: 'user', content: 'Hello' },
    ];

    const result = normalizeChatMessagesToText(messages);

    expect(result).toBe('user: Hello');
  });

  it('여러 메시지를 줄바꿈으로 이어 붙인다', () => {
    const messages: ChatMessageInput[] = [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello there' },
      { role: 'user', content: 'Thanks' },
    ];

    const result = normalizeChatMessagesToText(messages);

    expect(result).toBe(
      'user: Hi\nassistant: Hello there\nuser: Thanks',
    );
  });

  it('content에 줄바꿈이 있어도 한 줄 포맷으로 그대로 포함한다', () => {
    const messages: ChatMessageInput[] = [
      { role: 'user', content: 'line1\nline2' },
    ];

    const result = normalizeChatMessagesToText(messages);

    expect(result).toBe('user: line1\nline2');
  });
});
