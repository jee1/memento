import { logger } from '../../shared/utils/logger.js';

export class BatchProcessor {
  private batchSize: number;
  private flushInterval: number;
  private batches: Map<string, unknown[]> = new Map();
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  constructor(batchSize: number = 100, flushInterval: number = 5000) {
    this.batchSize = batchSize;
    this.flushInterval = flushInterval;
  }

  addToBatch<T>(batchKey: string, item: T): void {
    if (!this.batches.has(batchKey)) {
      this.batches.set(batchKey, []);
    }

    const batch = this.batches.get(batchKey)!;
    batch.push(item);

    if (batch.length >= this.batchSize) {
      this.flushBatch(batchKey);
    } else {
      this.setFlushTimer(batchKey);
    }
  }

  private async flushBatch(batchKey: string): Promise<void> {
    const batch = this.batches.get(batchKey);
    if (!batch || batch.length === 0) return;

    const timer = this.timers.get(batchKey);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(batchKey);
    }

    try {
      await this.processBatch(batchKey, batch);
      this.batches.set(batchKey, []);
    } catch (error) {
      logger.error(`배치 처리 실패 (${batchKey}):`, { error });
    }
  }

  private async processBatch(batchKey: string, items: unknown[]): Promise<void> {
    switch (batchKey) {
      case 'memory_insert':
        await this.processMemoryBatch(items);
        break;
      case 'embedding_generation':
        await this.processEmbeddingBatch(items);
        break;
      case 'search_cache':
        await this.processSearchCacheBatch(items);
        break;
      default:
        logger.warn(`Unknown batch key: ${batchKey}`);
    }
  }

  private async processMemoryBatch(items: unknown[]): Promise<void> {
    logger.info(`메모리 배치 처리: ${items.length}개 항목`);
  }

  private async processEmbeddingBatch(items: unknown[]): Promise<void> {
    logger.info(`임베딩 배치 처리: ${items.length}개 항목`);
  }

  private async processSearchCacheBatch(items: unknown[]): Promise<void> {
    logger.info(`검색 캐시 배치 처리: ${items.length}개 항목`);
  }

  private setFlushTimer(batchKey: string): void {
    const existingTimer = this.timers.get(batchKey);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.flushBatch(batchKey);
    }, this.flushInterval);

    this.timers.set(batchKey, timer);
  }

  async flushAll(): Promise<void> {
    const promises = Array.from(this.batches.keys()).map(key => this.flushBatch(key));
    await Promise.all(promises);
  }

  getBatchStats(): Record<string, { size: number; lastFlush: Date }> {
    const stats: Record<string, { size: number; lastFlush: Date }> = {};

    for (const [key, batch] of this.batches) {
      stats[key] = {
        size: batch.length,
        lastFlush: new Date()
      };
    }

    return stats;
  }
}
