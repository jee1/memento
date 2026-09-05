import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { McpError } from '@modelcontextprotocol/sdk/types.js';
import {
  AuditCoverageError,
  AuditHashChainMigration,
  AuditHashChainService,
  AuditTransportExpansionMigration,
  AUDIT_MODE_ENV,
  type ServerServices,
} from '@memento/core';
import * as auditDispatch from './audit-tool-dispatch.js';

describe('tool dispatch audit', () => {
  let db: Database.Database;
  let originalAuditMode: string | undefined;

  beforeEach(async () => {
    originalAuditMode = process.env[AUDIT_MODE_ENV];
    delete process.env[AUDIT_MODE_ENV];
    db = new Database(':memory:');
    db.exec('CREATE TABLE memory_item (id TEXT PRIMARY KEY)');
    await new AuditHashChainMigration().up(db);
    await new AuditTransportExpansionMigration().up(db);
  });

  afterEach(() => {
    if (originalAuditMode === undefined) delete process.env[AUDIT_MODE_ENV];
    else process.env[AUDIT_MODE_ENV] = originalAuditMode;
    db.close();
  });

  it('records metadata-only MCP tool dispatches without tool content', () => {
    const args = { owner_id: 'owner-1', memory_id: 'mem_1', content: 'must not be audited' };
    const context = { transport: 'mcp_stdio' as const, agentId: 'agent-1' };
    auditDispatch.assertToolAuditCoverage(db, 'remember', args, context);
    auditDispatch.recordToolAudit(db, 'remember', args, context, 'success');

    const [record] = new AuditHashChainService(db).list();
    expect(record).toMatchObject({
      action: 'write', auditVerdict: 'incomplete', coverageGap: 'actor_unverified',
      targetUri: 'memento://owner-1/memory/mem_1',
    });
    expect(JSON.stringify(record)).not.toContain('must not be audited');
  });

  it('fails closed before strict stdio deletion without a verified actor', () => {
    process.env[AUDIT_MODE_ENV] = 'strict';
    expect(() => auditDispatch.assertToolAuditCoverage(db, 'forget', {}, { transport: 'mcp_stdio' }))
      .toThrow(AuditCoverageError);
    expect(new AuditHashChainService(db).list()).toHaveLength(0);
  });

  it.each(['mcp_stdio', 'mcp_http', 'mcp_ws', 'rest'] as const)(
    'records tool-level audit metadata for %s',
    (transport) => {
      auditDispatch.recordToolAudit(
        db,
        'remember',
        { content: 'must not be audited' },
        { transport } as auditDispatch.ToolAuditContext,
        'success',
      );

      expect(new AuditHashChainService(db).list({ transport }).map((record) => record.toolOrEndpoint))
        .toEqual(['remember']);
    },
  );

  it('uses one concurrency limit around execution and audit recording', async () => {
    let active = 0;
    let maximumActive = 0;
    let callCount = 0;
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve; });
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const dispatch = auditDispatch.createToolDispatcher({
      maxConcurrency: 1,
      execute: async () => {
        callCount += 1;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        if (callCount === 1) {
          markFirstStarted();
          await firstGate;
        }
        active -= 1;
        return { content: [] };
      },
    });
    const services = {} as ServerServices;

    const first = dispatch('remember', {}, db, services, { transport: 'mcp_stdio' });
    await firstStarted;
    const second = dispatch('remember', {}, db, services, { transport: 'rest' } as auditDispatch.ToolAuditContext);
    await Promise.resolve();

    expect(callCount).toBe(1);
    releaseFirst();
    await Promise.all([first, second]);
    expect(maximumActive).toBe(1);
    expect(new AuditHashChainService(db).list()).toHaveLength(2);
  });

  it('maps validation failures once and records the failed dispatch', async () => {
    const { z } = await import('zod');
    const dispatch = auditDispatch.createToolDispatcher({
      maxConcurrency: 1,
      execute: async () => z.object({ required: z.string() }).parse({}),
    });

    const error = await dispatch(
      'remember',
      {},
      db,
      {} as ServerServices,
      { transport: 'mcp_ws' } as auditDispatch.ToolAuditContext,
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(McpError);
    // #861: 이유가 protocolMessage 에 들어가야 클라이언트가 그대로 보여준다.
    expect(error).toMatchObject({
      code: -32602,
      protocolMessage: expect.stringMatching(/^Invalid params: \S/),
    });
    expect(new AuditHashChainService(db).list()).toMatchObject([
      { transport: 'mcp_ws', toolOrEndpoint: 'remember', resultStatus: 'failure' },
    ]);
  });

  it('keeps strict unauthenticated WebSocket deletes fail-closed before execution', async () => {
    process.env[AUDIT_MODE_ENV] = 'strict';
    let executed = false;
    const dispatch = auditDispatch.createToolDispatcher({
      maxConcurrency: 1,
      execute: async () => {
        executed = true;
        return { content: [] };
      },
    });

    const error = await dispatch(
      'forget',
      {},
      db,
      {} as ServerServices,
      { transport: 'mcp_ws' } as auditDispatch.ToolAuditContext,
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(McpError);
    expect(error).toMatchObject({ code: -32603, protocolMessage: 'Internal error' });
    expect(executed).toBe(false);
    expect(new AuditHashChainService(db).list()).toHaveLength(0);
  });
});
