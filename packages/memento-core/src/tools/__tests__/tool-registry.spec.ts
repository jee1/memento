import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToolRegistry } from '../tool-registry.js';
import type { ToolContext } from '../types.js';

describe('ToolRegistry caller-scoped cache', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    db.close();
  });

  it.each<[string, Partial<ToolContext>, Partial<ToolContext>]>([
    ['bound owners', { boundAgentId: 'owner-a' }, { boundAgentId: 'owner-b' }],
    ['bound projects', { boundAgentId: 'owner-a', boundProjectId: 'project-a' },
      { boundAgentId: 'owner-a', boundProjectId: 'project-b' }],
    ['project-only bindings', { boundProjectId: 'project-a' }, { boundProjectId: 'project-b' }],
    ['bound and unbound owners', { agentId: 'owner-a', boundAgentId: 'owner-a' }, { agentId: 'owner-a' }],
    ['bound and unbound projects', { projectId: 'project-a', boundProjectId: 'project-a' }, { projectId: 'project-a' }],
    ['unbound agents', { agentId: 'owner-a' }, { agentId: 'owner-b' }],
    ['unbound projects', { projectId: 'project-a' }, { projectId: 'project-b' }],
  ])('isolates %s and reuses each caller’s result', async (_label, scopeA, scopeB) => {
    const registry = new ToolRegistry({ enableCaching: true, enableLogging: false });
    const handler = vi.fn(async (_params: unknown, context: ToolContext) => ({
      success: true,
      content: [{ type: 'text' as const, text: JSON.stringify({
        boundAgentId: context.boundAgentId,
        boundProjectId: context.boundProjectId,
        agentId: context.agentId,
        projectId: context.projectId,
      }) }],
    }));
    registry.register({ name: 'scoped_read', description: '', inputSchema: {}, handler });
    const contextA: ToolContext = { db, services: {}, ...scopeA };
    const contextB: ToolContext = { db, services: {}, ...scopeB };
    const params = { query: 'same query' };

    const resultA = await registry.execute('scoped_read', params, contextA);
    const resultB = await registry.execute('scoped_read', params, contextB);

    expect(resultB).not.toEqual(resultA);
    expect(handler).toHaveBeenCalledTimes(2);
    expect(await registry.execute('scoped_read', params, { ...contextA })).toBe(resultA);
    expect(await registry.execute('scoped_read', params, { ...contextB })).toBe(resultB);
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
