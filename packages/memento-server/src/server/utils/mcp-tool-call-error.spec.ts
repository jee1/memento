import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { mapToolExecutionErrorToJsonRpc } from './mcp-tool-call-error.js';

describe('mapToolExecutionErrorToJsonRpc', () => {
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
