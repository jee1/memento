/**
 * Core Memory Repository Interface
 * Core Memory 테이블에 대한 데이터베이스 접근 인터페이스 정의
 */

/**
 * Core Memory 레코드 타입
 */
export interface CoreMemoryRecord {
  core_id: string;
  agent_id: string;
  key: string;
  value: string;
  always_load: boolean;
  origin_source?: string | null;
  version: number; // 버전 번호 (단조 증가, 캐시 무효화용)
  created_at: string;
  updated_at: string;
}

/**
 * Core Memory 생성 입력 타입
 */
export interface CreateCoreMemoryInput {
  core_id: string;
  agent_id?: string;
  key: string;
  value: string;
  always_load?: boolean;
  origin_source?: string | null;
}

/**
 * Core Memory 업데이트 입력 타입
 */
export interface UpdateCoreMemoryInput {
  value?: string;
  always_load?: boolean;
  origin_source?: string | null;
}

/**
 * Core Memory Repository 인터페이스
 * 모든 메서드는 비동기 Promise를 반환합니다.
 */
export interface CoreMemoryRepository {
  /**
   * Core Memory 생성
   */
  create(input: CreateCoreMemoryInput): Promise<CoreMemoryRecord>;

  /**
   * ID로 Core Memory 조회
   */
  findById(core_id: string): Promise<CoreMemoryRecord | null>;

  /**
   * agent_id와 key로 Core Memory 조회
   */
  findByKey(agent_id: string, key: string): Promise<CoreMemoryRecord | null>;

  /**
   * agent_id로 모든 Core Memory 조회
   */
  findByAgentId(agent_id: string): Promise<CoreMemoryRecord[]>;

  /**
   * always_load=true인 Core Memory 조회
   */
  findAlwaysLoad(agent_id?: string): Promise<CoreMemoryRecord[]>;

  /**
   * Core Memory 업데이트
   */
  update(core_id: string, input: UpdateCoreMemoryInput): Promise<CoreMemoryRecord | null>;

  /**
   * agent_id와 key로 Core Memory 업데이트
   */
  updateByKey(
    agent_id: string,
    key: string,
    input: UpdateCoreMemoryInput
  ): Promise<CoreMemoryRecord | null>;

  /**
   * Core Memory 삭제
   */
  delete(core_id: string): Promise<boolean>;

  /**
   * agent_id와 key로 Core Memory 삭제
   */
  deleteByKey(agent_id: string, key: string): Promise<boolean>;

  /**
   * agent_id로 모든 Core Memory 삭제
   */
  deleteByAgentId(agent_id: string): Promise<number>;

  /**
   * 모든 Core Memory 조회 (관리용)
   */
  findAll(): Promise<CoreMemoryRecord[]>;

  /**
   * Core Memory 개수 조회
   */
  count(agent_id?: string): Promise<number>;
}

