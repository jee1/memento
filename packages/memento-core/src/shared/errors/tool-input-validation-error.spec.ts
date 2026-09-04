import { describe, expect, it } from 'vitest';
import { ToolInputValidationError } from './tool-input-validation-error.js';

describe('ToolInputValidationError', () => {
  it('sets name and message for MCP -32602 mapping', () => {
    const error = new ToolInputValidationError('type parameter is required');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ToolInputValidationError);
    expect(error.name).toBe('ToolInputValidationError');
    expect(error.message).toBe('type parameter is required');
  });
});
