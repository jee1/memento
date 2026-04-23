/**
 * Knowledge Vault Repository Interface
 */

export interface KnowledgeVaultRecord {
  vault_id: string;
  agent_id: string;
  key: string;
  value: string;
  immutable: boolean;
  version: number;
  previous_version_id?: string | null;
  admin_override: boolean;
  deleted_at?: string | null;
  origin_source?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateKnowledgeVaultInput {
  vault_id: string;
  agent_id?: string;
  key: string;
  value: string;
  immutable?: boolean;
  version?: number;
  previous_version_id?: string | null;
  admin_override?: boolean;
  deleted_at?: string | null;
  origin_source?: string | null;
}

export interface UpdateKnowledgeVaultInput {
  value?: string;
  immutable?: boolean;
  admin_override?: boolean;
  origin_source?: string | null;
}

export interface IKnowledgeVaultRepository {
  create(input: CreateKnowledgeVaultInput): Promise<KnowledgeVaultRecord>;
  findById(vault_id: string): Promise<KnowledgeVaultRecord | null>;
  findActiveByKey(agent_id: string, key: string): Promise<KnowledgeVaultRecord | null>;
  findByKeyAndVersion(
    agent_id: string,
    key: string,
    version: number
  ): Promise<KnowledgeVaultRecord | null>;
  findAllVersionsByKey(agent_id: string, key: string): Promise<KnowledgeVaultRecord[]>;
  findActiveByAgentId(agent_id: string): Promise<KnowledgeVaultRecord[]>;
  findByAgentId(agent_id: string): Promise<KnowledgeVaultRecord[]>;
  update(vault_id: string, input: UpdateKnowledgeVaultInput): Promise<KnowledgeVaultRecord | null>;
  delete(vault_id: string): Promise<boolean>;
  deleteActiveByKey(agent_id: string, key: string): Promise<boolean>;
  hardDelete(vault_id: string): Promise<boolean>;
  findAll(): Promise<KnowledgeVaultRecord[]>;
  findAllActive(): Promise<KnowledgeVaultRecord[]>;
  count(agent_id?: string, activeOnly?: boolean): Promise<number>;
  getNextVersion(agent_id: string, key: string): Promise<number>;
}
