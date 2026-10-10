import { describe, it, expect } from 'vitest';
import {
  parseLlmRelationsResponse,
  prepareOllamaRelationJsonContent
} from '../llm-relation-extractor/llm-response-parse.js';

const rel = (overrides: Record<string, unknown> = {}) => ({
  target_id: 'mem_1',
  relation_type: 'REFERENCES',
  confidence: 0.8,
  reasoning: 'r',
  ...overrides
});
const body = (relations: unknown) => JSON.stringify({ relations });

describe('parseLlmRelationsResponse', () => {
  it('plain JSON', () => {
    expect(parseLlmRelationsResponse(body([rel()]))).toEqual({
      success: true,
      relations: [rel()]
    });
  });

  it('markdown code block and trailing text', () => {
    const text = '설명입니다\n```json\n' + body([rel()]) + '\n```\n추가 텍스트 } 끝';
    expect(parseLlmRelationsResponse(text)).toEqual({ success: true, relations: [rel()] });
  });

  it('filters invalid relation_type and confidence', () => {
    const result = parseLlmRelationsResponse(
      body([
        rel({ target_id: 'ok' }),
        rel({ relation_type: 'nope' }),
        rel({ confidence: 1.5 }),
        rel({ confidence: -0.1 }),
        rel({ confidence: '0.5' }),
        rel({ target_id: 'edge0', confidence: 0 }),
        rel({ target_id: 'edge1', confidence: 1 })
      ])
    );
    expect(result.success).toBe(true);
    expect(result.relations.map(r => r.target_id)).toEqual(['ok', 'edge0', 'edge1']);
  });

  it('normalizes -0 confidence to 0', () => {
    const result = parseLlmRelationsResponse('{"relations":[{"target_id":"a","relation_type":"REFERENCES","confidence":-0}]}');
    expect(Object.is(result.relations[0]?.confidence, 0)).toBe(true);
  });

  it('missing relations array', () => {
    const expected = {
      success: false,
      relations: [],
      error: '응답 구조가 올바르지 않습니다: relations 배열이 없거나 배열이 아닙니다.'
    };
    expect(parseLlmRelationsResponse('{"items":[]}')).toEqual(expected);
    expect(parseLlmRelationsResponse('{"relations":{}}')).toEqual(expected);
    expect(parseLlmRelationsResponse('42')).toEqual(expected);
  });

  it('truncated JSON reports the parse error', () => {
    const text = '{"relations":[{"target_id":"a"';
    let message = '';
    try {
      JSON.parse(text);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(parseLlmRelationsResponse(text)).toEqual({
      success: false,
      relations: [],
      error: `JSON 파싱 실패: ${message}`
    });
  });

  it('no JSON at all', () => {
    const result = parseLlmRelationsResponse('관계가 없습니다');
    expect(result.success).toBe(false);
    expect(result.relations).toEqual([]);
    expect(result.error).toMatch(/^JSON 파싱 실패: /);
  });

  it('null JSON goes through the outer catch', () => {
    const result = parseLlmRelationsResponse('null');
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/^JSON 파싱 실패: .*relations/);
  });
});

describe('prepareOllamaRelationJsonContent', () => {
  it('extracts the balanced object', () => {
    expect(prepareOllamaRelationJsonContent('앞 {"a":{"b":"}"}} 뒤 }')).toBe('{"a":{"b":"}"}}');
  });

  it('returns input without braces unchanged', () => {
    expect(prepareOllamaRelationJsonContent('  no json  ')).toBe('  no json  ');
  });

  it('keeps unclosed content when no valid prefix exists', () => {
    expect(prepareOllamaRelationJsonContent('x {"a":1')).toBe('{"a":1');
  });
});
