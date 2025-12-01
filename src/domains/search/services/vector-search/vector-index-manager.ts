/**
 * 벡터 인덱스 관리 서비스
 * 단일 책임 원칙(SRP) 적용 - 인덱스 관리만 담당
 */

import type { VectorIndexStatus } from '../../../../shared/types/vector-search.types.js';
import type { VectorIndexRepository } from '../../../../shared/interfaces/database.interface.js';

export class VectorIndexManager {
  constructor(private repository: VectorIndexRepository) {}

  /**
   * 인덱스 상태 확인
   */
  getIndexStatus(): VectorIndexStatus {
    try {
      return this.repository.getIndexStatus();
    } catch (error) {
      console.error('인덱스 상태 확인 실패:', error);
      return {
        available: false,
        tableExists: false,
        recordCount: 0,
        dimensions: 384,
        vecExtensionLoaded: false
      };
    }
  }

  /**
   * 인덱스 재구성
   */
  async rebuildIndex(): Promise<boolean> {
    try {
      console.log('🔄 벡터 인덱스 재구성 시작...');
      const result = await this.repository.rebuildIndex();
      console.log('✅ 벡터 인덱스 재구성 완료');
      return result;
    } catch (error) {
      console.error('❌ 벡터 인덱스 재구성 실패:', error);
      return false;
    }
  }

  /**
   * VEC 사용 가능 여부 확인
   */
  isAvailable(): boolean {
    try {
      return this.repository.checkAvailability();
    } catch (error) {
      console.error('VEC 가용성 확인 실패:', error);
      return false;
    }
  }

  /**
   * 인덱스 상태 요약
   */
  getStatusSummary(): string {
    const status = this.getIndexStatus();
    return `VEC 상태: ${status.available ? '사용가능' : '사용불가'} | ` +
           `테이블: ${status.tableExists ? '존재' : '없음'} | ` +
           `레코드: ${status.recordCount}개 | ` +
           `차원: ${status.dimensions}`;
  }
}
