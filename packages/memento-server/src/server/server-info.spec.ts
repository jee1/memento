import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  writeServerInfo,
  readServerInfo,
  deleteServerInfo,
} from './server-info.js';

describe('server-info', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'memento-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('writeServerInfo는 server.json을 생성한다', async () => {
    await writeServerInfo(tmpDir, 51764);
    const info = await readServerInfo(tmpDir);
    expect(info).not.toBeNull();
    expect(info!.port).toBe(51764);
    expect(info!.pid).toBe(process.pid);
    expect(info!.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('readServerInfo는 파일이 없으면 null을 반환한다', async () => {
    const info = await readServerInfo(tmpDir);
    expect(info).toBeNull();
  });

  it('deleteServerInfo는 server.json을 삭제한다', async () => {
    await writeServerInfo(tmpDir, 51764);
    await deleteServerInfo(tmpDir);
    const info = await readServerInfo(tmpDir);
    expect(info).toBeNull();
  });

  it('deleteServerInfo는 파일이 없어도 에러를 던지지 않는다', async () => {
    await expect(deleteServerInfo(tmpDir)).resolves.not.toThrow();
  });
});
