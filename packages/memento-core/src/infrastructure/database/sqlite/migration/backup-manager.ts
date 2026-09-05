/**
 * 백업 관리자
 * 
 * 마이그레이션 전 자동 백업 생성 및 복원 기능을 제공합니다.
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, join } from 'path';
import { mementoConfig } from '../../../../shared/config/index.js';
import { DAY_MS } from '../../../../shared/utils/date.js';
import { PIIMasker } from '../../../../shared/utils/pii-masker.js';
import { logger } from '../../../../shared/utils/logger.js';

type BackupCapableDatabase = Database.Database & {
  name?: string;
};

function isInMemoryDatabase(db: BackupCapableDatabase): boolean {
  return db.name === ':memory:';
}

/**
 * 백업 생성 결과
 */
export interface BackupResult {
  /**
   * 백업 파일 경로
   */
  backupPath: string;

  /**
   * 백업 생성 시간
   */
  timestamp: Date;

  /**
   * 백업 파일 크기 (bytes)
   */
  size: number;

  expectedSize: number;

  totalPages: number;

  integrityCheck: 'ok';
}

export type CleanupMode = 'preview' | 'apply';

export type CleanupSelectionReason =
  | 'expired-automatic'
  | 'surplus-automatic'
  | 'zero-byte-backup'
  | 'orphaned-sidecar'
  | 'interrupted-attempt';

export type CleanupStatus = 'selected' | 'deleted' | 'skipped' | 'failed';

export type CleanupDetail =
  | 'inspect-failed'
  | 'missing-before-delete'
  | 'changed-before-delete'
  | 'delete-failed'
  | null;

export interface CleanupArtifactOutcome {
  id: string;
  status: CleanupStatus;
  reason: CleanupSelectionReason;
  detail: CleanupDetail;
}

export interface CleanupReport {
  ok: boolean;
  error: 'scan-failed' | null;
  mode: CleanupMode;
  inspectedCount: number;
  selectedCount: number;
  selectedBytes: number;
  deletedCount: number;
  reclaimedBytes: number;
  skippedCount: number;
  failedCount: number;
  ignoredCount: number;
  artifacts: CleanupArtifactOutcome[];
}

export interface CleanupOptions {
  mode?: CleanupMode;
  now?: Date;
  includeInterrupted?: boolean;
  /**
   * 자동 백업 보존 개수. 미지정 시 AUTOMATIC_RETENTION_COUNT.
   * 0 이하를 주면 개수 상한을 적용하지 않는다(기간 기준만 사용).
   */
  keepCount?: number;
}

interface FileIdentity {
  dev: bigint | number;
  ino: bigint | number;
  mode: number;
  size: number;
  mtimeMs: number;
}

interface CleanupCandidate {
  path: string;
  outcome: CleanupArtifactOutcome;
  identity: FileIdentity | null;
  selectedBytes: number;
}

/** 자동 백업 보존 기간 (일) */
const AUTOMATIC_RETENTION_DAYS = 30;

/**
 * 자동 백업 보존 개수 상한 (#849).
 *
 * 기간 단독 기준은 생성 속도가 높으면 무력해진다. 실측(2026-09-05)에서 자동 백업이
 * 762개/일 생성돼 30일 보존만으로는 약 23,000개가 상시 잔류했고, 쌓인 18,292개
 * 전부가 보존 기간 이내라 한 건도 선별되지 않았다. 기간 기준과 OR 로 개수 상한을
 * 함께 적용해 디렉터리 크기를 생성 속도와 무관하게 묶는다.
 *
 * 마이그레이션 1회 실행은 버전 수만큼(현재 약 40개) 백업을 만들므로, 200개는
 * 최근 5회분에 해당한다.
 */
const AUTOMATIC_RETENTION_COUNT = 200;

const TIMESTAMP_PATTERN = /(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/;
const AUTOMATIC_NAME = new RegExp(
  `^memory-backup-(\\d+(?:\\.\\d+)+)-${TIMESTAMP_PATTERN.source}\\.db$`
);
const OPERATOR_NAME = new RegExp(`^memory-backup-${TIMESTAMP_PATTERN.source}\\.db$`);
const IN_PROGRESS_NAME = /^\.memory-backup-partial-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.db$/;

function parseBackupTimestamp(match: RegExpMatchArray, startIndex: number): number | null {
  const timestamp = `${match[startIndex]}T${match[startIndex + 1]}:${match[startIndex + 2]}:${match[startIndex + 3]}.${match[startIndex + 4]}Z`;
  const parsed = new Date(timestamp);

  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    return null;
  }

  return parsed.getTime();
}

