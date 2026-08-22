import Database from 'better-sqlite3';
import fs from 'fs';
import { basename, dirname, extname, join } from 'path';
import { PIIMasker } from '../../../shared/utils/pii-masker.js';
import { logger } from '../../../shared/utils/logger.js';

const CORRUPTION_SIGNAL_PATTERNS = [
  'malformed',
  'not a database',
  'database disk image is malformed',
  'file is not a database',
  'file is encrypted',
  'file is encrypted or is not a database',
];

function shouldSkipPreflight(dbPath: string): boolean {
  return dbPath === ':memory:' || dbPath.startsWith('file:') || !fs.existsSync(dbPath);
}

function extractPragmaMessages(rows: Array<Record<string, unknown>>): string[] {
  return rows
    .map((row) => Object.values(row)[0])
    .filter((value): value is string => typeof value === 'string');
}

function runCheck(db: Database.Database, pragmaName: 'quick_check' | 'integrity_check'): string[] {
  const rows = db.prepare(`PRAGMA ${pragmaName}`).all() as Array<Record<string, unknown>>;
  return extractPragmaMessages(rows);
}

function formatTimestamp(date: Date): string {
  return date.toISOString().replace(/[:.]/g, '-');
}

function buildQuarantinePath(dbPath: string, now: Date): string {
  const dbDir = dirname(dbPath);
  const quarantineDir = join(dbDir, 'quarantine');
  const ext = extname(dbPath);
  const baseName = basename(dbPath, ext || undefined);
  return join(quarantineDir, `${baseName}-corrupt-${formatTimestamp(now)}${ext || '.db'}`);
}

const QUARANTINE_DEDUP_WINDOW_MS = 15 * 60 * 1000;

function findRecentQuarantineSnapshot(dbPath: string, now: Date): string | null {
  const quarantineDir = join(dirname(dbPath), 'quarantine');
  if (!fs.existsSync(quarantineDir)) {
    return null;
  }
  let sourceStat: fs.Stats;
  try {
    sourceStat = fs.statSync(dbPath);
  } catch {
    return null;
  }
  const baseName = basename(dbPath, extname(dbPath) || undefined);
  const prefix = `${baseName}-corrupt-`;
  const entries = fs.readdirSync(quarantineDir);
  let newest: { path: string; mtimeMs: number } | null = null;
  for (const entry of entries) {
    if (!entry.startsWith(prefix) || !entry.endsWith(extname(dbPath) || '.db')) {
      continue;
    }
    const fullPath = join(quarantineDir, entry);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(fullPath);
    } catch {
      continue;
    }
    if (stat.size !== sourceStat.size) {
      continue;
    }
    if (now.getTime() - stat.mtimeMs > QUARANTINE_DEDUP_WINDOW_MS) {
      continue;
    }
    if (!newest || stat.mtimeMs > newest.mtimeMs) {
      newest = { path: fullPath, mtimeMs: stat.mtimeMs };
    }
  }
  return newest?.path ?? null;
}

function quarantineDatabaseFile(dbPath: string, now: Date): string {
  const existing = findRecentQuarantineSnapshot(dbPath, now);
  if (existing) {
    return existing;
  }
  const quarantinePath = buildQuarantinePath(dbPath, now);
  fs.mkdirSync(dirname(quarantinePath), { recursive: true });
  fs.copyFileSync(dbPath, quarantinePath);
  return quarantinePath;
}

function maskError(error: unknown): { message: string; name: string } {
  return error instanceof Error
    ? PIIMasker.maskError(error)
    : { message: String(error), name: 'Error' };
}

function isOkResult(messages: string[]): boolean {
  return messages.length === 1 && messages[0] === 'ok';
}

function looksLikeCorruption(messages: string[]): boolean {
  const combined = messages.join(' ').toLowerCase();
  return CORRUPTION_SIGNAL_PATTERNS.some((pattern) => combined.includes(pattern));
}

export function runDatabaseIntegrityPreflight(dbPath: string, now: Date = new Date()): void {
  if (shouldSkipPreflight(dbPath)) {
    return;
  }

  let quickCheckMessages: string[] = [];
  let integrityCheckMessages: string[] = [];
  let quickCheckErrored = false;
  let integrityCheckErrored = false;

  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      quickCheckMessages = runCheck(db, 'quick_check');
    } finally {
      db.close();
    }
  } catch (error) {
    const maskedError = maskError(error);
    quickCheckErrored = true;
    quickCheckMessages = [`quick_check execution failed: ${maskedError.message}`];
  }

  if (!quickCheckErrored && isOkResult(quickCheckMessages)) {
    return;
  }

  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      integrityCheckMessages = runCheck(db, 'integrity_check');
    } finally {
      db.close();
    }
  } catch (error) {
    const maskedError = maskError(error);
    integrityCheckErrored = true;
    integrityCheckMessages = [`integrity_check execution failed: ${maskedError.message}`];
  }

  const detectedCorruption =
    (!quickCheckErrored && !isOkResult(quickCheckMessages)) ||
    (!integrityCheckErrored && integrityCheckMessages.length > 0 && !isOkResult(integrityCheckMessages)) ||
    looksLikeCorruption(quickCheckMessages) ||
    looksLikeCorruption(integrityCheckMessages);

  if (!detectedCorruption) {
    logger.error('❌ DB integrity preflight could not verify database accessibility', {
      dbPath,
      quickCheckMessages,
      integrityCheckMessages,
    });
    throw new Error(`데이터베이스 사전 검사 실패: ${quickCheckMessages.join('; ')}`);
  }

  let quarantinePath: string | null = null;
  try {
    quarantinePath = quarantineDatabaseFile(dbPath, now);
  } catch (error) {
    const maskedError = maskError(error);
    logger.error('❌ DB quarantine snapshot 생성 실패', {
      dbPath,
      error: maskedError.message,
      errorName: maskedError.name,
    });
    throw new Error(`데이터베이스 무결성 사전 검사 실패 및 quarantine 복사 실패: ${maskedError.message}`);
  }

  logger.error('❌ DB integrity preflight failed; startup aborted', {
    dbPath,
    quarantinePath,
    quickCheckMessages,
    integrityCheckMessages,
  });

  throw new Error(
    `데이터베이스 무결성 사전 검사 실패: ${quickCheckMessages.join('; ')} | quarantine=${quarantinePath}`
  );
}
