import type { ProcessAttribute } from '../../../shared/types/index.js';

/**
 * ProcessAttribute Repository Interface
 * process_attribute 테이블에 접근하여 주제 및 속성 메타데이터를 관리합니다.
 */
export interface IProcessAttributeRepository {
  /**
   * process_id로 속성 정보를 조회합니다.
   * @param processId 프로세스 ID
   * @returns ProcessAttribute 객체 또는 null (데이터가 없는 경우)
   */
  getByProcessId(processId: string): ProcessAttribute | null;

  /**
   * 프로세스 속성 정보를 저장하거나 업데이트합니다.
   * @param attr 저장할 ProcessAttribute 객체
   */
  upsert(attr: ProcessAttribute): void;
}
