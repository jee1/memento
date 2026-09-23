import { describe, expect, it } from 'vitest';

import { applyModernSuccessEnvelope, wrapModernSuccessResult } from './modern-response.js';

/**
 * #1129: 서버가 server/discover 로 2026-07-28 을 광고하면 그 개정판을 실제로 지켜야 한다.
 * SEP-2549 는 cacheable result 에 ttlMs·cacheScope 를 요구한다. 이게 빠지면 클라이언트가
 * tools/list 를 스키마 위반으로 거절하고 "connected · tools fetch failed" 가 된다.
 */
const CACHEABLE = [
  'tools/list',
  'prompts/list',
  'resources/list',
  'resources/templates/list',
  'resources/read',
  'server/discover',
] as const;

const NOT_CACHEABLE = ['tools/call', 'prompts/get', 'initialize', 'ping'] as const;

describe('#1129: 2026-07-28 cacheable result 의 캐시 필드', () => {
  it.each(CACHEABLE)('%s 는 ttlMs·cacheScope 를 채운다', (method) => {
    const wrapped = wrapModernSuccessResult({ tools: [] }, method);
    expect(wrapped.ttlMs).toBe(0);
    expect(wrapped.cacheScope).toBe('private');
  });

  it.each(NOT_CACHEABLE)('%s 는 캐시 필드를 붙이지 않는다', (method) => {
    const wrapped = wrapModernSuccessResult({ content: [] }, method);
    // 목록은 닫혀 있다. 규정에 없는 필드를 붙이는 것도 규정 위반이다.
    expect(wrapped).not.toHaveProperty('ttlMs');
    expect(wrapped).not.toHaveProperty('cacheScope');
  });

  it('핸들러가 넣은 유효한 값이 기본값을 이긴다', () => {
    const wrapped = wrapModernSuccessResult(
      { tools: [], ttlMs: 60_000, cacheScope: 'public' },
      'tools/list',
    );
    expect(wrapped.ttlMs).toBe(60_000);
    expect(wrapped.cacheScope).toBe('public');
  });

  it.each([
    ['음수', -1],
    ['소수', 1.5],
    ['문자열', '60000'],
    ['NaN', Number.NaN],
    ['안전정수 초과', Number.MAX_SAFE_INTEGER + 2],
  ])('유효하지 않은 ttlMs(%s)는 0 으로 떨어진다', (_label, value) => {
    const wrapped = wrapModernSuccessResult({ tools: [], ttlMs: value }, 'tools/list');
    expect(wrapped.ttlMs).toBe(0);
  });

  it.each([['알 수 없는 값', 'shared'], ['숫자', 1], ['null', null]])(
    '유효하지 않은 cacheScope(%s)는 private 으로 떨어진다',
    (_label, value) => {
      const wrapped = wrapModernSuccessResult({ tools: [], cacheScope: value }, 'tools/list');
      expect(wrapped.cacheScope).toBe('private');
    },
  );

  it('기존 봉투(resultType·serverInfo)는 그대로 유지된다', () => {
    const wrapped = wrapModernSuccessResult({ tools: [] }, 'tools/list');
    expect(wrapped.resultType).toBe('complete');
    expect(wrapped._meta).toMatchObject({
      'io.modelcontextprotocol/serverInfo': { name: 'memento-mcp-server' },
    });
  });
});

describe('#1129: applyModernSuccessEnvelope', () => {
  it('cacheable 메서드의 응답에 캐시 필드를 싣는다', () => {
    const response = applyModernSuccessEnvelope(
      { jsonrpc: '2.0', id: 1, result: { tools: [] } },
      'tools/list',
    );
    expect(response.result).toMatchObject({ ttlMs: 0, cacheScope: 'private' });
  });

  it('에러 응답은 건드리지 않는다', () => {
    const errorResponse = {
      jsonrpc: '2.0' as const,
      id: 1,
      error: { code: -32601, message: 'Method not found' },
    };
    expect(applyModernSuccessEnvelope(errorResponse, 'tools/list')).toEqual(errorResponse);
  });
});
