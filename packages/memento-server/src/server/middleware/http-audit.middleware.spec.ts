import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { NextFunction, Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { AuditHashChainMigration, AuditHashChainService } from '@memento/core';

import {
  createHttpAuditMiddleware,
  extractHttpAuditToolName,
  resolveHttpAuditKeyId,
  type HttpAuditEntry,
} from './http-audit.middleware.js';

function createMockResponse(): Response & EventEmitter {
  const res = new EventEmitter() as Response & EventEmitter;
  res.statusCode = 200;
  res.status = vi.fn((code: number) => {
    res.statusCode = code;
    return res;
  }) as Response['status'];
  res.json = vi.fn(() => res) as Response['json'];
  return res;
}

describe('createHttpAuditMiddleware', () => {
  let tempDir: string;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = '';
    }
  });

  it('prefers X-Memento-Agent-Id over X-Agent-Id for agent_id field', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'memento-http-audit-'));
    const logPath = join(tempDir, 'audit-memento-agent.jsonl');

    const middleware = createHttpAuditMiddleware({ logPath });
    const req = {
      baseUrl: '/tools',
      path: '/recall',
      originalUrl: '/tools/recall',
      method: 'POST',
      headers: {
        authorization: 'Bearer test-admin-key',
        'x-memento-agent-id': 'memento-agent-a',
        'x-agent-id': 'legacy-agent',
      },
      body: { query: 'test' },
    } as Request;
    const res = createMockResponse();
    const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

    middleware(req, res, next);
    res.status(200);
    res.emit('finish');

    await vi.waitFor(async () => {
      const raw = await readFile(logPath, 'utf8');
      expect(raw.trim()).not.toBe('');
    });

    const entry = JSON.parse((await readFile(logPath, 'utf8')).trim().split('\n')[0]!);
    expect(entry.agent_id).toBe('memento-agent-a');
  });

  it('writes a JSONL audit line with the expected field contract on finish', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'memento-http-audit-'));
    const logPath = join(tempDir, 'audit.jsonl');

    const middleware = createHttpAuditMiddleware({ logPath });
    const req = {
      baseUrl: '/tools',
      path: '/remember',
      originalUrl: '/tools/remember',
      method: 'POST',
      headers: {
        authorization: 'Bearer test-admin-key',
        'x-agent-id': 'agent-42',
      },
      body: {
        owner_id: 'owner-1',
        content: 'hello',
      },
      programmaticAuth: {
        keyId: 'key-662',
      },
    } as Request;
    const res = createMockResponse();
    const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

    middleware(req, res, next);
    expect(next).toHaveBeenCalledOnce();

    res.status(201);
    res.emit('finish');

    await vi.waitFor(async () => {
      const raw = await readFile(logPath, 'utf8');
      expect(raw.trim()).not.toBe('');
    });

    const raw = await readFile(logPath, 'utf8');
    const entry = JSON.parse(raw.trim()) as HttpAuditEntry;

    expect(entry).toEqual({
      ts: expect.any(String),
      key_id: 'key-662',
      route: '/tools/remember',
      tool: 'remember',
      owner_id: 'owner-1',
      agent_id: 'agent-42',
      latency_ms: expect.any(Number),
      status: 201,
    });
    expect(new Date(entry.ts).toString()).not.toBe('Invalid Date');
  });

  it('adds a metadata-only hash-chain record without storing request content', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'memento-http-audit-'));
    const db = new Database(':memory:');
    db.exec('CREATE TABLE memory_item (id TEXT PRIMARY KEY)');
    await new AuditHashChainMigration().up(db);
    const middleware = createHttpAuditMiddleware({ logPath: join(tempDir, 'audit.jsonl'), database: db });
    const req = {
      baseUrl: '/tools', path: '/remember', originalUrl: '/tools/remember', method: 'POST',
      headers: { authorization: 'Bearer test-admin-key' },
      body: { owner_id: 'owner-1', content: 'must not be audited' },
      programmaticAuth: { keyId: 'key-662' },
    } as Request;
    const res = createMockResponse();

    middleware(req, res, vi.fn());
    res.status(201);
    res.emit('finish');

    await vi.waitFor(() => {
      expect(new AuditHashChainService(db).list()).toHaveLength(1);
    });
    expect(new AuditHashChainService(db).list()[0]).toMatchObject({
      transport: 'mcp_http', action: 'write', evidenceMode: 'metadata_only', toolArgsState: 'omitted',
    });
    expect(JSON.stringify(new AuditHashChainService(db).list())).not.toContain('must not be audited');
    db.close();
  });

  it('skips logging when shouldAudit returns false', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'memento-http-audit-'));
    const logPath = join(tempDir, 'audit.jsonl');

    const middleware = createHttpAuditMiddleware({
      logPath,
      shouldAudit: () => false,
    });
    const req = {
      baseUrl: '/',
      path: '/health',
      originalUrl: '/health',
      headers: {},
    } as Request;
    const res = createMockResponse();
    const next = vi.fn<Parameters<NextFunction>, ReturnType<NextFunction>>();

    middleware(req, res, next);
    res.emit('finish');

    await expect(readFile(logPath, 'utf8')).rejects.toThrow();
  });
});

describe('resolveHttpAuditKeyId', () => {
  it('prefers programmaticAuth.keyId when present', () => {
    const req = {
      headers: { authorization: 'Bearer secret' },
      programmaticAuth: { keyId: 'managed-key' },
    } as Request;

    expect(resolveHttpAuditKeyId(req)).toBe('managed-key');
  });

  it('hashes bearer credentials when programmaticAuth is absent', () => {
    const req = {
      headers: { authorization: 'Bearer secret-token' },
    } as Request;

    expect(resolveHttpAuditKeyId(req)).toHaveLength(12);
    expect(resolveHttpAuditKeyId(req)).not.toBe('legacy-key');
  });

  it('returns legacy-key for non-bearer Authorization headers', () => {
    const req = {
      headers: { authorization: 'Basic abc' },
    } as Request;

    expect(resolveHttpAuditKeyId(req)).toBe('legacy-key');
  });
});

describe('extractHttpAuditToolName', () => {
  it('extracts tool name from mounted /tools routes', () => {
    const req = {
      baseUrl: '/tools',
      path: '/recall',
      originalUrl: '/tools/recall',
    } as Request;

    expect(extractHttpAuditToolName(req)).toBe('recall');
  });
});
