import { ToolInputValidationError } from '@memento/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { mapToolExecutionErrorToJsonRpc } from './mcp-tool-call-error.js';

/** Messages thrown by recall/remember when MEMENTO_TYPE_PARAM_MODE=error and type is omitted */
const TYPE_LESS_RECALL_MSG =
  "❌ recall: 'type' 파라미터는 필수입니다. 지원되는 타입: working | episodic | semantic | procedural | core | vault";
const TYPE_LESS_REMEMBER_MSG =
  "❌ remember: 'type' 파라미터는 필수입니다. 지원되는 타입: working | episodic | semantic | procedural | core | vault";

describe('mapToolExecutionErrorToJsonRpc', () => {
  it('maps ToolInputValidationError to -32602 Invalid params with message data', () => {
    const mapped = mapToolExecutionErrorToJsonRpc(
      new ToolInputValidationError('type parameter is required')
    );

    expect(mapped).toEqual({
      code: -32602,
      message: 'Invalid params: type parameter is required',
      data: 'type parameter is required'
    });
  });

  it('maps errors named ToolInputValidationError to -32602 even without instanceof', () => {
    const duck = new Error('query is required');
    duck.name = 'ToolInputValidationError';

    const mapped = mapToolExecutionErrorToJsonRpc(duck);

    expect(mapped).toEqual({
      code: -32602,
      message: 'Invalid params: query is required',
      data: 'query is required'
    });
  });

  /**
   * US3 / FR-006 (#811): type-less recall/remember in error mode must surface as
   * -32602 Invalid params, not -32603 Internal error (plain Error fall-through).
   */
  it('maps type-less recall/remember ToolInputValidationError to -32602 not -32603', () => {
    for (const msg of [TYPE_LESS_RECALL_MSG, TYPE_LESS_REMEMBER_MSG]) {
      const mapped = mapToolExecutionErrorToJsonRpc(new ToolInputValidationError(msg));
      expect(mapped).not.toBeNull();
      expect(mapped!.code).toBe(-32602);
      expect(mapped!.message).toBe(`Invalid params: ${msg}`);
      expect(String(mapped!.data)).toMatch(/type|파라미터|필수/i);
      expect(mapped!.code).not.toBe(-32603);

      // Plain Error with the same message must NOT map (class/name signal, not string match)
      expect(mapToolExecutionErrorToJsonRpc(new Error(msg))).toBeNull();
    }
  });

  it('maps ZodError to -32602 Invalid params with flattened details', () => {
    const schema = z.object({ content: z.string().min(1) });
    let caught: z.ZodError | undefined;
    try {
      schema.parse({});
    } catch (error) {
      caught = error as z.ZodError;
    }

    expect(caught).toBeInstanceOf(z.ZodError);
    const mapped = mapToolExecutionErrorToJsonRpc(caught);

    expect(mapped).toEqual({
      code: -32602,
      message: 'Invalid params: content: Required',
      data: caught!.flatten()
    });
  });

  /**
   * #861: 대부분의 MCP 클라이언트는 error.message 만 보여주고 error.data 는 버린다.
   * 이유가 message 밖으로 나가지 않으면 호출자는 "Invalid params" 한 줄만 본다.
   */
  describe('reason must reach the JSON-RPC message field (#861)', () => {
    it('never returns a bare "Invalid params" for a validation error with a reason', () => {
      const schema = z.object({ content: z.string().min(1) });
      const errors: unknown[] = [
        new ToolInputValidationError(TYPE_LESS_REMEMBER_MSG),
        (() => {
          try {
            schema.parse({});
          } catch (error) {
            return error;
          }
        })()
      ];

      for (const error of errors) {
        const mapped = mapToolExecutionErrorToJsonRpc(error);
        expect(mapped!.code).toBe(-32602);
        expect(mapped!.message).not.toBe('Invalid params');
        expect(mapped!.message.length).toBeGreaterThan('Invalid params'.length);
      }
    });

    it('collapses newlines and clips a very long reason so message stays one short line', () => {
      const mapped = mapToolExecutionErrorToJsonRpc(
        new ToolInputValidationError(`line one\nline two ${'x'.repeat(500)}`)
      );

      expect(mapped!.message).not.toContain('\n');
      expect(mapped!.message).toContain('line one line two');
      expect(mapped!.message.endsWith('…')).toBe(true);
      expect(mapped!.message.length).toBeLessThanOrEqual('Invalid params: '.length + 301);
      // 전체 원문은 data 에 그대로 남아야 한다.
      expect(String(mapped!.data)).toContain('x'.repeat(500));
    });

    it('falls back to a bare "Invalid params" when the reason is empty', () => {
      const mapped = mapToolExecutionErrorToJsonRpc(new ToolInputValidationError('   '));

      expect(mapped!.message).toBe('Invalid params');
    });
  });

  it('maps Unknown tool errors to -32601 Method not found', () => {
    const mapped = mapToolExecutionErrorToJsonRpc(new Error('Unknown tool: not_a_real_tool'));

    expect(mapped).toEqual({
      code: -32601,
      message: 'Method not found',
      data: 'Unknown tool: not_a_real_tool'
    });
  });

  it('returns null for unmapped errors', () => {
    expect(mapToolExecutionErrorToJsonRpc(new Error('database unavailable'))).toBeNull();
    expect(mapToolExecutionErrorToJsonRpc('not an error')).toBeNull();
  });
});
