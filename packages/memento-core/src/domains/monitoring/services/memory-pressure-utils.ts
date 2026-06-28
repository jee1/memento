/**
 * Memory pressure ratio helpers (RSS / cgroup or host budget)
 */

import os from 'os';

/**
 * RSS·힙 압력 비율의 분모(바이트).
 * Docker/Kubernetes 등 OS가 부과한 메모리 상한이 있으면 `process.constrainedMemory()`를 쓰고,
 * 없거나 비정상 값이면 호스트 `os.totalmem()`으로 폴백한다.
 */
export function getMemoryPressureDenominatorBytes(): number {
  try {
    const fn = (process as NodeJS.Process & { constrainedMemory?: () => number }).constrainedMemory;
    if (typeof fn === 'function') {
      const v = fn.call(process);
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        return v;
      }
    }
  } catch {
    // constrainedMemory 미지원·런타임 오류 시 호스트 메모리로 폴백
  }
  return os.totalmem();
}

export function memoryRatioToPercent(numerator: number, denominator: number): number {
  if (!(denominator > 0) || !Number.isFinite(numerator) || !Number.isFinite(denominator)) {
    return 0;
  }
  const pct = (numerator / denominator) * 100;
  return Number.isFinite(pct) ? pct : 0;
}

/**
 * 바이트를 읽기 쉬운 형식으로 변환
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
