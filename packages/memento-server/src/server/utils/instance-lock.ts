/**
 * 같은 DB 디렉터리에서 HTTP sidecar를 실행할 프로세스 하나를 선출한다.
 *
 * Lock 경로는 path.dirname(dbPath) + 고정 basename('memento-mcp.lock')으로 제한됨.
 */
/* eslint-disable security/detect-non-literal-fs-filename */

import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

let ownedLock: { path: string; token: string } | null = null;

/**
 * PID에 해당하는 프로세스가 아직 살아 있는지 확인
 * process.kill(pid, 0)은 시그널 0으로 실제 종료 없이 존재 여부만 확인
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/**
 * Lock 파일 경로 계산 (dbPath와 같은 디렉터리에 memento-mcp.lock)
 */
function getLockFilePath(dbPath: string): string {
  const dir = path.resolve(path.dirname(dbPath));
  return path.join(dir, 'memento-mcp.lock');
}

export type AcquireLockResult = { acquired: true } | { acquired: false; existingPid: number };

/**
 * Lock 획득 시도.
 * - 완성된 디렉터리를 atomic rename으로 게시한다 (빈 PID 파일 노출 없음).
 * - 죽은 소유자의 디렉터리는 고유 tombstone으로 이동한 후 재시도한다.
 * - 다른 프로세스가 이미 보유 중이면 { acquired: false, existingPid } 반환.
 * - 레거시 PID 파일은 안전한 자동 이전이 불가능하므로 fail-closed한다.
 */
export function tryAcquireLock(dbPath: string): AcquireLockResult {
  const lockPath = getLockFilePath(dbPath);
  let candidate: string | undefined;

  try {
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    candidate = fs.mkdtempSync(`${lockPath}.candidate-`);
    const preparedPath = candidate;
    const token = randomUUID();
    fs.writeFileSync(path.join(candidate, 'owner.json'), JSON.stringify({ pid: process.pid, token }));
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // Nonempty destination directories cannot be replaced by rename.
        fs.renameSync(preparedPath, lockPath);
        candidate = undefined;
        ownedLock = { path: lockPath, token };
        return { acquired: true };
      } catch (error) {
        if (!['EEXIST', 'ENOTEMPTY', 'ENOTDIR', 'EISDIR', 'EPERM'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      }
      if (fs.statSync(lockPath).isFile()) {
        const existingPid = Number(fs.readFileSync(lockPath, 'utf8').trim());
        return { acquired: false, existingPid: Number.isSafeInteger(existingPid) && existingPid > 0 ? existingPid : -1 };
      }
      const owner = JSON.parse(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8')) as { pid: number; token: string };
      if (!Number.isSafeInteger(owner.pid) || owner.pid <= 0 || typeof owner.token !== 'string' || !/^[a-f0-9-]{36}$/.test(owner.token)) {
        return { acquired: false, existingPid: -1 };
      }
      if (isProcessAlive(owner.pid) || attempt === 1) return { acquired: false, existingPid: owner.pid };
      // ponytail: one retained directory per crashed owner; offline cleanup may remove
      // tombstones only after all contenders stop. Retention blocks stale reapers
      // from renaming a replacement owner into the same nonempty destination.
      fs.renameSync(lockPath, `${lockPath}.stale-${owner.token}`);
    }
  } catch {
    return { acquired: false, existingPid: -1 };
  } finally {
    if (candidate) {
      try { fs.rmSync(candidate, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }
  return { acquired: false, existingPid: -1 };
}

/**
 * Lock 해제 (프로세스 종료 시 cleanup에서 호출)
 */
export function releaseLock(): void {
  if (ownedLock === null) return;
  try {
    const ownerPath = path.join(ownedLock.path, 'owner.json');
    const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8')) as { token: string };
    if (owner.token === ownedLock.token) {
      fs.unlinkSync(ownerPath);
      // Never recursively delete: a contender may publish after owner.json is removed.
      fs.rmdirSync(ownedLock.path);
    }
  } catch {
    // 무시
  } finally {
    ownedLock = null;
  }
}
