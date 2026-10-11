import type { RepositoryProvider } from '../../../domains/memory/repositories/repository-provider.port.js';
import { FeedbackRepositorySQLite } from '../repositories/feedback-repository-sqlite.impl.js';
import { ProcessAttributeRepositorySqlite } from '../repositories/process-attribute-repository-sqlite.impl.js';
import { KnowledgeVaultRepositorySqlite } from '../repositories/knowledge-vault-repository-sqlite.impl.js';
import { createCoreMemoryRepository } from './core-memory-repository.factory.js';

/** SQLite 저장소 구현을 RepositoryProvider port 로 묶는다 (#1328). 상태가 없어 공유해도 된다. */
export const sqliteRepositoryProvider: RepositoryProvider = {
  feedback: (db) => new FeedbackRepositorySQLite(db),
  processAttribute: (db) => new ProcessAttributeRepositorySqlite(db),
  knowledgeVault: (db) => new KnowledgeVaultRepositorySqlite(db),
  coreMemory: (db) => createCoreMemoryRepository(db),
};