function isOperatorBackupName(name: string): boolean {
  const match = name.match(OPERATOR_NAME);
  return match !== null && parseBackupTimestamp(match, 1) !== null;
}

function getAutomaticBackupCreatedAt(name: string): number | null {
  const match = name.match(AUTOMATIC_NAME);

  return match ? parseBackupTimestamp(match, 2) : null;
}

function isCompletedBackupName(name: string): boolean {
  return getAutomaticBackupCreatedAt(name) !== null || isOperatorBackupName(name);
}

function getSidecarBaseName(name: string): string | null {
  if (name.endsWith('-wal') || name.endsWith('-shm')) {
    return name.slice(0, -4);
  }

  return null;
}

/**
 * 개수 상한을 넘긴 자동 백업 이름 집합을 만든다 (#849).
 * 최신순으로 keepCount개를 남기고 나머지를 반환한다.
 * 운영자 백업(버전 없는 이름)은 대상이 아니다.
 */
function selectSurplusAutomaticNames(names: string[], keepCount: number): Set<string> {
  if (keepCount <= 0) {
    return new Set();
  }

  const automatic = names
    .flatMap(name => {
      const createdAt = getAutomaticBackupCreatedAt(name);
      return createdAt === null ? [] : [{ name, createdAt }];
    })
    // 최신순. 타임스탬프가 같으면 이름으로 안정 정렬해 실행마다 결과가 흔들리지 않게 한다.
    .sort((a, b) => (b.createdAt - a.createdAt) || a.name.localeCompare(b.name));

  return new Set(automatic.slice(keepCount).map(entry => entry.name));
}

function classifyNameSelection(
  name: string,
  cutoff: number,
  includeInterrupted: boolean,
  surplusNames: Set<string>
): CleanupSelectionReason | null {
  const sidecarBase = getSidecarBaseName(name);

  if (
    sidecarBase !== null &&
    (isCompletedBackupName(sidecarBase) ||
      (includeInterrupted && IN_PROGRESS_NAME.test(sidecarBase)))
  ) {
    return 'orphaned-sidecar';
  }

  const createdAt = getAutomaticBackupCreatedAt(name);

  if (createdAt !== null && createdAt < cutoff) {
    return 'expired-automatic';
  }

  if (createdAt !== null && surplusNames.has(name)) {
    return 'surplus-automatic';
  }

  if (createdAt !== null || isOperatorBackupName(name)) {
    return null;
  }

  if (includeInterrupted && IN_PROGRESS_NAME.test(name)) {
    return 'interrupted-attempt';
  }

  return null;
}

function classifyInspectedSelection(
  name: string,
  stats: fs.Stats,
  cutoff: number,
  includeInterrupted: boolean,
  surplusNames: Set<string>
): CleanupSelectionReason | null {
  if (!stats.isFile()) {
    return null;
  }

  if (stats.size === 0 && isCompletedBackupName(name)) {
    return 'zero-byte-backup';
  }

  return classifyNameSelection(name, cutoff, includeInterrupted, surplusNames);
}

function getIdentity(stats: fs.Stats): FileIdentity {
  return {
    dev: stats.dev,
    ino: stats.ino,
    mode: stats.mode,
    size: stats.size,
    mtimeMs: stats.mtimeMs,
  };
}

function sameIdentity(before: FileIdentity, after: FileIdentity): boolean {
  return before.dev === after.dev &&
    before.ino === after.ino &&
    before.mode === after.mode &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs;
}

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

function hasFsCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function backupFailure(reason: string, residue: string[] = []): Error {
  return new Error(residue.length === 0 ? reason : `${reason} residue=${residue.join(',')}`);
}

function normalizeBackupFailure(error: unknown, residue: string[]): Error {
  if (!(error instanceof Error)) {
    return backupFailure('backup-failed', residue);
  }

  if (error.message.includes('residue=')) {
    return error;
  }

  if (
    error.message.startsWith('backup-') ||
    error.message.startsWith('메모리 데이터베이스') ||
    error.message.startsWith('백업할 데이터베이스')
  ) {
    return backupFailure(error.message, residue);
  }

  return backupFailure('backup-failed', residue);
}

function removeArtifacts(paths: string[]): string[] {
  const remaining: string[] = [];
  const seen = new Set<string>();

  for (const candidate of paths) {
    if (seen.has(candidate)) {
      continue;
    }
    seen.add(candidate);

    try {
      fs.unlinkSync(candidate);
    } catch (error) {
      if (!isEnoent(error)) {
        remaining.push(basename(candidate));
      }
    }
  }

  return remaining;
}

