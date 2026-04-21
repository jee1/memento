/**
 * Knowledge Vault Service
 * Knowledge Vault에 대한 비즈니스 로직 처리
 * 
 * 클린코드 원칙:
 * - 단일 책임 원칙: Knowledge Vault 비즈니스 로직만 담당
 * - 의존성 역전: Repository에 의존
 * - Immutable 검증: immutable=true인 경우 업데이트/삭제 제한
 * - 버전 관리: 기존 버전을 삭제하지 않고 새 버전 생성
 */

import {
KnowledgeVaultRepository,
type KnowledgeVaultRecord
} from '../repositories/knowledge-vault-repository.js';

export interface CreateKnowledgeVaultServiceInput {
  agent_id?: string;
  key: string;
  value: string;
  immutable?: boolean;
  admin_override?: boolean;
  origin_source?: string | null;
}

export interface UpdateKnowledgeVaultServiceInput {
  value?: string;
  immutable?: boolean;
  admin_override?: boolean;
  origin_source?: string | null;
}

/**
 * Knowledge Vault ID 생성 유틸리티
 */
function generateVaultId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 11);
  return `vault_${timestamp}_${random}`;
}

/**
 * Immutable 데이터 수정 시도 에러
 */
export class ImmutableDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImmutableDataError';
  }
}

/**
 * Knowledge Vault Service
 */
export class KnowledgeVaultService {
  constructor(private repository: KnowledgeVaultRepository) {}

  /**
   * Knowledge Vault 생성
   * 기존 활성 버전이 있으면 새 버전으로 생성 (기존 버전은 유지)
   */
  async create(input: CreateKnowledgeVaultServiceInput): Promise<KnowledgeVaultRecord> {
    const {
      agent_id = 'default',
      key,
      value,
      immutable = true,
      admin_override = false,
      origin_source = null
    } = input;

    // 기존 활성 버전 확인
    const existing = await this.repository.findActiveByKey(agent_id, key);

    let version = 1;
    let previous_version_id: string | null = null;

    if (existing) {
      // 기존 버전이 있으면 다음 버전으로 생성
      version = await this.repository.getNextVersion(agent_id, key);
      previous_version_id = existing.vault_id;
    }

    const vault_id = generateVaultId();

    const record = await this.repository.create({
      vault_id,
      agent_id,
      key,
      value,
      immutable,
      version,
      previous_version_id,
      admin_override,
      deleted_at: null,
      origin_source
    });

    return record;
  }

  /**
   * ID로 Knowledge Vault 조회
   */
  async findById(vault_id: string): Promise<KnowledgeVaultRecord | null> {
    return this.repository.findById(vault_id);
  }

  /**
   * agent_id와 key로 활성 버전 조회
   */
  async findActiveByKey(agent_id: string, key: string): Promise<KnowledgeVaultRecord | null> {
    return this.repository.findActiveByKey(agent_id, key);
  }

  /**
   * agent_id와 key로 특정 버전 조회
   */
  async findByKeyAndVersion(
    agent_id: string,
    key: string,
    version: number
  ): Promise<KnowledgeVaultRecord | null> {
    return this.repository.findByKeyAndVersion(agent_id, key, version);
  }

  /**
   * agent_id와 key로 모든 버전 조회
   */
  async findAllVersionsByKey(
    agent_id: string,
    key: string
  ): Promise<KnowledgeVaultRecord[]> {
    return this.repository.findAllVersionsByKey(agent_id, key);
  }

  /**
   * agent_id로 모든 활성 Knowledge Vault 조회
   */
  async findActiveByAgentId(agent_id: string): Promise<KnowledgeVaultRecord[]> {
    return this.repository.findActiveByAgentId(agent_id);
  }

  /**
   * agent_id로 모든 Knowledge Vault 조회 (삭제된 것 포함)
   */
  async findByAgentId(agent_id: string): Promise<KnowledgeVaultRecord[]> {
    return this.repository.findByAgentId(agent_id);
  }

