/**
 * #860 — postinstall DB init must use @memento/core, never swallow failures.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
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
});

describe('auto-setup.js postinstall DB path (#860)', () => {
  it('does not invoke packages/ source init.ts via tsx', () => {
    const autoSetup = readFileSync(join(here, '..', 'auto-setup.js'), 'utf8');
    expect(autoSetup).not.toMatch(
      /packages\/memento-core\/src\/infrastructure\/database\/sqlite\/init\.ts/
    );
    expect(autoSetup).not.toMatch(/\bnpx\s+tsx\b/);
  });
});
