/**
 * 배치 스케줄러 인터페이스 (DIP)
 * 도메인/툴은 이 인터페이스만 참조하고, 인프라 구현체를 컨텍스트 통해 주입받음.
 */

/** 스케줄러 상태 (호출자가 isRunning 등만 사용) */
export interface ISchedulerStatus {
  isRunning: boolean;
  activeJobs?: string[];
  lastExecution?: Map<string, Date>;
  totalExecutions?: Map<string, number>;
  errorCount?: Map<string, number>;
  uptime?: number;
  config?: unknown;
}

export interface IBatchScheduler {
  addJob(name: string, job: () => Promise<void>, priority?: number, retryCount?: number): boolean;
  getStatus(): ISchedulerStatus;
  isJobQueued(name: string): boolean;
  isJobRunning(name: string): boolean;
}
