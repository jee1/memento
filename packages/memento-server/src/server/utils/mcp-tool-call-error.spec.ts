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
      message: 'Invalid params',
      data: 'type parameter is required'
    });
  });

  it('maps errors named ToolInputValidationError to -32602 even without instanceof', () => {
    const duck = new Error('query is required');
    duck.name = 'ToolInputValidationError';

    const mapped = mapToolExecutionErrorToJsonRpc(duck);

    expect(mapped).toEqual({
      code: -32602,
      message: 'Invalid params',
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
      expect(mapped!.message).toBe('Invalid params');
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
      message: 'Invalid params',
      data: caught!.flatten()
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
