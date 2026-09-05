/**
 * type 파라미터 계약 테스트 (#853)
 *
 * 런타임(validateTypeParam)은 'error' 모드에서 type 없는 호출을 -32602 로 거절하는데,
 * MCP 가 광고하는 inputSchema 는 type 을 선택 파라미터로 노출하고 있었다.
 * 스키마만 보고 호출한 클라이언트가 전부 실패했으므로, 둘이 어긋나면 깨지도록 고정한다.
 */

import { describe, it, expect } from 'vitest';

import { mementoConfig } from '../../config/index.js';
import { RememberTool } from '../../../domains/memory/remember/remember-tool.js';
import { RECALL_TOOL_INPUT_SCHEMA } from '../../../domains/memory/recall/recall-tool-definition.js';
import { parseTypeParamMode, typeParamRequiredFields } from '../type-param-validator.js';

type JsonSchema = {
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  anyOf?: Array<{ required: string[] }>;
};

const rememberSchema = new RememberTool().getDefinition().inputSchema as unknown as JsonSchema;
const recallSchema = RECALL_TOOL_INPUT_SCHEMA as unknown as JsonSchema;

describe('type 파라미터 스키마 ↔ 런타임 계약 (#853)', () => {
  it('환경 변수가 없으면 롤아웃 모드는 error 다 (#636 이후 배포 기본값)', () => {
    expect(parseTypeParamMode(undefined)).toBe('error');
  });

  it('typeParamRequiredFields 는 error 모드에서만 type 을 필수로 만든다', () => {
    expect(typeParamRequiredFields('error')).toEqual(['type']);
    expect(typeParamRequiredFields('warn')).toEqual([]);
    expect(typeParamRequiredFields('deprecate')).toEqual([]);
  });

  it('remember 스키마의 required 가 현재 롤아웃 모드와 일치한다', () => {
    const mode = mementoConfig.typeParamMode;
    expect(rememberSchema.required.includes('type')).toBe(mode === 'error');
  });

  it('remember 스키마가 type 기본값을 광고하지 않는다', () => {
    // default 가 남아 있으면 클라이언트는 type 생략이 안전하다고 판단한다 — 재발 조건.
    expect(rememberSchema.properties.type).not.toHaveProperty('default');
    expect(String(rememberSchema.properties.type.description)).not.toContain("기본값: 'episodic'");
  });

  it('recall 스키마가 type 또는 memory_types 중 하나를 요구한다', () => {
    const mode = mementoConfig.typeParamMode;

    // recall 은 memory_types 로 type 을 대체할 수 있어 required 로는 표현할 수 없다.
    expect(recallSchema.required).not.toContain('type');

    if (mode === 'error') {
      expect(recallSchema.anyOf).toEqual([
        { required: ['type'] },
        { required: ['memory_types'] }
      ]);
    } else {
      expect(recallSchema.anyOf).toBeUndefined();
    }
  });

  it('recall 스키마의 type 설명이 선택사항이라고 안내하지 않는다', () => {
    expect(String(recallSchema.properties.type.description)).not.toContain('선택사항');
  });
});
