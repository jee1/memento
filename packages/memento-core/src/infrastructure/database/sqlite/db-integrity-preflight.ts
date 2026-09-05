import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
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

/**
 * 격리 스냅샷 보존 개수 (#849). 초과분은 오래된 것부터 지운다.
 */
const QUARANTINE_RETENTION_COUNT = 5;

function hashFile(path: string): string | null {
  try {
    return createHash('sha256').update(fs.readFileSync(path)).digest('hex');
  } catch {
    return null;
  }
}

function listQuarantineSnapshots(
  dbPath: string
): Array<{ path: string; size: number; mtimeMs: number }> {
  const quarantineDir = join(dirname(dbPath), 'quarantine');
  if (!fs.existsSync(quarantineDir)) {
    return [];
  }
  const ext = extname(dbPath) || '.db';
  const prefix = `${basename(dbPath, extname(dbPath) || undefined)}-corrupt-`;
  const found: Array<{ path: string; size: number; mtimeMs: number }> = [];

  let entries: string[];
  try {
    entries = fs.readdirSync(quarantineDir);
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.startsWith(prefix) || !entry.endsWith(ext)) {
      continue;
    }
    const fullPath = join(quarantineDir, entry);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isFile()) {
        found.push({ path: fullPath, size: stat.size, mtimeMs: stat.mtimeMs });
      }
    } catch {
      continue;
    }
  }

  return found.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/**
 * 이미 같은 내용이 격리돼 있으면 그 경로를 돌려준다 (#849).
 *
 * 기존 구현은 15분 창 안에서만 중복을 걸렀는데, 손상 DB 재시도가 그 간격을 넘기면
 * 같은 파일이 계속 새로 쌓였다. 실측(2026-09-05)에서 39개 중 고유 파일은 2종뿐이었고
 * 68.7MB짜리가 29벌 남아 3.2GB를 차지했다. 시간 대신 내용 해시로 판정한다.
 */
function findDuplicateQuarantineSnapshot(dbPath: string): string | null {
  let sourceStat: fs.Stats;
  try {
    sourceStat = fs.statSync(dbPath);
  } catch {
    return null;
  }

  // 해시는 크기가 같은 후보에만 계산한다.
  const sameSize = listQuarantineSnapshots(dbPath).filter(
    entry => entry.size === sourceStat.size
  );
  if (sameSize.length === 0) {
    return null;
  }

  const sourceHash = hashFile(dbPath);
  if (sourceHash === null) {
    return null;
  }

  for (const candidate of sameSize) {
    if (hashFile(candidate.path) === sourceHash) {
      return candidate.path;
    }
  }

  return null;
}

/** 보존 개수를 넘긴 오래된 격리 스냅샷을 지운다 (#849). */
function pruneQuarantineSnapshots(dbPath: string, keepCount: number): void {
  if (keepCount <= 0) {
    return;
  }
  for (const stale of listQuarantineSnapshots(dbPath).slice(keepCount)) {
    try {
      fs.unlinkSync(stale.path);
    } catch (error) {
      logger.warn('격리 스냅샷 정리 실패', {
        path: PIIMasker.mask(stale.path).masked,
        error: maskError(error).message,
      });
    }
  }
}

function quarantineDatabaseFile(dbPath: string, now: Date): string {
  const existing = findDuplicateQuarantineSnapshot(dbPath);
  if (existing) {
    return existing;
  }
  const quarantinePath = buildQuarantinePath(dbPath, now);
  fs.mkdirSync(dirname(quarantinePath), { recursive: true });
  fs.copyFileSync(dbPath, quarantinePath);
  pruneQuarantineSnapshots(dbPath, QUARANTINE_RETENTION_COUNT);
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
