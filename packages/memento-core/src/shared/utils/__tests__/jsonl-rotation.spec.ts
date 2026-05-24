import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { rotateJsonlIfNeeded } from '../jsonl-rotation.js';

describe('rotateJsonlIfNeeded', () => {
  let dir: string;

  afterEach(async () => {
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('does nothing when the file is below maxBytes', async () => {
    dir = join(tmpdir(), `jsonl-rotation-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, 'sample.jsonl');
    await writeFile(filePath, '{"a":1}\n', 'utf8');

    await expect(rotateJsonlIfNeeded(filePath, 1024, 3)).resolves.toBe(false);
    await expect(readFile(filePath, 'utf8')).resolves.toBe('{"a":1}\n');
  });

  it('rotates numbered backups when maxBytes is exceeded', async () => {
    dir = join(tmpdir(), `jsonl-rotation-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const filePath = join(dir, 'sample.jsonl');
    await writeFile(filePath, 'x'.repeat(20), 'utf8');
    await writeFile(`${filePath}.1`, 'first-backup\n', 'utf8');

    await expect(rotateJsonlIfNeeded(filePath, 10, 2)).resolves.toBe(true);
    await expect(stat(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(`${filePath}.1`, 'utf8')).resolves.toBe('x'.repeat(20));
    await expect(readFile(`${filePath}.2`, 'utf8')).resolves.toBe('first-backup\n');
  });
});