  /**
   * Knowledge Vault 업데이트
   * immutable=true인 경우 새 버전으로 생성 (기존 버전은 유지)
   */
  async update(
    vault_id: string,
    input: UpdateKnowledgeVaultServiceInput
  ): Promise<KnowledgeVaultRecord> {
    const existing = await this.repository.findById(vault_id);
    if (!existing) {
      throw new Error(`Knowledge vault with id '${vault_id}' not found`);
    }

    // immutable=true이고 admin_override=false인 경우 새 버전으로 생성
    if (existing.immutable && !existing.admin_override && !input.admin_override) {
      // 새 버전 생성
      const nextVersion = await this.repository.getNextVersion(existing.agent_id, existing.key);
      const newVaultId = generateVaultId();

      // 새 버전 생성 (기존 value를 input.value로 업데이트)
      const newRecord = await this.repository.create({
        vault_id: newVaultId,
        agent_id: existing.agent_id,
        key: existing.key,
        value: input.value ?? existing.value,
        immutable: input.immutable ?? existing.immutable,
        version: nextVersion,
        previous_version_id: existing.vault_id,
        admin_override: input.admin_override ?? existing.admin_override,
        deleted_at: null,
        origin_source: input.origin_source ?? existing.origin_source
      });

      return newRecord;
    }

    // 일반 업데이트 (immutable=false이거나 admin_override=true인 경우)
    const updated = await this.repository.update(vault_id, input);
    if (!updated) {
      throw new Error(`Failed to update knowledge vault with id: ${vault_id}`);
    }

    return updated;
  }

  /**
   * agent_id와 key로 활성 버전 업데이트
   * immutable=true인 경우 새 버전으로 생성
   */
  async updateActiveByKey(
    agent_id: string,
    key: string,
    input: UpdateKnowledgeVaultServiceInput
  ): Promise<KnowledgeVaultRecord> {
    const existing = await this.repository.findActiveByKey(agent_id, key);
    if (!existing) {
      throw new Error(`Active knowledge vault with key '${key}' not found for agent '${agent_id}'`);
    }

    return this.update(existing.vault_id, input);
  }

  /**
   * Knowledge Vault 삭제 (soft delete)
   * immutable=true인 경우 삭제 불가
   */
  async delete(vault_id: string): Promise<boolean> {
    const existing = await this.repository.findById(vault_id);
    if (!existing) {
      return false;
    }

    // immutable=true이고 admin_override=false인 경우 삭제 불가
    if (existing.immutable && !existing.admin_override) {
      throw new ImmutableDataError(
        `Cannot delete immutable knowledge vault: ${vault_id}. Use admin_override=true to delete.`
      );
    }

    return this.repository.delete(vault_id);
  }

  /**
   * agent_id와 key로 활성 버전 삭제 (soft delete)
   */
  async deleteActiveByKey(agent_id: string, key: string): Promise<boolean> {
    const existing = await this.repository.findActiveByKey(agent_id, key);
    if (!existing) {
      return false;
    }

    // immutable=true이고 admin_override=false인 경우 삭제 불가
    if (existing.immutable && !existing.admin_override) {
      throw new ImmutableDataError(
        `Cannot delete immutable knowledge vault: agent_id=${agent_id}, key=${key}. Use admin_override=true to delete.`
      );
    }

    return this.repository.deleteActiveByKey(agent_id, key);
  }

  /**
   * 하드 삭제 (물리적 삭제, 주의 필요)
   * immutable=true인 경우에도 강제 삭제 가능 (admin 권한 필요)
   */
  async hardDelete(vault_id: string, force: boolean = false): Promise<boolean> {
    const existing = await this.repository.findById(vault_id);
    if (!existing) {
      return false;
    }

    // immutable=true이고 force=false인 경우 삭제 불가
    if (existing.immutable && !force) {
      throw new ImmutableDataError(
        `Cannot hard delete immutable knowledge vault: ${vault_id}. Use force=true to delete.`
      );
    }

    return this.repository.hardDelete(vault_id);
  }

  /**
   * 모든 활성 Knowledge Vault 조회
   */
  async findAllActive(): Promise<KnowledgeVaultRecord[]> {
    return this.repository.findAllActive();
  }

  /**
   * 모든 Knowledge Vault 조회 (삭제된 것 포함)
   */
  async findAll(): Promise<KnowledgeVaultRecord[]> {
    return this.repository.findAll();
  }

  /**
   * Knowledge Vault 개수 조회
   */
  async count(agent_id?: string, activeOnly: boolean = true): Promise<number> {
    return this.repository.count(agent_id, activeOnly);
  }

  /**
   * Immutable 검증
   * immutable=true인 경우 업데이트/삭제 가능 여부 확인
   */
  canUpdate(record: KnowledgeVaultRecord, admin_override: boolean = false): boolean {
    if (!record.immutable) {
      return true;
    }
    return record.admin_override || admin_override;
  }

  /**
   * Immutable 검증
   * immutable=true인 경우 삭제 가능 여부 확인
   */
  canDelete(record: KnowledgeVaultRecord, admin_override: boolean = false): boolean {
    if (!record.immutable) {
      return true;
    }
    return record.admin_override || admin_override;
  }
}

