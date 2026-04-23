/**
 * Knowledge Vault Repository (Deprecated)
 * 
 * @deprecated Use IKnowledgeVaultRepository from './knowledge-vault-repository.interface.js' 
 * and KnowledgeVaultRepositorySqlite from '../../../infrastructure/database/repositories/knowledge-vault-repository-sqlite.impl.js'
 */

export * from './knowledge-vault-repository.interface.js';
import { KnowledgeVaultRepositorySqlite } from '../../../infrastructure/database/repositories/knowledge-vault-repository-sqlite.impl.js';

/**
 * @deprecated Use KnowledgeVaultRepositorySqlite instead
 */
export const KnowledgeVaultRepository = KnowledgeVaultRepositorySqlite;
export type KnowledgeVaultRepository = KnowledgeVaultRepositorySqlite;
