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

  it('invalidates cached memory reads after approve, restore and target deletion', async () => {
    db.exec(`CREATE TABLE memory_item (id TEXT PRIMARY KEY, superseded_by TEXT, is_deleted INTEGER DEFAULT 0);
      INSERT INTO memory_item (id) VALUES ('old'), ('target');`);
    const handler = vi.fn(async () => ({ success: true, content: [{ type: 'text' as const,
      text: JSON.stringify(db.prepare(`SELECT id FROM memory_item mi WHERE is_deleted = 0
        AND NOT (superseded_by IS NOT NULL AND EXISTS (
          SELECT 1 FROM memory_item target WHERE target.id = mi.superseded_by AND target.is_deleted = 0))
        ORDER BY id`).all()),
    }] }));
    const registry = new ToolRegistry({ enableCaching: true, enableLogging: false });
    registry.register({ name: 'recall', description: '', inputSchema: {}, handler });
    const context: ToolContext = { db, services: {} };
    const read = async () => JSON.parse((await registry.execute('recall', {}, context)).content[0]!.text!);
    expect(await read()).toEqual([{ id: 'old' }, { id: 'target' }]);
    expect(await read()).toEqual([{ id: 'old' }, { id: 'target' }]);
    expect(handler).toHaveBeenCalledTimes(1);
    db.exec("UPDATE memory_item SET superseded_by = 'target' WHERE id = 'old'");
    expect(await read()).toEqual([{ id: 'target' }]);
    db.exec("UPDATE memory_item SET superseded_by = NULL WHERE id = 'old'");
    expect(await read()).toEqual([{ id: 'old' }, { id: 'target' }]);
    db.exec("UPDATE memory_item SET superseded_by = 'target' WHERE id = 'old'; UPDATE memory_item SET is_deleted = 1 WHERE id = 'target'");
    expect(await read()).toEqual([{ id: 'old' }]);
  });

  it('does not cache a read under a newer revision when approval races the handler', async () => {
    db.exec('CREATE TABLE state (revision INTEGER); INSERT INTO state VALUES (0)');
    const handler = vi.fn(async () => {
      const revision = db.prepare('SELECT revision FROM state').pluck().get();
      if (revision === 0) db.exec('UPDATE state SET revision = 1');
      return { success: true, content: [{ type: 'text' as const, text: String(revision) }] };
    });
    const registry = new ToolRegistry({ enableCaching: true, enableLogging: false });
    registry.register({ name: 'recall', description: '', inputSchema: {}, handler });
    const context: ToolContext = { db, services: {} };
    expect((await registry.execute('recall', {}, context)).content[0]!.text).toBe('0');
    expect((await registry.execute('recall', {}, context)).content[0]!.text).toBe('1');
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
