import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { AuditHashChainMigration } from '../../../infrastructure/database/sqlite/migration/migrations/040-audit-hash-chain.js';
import {
  AUDIT_MODE_ENV,
  AuditCoverageError,
  AuditHashChainService,
} from './audit-hash-chain-service.js';

describe('AuditHashChainService', () => {
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

  it('chains append-only records and validates the chain', () => {
    const service = new AuditHashChainService(db);
    const first = service.append({
      actorId: 'key_1', transport: 'mcp_http', toolOrEndpoint: 'remember', action: 'write',
      targetUri: 'memento://owner/memory/mem_1', resultStatus: 'success', evidenceMode: 'metadata_only',
      requestSeen: true, responseSeen: true,
    });
    const second = service.append({
      actorId: 'key_1', transport: 'mcp_http', toolOrEndpoint: 'recall', action: 'read',
      resultStatus: 'success', evidenceMode: 'metadata_only', requestSeen: true, responseSeen: true,
    });

    expect(second.previousHash).toBe(first.currentHash);
    expect(service.verify()).toEqual({ valid: true, checked: 2 });
    expect(service.list({ action: 'write' })).toMatchObject([{ id: first.id, action: 'write' }]);
  });

  it('reports a tampered chain record', () => {
    const service = new AuditHashChainService(db);
    const record = service.append({
      actorId: 'key_1', transport: 'mcp_http', toolOrEndpoint: 'forget', action: 'delete',
      resultStatus: 'success', evidenceMode: 'metadata_only', requestSeen: true, responseSeen: true,
    });
    db.exec('DROP TRIGGER audit_log_prevent_update');
    db.prepare("UPDATE audit_log SET result_status = 'failure' WHERE id = ?").run(record.id);

    expect(service.verify()).toEqual({ valid: false, checked: 0, brokenAtId: record.id });
  });

  it('records incomplete coverage in best-effort mode', () => {
    const record = new AuditHashChainService(db).append({
      transport: 'mcp_stdio', toolOrEndpoint: 'recall', action: 'read', resultStatus: 'success',
    });

    expect(record).toMatchObject({ auditVerdict: 'incomplete', coverageGap: 'actor_unverified' });
  });

  it('fails closed for strict sensitive actions with a coverage gap', () => {
    process.env[AUDIT_MODE_ENV] = 'strict';
    expect(() => new AuditHashChainService(db).append({
      transport: 'mcp_stdio', toolOrEndpoint: 'forget', action: 'delete', resultStatus: 'success',
    })).toThrow(AuditCoverageError);
  });

  it('preserves denied authentication events in strict mode because the request is already rejected', () => {
    process.env[AUDIT_MODE_ENV] = 'strict';
    const record = new AuditHashChainService(db).append({
      transport: 'mcp_http', toolOrEndpoint: '/tools/remember', action: 'auth_denied', resultStatus: 'denied',
    });

    expect(record).toMatchObject({ auditVerdict: 'incomplete', coverageGap: 'actor_unverified' });
  });
});
