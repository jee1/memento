import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushUsageAggregator } from '@memento/core';
import { mcpLogger } from './mcp-logger.js';
import { countConnectionSignal, resetUsageRecordingForTests } from './usage-recording.js';
import { cleanupTestDatabase, setupTestDatabase, type TestDatabaseContext } from './test/helpers/test-database.js';

describe('usage-recording: 목록 밖 클라이언트 이름 로그 (#1768)', () => {
  let ctx: TestDatabaseContext;
  let info: ReturnType<typeof vi.spyOn>;

  const connect = (clientName: unknown) =>
    countConnectionSignal(ctx.db, { connectionMethod: 'stdio', era: 'modern', clientName, clientVersion: '1.0.0' }, 'tools/list');
  const logged = () => info.mock.calls.filter((c) => String(c[1]).includes('client_name_unrecognized')).map((c) => String(c[1]));

  beforeEach(async () => {
    resetUsageRecordingForTests();
    ctx = await setupTestDatabase();
    info = vi.spyOn(mcpLogger, 'logServer').mockImplementation(() => undefined);
  });

  afterEach(async () => {
    flushUsageAggregator(ctx.db);
    vi.restoreAllMocks();
    await cleanupTestDatabase(ctx);
  });

  it('영문자와 하이픈만 있는 20자 이하 이름은 로그에 남기고, 토큰·경로·긴 값은 이름 없이 길이만 남긴다', () => {
    const token = 'sk-live-abcdef0123456789';
    const path = '/home/jee1lee/secret-project';
    const longName = 'x'.repeat(60);

    connect('Brand-New-Client');
    connect(token);
    connect(path);
    connect(longName);

    const lines = logged();
    expect(lines).toContain('client_name_unrecognized brand-new-client');
    const everything = lines.join('\n');
    for (const secret of [token, path, longName, 'secret', 'abcdef']) expect(everything).not.toContain(secret);
    // 남길 수 없는 이름은 값 대신 한 번만 알린다(길이만).
    const unloggable = lines.filter((l) => l.includes('이름은 남기지 않음'));
    expect(unloggable).toHaveLength(1);
    expect(unloggable[0]).toMatch(/길이 \d+/);
  });

  it('같은 이름은 한 번만 남긴다', () => {
    connect('zed-editor');
    connect('zed-editor');
    connect('ZED-EDITOR');
    expect(logged().filter((l) => l.includes('zed-editor'))).toHaveLength(1);
  });

  it('알려진 이름과 정보가 없는 연결은 로그를 남기지 않는다', () => {
    connect('claude-code');
    connect(undefined);
    expect(logged()).toEqual([]);
  });
});
