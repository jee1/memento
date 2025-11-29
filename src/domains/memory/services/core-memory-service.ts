/**
 * Core Memory Service
 * Core Memory에 대한 비즈니스 로직 처리
 * 
 * 클린코드 원칙:
 * - 단일 책임 원칙: Core Memory 비즈니스 로직만 담당
 * - 의존성 역전: Repository에 의존
 * - 캐시 연동: always_load=true인 항목은 캐시에 유지
 */

import { CoreMemoryRepository, type CoreMemoryRecord, type CreateCoreMemoryInput, type UpdateCoreMemoryInput } from '../repositories/core-memory-repository.js';

export interface CoreMemoryCache {
  /**
   * 항목을 캐시에 저장
   */
  set(key: string, value: CoreMemoryRecord): void;

  /**
   * 캐시에서 항목 조회
   */
  get(key: string): CoreMemoryRecord | undefined;

  /**
   * 캐시에서 항목 삭제
   */
  delete(key: string): void;

  /**
   * 캐시 전체 조회 (always_load=true인 항목들)
   */
  getAll(): CoreMemoryRecord[];

  /**
   * 캐시 무효화
   */
  clear(): void;

  /**
   * 캐시 크기 반환
   */
  size(): number;
}

export interface CreateCoreMemoryServiceInput {
  agent_id?: string;
  key: string;
  value: string;
  always_load?: boolean;
  origin_source?: string | null;
}

export interface UpdateCoreMemoryServiceInput {
  value?: string;
  always_load?: boolean;
  origin_source?: string | null;
}

/**
 * Core Memory ID 생성 유틸리티
 */
function generateCoreId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 11);
  return `core_${timestamp}_${random}`;
}

/**
 * Core Memory Service
 */
export class CoreMemoryService {
  private cache: CoreMemoryCache | null = null;

  constructor(
    private repository: CoreMemoryRepository,
    cache?: CoreMemoryCache
  ) {
    this.cache = cache || null;
  }

  /**
   * 캐시 서비스 설정
   */
  setCache(cache: CoreMemoryCache): void {
    this.cache = cache;
  }

  /**
   * Core Memory 생성
   */
  async create(input: CreateCoreMemoryServiceInput): Promise<CoreMemoryRecord> {
    const {
      agent_id = 'default',
      key,
      value,
      always_load = false,
      origin_source = null
    } = input;

    // 기존 key가 있는지 확인 (UNIQUE 제약)
    const existing = await this.repository.findByKey(agent_id, key);
    if (existing) {
      throw new Error(`Core memory with key '${key}' already exists for agent '${agent_id}'`);
    }

    const core_id = generateCoreId();

    const record = await this.repository.create({
      core_id,
      agent_id,
      key,
      value,
      always_load,
      origin_source
    });

    // always_load=true인 경우 캐시에 추가
    if (always_load && this.cache) {
      this.cache.set(this.getCacheKey(agent_id, key), record);
    }

    return record;
  }

  /**
   * ID로 Core Memory 조회
   */
  async findById(core_id: string): Promise<CoreMemoryRecord | null> {
    return this.repository.findById(core_id);
  }

  /**
   * agent_id와 key로 Core Memory 조회 (캐시 우선)
   */
  async findByKey(agent_id: string, key: string): Promise<CoreMemoryRecord | null> {
    // 캐시에서 먼저 조회
    if (this.cache) {
      const cached = this.cache.get(this.getCacheKey(agent_id, key));
      if (cached) {
        return cached;
      }
    }

    // 캐시에 없으면 DB에서 조회
    const record = await this.repository.findByKey(agent_id, key);
    
    // always_load=true이고 캐시에 없으면 캐시에 추가
    if (record && record.always_load && this.cache) {
      this.cache.set(this.getCacheKey(agent_id, key), record);
    }

    return record;
  }

  /**
   * agent_id로 모든 Core Memory 조회
   */
  async findByAgentId(agent_id: string): Promise<CoreMemoryRecord[]> {
    return this.repository.findByAgentId(agent_id);
  }

  /**
   * always_load=true인 Core Memory 조회 (캐시 우선)
   */
  async findAlwaysLoad(agent_id?: string): Promise<CoreMemoryRecord[]> {
    // 캐시가 있고 캐시에 데이터가 있으면 캐시에서 조회
    if (this.cache && this.cache.size() > 0) {
      const cached = this.cache.getAll();
      if (agent_id) {
        return cached.filter(record => record.agent_id === agent_id);
      }
      return cached;
    }

    // 캐시가 없거나 비어있으면 DB에서 조회
    const dbItems = await this.repository.findAlwaysLoad(agent_id);
    
    // 캐시가 있으면 DB에서 조회한 항목들을 캐시에 로드
    if (this.cache) {
      for (const item of dbItems) {
        const cacheKey = this.getCacheKey(item.agent_id, item.key);
        this.cache.set(cacheKey, item);
      }
    }
    
    return dbItems;
  }

