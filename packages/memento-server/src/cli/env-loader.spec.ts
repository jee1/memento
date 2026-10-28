import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { loadEnv } from './env-loader.js';

const ENDPOINT = 'MEMENTO_ENDPOINT';

describe('loadEnv', () => {
  const created: string[] = [];
  const cwd = process.cwd();
  const saved = {
    [ENDPOINT]: process.env[ENDPOINT],
    MEMENTO_CONFIG_DIR: process.env.MEMENTO_CONFIG_DIR,
    NODE_ENV: process.env.NODE_ENV,
    HOME: process.env.HOME,
  };

  afterEach(async () => {
    process.chdir(cwd);
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function tempDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix));
    created.push(dir);
    return dir;
  }

  function isolateHome(home: string): void {
    delete process.env[ENDPOINT];
    delete process.env.MEMENTO_CONFIG_DIR;
    process.env.NODE_ENV = 'production';
    process.env.HOME = home;
  }

  it('does not load a cwd .env on the default search', async () => {
    const work = await tempDir('memento-env-cwd-');
    const home = await tempDir('memento-env-home-');
    await writeFile(join(work, '.env'), `${ENDPOINT}=https://remote.example\n`);
    process.chdir(work);
    isolateHome(home);

    loadEnv();

    expect(process.env[ENDPOINT]).toBeUndefined();
  });

  it('loads ~/.memento/.env and ignores a cwd .env on the default search', async () => {
    const work = await tempDir('memento-env-cwd-');
    const home = await tempDir('memento-env-home-');
    await writeFile(join(work, '.env'), `${ENDPOINT}=https://remote.example\n`);
    await mkdir(join(home, '.memento'));
    await writeFile(join(home, '.memento', '.env'), `${ENDPOINT}=http://127.0.0.1:9\n`);
    process.chdir(work);
    isolateHome(home);

    loadEnv();

    expect(process.env[ENDPOINT]).toBe('http://127.0.0.1:9');
  });

  it('loads an explicit env file', async () => {
    const work = await tempDir('memento-env-file-');
    const file = join(work, '.env');
    await writeFile(file, `${ENDPOINT}=https://remote.example\n`);
    delete process.env[ENDPOINT];

    loadEnv({ envFile: file });

    expect(process.env[ENDPOINT]).toBe('https://remote.example');
  });

  it('loads --config-dir .env instead of a cwd .env', async () => {
    const work = await tempDir('memento-env-cwd-');
    const configDir = await tempDir('memento-env-cfg-');
    await writeFile(join(work, '.env'), `${ENDPOINT}=https://remote.example\n`);
    await writeFile(join(configDir, '.env'), `${ENDPOINT}=http://127.0.0.1:9\n`);
    process.chdir(work);
    delete process.env[ENDPOINT];
    delete process.env.MEMENTO_CONFIG_DIR;
    process.env.NODE_ENV = 'production';

    loadEnv({ configDir });

    expect(process.env[ENDPOINT]).toBe('http://127.0.0.1:9');
  });

  it('hook and CLI loadEnv follow MEMENTO_CONFIG_DIR and skip a cwd .env', async () => {
    const work = await tempDir('memento-env-cwd-');
    const configDir = await tempDir('memento-env-cfg-');
    await writeFile(join(work, '.env'), `${ENDPOINT}=https://remote.example\n`);
    await writeFile(join(configDir, '.env'), `${ENDPOINT}=http://127.0.0.1:9\n`);
    process.chdir(work);
    delete process.env[ENDPOINT];
    process.env.MEMENTO_CONFIG_DIR = configDir;
    process.env.NODE_ENV = 'production';

    loadEnv();

    expect(process.env[ENDPOINT]).toBe('http://127.0.0.1:9');
  });
});
