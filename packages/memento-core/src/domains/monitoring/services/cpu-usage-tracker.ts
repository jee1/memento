/**
 * Dual-baseline CPU usage tracker (scheduled vs on-demand paths)
 */

export interface CpuUsageHost {
  scheduledCpuUsage: NodeJS.CpuUsage | null;
  scheduledMeasurementTime: number | null;
  onDemandCpuUsage: NodeJS.CpuUsage | null;
  onDemandMeasurementTime: number | null;
  latestCpuSnapshot: NodeJS.CpuUsage;
  lastCpuPercent: number;
}

export class CpuUsageTracker {
  /**
   * Seed both baselines from the same snapshot so neither path returns 0 on the first call.
   */
  seed(host: CpuUsageHost): void {
    const seedUsage = process.cpuUsage();
    const now = Date.now();
    host.scheduledCpuUsage = seedUsage;
    host.scheduledMeasurementTime = now;
    host.onDemandCpuUsage = seedUsage;
    host.onDemandMeasurementTime = now;
    host.latestCpuSnapshot = seedUsage;
  }

  getLatestSnapshot(host: CpuUsageHost): NodeJS.CpuUsage {
    return host.latestCpuSnapshot;
  }

  /**
   * CPU 사용률 계산 (dual-baseline 설계)
   * 직전 baseline 이후의 (∆user + ∆system) / wallClock 으로 실제 사용률을 계산합니다.
   *
   * tick=true (scheduled): scheduledCpuUsage baseline 사용·갱신. lastCpuPercent도 갱신됩니다.
   * tick=false (on-demand): onDemandCpuUsage baseline 사용·갱신.
   *   scheduledCpuUsage는 건드리지 않아 scheduled tick의 측정 창이 보존됩니다.
   */
  calculateUsage(host: CpuUsageHost, tick: boolean): number {
    const now = Date.now();
    const current = process.cpuUsage();
    host.latestCpuSnapshot = current;

    if (tick) {
      // Scheduled path
      if (host.scheduledCpuUsage === null || host.scheduledMeasurementTime === null) {
        host.scheduledCpuUsage = current;
        host.scheduledMeasurementTime = now;
        return 0;
      }
      const cpuDelta = (current.user - host.scheduledCpuUsage.user)
                     + (current.system - host.scheduledCpuUsage.system);
      const wallClockDelta = (now - host.scheduledMeasurementTime) * 1000; // ms → µs
      host.scheduledCpuUsage = current;
      host.scheduledMeasurementTime = now;
      if (wallClockDelta === 0) return host.lastCpuPercent;
      const result = Math.max(0, Math.min(100, (cpuDelta / wallClockDelta) * 100));
      host.lastCpuPercent = result;
      return result;
    } else {
      // On-demand path: always advance own baseline for fresh short-window reads;
      // never touches scheduledCpuUsage so scheduled windows stay intact.
      if (host.onDemandCpuUsage === null || host.onDemandMeasurementTime === null) {
        host.onDemandCpuUsage = current;
        host.onDemandMeasurementTime = now;
        return host.lastCpuPercent;
      }
      const cpuDelta = (current.user - host.onDemandCpuUsage.user)
                     + (current.system - host.onDemandCpuUsage.system);
      const wallClockDelta = (now - host.onDemandMeasurementTime) * 1000; // ms → µs
      host.onDemandCpuUsage = current;
      host.onDemandMeasurementTime = now;
      if (wallClockDelta === 0) return host.lastCpuPercent;
      return Math.max(0, Math.min(100, (cpuDelta / wallClockDelta) * 100));
    }
  }
}
