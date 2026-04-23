/**
 * KgTriple Repository (Issue #90)
 * 
 * @deprecated 이 파일은 하위 호환성을 위해 유지됩니다.
 * 새로운 코드는 kg-triple-repository.interface.ts의 IKgTripleRepository 인터페이스를 사용하고
 * infrastructure/database/repositories/kg-triple-repository-sqlite.impl.ts의 구현체를 사용하세요.
 */

// 인터페이스와 타입 re-export
export type { 
  KgTripleRow, 
  UpsertTripleInput,
  IKgTripleRepository as KgTripleRepositoryInterface 
} from './kg-triple-repository.interface.js';

// 구현체 re-export (하위 호환성 유지)
export { KgTripleRepositorySqlite as KgTripleRepository } from '../../../infrastructure/database/repositories/kg-triple-repository-sqlite.impl.js';