  /**
   * Core Memory 업데이트
   */
  async update(
    core_id: string,
    input: UpdateCoreMemoryServiceInput
  ): Promise<CoreMemoryRecord | null> {
    const existing = await this.repository.findById(core_id);
    if (!existing) {
      return null;
    }

    const updated = await this.repository.update(core_id, input);

    if (!updated) {
      return null;
    }

    // 캐시 업데이트
    if (this.cache) {
      const cacheKey = this.getCacheKey(updated.agent_id, updated.key);
      
      if (updated.always_load) {
        // always_load=true인 경우 캐시에 추가/업데이트
        this.cache.set(cacheKey, updated);
      } else {
        // always_load=false로 변경된 경우 캐시에서 제거
        this.cache.delete(cacheKey);
      }
    }

    return updated;
  }

  /**
   * agent_id와 key로 Core Memory 업데이트
   */
  async updateByKey(
    agent_id: string,
    key: string,
    input: UpdateCoreMemoryServiceInput
  ): Promise<CoreMemoryRecord | null> {
    const existing = await this.repository.findByKey(agent_id, key);
    if (!existing) {
      return null;
    }

    const updated = await this.repository.updateByKey(agent_id, key, input);

    if (!updated) {
      return null;
    }

    // 캐시 업데이트
    if (this.cache) {
      const cacheKey = this.getCacheKey(agent_id, key);
      
      if (updated.always_load) {
        // always_load=true인 경우 캐시에 추가/업데이트
        this.cache.set(cacheKey, updated);
      } else {
        // always_load=false로 변경된 경우 캐시에서 제거
        this.cache.delete(cacheKey);
      }
    }

    return updated;
  }

  /**
   * Core Memory 삭제
   */
  async delete(core_id: string): Promise<boolean> {
    const existing = await this.repository.findById(core_id);
    if (!existing) {
      return false;
    }

    const deleted = await this.repository.delete(core_id);

    // 캐시에서도 제거
    if (deleted && this.cache) {
      this.cache.delete(this.getCacheKey(existing.agent_id, existing.key));
    }

    return deleted;
  }

  /**
   * agent_id와 key로 Core Memory 삭제
   */
  async deleteByKey(agent_id: string, key: string): Promise<boolean> {
    const existing = await this.repository.findByKey(agent_id, key);
    if (!existing) {
      return false;
    }

    const deleted = await this.repository.deleteByKey(agent_id, key);

    // 캐시에서도 제거
    if (deleted && this.cache) {
      this.cache.delete(this.getCacheKey(agent_id, key));
    }

    return deleted;
  }

  /**
   * agent_id로 모든 Core Memory 삭제
   */
  async deleteByAgentId(agent_id: string): Promise<number> {
    const deleted = await this.repository.deleteByAgentId(agent_id);

    // 캐시에서도 제거
    if (deleted > 0 && this.cache) {
      // 캐시에서 해당 agent_id의 항목들 제거
      const cached = this.cache.getAll();
      for (const record of cached) {
        if (record.agent_id === agent_id) {
          this.cache.delete(this.getCacheKey(agent_id, record.key));
        }
      }
    }

    return deleted;
  }

  /**
   * 모든 Core Memory 조회 (관리용)
   */
  async findAll(): Promise<CoreMemoryRecord[]> {
    return this.repository.findAll();
  }

  /**
   * Core Memory 개수 조회
   */
  async count(agent_id?: string): Promise<number> {
    return this.repository.count(agent_id);
  }

  /**
   * 캐시 키 생성
   */
  private getCacheKey(agent_id: string, key: string): string {
    return `${agent_id}:${key}`;
  }

  /**
   * 캐시 무효화 및 재로드 (always_load=true인 항목들)
   */
  async reloadCache(agent_id?: string): Promise<void> {
    if (!this.cache) {
      return;
    }

    // 캐시 클리어
    this.cache.clear();

    // always_load=true인 항목들을 DB에서 조회하여 캐시에 로드
    const alwaysLoadItems = await this.repository.findAlwaysLoad(agent_id);
    for (const item of alwaysLoadItems) {
      this.cache.set(this.getCacheKey(item.agent_id, item.key), item);
    }
  }
}

