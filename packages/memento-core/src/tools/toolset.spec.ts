import { describe, expect, it, vi } from 'vitest';
import {
  CORE_TOOLSET,
  getExposedTools,
  getToolRegistry,
  resolveToolsetMode,
} from './index.js';

describe('MCP toolset exposure', () => {
  it('defaults to the core toolset and accepts full', () => {
    expect(resolveToolsetMode(undefined)).toBe('core');
    expect(resolveToolsetMode('full')).toBe('full');
    expect(resolveToolsetMode('  FULL  ')).toBe('full');
    expect(resolveToolsetMode('core')).toBe('core');
  });

  it('falls back to core and warns on an unknown value instead of throwing', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    expect(resolveToolsetMode('everything')).toBe('core');
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('MEMENTO_TOOLSET'));

    stderr.mockRestore();
  });

  it('exposes exactly the four core tools by default', () => {
    expect(getExposedTools('core').map((tool) => tool.name).sort())
      .toEqual([...CORE_TOOLSET].sort());
  });

  it('exposes every registered tool under full', () => {
    expect(getExposedTools('full')).toEqual(getToolRegistry().getAll());
  });

  it('keeps withheld tools registered and executable', () => {
    const exposed = new Set(getExposedTools('core').map((tool) => tool.name));
    const withheld = getToolRegistry().getAll().filter((tool) => !exposed.has(tool.name));

    expect(withheld.length).toBeGreaterThan(0);
    // Withholding a definition must not unregister the tool: `tools/call` still resolves it.
    for (const tool of withheld) {
      expect(getToolRegistry().get(tool.name)).toBeDefined();
    }
  });

  it('cuts the listed definition payload roughly in half', () => {
    const size = (mode: 'core' | 'full') => Buffer.byteLength(JSON.stringify(
      getExposedTools(mode).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    ), 'utf8');

    expect(size('core')).toBeLessThan(size('full') * 0.55);
  });
});