function attemptArtifactPaths(inProgressPath: string): string[] {
  return [inProgressPath, `${inProgressPath}-wal`, `${inProgressPath}-shm`];
}

function removeAttemptArtifacts(inProgressPath: string): string[] {
  return removeArtifacts(attemptArtifactPaths(inProgressPath));
}

function removeAttemptSidecars(inProgressPath: string): boolean {
  return removeArtifacts([`${inProgressPath}-wal`, `${inProgressPath}-shm`]).length === 0;
}

/** Best-effort: drop leftover strict in-progress names (+ -wal/-shm) before a new attempt (FR-018). */
function removeStaleInProgressArtifacts(backupsDir: string): void {
  let names: string[];
  try {
    names = fs.readdirSync(backupsDir);
  } catch {
    return;
  }

  const bases = new Set<string>();
  for (const name of names) {
    if (IN_PROGRESS_NAME.test(name)) {
      bases.add(name);
      continue;
    }
    const sidecarBase = getSidecarBaseName(name);
    if (sidecarBase !== null && IN_PROGRESS_NAME.test(sidecarBase)) {
      bases.add(sidecarBase);
    }
  }

  for (const base of bases) {
    removeAttemptArtifacts(join(backupsDir, base));
  }
}

function emptyCleanupReport(mode: CleanupMode, error: CleanupReport['error']): CleanupReport {
  return {
    ok: error === null,
    error,
    mode,
    inspectedCount: 0,
    selectedCount: 0,
    selectedBytes: 0,
    deletedCount: 0,
    reclaimedBytes: 0,
    skippedCount: 0,
    failedCount: 0,
    ignoredCount: 0,
    artifacts: [],
  };
}

function buildCleanupReport(
  mode: CleanupMode,
  inspectedCount: number,
  candidates: CleanupCandidate[],
  reclaimedBytes: number
): CleanupReport {
  const artifacts = candidates.map(candidate => candidate.outcome);
  const failedCount = artifacts.filter(artifact => artifact.status === 'failed').length;
  const skippedCount = artifacts.filter(artifact => artifact.status === 'skipped').length;

  return {
    ...emptyCleanupReport(mode, null),
    ok: failedCount === 0 && skippedCount === 0,
    inspectedCount,
    selectedCount: artifacts.length,
    selectedBytes: candidates.reduce((total, candidate) => total + candidate.selectedBytes, 0),
    deletedCount: artifacts.filter(artifact => artifact.status === 'deleted').length,
    reclaimedBytes,
    skippedCount,
    failedCount,
    ignoredCount: inspectedCount - artifacts.length,
    artifacts,
  };
}

/**
 * 백업 관리자
 */
export class BackupManager {
  private backupsDir: string;

  constructor(backupsDir?: string) {
    // 기본 백업 디렉토리: data/backups
    const dbDir = dirname(mementoConfig.dbPath);
    this.backupsDir = backupsDir || join(dbDir, 'backups');
    this.ensureBackupsDirectory();
  }

  /**
   * 백업 디렉토리 생성
   */
  private ensureBackupsDirectory(): void {
    try {
      if (!fs.existsSync(this.backupsDir)) {
        fs.mkdirSync(this.backupsDir, { recursive: true });
      }
    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      logger.error('❌ 백업 디렉토리 생성 실패', {
        error: maskedError.message,
        errorName: maskedError.name
      });
      throw error;
    }
  }

