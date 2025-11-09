/**
 * Write Coalescing 유틸리티
 * 실시간 쓰기를 버퍼링하여 배치로 처리하여 I/O 부하를 줄입니다.
 * 
 * 사용 사례:
 * - last_accessed_at 업데이트를 초당 1회로 제한
 * - recall_count 업데이트를 버퍼링하여 배치 처리
 */

export interface CoalescedWrite {
  /**
   * 메모리 ID
   */
  memoryId: string;

  /**
   * 업데이트할 필드들
   */
  fields: {
    recall_count?: number;
    last_accessed_at?: string; // ISO timestamp
    g_value?: number;
    consolidation_score?: number;
  };
}

/**
 * Write Coalescing Manager
 * 메모리 버퍼를 사용하여 쓰기 작업을 결합하고 주기적으로 flush합니다.
 */
export class WriteCoalescingManager {
  private buffer: Map<string, CoalescedWrite> = new Map();
  private flushInterval: number; // 밀리초
  private flushTimer: NodeJS.Timeout | null = null;
  private isFlushing: boolean = false;
  private isDestroyed: boolean = false; // destroy 호출 여부 추적
  private flushCallback: (writes: CoalescedWrite[]) => Promise<void>;

  /**
   * @param flushIntervalMs flush 간격 (밀리초, 기본값: 1000ms = 1초)
   * @param flushCallback flush 시 호출할 콜백 함수
   */
  constructor(
    flushIntervalMs: number = 1000,
    flushCallback: (writes: CoalescedWrite[]) => Promise<void>
  ) {
    this.flushInterval = flushIntervalMs;
    this.flushCallback = flushCallback;
  }

  /**
   * 쓰기 작업을 버퍼에 추가
   * 동일한 memoryId에 대한 여러 업데이트는 자동으로 병합됩니다.
   * 
   * @param write 쓰기 작업
   */
  addWrite(write: CoalescedWrite): void {
    // destroy된 후에는 쓰기 추가 불가
    if (this.isDestroyed) {
      console.warn('WriteCoalescingManager가 destroy된 후에는 쓰기를 추가할 수 없습니다.');
      return;
    }
    
    const existing = this.buffer.get(write.memoryId);
    
    if (existing) {
      // 기존 항목과 병합 (최신 값으로 덮어쓰기)
      existing.fields = {
        ...existing.fields,
        ...write.fields
      };
    } else {
      // 새 항목 추가
      this.buffer.set(write.memoryId, { ...write });
    }

    // 첫 번째 항목이 추가되면 타이머 시작
    if (this.buffer.size === 1 && !this.flushTimer && !this.isDestroyed) {
      this.startFlushTimer();
    }
  }

  /**
   * 여러 쓰기 작업을 한 번에 추가
   * 
   * @param writes 쓰기 작업 배열
   */
  addWrites(writes: CoalescedWrite[]): void {
    for (const write of writes) {
      this.addWrite(write);
    }
  }

  /**
   * Flush 타이머 시작
   */
  private startFlushTimer(): void {
    if (this.flushTimer || this.isDestroyed) {
      return; // 이미 실행 중이거나 destroy됨
    }

    this.flushTimer = setTimeout(async () => {
      this.flushTimer = null;
      
      // destroy가 호출되었거나 버퍼가 비어있으면 종료
      if (this.isDestroyed || this.buffer.size === 0) {
        return;
      }
      
      // flush 실행 (destroy 중이 아닐 때만)
      if (!this.isFlushing) {
        try {
          await this.flush();
          // flush 후 버퍼에 항목이 있고 destroy되지 않았으면 타이머 재시작
          if (this.buffer.size > 0 && !this.flushTimer && !this.isDestroyed) {
            this.startFlushTimer();
          }
        } catch (error) {
          // flush 실패는 무시 (이미 로깅됨)
          console.error('Write coalescing timer flush 실패:', error);
        }
      }
    }, this.flushInterval);
  }

  /**
   * 버퍼의 모든 쓰기 작업을 즉시 flush
   * 
   * @returns flush된 쓰기 작업 수
   */
  async flush(): Promise<number> {
    if (this.isFlushing) {
      return 0; // 이미 flush 중
    }

    if (this.buffer.size === 0) {
      return 0; // 버퍼가 비어있음
    }

    this.isFlushing = true;

    try {
      // 버퍼 복사 및 초기화
      const writes = Array.from(this.buffer.values());
      this.buffer.clear();

      // 타이머 정리
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }

      // 콜백 실행
      await this.flushCallback(writes);

      return writes.length;
    } catch (error) {
      // 에러 발생 시 버퍼에 다시 추가하지 않음 (데이터 손실 방지)
      // 대신 에러를 로깅하고 계속 진행
      console.error('Write coalescing flush 실패:', error);
      throw error;
    } finally {
      this.isFlushing = false;
    }
  }

  /**
   * 버퍼 크기 반환
   */
  getBufferSize(): number {
    return this.buffer.size;
  }

  /**
   * 버퍼가 비어있는지 확인
   */
  isEmpty(): boolean {
    return this.buffer.size === 0;
  }

  /**
   * 모든 타이머 정리 및 버퍼 초기화
   * 진행 중인 flush 작업이 있으면 완료될 때까지 대기합니다.
   */
  async destroy(): Promise<void> {
    // 중복 호출 방지
    if (this.isDestroyed) {
      return;
    }
    
    this.isDestroyed = true;
    
    // 타이머 정리
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    
    // 진행 중인 flush 작업이 있으면 완료될 때까지 대기
    // 최대 1초 대기 (무한 대기 방지)
    const maxWaitTime = 1000;
    const startTime = Date.now();
    while (this.isFlushing && (Date.now() - startTime) < maxWaitTime) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    // 남은 버퍼 flush (동기적으로)
    if (this.buffer.size > 0 && !this.isFlushing) {
      try {
        // 동기 flush (타이머 없이)
        const writes = Array.from(this.buffer.values());
        this.buffer.clear();
        if (writes.length > 0) {
          await this.flushCallback(writes);
        }
      } catch (error) {
        console.error('Write coalescing destroy 시 flush 실패:', error);
      }
    }
    
    // 버퍼 초기화
    this.buffer.clear();
    this.isFlushing = false;
  }
}

