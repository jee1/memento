/**
 * Core Memory Repository
 * 
 * @deprecated 이 파일은 하위 호환성을 위해 유지됩니다.
 * 새로운 코드는 core-memory-repository.interface.ts의 인터페이스를 사용하고
 * Factory 패턴(createCoreMemoryRepository)을 통해 구현체를 생성하세요.
 * 
 * 이 파일은 인터페이스와 타입만 re-export합니다.
 */

// 인터페이스와 타입 re-export
export type {
  CoreMemoryRepository,
  CoreMemoryRecord,
  CreateCoreMemoryInput,
  UpdateCoreMemoryInput
} from './core-memory-repository.interface.js';
