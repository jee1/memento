/**
 * Token-bound callers (ToolContext.boundAgentId) must not reach other owners' memories
 * through id-taking tools, and another owner's memory must look exactly like a
 * missing one (#1094 follow-up).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { setupTestDatabase } from '../../test/helpers/test-database.js';
import type { ToolContext } from '../types.js';
import { callerOwnerClause, filterCallerOwnedIds, resolveCallerAgentId } from '../caller-scope.js';
import { PinTool } from '../../domains/memory/tools/pin-tool.js';
import { UnpinTool } from '../../domains/memory/tools/unpin-tool.js';
import { FeedbackTool } from '../../domains/memory/tools/feedback-tool.js';
import { GetMemoryNeighborsTool } from '../../domains/memory/tools/get-memory-neighbors-tool.js';
import { ProceduralRollbackTool } from '../../domains/memory/procedural/procedural-rollback-tool.js';
import { SetAnchorTool } from '../../domains/anchor/tools/set-anchor-tool.js';
import { GetAnchorTool } from '../../domains/anchor/tools/get-anchor-tool.js';
import { GetRelationsTool } from '../../domains/relation/tools/get-relations-tool.js';
import { RememberTool } from '../../domains/memory/remember/remember-tool.js';
import { ProceduralDiffTool } from '../../domains/memory/procedural/procedural-diff-tool.js';
import { AddRelationTool } from '../../domains/relation/tools/add-relation-tool.js';
import { RemoveRelationTool } from '../../domains/relation/tools/remove-relation-tool.js';

type Handler = { handle(params: unknown, context: ToolContext): Promise<{ content: Array<{ text?: string }> }> };

/** Tool output or thrown message, with the probed id masked so two runs compare equal. */
async function outcome(tool: Handler, params: Record<string, unknown>, context: ToolContext, id: string) {
  try {
    const result = await tool.handle(params, context);
    return (result.content[0]?.text ?? '').replaceAll(id, '<id>');
  } catch (error) {
    return `throw: ${(error as Error).message.replaceAll(id, '<id>')}`;
  }
}

