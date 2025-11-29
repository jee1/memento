/**
 * 백업 관리자
 * 
 * 마이그레이션 전 자동 백업 생성 및 복원 기능을 제공합니다.
 */

import type Database from 'better-sqlite3';
import fs from 'fs';
import { join, dirname } from 'path';
import { mementoConfig } from '../../../../../shared/config/index.js';

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
      console.error('❌ 백업 디렉토리 생성 실패:', error);
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
      const dbPath = (db as any).name || mementoConfig.dbPath;
      
      // 파일 시스템을 통한 백업 (더 안정적)
      if (fs.existsSync(dbPath)) {
        fs.copyFileSync(dbPath, backupPath);
      } else {
        // 메모리 데이터베이스인 경우 backup API 사용 시도
        try {
          const backup = (db as any).backup(backupPath);
          if (backup && typeof backup.step === 'function') {
            await new Promise<void>((resolve, reject) => {
              backup.step(-1, (err: Error | null) => {
                if (err) {
                  reject(err);
                } else {
                  resolve();
                }
              });
            });
            if (typeof backup.finish === 'function') {
              backup.finish();
            }
          } else {
            throw new Error('백업 API를 사용할 수 없습니다');
          }
        } catch (backupError) {
          throw new Error(`백업 생성 실패: ${backupError}`);
        }
      }

      const stats = fs.statSync(backupPath);
      const size = stats.size;

      console.log(`✅ 백업 생성 완료: ${backupPath} (${(size / 1024 / 1024).toFixed(2)} MB)`);

      return {
        backupPath,
        timestamp,
        size
      };
    } catch (error) {
      console.error('❌ 백업 생성 실패:', error);
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
        console.log(`📦 기존 데이터베이스 백업: ${oldBackupPath}`);
      }

      // 백업 파일 복사
      fs.copyFileSync(backupPath, targetDbPath);
      console.log(`✅ 백업 복원 완료: ${targetDbPath}`);
    } catch (error) {
      console.error('❌ 백업 복원 실패:', error);
      throw error;
    }
  }

  /**
   * 오래된 백업 파일 정리 (기본 30일)
   */
  async cleanupOldBackups(retentionDays: number = 30): Promise<number> {
    try {
      const files = fs.readdirSync(this.backupsDir);
      const now = Date.now();
      const retentionMs = retentionDays * 24 * 60 * 60 * 1000;
      let deletedCount = 0;

      for (const file of files) {
        if (!file.endsWith('.db')) {
          continue;
        }

        const filePath = join(this.backupsDir, file);
        const stats = fs.statSync(filePath);
        const age = now - stats.mtimeMs;

        if (age > retentionMs) {
          fs.unlinkSync(filePath);
          deletedCount++;
          console.log(`🗑️  오래된 백업 삭제: ${file}`);
        }
      }

      if (deletedCount > 0) {
        console.log(`✅ 백업 정리 완료: ${deletedCount}개 파일 삭제`);
      }

      return deletedCount;
    } catch (error) {
      console.error('❌ 백업 정리 실패:', error);
      return 0;
    }
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
      console.error('❌ 백업 파일 검색 실패:', error);
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

