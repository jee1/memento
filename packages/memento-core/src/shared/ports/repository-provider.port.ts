import type Database from 'better-sqlite3';
import type { IFeedbackRepository } from './feedback-repository.interface.js';
import type { IProcessAttributeRepository } from './process-attribute-repository.interface.js';
import type { IKnowledgeVaultRepository } from './knowledge-vault-repository.interface.js';
import type { CoreMemoryRepository } from './core-memory-repository.interface.js';

/**
 * 도메인이 쓰는 저장소를 db 핸들에서 만드는 port (#1328).
 * 구현체는 infrastructure 에 있고 bootstrap 이 주입한다 — 도메인은 이 타입만 import 한다.
 */
export interface RepositoryProvider {
  feedback(db: Database.Database): IFeedbackRepository;
  processAttribute(db: Database.Database): IProcessAttributeRepository;
  knowledgeVault(db: Database.Database): IKnowledgeVaultRepository;
  coreMemory(db: Database.Database): CoreMemoryRepository;
}

/** 주입이 빠진 경로는 조용히 기능을 잃지 말고 바로 실패한다. */
export function requireRepositoryProvider(provider: RepositoryProvider | undefined): RepositoryProvider {
  if (!provider) {
    throw new Error('RepositoryProvider is not wired — pass context.services.repositories (see bootstrap)');
  }
  return provider;
}