  /**
   * 데이터베이스 백업 생성
   */
  async createBackup(db: Database.Database, migrationVersion?: string): Promise<BackupResult> {
    const timestamp = new Date();
    const timestampStr = timestamp.toISOString().replace(/[:.]/g, '-');
    const backupFileName = migrationVersion
      ? `memory-backup-${migrationVersion}-${timestampStr}.db`
      : `memory-backup-${timestampStr}.db`;
    const backupPath = join(this.backupsDir, backupFileName);
    const inProgressPath = join(this.backupsDir, `.memory-backup-partial-${randomUUID()}.db`);

    try {
      // 데이터베이스 파일 경로 가져오기
      const backupDb = db as BackupCapableDatabase;
      if (isInMemoryDatabase(backupDb)) {
        throw new Error('메모리 데이터베이스는 파일 백업을 지원하지 않습니다');
      }

      if (!backupDb.name || !fs.existsSync(backupDb.name)) {
        throw new Error('백업할 데이터베이스 파일을 찾을 수 없습니다');
      }

      removeStaleInProgressArtifacts(this.backupsDir);

      const sourcePageSize = backupDb.pragma('page_size', { simple: true }) as number;
      let metadata: Awaited<ReturnType<BackupCapableDatabase['backup']>>;
      try {
        metadata = await backupDb.backup(inProgressPath);
      } catch {
        throw backupFailure('backup-write-failed');
      }
      if (metadata.remainingPages !== 0) {
        throw backupFailure('backup-incomplete');
      }

      const verify = new Database(inProgressPath);
      let totalPages: number;
      try {
        const checkpointRows = verify.pragma('wal_checkpoint(TRUNCATE)') as Array<{
          busy: number;
          log: number;
          checkpointed: number;
        }>;
        const checkpoint = checkpointRows[0];
        if (!checkpoint) {
          throw backupFailure('backup-checkpoint-incomplete');
        }
        if (checkpoint.busy !== 0 || checkpoint.log !== checkpoint.checkpointed) {
          throw backupFailure('backup-checkpoint-incomplete');
        }

        try {
          verify.pragma('journal_mode = DELETE');
          const journalMode = verify.pragma('journal_mode', { simple: true }) as string;
          totalPages = verify.pragma('page_count', { simple: true }) as number;
          const pageSize = verify.pragma('page_size', { simple: true }) as number;
          const integrity = verify.pragma('integrity_check') as Array<{ integrity_check: string }>;

          if (
            journalMode !== 'delete' ||
            totalPages !== metadata.totalPages ||
            pageSize !== sourcePageSize ||
            integrity.length !== 1 ||
            integrity[0]?.integrity_check !== 'ok'
          ) {
            throw backupFailure('backup-validation-failed');
          }
        } catch (error) {
          if (error instanceof Error && error.message.startsWith('backup-')) {
            throw error;
          }
          throw backupFailure('backup-validation-failed');
        }
      } finally {
        verify.close();
      }

      if (!removeAttemptSidecars(inProgressPath)) {
        throw backupFailure('backup-sidecar-cleanup-failed');
      }

      const expectedSize = metadata.totalPages * sourcePageSize;
      const stats = fs.statSync(inProgressPath);
      const size = stats.size;
      if (size === 0 || size !== expectedSize) {
        throw backupFailure('backup-size-mismatch');
      }

      let fd: number | null = null;
      try {
        fd = fs.openSync(inProgressPath, 'r');
        fs.fsyncSync(fd);
      } catch {
        throw backupFailure('backup-fsync-failed');
      } finally {
        if (fd !== null) {
          fs.closeSync(fd);
        }
      }

      try {
        fs.linkSync(inProgressPath, backupPath);
      } catch (error) {
        throw backupFailure(hasFsCode(error, 'EEXIST') ? 'backup-collision' : 'backup-publication-failed');
      }

      try {
        fs.unlinkSync(inProgressPath);
      } catch {
        const residue = removeArtifacts([
          ...attemptArtifactPaths(inProgressPath),
          ...attemptArtifactPaths(backupPath),
        ]);
        throw backupFailure('backup-post-link-cleanup-failed', residue);
      }

      logger.info('✅ 백업 생성 완료', {
        backupPath,
        sizeMB: (size / 1024 / 1024).toFixed(2)
      });

      return {
        backupPath,
        timestamp,
        size,
        expectedSize,
        totalPages,
        integrityCheck: 'ok',
      };
    } catch (error) {
      const safeError = normalizeBackupFailure(error, removeAttemptArtifacts(inProgressPath));
      const maskedError = PIIMasker.maskError(safeError);
      logger.error('❌ 백업 생성 실패', {
        error: maskedError.message,
        errorName: maskedError.name
      });
      throw safeError;
    }
  }

  /**
   * 백업 복원
   */
  async restoreBackup(backupPath: string, targetDbPath: string): Promise<void> {
    try {
      if (!fs.existsSync(backupPath)) {
        throw new Error(`백업 파일을 찾을 수 없습니다: ${backupPath}`);
      }

      // 기존 데이터베이스 파일이 있으면 백업
      if (fs.existsSync(targetDbPath)) {
        const oldBackupPath = `${targetDbPath}.old-${Date.now()}`;
        fs.copyFileSync(targetDbPath, oldBackupPath);
        logger.info('📦 기존 데이터베이스 백업', {
          oldBackupPath
        });
      }

      // 백업 파일 복사
      fs.copyFileSync(backupPath, targetDbPath);
      logger.info('✅ 백업 복원 완료', {
        targetDbPath
      });
    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      logger.error('❌ 백업 복원 실패', {
        error: maskedError.message,
        errorName: maskedError.name
      });
      throw error;
    }
  }

