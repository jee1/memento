import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { processMcpMessage } from './message-processor.js';
import type { ToolAuditContext } from '../../audit-tool-dispatch.js';

const BOUND: ToolAuditContext = { transport: 'mcp_http', boundAgentId: 'agent-a', boundProjectId: 'proj-1' };
const UNBOUND: ToolAuditContext = { transport: 'mcp_http' };

describe('MCP resources honour the caller scope', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`CREATE TABLE memory_item (
      id TEXT PRIMARY KEY, type TEXT, content TEXT, importance REAL DEFAULT 0.5,
      privacy_scope TEXT DEFAULT 'private', tags TEXT, source TEXT, created_at TEXT,
      last_accessed TEXT, pinned INTEGER DEFAULT 0, owner_id TEXT, project_id TEXT, is_deleted INTEGER DEFAULT 0
    )`);
    const insert = db.prepare(
      `INSERT INTO memory_item (id, type, content, owner_id, project_id, is_deleted, created_at)
       VALUES (?, 'semantic', ?, ?, ?, ?, ?)`,
    );
    insert.run('own', 'own', 'agent-a', 'proj-1', 0, '2026-01-04');
    insert.run('other-owner', 'other owner', 'agent-b', 'proj-1', 0, '2026-01-03');
    insert.run('other-project', 'other project', 'agent-a', 'proj-2', 0, '2026-01-02');
    insert.run('removed', 'removed', 'agent-a', 'proj-1', 1, '2026-01-01');
  });

  afterEach(() => {
    db.close();
  });

  async function listIds(context: ToolAuditContext): Promise<string[]> {
    const response = await processMcpMessage({ jsonrpc: '2.0', id: 1, method: 'resources/list' }, db, null, context);
    const result = (response as { result: { resources: Array<{ uri: string }> } }).result;
    return result.resources.map((resource) => resource.uri.replace('memory://', ''));
  }

  async function read(context: ToolAuditContext, id: string) {
    return processMcpMessage(
      { jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: `memory://${id}` } },
      db,
      null,
      context,
    );
  }

  it('lists only live memories in the bound owner and project', async () => {
    expect(await listIds(BOUND)).toEqual(['own']);
    expect(await listIds(UNBOUND)).toEqual(['own', 'other-owner', 'other-project']);
  });

  it('reads memories outside the scope or soft-deleted as not found', async () => {
    for (const id of ['other-owner', 'other-project', 'removed']) {
      expect(await read(BOUND, id)).toMatchObject({ error: { code: -32602 } });
    }
    expect(await read(UNBOUND, 'removed')).toMatchObject({ error: { code: -32602 } });
    expect(await read(BOUND, 'own')).toMatchObject({ result: { contents: [{ uri: 'memory://own' }] } });
    expect(await read(UNBOUND, 'other-owner')).toMatchObject({ result: { contents: [{ uri: 'memory://other-owner' }] } });
  });
});
