/**
 * 백업 관리자
 * 
 * 마이그레이션 전 자동 백업 생성 및 복원 기능을 제공합니다.
 */

import type Database from 'better-sqlite3';
import fs from 'fs';
import { join, dirname } from 'path';
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
}

export type CleanupMode = 'preview' | 'apply';

export type CleanupSelectionReason =
  | 'expired-automatic'
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

function classifySelection(
  name: string,
  cutoff: number,
  includeInterrupted: boolean
): CleanupSelectionReason | null {
  const automaticMatch = name.match(AUTOMATIC_NAME);

  if (automaticMatch) {
    const createdAt = parseBackupTimestamp(automaticMatch, 2);

    if (createdAt !== null && createdAt < cutoff) {
      return 'expired-automatic';
    }

    return null;
  }

  if (isOperatorBackupName(name)) {
    return null;
  }

  if (includeInterrupted && IN_PROGRESS_NAME.test(name)) {
    return 'interrupted-attempt';
  }

  return null;
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

  return {
    ...emptyCleanupReport(mode, null),
    ok: failedCount === 0,
    inspectedCount,
    selectedCount: artifacts.length,
    selectedBytes: candidates.reduce((total, candidate) => total + candidate.selectedBytes, 0),
    deletedCount: artifacts.filter(artifact => artifact.status === 'deleted').length,
    reclaimedBytes,
    skippedCount: artifacts.filter(artifact => artifact.status === 'skipped').length,
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
  async createBackup(db: Database.Database, migrationVersion: string): Promise<BackupResult> {
    const timestamp = new Date();
    const timestampStr = timestamp.toISOString().replace(/[:.]/g, '-');
    const backupFileName = `memory-backup-${migrationVersion}-${timestampStr}.db`;
    const backupPath = join(this.backupsDir, backupFileName);

    try {
      // 데이터베이스 파일 경로 가져오기
      const backupDb = db as BackupCapableDatabase;
      if (isInMemoryDatabase(backupDb)) {
        throw new Error('메모리 데이터베이스는 파일 백업을 지원하지 않습니다');
      }

      const dbPath = backupDb.name || mementoConfig.dbPath;
      
      // 파일 시스템을 통한 백업 (더 안정적)
      if (fs.existsSync(dbPath)) {
        fs.copyFileSync(dbPath, backupPath);
      } else {
        // 메모리 데이터베이스인 경우 backup API 사용 시도
        try {
          await backupDb.backup(backupPath);
        } catch (backupError) {
          throw new Error(`백업 생성 실패: ${backupError}`);
        }
      }

      const stats = fs.statSync(backupPath);
      const size = stats.size;

      logger.info('✅ 백업 생성 완료', {
        backupPath,
        sizeMB: (size / 1024 / 1024).toFixed(2)
      });

      return {
        backupPath,
        timestamp,
        size
      };
    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      logger.error('❌ 백업 생성 실패', {
        error: maskedError.message,
        errorName: maskedError.name
      });
      throw error;
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
    const cutoff = now.getTime() - 30 * DAY_MS;
    let names: string[];

    try {
      names = fs.readdirSync(this.backupsDir);
    } catch {
      return emptyCleanupReport(mode, 'scan-failed');
    }

    const candidates = names.sort().flatMap<CleanupCandidate>(name => {
      const reason = classifySelection(name, cutoff, options.includeInterrupted ?? false);
      const path = join(this.backupsDir, name);

      try {
        const stats = fs.lstatSync(path);

        if (reason === null || !stats.isFile()) {
          return [];
        }

        return [{
          path,
          outcome: { id: name, status: 'selected' as const, reason, detail: null },
          identity: getIdentity(stats),
          selectedBytes: stats.size,
        }];
      } catch {
        if (reason === null) {
          return [];
        }

        return [{
          path,
          outcome: { id: name, status: 'failed' as const, reason, detail: 'inspect-failed' as const },
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
