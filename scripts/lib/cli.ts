import Database from 'better-sqlite3';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs as parseNodeArgs, type ParseArgsConfig } from 'node:util';

export type CliDatabase = Database.Database;

export function parseArgs(config: ParseArgsConfig = {}) {
  const args = [...(config.args ?? process.argv.slice(2))];
  return {
    ...parseNodeArgs({
      ...config,
      args,
      allowPositionals: config.allowPositionals ?? true,
      strict: config.strict ?? false,
    }),
    args,
  };
}

export function openDb(
  filename: string | Buffer = ':memory:',
  options?: Database.Options,
): Database.Database {
  return new Database(filename, options);
}

export function isMain(moduleUrl: string): boolean {
  const entrypoint = process.argv[1];
  return entrypoint !== undefined && resolve(entrypoint) === fileURLToPath(moduleUrl);
}
