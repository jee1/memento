/**
 * 벡터 인덱스 관리 서비스
 * 단일 책임 원칙(SRP) 적용 - 인덱스 관리만 담당
 */

import type { VectorIndexStatus } from '../../../../shared/types/vector-search.types.js';
import type { VectorIndexRepository } from '../../../../shared/interfaces/database.interface.js';
import { PIIMasker } from '../../../../shared/utils/pii-masker.js';
import { logger } from '../../../../shared/utils/logger.js';
import { VECTOR_SEARCH } from '../../../../shared/config/constants.js';

export class VectorIndexManager {
  constructor(private repository: VectorIndexRepository) {}

  /**
   * 인덱스 상태 확인
   * 
   * 왜 차원 검증이 중요한가?
   * - "expected 384 vs actual 512" 에러 방지를 위해 정확한 차원 정보 반환 필요
   */
  getIndexStatus(): VectorIndexStatus {
    try {
      const status = this.repository.getIndexStatus();
      
      // 차원 정보 검증: PROVIDER_DIMENSIONS와 일치하는지 확인
      // 왜 필요한가? 잘못된 차원 정보로 인한 벡터 검색 실패 방지
      const validDimensions = Object.values(VECTOR_SEARCH.PROVIDER_DIMENSIONS) as number[];
      if (status.dimensions && !validDimensions.includes(status.dimensions)) {
        logger.warn('인덱스 차원이 예상과 다릅니다', {
          actualDimensions: status.dimensions,
          validDimensions
        });
      }
      
      return status;
    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      logger.error('인덱스 상태 확인 실패', {
        error: maskedError.message
      });
      return {
        available: false,
        tableExists: false,
        recordCount: 0,
        dimensions: 384, // 기본값 (MiniLM 차원)
        vecExtensionLoaded: false
      };
    }
  }

  /**
   * 인덱스 재구성
   */
  async rebuildIndex(): Promise<boolean> {
    try {
      logger.info('벡터 인덱스 재구성 시작');
      const result = await this.repository.rebuildIndex();
      logger.info('벡터 인덱스 재구성 완료');
      return result;
    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      logger.error('벡터 인덱스 재구성 실패', {
        error: maskedError.message
      });
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
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      logger.error('VEC 가용성 확인 실패', {
        error: maskedError.message
      });
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
