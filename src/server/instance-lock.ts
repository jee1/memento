/**
 * 단일 인스턴스 lock (같은 DB를 쓰는 MCP 서버가 한 프로세스만 실행되도록)
 *
 * 근본 원인: Cursor가 user/project 등으로 동일 서버를 두 번 띄우면
 * 로그가 두 프로세스에서 각각 출력되어 동일 메시지가 두 번 찍힘.
 * Lock으로 두 번째 프로세스는 즉시 종료하여 로그 중복을 제거함.
 */

import fs from 'node:fs';
import path from 'node:path';

let lockFilePath: string | null = null;

/**
 * PID에 해당하는 프로세스가 아직 살아 있는지 확인
 * process.kill(pid, 0)은 시그널 0으로 실제 종료 없이 존재 여부만 확인
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
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
 * - Lock이 없거나 기존 PID가 죽었으면 획득 후 { acquired: true } 반환.
 * - 다른 프로세스가 이미 보유 중이면 { acquired: false, existingPid } 반환.
 */
export function tryAcquireLock(dbPath: string): AcquireLockResult {
  const lockPath = getLockFilePath(dbPath);
  const pid = process.pid;

  try {
    if (fs.existsSync(lockPath)) {
      const content = fs.readFileSync(lockPath, 'utf8').trim();
      const existingPid = parseInt(content, 10);
      if (!Number.isNaN(existingPid) && isProcessAlive(existingPid)) {
        return { acquired: false, existingPid };
      }
      fs.unlinkSync(lockPath);
    }
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    fs.writeFileSync(lockPath, String(pid), 'utf8');
    lockFilePath = lockPath;
    return { acquired: true };
  } catch {
    return { acquired: false, existingPid: -1 };
  }
}

/**
 * Lock 해제 (프로세스 종료 시 cleanup에서 호출)
 */
export function releaseLock(): void {
  if (lockFilePath === null) return;
  try {
    if (fs.existsSync(lockFilePath)) {
      fs.unlinkSync(lockFilePath);
    }
  } catch {
    // 무시
  } finally {
    lockFilePath = null;
  }
}
