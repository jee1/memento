import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  writeServerInfo,
  readServerInfo,
  deleteServerInfo,
  resolveServerInfoConfigDir,
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

  it('resolveServerInfoConfigDir는 명시적 env를 우선 사용한다', () => {
    expect(
      resolveServerInfoConfigDir({
        env: { MEMENTO_CONFIG_DIR: '/custom/config', DOCKER: 'true' },
        homedirPath: '/home/memento',
      })
    ).toBe('/custom/config');
  });

  it('resolveServerInfoConfigDir는 docker 환경에서 /app/.memento를 기본값으로 사용한다', () => {
    expect(
      resolveServerInfoConfigDir({
        env: { DOCKER: 'true' },
        homedirPath: '/home/memento',
      })
    ).toBe('/app/.memento');
  });

  it('resolveServerInfoConfigDir는 일반 환경에서 홈 디렉터리 하위를 사용한다', () => {
    expect(
      resolveServerInfoConfigDir({
        env: {},
        homedirPath: '/Users/tester',
      })
    ).toBe('/Users/tester/.memento');
  });
});