  async cleanupBackups(options: CleanupOptions = {}): Promise<CleanupReport> {
    const mode: CleanupMode = options.mode === 'apply' ? 'apply' : 'preview';
    const now = options.now ?? new Date();
    const cutoff = now.getTime() - AUTOMATIC_RETENTION_DAYS * DAY_MS;
    const keepCount = options.keepCount ?? AUTOMATIC_RETENTION_COUNT;
    let names: string[];

    try {
      names = fs.readdirSync(this.backupsDir);
    } catch {
      return emptyCleanupReport(mode, 'scan-failed');
    }

    // 개수 상한은 이름 하나만 봐서는 판정할 수 없어 전체 목록에서 먼저 계산한다.
    const surplusNames = selectSurplusAutomaticNames(names, keepCount);

    const candidates = names.sort().flatMap<CleanupCandidate>(name => {
      const includeInterrupted = options.includeInterrupted ?? false;
      const nameReason = classifyNameSelection(name, cutoff, includeInterrupted, surplusNames);
      const path = join(this.backupsDir, name);

      try {
        const stats = fs.lstatSync(path);
        const reason = classifyInspectedSelection(name, stats, cutoff, includeInterrupted, surplusNames);

        if (reason === null) {
          return [];
        }

        return [{
          path,
          outcome: { id: name, status: 'selected' as const, reason, detail: null },
          identity: getIdentity(stats),
          selectedBytes: stats.size,
        }];
      } catch {
        if (nameReason === null) {
          return [];
        }

        return [{
          path,
          outcome: { id: name, status: 'failed' as const, reason: nameReason, detail: 'inspect-failed' as const },
          identity: null,
          selectedBytes: 0,
        }];
      }
    });

    if (mode === 'preview') {
      return buildCleanupReport(mode, names.length, candidates, 0);
    }

    let reclaimedBytes = 0;

    for (const candidate of candidates) {
      if (candidate.identity === null) {
        continue;
      }

      try {
        const currentStats = fs.lstatSync(candidate.path);
        const currentIdentity = getIdentity(currentStats);

        if (!currentStats.isFile() || !sameIdentity(candidate.identity, currentIdentity)) {
          candidate.outcome = {
            ...candidate.outcome,
            status: 'skipped',
            detail: 'changed-before-delete',
          };
          continue;
        }
      } catch (error) {
        const missing = isEnoent(error);
        candidate.outcome = {
          ...candidate.outcome,
          status: missing ? 'skipped' : 'failed',
          detail: missing ? 'missing-before-delete' : 'inspect-failed',
        };
        continue;
      }

      try {
        fs.unlinkSync(candidate.path);
        candidate.outcome = {
          ...candidate.outcome,
          status: 'deleted',
          detail: null,
        };
        reclaimedBytes += candidate.selectedBytes;
      } catch (error) {
        const missing = isEnoent(error);
        candidate.outcome = {
          ...candidate.outcome,
          status: missing ? 'skipped' : 'failed',
          detail: missing ? 'missing-before-delete' : 'delete-failed',
        };
      }
    }

    return buildCleanupReport(mode, names.length, candidates, reclaimedBytes);
  }

  /**
   * 최신 백업 파일 찾기
   */
  findLatestBackup(migrationVersion?: string): string | null {
    try {
      const files = fs.readdirSync(this.backupsDir);
      const backupFiles = files
        .filter(file => {
          if (!file.endsWith('.db')) {
            return false;
          }
          if (migrationVersion && !file.includes(migrationVersion)) {
            return false;
          }
          return file.startsWith('memory-backup-');
        })
        .map(file => ({
          name: file,
          path: join(this.backupsDir, file),
          mtime: fs.statSync(join(this.backupsDir, file)).mtimeMs
        }))
        .sort((a, b) => b.mtime - a.mtime);

      return backupFiles.length > 0 ? (backupFiles[0]?.path || null) : null;
    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      logger.error('❌ 백업 파일 검색 실패', {
        error: maskedError.message,
        errorName: maskedError.name
      });
      return null;
    }
  }

  /**
   * 백업 디렉토리 경로 반환
   */
  getBackupsDirectory(): string {
    return this.backupsDir;
  }
}
