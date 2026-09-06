/**
 * 작업 큐 관리 모듈
 * 배치 작업의 큐 관리, 우선순위 정렬, 중복 방지 기능 제공
 */

export interface QueuedJob {
  name: string;
  job: () => Promise<void>;
  priority: number;
  retryCount?: number;
}

export interface JobQueueConfig {
  maxSize?: number; // 최대 큐 크기 (선택적)
}

/**
 * 작업 큐 관리자
 * 
 * 역할:
 * - 작업 추가/제거
 * - 우선순위 기반 정렬
 * - 중복 작업 방지
 * - 큐 크기 관리
 */
export class JobQueue {
  private queue: QueuedJob[] = [];
  private runningJobs: Set<string> = new Set();
  private config: JobQueueConfig;

  constructor(config: JobQueueConfig = {}) {
    this.config = config;
  }

  /**
   * 큐에 작업 추가 (중복 방지 포함)
   * 
   * Race condition 방지를 위해 double-check pattern 적용
   * - 실행 중인 작업이면 큐에 추가하기 전에 다시 한 번 확인
   * - 큐에 추가 후 즉시 중복 체크하여 중복이면 제거
   * 
   * @param name 작업 이름
   * @param job 실행할 작업 함수
   * @param priority 우선순위 (낮을수록 높은 우선순위)
   * @param retryCount 재시도 횟수
   * @returns 추가 성공 여부
   */
  add(name: string, job: () => Promise<void>, priority: number, retryCount: number = 0): boolean {
    // 최대 크기 체크
    if (this.config.maxSize && this.queue.length >= this.config.maxSize) {
      return false;
    }

    // 실행 중인 작업이면 큐에 추가 (완료 후 실행되도록)
    if (this.runningJobs.has(name)) {
      // 첫 번째 체크: 큐에 이미 있는지 확인
      const alreadyQueued = this.queue.some(j => j.name === name);
      if (alreadyQueued) {
        return false;
      }
      
      // 큐에 추가
      this.queue.push({ name, job, priority, retryCount });
      
      // 두 번째 체크: 추가 후 다시 확인하여 중복이면 제거 (race condition 방지)
      // 큐에서 동일 이름의 작업이 여러 개인지 확인 (방금 추가한 것 제외)
      const duplicateCount = this.queue.filter(j => j.name === name).length;
      if (duplicateCount > 1) {
        // 중복 항목 제거 (나중에 추가된 것 제거, 즉 마지막 항목 제거)
        const lastIndex = this.queue.length - 1;
        this.queue.splice(lastIndex, 1);
        return false;
      }
      
      return true;
    }

    // 실행 중이 아닌 경우: 큐에 동일 이름의 잡이 이미 있는지 확인
    const alreadyQueued = this.queue.some(j => j.name === name);
    if (alreadyQueued) {
      return false;
    }

    // 큐에 추가
    this.queue.push({ name, job, priority, retryCount });
    return true;
  }

  /**
   * 다음 작업 가져오기 (우선순위 순으로 정렬)
   * 
   * @returns 다음 작업 또는 undefined
   */
  getNext(): QueuedJob | undefined {
    if (this.queue.length === 0) {
      return undefined;
    }

    // 우선순위 순으로 정렬
    this.queue.sort((a, b) => a.priority - b.priority);
    
    return this.queue.shift();
  }

  /**
   * 다음 작업 미리보기 (큐에서 제거하지 않음)
   * 
   * @returns 다음 작업 또는 undefined
   */
  peekNext(): QueuedJob | undefined {
    if (this.queue.length === 0) {
      return undefined;
    }

    // 우선순위 순으로 정렬
    this.queue.sort((a, b) => a.priority - b.priority);

    return this.queue[0];
  }

  /**
   * 실행 중인 작업으로 표시
   * 
   * @param name 작업 이름
   */
  markRunning(name: string): void {
    this.runningJobs.add(name);
  }

  /**
   * 실행 완료된 작업 표시 제거
   * 
   * @param name 작업 이름
   */
  markCompleted(name: string): void {
    this.runningJobs.delete(name);
  }

  /**
   * 큐 크기
   */
  get size(): number {
    return this.queue.length;
  }

  /**
   * 실행 중인 작업 수
   */
  get runningCount(): number {
    return this.runningJobs.size;
  }

  /**
   * 큐가 비어있는지 확인
   */
  get isEmpty(): boolean {
    return this.queue.length === 0;
  }

  /**
   * 큐 비우기
   */
  clear(): void {
    this.queue.length = 0;
  }

  /**
   * 특정 작업이 실행 중인지 확인
   * 
   * @param name 작업 이름
   */
  isRunning(name: string): boolean {
    return this.runningJobs.has(name);
  }

  /**
   * 특정 작업이 큐에 있는지 확인
   * 
   * @param name 작업 이름
   */
  isQueued(name: string): boolean {
    return this.queue.some(j => j.name === name);
  }

  /**
   * Snapshot of running job names (array copy; no job fn leak).
   */
  getRunningNames(): string[] {
    return Array.from(this.runningJobs);
  }

  /**
   * Snapshot of queued job names (array copy; no job fn leak).
   */
  getQueuedNames(): string[] {
    return this.queue.map(j => j.name);
  }
}

