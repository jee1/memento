import type { MemoryType, PrivacyScope } from '../types.js';

/**
 * 메모리 내용에서 태그 추출
 */
export function extractTagsFromContent(content: string): string[] {
  const hashtags = content.match(/#[\w가-힣]+/g) || [];
  const mentions = content.match(/@[\w가-힣]+/g) || [];
  const tagPatterns = content.match(/[\w가-힣]+:/g) || [];

  return [
    ...hashtags.map(tag => tag.substring(1)),
    ...mentions.map(mention => mention.substring(1)),
    ...tagPatterns.map(tag => tag.substring(0, tag.length - 1)),
  ];
}

/**
 * 메모리 내용 요약 (지정된 길이로)
 */
export function summarizeContent(content: string, maxLength: number = 200): string {
  if (content.length <= maxLength) {
    return content;
  }

  const sentences = content.split(/[.!?]+/);
  let summary = '';

  for (const sentence of sentences) {
    if (summary.length + sentence.length <= maxLength) {
      summary += sentence + '.';
    } else {
      break;
    }
  }

  return summary || content.substring(0, maxLength) + '...';
}

/**
 * 메모리 중요도 계산 (내용 길이, 태그 수, 타입 기반)
 */
export function calculateImportance(
  content: string,
  tags: string[] = [],
  type: MemoryType = 'episodic',
): number {
  let importance = 0.5;

  const contentLength = content.length;
  if (contentLength > 500) importance += 0.2;
  else if (contentLength > 200) importance += 0.1;
  else if (contentLength < 50) importance -= 0.1;

  const tagCount = tags.length;
  if (tagCount > 5) importance += 0.2;
  else if (tagCount > 2) importance += 0.1;
  else if (tagCount === 0) importance -= 0.1;

  switch (type) {
    case 'semantic':
      importance += 0.2;
      break;
    case 'procedural':
      importance += 0.1;
      break;
    case 'working':
      importance -= 0.1;
      break;
  }

  return Math.max(0, Math.min(1, importance));
}

/**
 * 메모리 타입별 기본 설정
 */
export function getDefaultSettingsForType(type: MemoryType): {
  importance: number;
  privacyScope: PrivacyScope;
  ttlDays?: number;
} {
  switch (type) {
    case 'working':
      return {
        importance: 0.3,
        privacyScope: 'private',
        ttlDays: 2,
      };
    case 'episodic':
      return {
        importance: 0.6,
        privacyScope: 'private',
        ttlDays: 90,
      };
    case 'semantic':
      return {
        importance: 0.8,
        privacyScope: 'team',
      };
    case 'procedural':
      return {
        importance: 0.7,
        privacyScope: 'team',
        ttlDays: 180,
      };
    case 'core':
      return {
        importance: 1.0,
        privacyScope: 'private',
      };
    case 'vault':
      return {
        importance: 1.0,
        privacyScope: 'private',
      };
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown memory type: ${_exhaustive}`);
    }
  }
}

/**
 * 메모리를 JSON으로 직렬화
 */
export function serializeMemory(memory: import('../types.js').MemoryItem): string {
  return JSON.stringify(memory, null, 2);
}

/**
 * JSON에서 메모리 역직렬화
 */
export function deserializeMemory(json: string): import('../types.js').MemoryItem {
  return JSON.parse(json);
}
