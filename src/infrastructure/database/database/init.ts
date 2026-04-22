import type Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function loadCoreInitModule() {
  const candidates = [
    join(__dirname, '../../../../packages/memento-core/dist/infrastructure/database/database/init.js'),
    join(__dirname, '../../../../packages/memento-core/src/infrastructure/database/database/init.ts')
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return import(pathToFileURL(candidate).href);
    }
  }

  throw new Error(
    `[memento] @memento/core database init module not found. tried: ${candidates.join(', ')}`
  );
}

const coreInitModule = await loadCoreInitModule();

export const initializeDatabase = coreInitModule.initializeDatabase as (
  overrideDbPath?: string
) => Promise<Database.Database>;

export const closeDatabase = coreInitModule.closeDatabase as (db: Database.Database) => void;

const executedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;

if (executedDirectly) {
  const db = await initializeDatabase();
  closeDatabase(db);
}
