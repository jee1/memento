import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { AuditCoverageError, AuditHashChainMigration, AuditHashChainService, AUDIT_MODE_ENV } from '@memento/core';
import { assertToolAuditCoverage, recordToolAudit } from './audit-tool-dispatch.js';

describe('tool dispatch audit', () => {
  let db: Database.Database;
  let originalAuditMode: string | undefined;

  beforeEach(async () => {
    originalAuditMode = process.env[AUDIT_MODE_ENV];
    delete process.env[AUDIT_MODE_ENV];
    db = new Database(':memory:');
    db.exec('CREATE TABLE memory_item (id TEXT PRIMARY KEY)');
    await new AuditHashChainMigration().up(db);
  });

  afterEach(() => {
    if (originalAuditMode === undefined) delete process.env[AUDIT_MODE_ENV];
    else process.env[AUDIT_MODE_ENV] = originalAuditMode;
    db.close();
  });

  it('records metadata-only MCP tool dispatches without tool content', () => {
    const args = { owner_id: 'owner-1', memory_id: 'mem_1', content: 'must not be audited' };
    const context = { transport: 'mcp_stdio' as const, agentId: 'agent-1' };
    assertToolAuditCoverage(db, 'remember', args, context);
    recordToolAudit(db, 'remember', args, context, 'success');

    const [record] = new AuditHashChainService(db).list();
    expect(record).toMatchObject({
      action: 'write', auditVerdict: 'incomplete', coverageGap: 'actor_unverified',
      targetUri: 'memento://owner-1/memory/mem_1',
    });
    expect(JSON.stringify(record)).not.toContain('must not be audited');
  });

  it('fails closed before strict stdio deletion without a verified actor', () => {
    process.env[AUDIT_MODE_ENV] = 'strict';
    expect(() => assertToolAuditCoverage(db, 'forget', {}, { transport: 'mcp_stdio' }))
      .toThrow(AuditCoverageError);
    expect(new AuditHashChainService(db).list()).toHaveLength(0);
  });
});
