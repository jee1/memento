/**
 * Reflexion Worker 인터페이스 (DIP)
 * 도메인/툴·스케줄러는 이 인터페이스만 참조하고, 인프라 구현체를 주입받음.
 */

/** Worker 상태 (호출자가 isRunning 등만 사용) */
export interface IWorkerStatus {
  isRunning: boolean;
  activeWorkers: number;
  queueSize: number;
  processedCount: number;
  failedCount: number;
  restartCount: number;
}

export interface IReflexionWorker {
  getStatus(): IWorkerStatus;
  queueFailureEvent(event: unknown): Promise<boolean>;
}
