import Database from 'better-sqlite3';
import { logger } from '../shared/utils/logger.js';
import { MetaMemoryService } from '../domains/memory/introspection/meta-memory-service.js';

export function createMetaMemoryService(db: Database.Database): {
  metaMemoryService: MetaMemoryService;
} {
  const metaMemoryService = new MetaMemoryService(db);
  logger.info('MetaMemoryService 초기화 완료');
  return { metaMemoryService };
}
