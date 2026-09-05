/**
 * #860 — postinstall DB init: published → @memento/core (fail hard);
 * monorepo → tsx packages/.../init.ts (dist may be missing during npm ci).
 */
import { describe, it, expect, vi } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

describe('runPostinstallDbInit (#860)', () => {
  it('calls initializeDatabase then closeDatabase via injectable loader', async () => {
    const { runPostinstallDbInit } = await import('./postinstall-db-init.js');
    const closeDatabase = vi.fn();
    const initializeDatabase = vi.fn().mockResolvedValue({ id: 'db' });

    await runPostinstallDbInit({
      dbPath: ':memory:',
      loadCore: async () => ({ initializeDatabase, closeDatabase }),
    });

    expect(initializeDatabase).toHaveBeenCalledWith(':memory:');
    expect(closeDatabase).toHaveBeenCalledWith({ id: 'db' });
  });

  it('propagates initializeDatabase failures (no swallow)', async () => {
    const { runPostinstallDbInit } = await import('./postinstall-db-init.js');
    const closeDatabase = vi.fn();

    await expect(
      runPostinstallDbInit({
        loadCore: async () => ({
          initializeDatabase: async () => {
            throw new Error('init-failed');
          },
          closeDatabase,
        }),
      })
    ).rejects.toThrow('init-failed');

    expect(closeDatabase).not.toHaveBeenCalled();
  });

  it('uses monorepo tsx path when packages/.../init.ts exists', async () => {
    const { runPostinstallDbInit, isMonorepoCheckout } = await import(
      './postinstall-db-init.js'
    );
    const root = mkdtempSync(join(tmpdir(), 'memento-mono-'));
    const initRel = join(
      'packages',
      'memento-core',
      'src',
      'infrastructure',
      'database',
      'sqlite'
    );
    mkdirSync(join(root, initRel), { recursive: true });
    writeFileSync(join(root, initRel, 'init.ts'), '// stub');
    expect(isMonorepoCheckout(root)).toBe(true);

    const runMonorepoInit = vi.fn();
    await runPostinstallDbInit({ projectRoot: root, runMonorepoInit });
    expect(runMonorepoInit).toHaveBeenCalledWith(root);
  });

  it('uses @memento/core when packages/ source is absent (published layout)', async () => {
    const { runPostinstallDbInit, isMonorepoCheckout } = await import(
      './postinstall-db-init.js'
    );
    const root = mkdtempSync(join(tmpdir(), 'memento-pkg-'));
    expect(isMonorepoCheckout(root)).toBe(false);

    const closeDatabase = vi.fn();
    const initializeDatabase = vi.fn().mockResolvedValue({ id: 'db' });
    // loadCore forces published path even if cwd is a monorepo — also covers absent packages/
    await runPostinstallDbInit({
      projectRoot: root,
      loadCore: async () => ({ initializeDatabase, closeDatabase }),
    });
    expect(initializeDatabase).toHaveBeenCalled();
  });
});

describe('auto-setup.js postinstall DB path (#860)', () => {
  it('does not hardcode packages/ init.ts or npx tsx (helper owns the branch)', () => {
    const autoSetup = readFileSync(join(here, '..', 'auto-setup.js'), 'utf8');
    expect(autoSetup).not.toMatch(
      /packages\/memento-core\/src\/infrastructure\/database\/sqlite\/init\.ts/
    );
    expect(autoSetup).not.toMatch(/\bnpx\s+tsx\b/);
    expect(autoSetup).toMatch(/runPostinstallDbInit/);
  });
});