describe('caller scope', () => {
  let db: Database.Database;
  let bound: ToolContext;
  let unbound: ToolContext;

  beforeEach(async () => {
    db = await setupTestDatabase();
    const insert = db.prepare(
      `INSERT INTO memory_item (id, type, content, owner_id) VALUES (?, 'procedural', 'x', ?)`,
    );
    insert.run('mem_own', 'agent-a');
    insert.run('mem_own2', 'agent-a');
    insert.run('mem_other', 'agent-b');
    insert.run('mem_null', null);
    bound = { db, boundAgentId: 'agent-a', services: {} } as ToolContext;
    // A self-declared agentId (X-Memento-Agent-Id header / env) is not a binding.
    unbound = { db, agentId: 'agent-a', services: {} } as ToolContext;
  });

  afterEach(() => db.close());

  it('helpers scope only bound callers', () => {
    expect(callerOwnerClause(unbound)).toEqual({ sql: '', params: [] });
    expect(callerOwnerClause(bound)).toEqual({ sql: ' AND owner_id IS ?', params: ['agent-a'] });
    expect([...filterCallerOwnedIds(bound, ['mem_own', 'mem_other', 'mem_null', 'mem_missing'])]).toEqual(['mem_own']);
    expect(filterCallerOwnedIds(unbound, ['mem_other', 'mem_missing']).size).toBe(2);
    expect(resolveCallerAgentId(unbound, 'agent-b')).toBe('agent-b');
    expect(resolveCallerAgentId(bound, 'default')).toBe('agent-a');
    expect(resolveCallerAgentId(bound, undefined)).toBe('agent-a');
    expect(() => resolveCallerAgentId(bound, 'agent-b')).toThrow(/token-bound agent/);
  });

  const guarded: Array<[string, () => Handler, (id: string) => Record<string, unknown>]> = [
    ['pin', () => new PinTool(), (id) => ({ id })],
    ['unpin', () => new UnpinTool(), (id) => ({ id })],
    ['feedback', () => new FeedbackTool(), (id) => ({ memory_id: id, helpful: true })],
    ['get_memory_neighbors', () => new GetMemoryNeighborsTool(), (id) => ({ memory_id: id })],
    ['procedural_rollback', () => new ProceduralRollbackTool(), (id) => ({ current_id: id, target_version_id: id })],
    ['set_anchor', () => new SetAnchorTool(), (id) => ({ memory_id: id, slot: 'A' })],
    ['get_relations', () => new GetRelationsTool(), (id) => ({ memory_id: id })],
    ['procedural_diff', () => new ProceduralDiffTool(), (id) => ({ left_id: id, right_id: 'mem_own' })],
    ['add_relation', () => new AddRelationTool(), (id) => ({ source_id: id, target_id: 'mem_own', relation_type: 'REFERENCES' })],
    ['remove_relation', () => new RemoveRelationTool(), (id) => ({ source_id: id, target_id: 'mem_own', relation_type: 'REFERENCES' })],
  ];

  it.each(guarded)('%s: another owner\'s memory reads exactly like a missing one', async (_name, make, params) => {
    const relationGraph = { removeRelation: vi.fn().mockResolvedValue(true), addRelation: vi.fn() };
    const ctx = { ...bound, services: { anchorManager: { setAnchor: vi.fn() }, relationGraph } } as unknown as ToolContext;
    const missing = await outcome(make(), params('mem_missing'), ctx, 'mem_missing');
    expect(await outcome(make(), params('mem_other'), ctx, 'mem_other')).toBe(missing);
    expect(await outcome(make(), params('mem_null'), ctx, 'mem_null')).toBe(missing);
  });

  it('pin: bound caller pins its own memory; unbound caller keeps legacy access', async () => {
    await new PinTool().handle({ id: 'mem_own' }, bound);
    await new PinTool().handle({ id: 'mem_other' }, unbound);
    const pinned = db.prepare('SELECT id FROM memory_item WHERE pinned = 1 ORDER BY id').all();
    expect(pinned).toEqual([{ id: 'mem_other' }, { id: 'mem_own' }]);
  });

  it('remove_relation: never deletes an edge touching another owner', async () => {
    const relationGraph = { removeRelation: vi.fn().mockResolvedValue(true) };
    const ctx = { ...bound, services: { relationGraph } } as unknown as ToolContext;
    const { lastInsertRowid } = db.prepare(
      `INSERT INTO memory_relation (source_id, target_id, relation_type) VALUES ('mem_own', 'mem_other', 'REFERENCES')`,
    ).run();
    const text = (await new RemoveRelationTool().handle({ relation_id: Number(lastInsertRowid) }, ctx)).content[0]!.text!;
    expect(JSON.parse(text).error).toBe('RELATION_NOT_FOUND');
    await new RemoveRelationTool().handle({ source_id: 'mem_own', target_id: 'mem_other', relation_type: 'REFERENCES' }, ctx);
    expect(relationGraph.removeRelation).not.toHaveBeenCalled();

    await new RemoveRelationTool().handle({ source_id: 'mem_own', target_id: 'mem_own2', relation_type: 'REFERENCES' }, ctx);
    expect(relationGraph.removeRelation).toHaveBeenCalledWith('mem_own', 'mem_own2', 'REFERENCES');
  });

  it('get_relations: drops edges into other owners\' memories', async () => {
    const relationGraph = {
      getRelations: vi.fn().mockResolvedValue([
        { id: 1, source_id: 'mem_own', target_id: 'mem_own2', relation_type: 'REFERENCES', confidence: 1 },
        { id: 2, source_id: 'mem_own', target_id: 'mem_other', relation_type: 'REFERENCES', confidence: 1 },
      ]),
    };
    const ctx = { ...bound, services: { relationGraph } } as unknown as ToolContext;
    const data = JSON.parse((await new GetRelationsTool().handle({ memory_id: 'mem_own' }, ctx)).content[0]!.text!);
    expect(data.relations.map((r: { target_id: string }) => r.target_id)).toEqual(['mem_own2']);
  });

  it('anchors: bound caller acts only as its own agent', async () => {
    const anchorManager = { setAnchor: vi.fn(), getAnchor: vi.fn().mockResolvedValue([]) };
    const ctx = { ...bound, services: { anchorManager } } as unknown as ToolContext;
    await new SetAnchorTool().handle({ memory_id: 'mem_own', slot: 'A' }, ctx);
    expect(anchorManager.setAnchor).toHaveBeenCalledWith('agent-a', 'mem_own', 'A');
    await expect(new GetAnchorTool().handle({ agent_id: 'agent-b' }, ctx)).rejects.toThrow(/token-bound agent/);
  });

  it('remember: bound caller cannot write into another owner', async () => {
    const outcomeText = await outcome(
      new RememberTool(),
      { content: 'spoof', type: 'episodic', owner_id: 'agent-b' },
      bound,
      'agent-b',
    );
    expect(outcomeText).toMatch(/token-bound agent/);
    expect(db.prepare(`SELECT COUNT(*) AS n FROM memory_item WHERE content = 'spoof'`).get()).toEqual({ n: 0 });
  });
});
