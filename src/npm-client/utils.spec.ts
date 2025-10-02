import { describe, it, expect } from 'vitest';
import {
  isValidMemoryType,
  isValidPrivacyScope,
  validateMemoryItem,
  validateCreateMemoryParams,
  validateSearchFilters,
  sanitizeText,
  formatDate,
  parseDate,
  generateId,
  hashText,
  compressText,
  estimateTokens,
  truncateText,
  extractKeywords,
  calculateSimilarity,
  groupBy,
  sortBy,
  filterBy,
  debounce,
  throttle,
  retry,
  timeout,
  sleep
} from './utils.js';

describe('Utils', () => {
  describe('isValidMemoryType', () => {
    it('유효한 메모리 타입을 올바르게 검증해야 함', () => {
      expect(isValidMemoryType('working')).toBe(true);
      expect(isValidMemoryType('episodic')).toBe(true);
      expect(isValidMemoryType('semantic')).toBe(true);
      expect(isValidMemoryType('procedural')).toBe(true);
    });

    it('유효하지 않은 메모리 타입을 거부해야 함', () => {
      expect(isValidMemoryType('invalid')).toBe(false);
      expect(isValidMemoryType('')).toBe(false);
      expect(isValidMemoryType(null as any)).toBe(false);
      expect(isValidMemoryType(undefined as any)).toBe(false);
    });
  });

  describe('isValidPrivacyScope', () => {
    it('유효한 프라이버시 스코프를 올바르게 검증해야 함', () => {
      expect(isValidPrivacyScope('private')).toBe(true);
      expect(isValidPrivacyScope('team')).toBe(true);
      expect(isValidPrivacyScope('public')).toBe(true);
    });

    it('유효하지 않은 프라이버시 스코프를 거부해야 함', () => {
      expect(isValidPrivacyScope('invalid')).toBe(false);
      expect(isValidPrivacyScope('')).toBe(false);
      expect(isValidPrivacyScope(null as any)).toBe(false);
      expect(isValidPrivacyScope(undefined as any)).toBe(false);
    });
  });

  describe('validateMemoryItem', () => {
    it('유효한 메모리 아이템을 검증해야 함', () => {
      const validMemory = {
        id: 'memory-123',
        content: 'Test memory',
        type: 'episodic',
        importance: 0.5,
        created_at: '2024-01-01T00:00:00.000Z',
        last_accessed: '2024-01-01T00:00:00.000Z',
        pinned: false,
        tags: ['test'],
        source: 'user',
        privacy_scope: 'private'
      };

      expect(() => validateMemoryItem(validMemory)).not.toThrow();
    });

    it('유효하지 않은 메모리 아이템에 대해 에러를 던져야 함', () => {
      const invalidMemory = {
        id: '',
        content: '',
        type: 'invalid',
        importance: -1
      };

      expect(() => validateMemoryItem(invalidMemory as any)).toThrow();
    });
  });

  describe('validateCreateMemoryParams', () => {
    it('유효한 생성 파라미터를 검증해야 함', () => {
      const validParams = {
        content: 'Test memory',
        type: 'episodic',
        importance: 0.5,
        tags: ['test']
      };

      expect(() => validateCreateMemoryParams(validParams)).not.toThrow();
    });

    it('유효하지 않은 생성 파라미터에 대해 에러를 던져야 함', () => {
      const invalidParams = {
        content: '',
        type: 'invalid'
      };

      expect(() => validateCreateMemoryParams(invalidParams as any)).toThrow();
    });
  });

  describe('validateSearchFilters', () => {
    it('유효한 검색 필터를 검증해야 함', () => {
      const validFilters = {
        type: ['episodic'],
        tags: ['test'],
        limit: 10
      };

      expect(() => validateSearchFilters(validFilters)).not.toThrow();
    });

    it('유효하지 않은 검색 필터에 대해 에러를 던져야 함', () => {
      const invalidFilters = {
        type: ['invalid'],
        limit: -1
      };

      expect(() => validateSearchFilters(invalidFilters as any)).toThrow();
    });
  });

  describe('sanitizeText', () => {
    it('텍스트를 정리해야 함', () => {
      const dirtyText = '  Hello   World!  \n\n  ';
      const cleanText = sanitizeText(dirtyText);

      expect(cleanText).toBe('Hello World!');
    });

    it('빈 텍스트를 처리해야 함', () => {
      expect(sanitizeText('')).toBe('');
      expect(sanitizeText('   ')).toBe('');
    });

    it('특수 문자를 처리해야 함', () => {
      const textWithSpecialChars = 'Hello!@#$%^&*()World';
      const cleanText = sanitizeText(textWithSpecialChars);

      expect(cleanText).toBe('Hello!@#$%^&*()World');
    });
  });

  describe('formatDate', () => {
    it('날짜를 올바르게 포맷해야 함', () => {
      const date = new Date('2024-01-01T00:00:00.000Z');
      const formatted = formatDate(date);

      expect(formatted).toBe('2024-01-01T00:00:00.000Z');
    });

    it('현재 날짜를 포맷해야 함', () => {
      const formatted = formatDate();

      expect(formatted).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe('parseDate', () => {
    it('유효한 날짜 문자열을 파싱해야 함', () => {
      const dateString = '2024-01-01T00:00:00.000Z';
      const parsed = parseDate(dateString);

      expect(parsed).toBeInstanceOf(Date);
      expect(parsed.getTime()).toBe(new Date(dateString).getTime());
    });

    it('유효하지 않은 날짜 문자열에 대해 null을 반환해야 함', () => {
      expect(parseDate('invalid')).toBeNull();
      expect(parseDate('')).toBeNull();
    });
  });

  describe('generateId', () => {
    it('고유한 ID를 생성해야 함', () => {
      const id1 = generateId();
      const id2 = generateId();

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
      expect(typeof id1).toBe('string');
    });

    it('지정된 길이의 ID를 생성해야 함', () => {
      const id = generateId(10);

      expect(id.length).toBe(10);
    });
  });

  describe('hashText', () => {
    it('텍스트의 해시를 생성해야 함', () => {
      const text = 'Hello World';
      const hash1 = hashText(text);
      const hash2 = hashText(text);

      expect(hash1).toBeDefined();
      expect(hash2).toBeDefined();
      expect(hash1).toBe(hash2);
      expect(typeof hash1).toBe('string');
    });

    it('다른 텍스트에 대해 다른 해시를 생성해야 함', () => {
      const hash1 = hashText('Hello');
      const hash2 = hashText('World');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('compressText', () => {
    it('텍스트를 압축해야 함', () => {
      const longText = 'This is a very long text that needs to be compressed. '.repeat(10);
      const compressed = compressText(longText, 100);

      expect(compressed.length).toBeLessThanOrEqual(100);
      expect(compressed).toContain('...');
    });

    it('짧은 텍스트는 그대로 반환해야 함', () => {
      const shortText = 'Short text';
      const compressed = compressText(shortText, 100);

      expect(compressed).toBe(shortText);
    });
  });

  describe('estimateTokens', () => {
    it('토큰 수를 추정해야 함', () => {
      const text = 'Hello world!';
      const tokens = estimateTokens(text);

      expect(tokens).toBeGreaterThan(0);
      expect(typeof tokens).toBe('number');
    });

    it('빈 텍스트에 대해 0을 반환해야 함', () => {
      expect(estimateTokens('')).toBe(0);
    });
  });

  describe('truncateText', () => {
    it('텍스트를 잘라야 함', () => {
      const longText = 'This is a very long text';
      const truncated = truncateText(longText, 10);

      expect(truncated.length).toBeLessThanOrEqual(10);
      expect(truncated).toBe('This is a ');
    });

    it('짧은 텍스트는 그대로 반환해야 함', () => {
      const shortText = 'Short';
      const truncated = truncateText(shortText, 10);

      expect(truncated).toBe(shortText);
    });
  });

  describe('extractKeywords', () => {
    it('키워드를 추출해야 함', () => {
      const text = 'React Hook useState useEffect';
      const keywords = extractKeywords(text);

      expect(keywords).toContain('React');
      expect(keywords).toContain('Hook');
      expect(keywords).toContain('useState');
      expect(keywords).toContain('useEffect');
    });

    it('중복 키워드를 제거해야 함', () => {
      const text = 'React React Hook Hook';
      const keywords = extractKeywords(text);

      expect(keywords.filter(k => k === 'React')).toHaveLength(1);
      expect(keywords.filter(k => k === 'Hook')).toHaveLength(1);
    });
  });

  describe('calculateSimilarity', () => {
    it('텍스트 유사도를 계산해야 함', () => {
      const text1 = 'Hello world';
      const text2 = 'Hello world';
      const similarity = calculateSimilarity(text1, text2);

      expect(similarity).toBe(1);
    });

    it('다른 텍스트에 대해 낮은 유사도를 반환해야 함', () => {
      const text1 = 'Hello world';
      const text2 = 'Goodbye universe';
      const similarity = calculateSimilarity(text1, text2);

      expect(similarity).toBeLessThan(1);
      expect(similarity).toBeGreaterThan(0);
    });
  });

  describe('groupBy', () => {
    it('배열을 그룹화해야 함', () => {
      const items = [
        { type: 'episodic', content: 'Memory 1' },
        { type: 'semantic', content: 'Memory 2' },
        { type: 'episodic', content: 'Memory 3' }
      ];

      const grouped = groupBy(items, 'type');

      expect(grouped.episodic).toHaveLength(2);
      expect(grouped.semantic).toHaveLength(1);
    });
  });

  describe('sortBy', () => {
    it('배열을 정렬해야 함', () => {
      const items = [
        { importance: 0.3, content: 'Low' },
        { importance: 0.8, content: 'High' },
        { importance: 0.5, content: 'Medium' }
      ];

      const sorted = sortBy(items, 'importance', 'desc');

      expect(sorted[0].importance).toBe(0.8);
      expect(sorted[1].importance).toBe(0.5);
      expect(sorted[2].importance).toBe(0.3);
    });
  });

  describe('filterBy', () => {
    it('배열을 필터링해야 함', () => {
      const items = [
        { type: 'episodic', content: 'Memory 1' },
        { type: 'semantic', content: 'Memory 2' },
        { type: 'episodic', content: 'Memory 3' }
      ];

      const filtered = filterBy(items, 'type', 'episodic');

      expect(filtered).toHaveLength(2);
      expect(filtered.every(item => item.type === 'episodic')).toBe(true);
    });
  });

  describe('debounce', () => {
    it('함수를 디바운스해야 함', async () => {
      const fn = vi.fn();
      const debouncedFn = debounce(fn, 100);

      debouncedFn();
      debouncedFn();
      debouncedFn();

      expect(fn).not.toHaveBeenCalled();

      await new Promise(resolve => setTimeout(resolve, 150));

      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('throttle', () => {
    it('함수를 스로틀해야 함', async () => {
      const fn = vi.fn();
      const throttledFn = throttle(fn, 100);

      throttledFn();
      throttledFn();
      throttledFn();

      expect(fn).toHaveBeenCalledTimes(1);

      await new Promise(resolve => setTimeout(resolve, 150));

      throttledFn();
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('retry', () => {
    it('성공하는 함수를 재시도해야 함', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await retry(fn, 3, 10);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('실패하는 함수를 재시도해야 함', async () => {
      const fn = vi.fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValue('success');

      const result = await retry(fn, 3, 10);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('최대 재시도 횟수 초과 시 에러를 던져야 함', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('Always fails'));

      await expect(retry(fn, 2, 10)).rejects.toThrow('Always fails');
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('timeout', () => {
    it('함수에 타임아웃을 적용해야 함', async () => {
      const fn = vi.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(resolve, 200))
      );

      await expect(timeout(fn(), 100)).rejects.toThrow('Timeout');
    });

    it('타임아웃 내에 완료되는 함수는 성공해야 함', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const result = await timeout(fn(), 100);

      expect(result).toBe('success');
    });
  });

  describe('sleep', () => {
    it('지정된 시간만큼 대기해야 함', async () => {
      const start = Date.now();
      await sleep(100);
      const end = Date.now();

      expect(end - start).toBeGreaterThanOrEqual(100);
    });
  });
});
