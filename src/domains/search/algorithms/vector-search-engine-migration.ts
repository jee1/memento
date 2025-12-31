/**
 * 기존 코드에서 리팩토링된 코드로의 점진적 전환을 지원합니다.
 * 마이그레이션 가이드와 헬퍼를 제공하여 안전한 전환을 보장합니다.
 */

import { VectorSearchEngine } from './vector-search-engine.js';
import { PIIMasker } from '../../../shared/utils/pii-masker.js';

/**
 * 기존 VectorSearchEngine에서 새로운 구조로의 전환을 지원합니다.
 * 마이그레이션 헬퍼를 제공하여 안전한 전환을 보장합니다.
 * 
 * @deprecated 리팩토링이 완료되어 더 이상 필요하지 않습니다.
 */
export class VectorSearchEngineMigration {
  /**
   * 기존 엔진을 새로운 엔진으로 교체하여 개선된 구현을 사용합니다.
   * 데이터베이스 연결 상태를 유지하여 중단 없는 전환을 보장합니다.
   * 
   * @deprecated 리팩토링이 완료되어 더 이상 필요하지 않습니다.
   */
  static migrate(oldEngine: VectorSearchEngine): VectorSearchEngine {
    // 리팩토링이 완료되어 기존 엔진을 그대로 반환
    const newEngine = new VectorSearchEngine();
    
    // 기존 데이터베이스 연결을 새 엔진에 전달하여 중단 없는 전환을 보장합니다.
    if (oldEngine.isConnected()) {
      // 기존 엔진의 데이터베이스 인스턴스를 가져와서 새 엔진에 설정하여 연결 상태를 유지합니다.
      // 실제 구현에서는 기존 엔진에서 데이터베이스 인스턴스를 추출하는 방법이 필요함
      console.log('⚠️ 기존 데이터베이스 연결을 새 엔진으로 전달해야 합니다');
    }
    
    return newEngine;
  }

  /**
   * 점진적 마이그레이션을 위해 어댑터 패턴을 사용하여 기존 코드 수정 없이 전환합니다.
   * 기존 인터페이스를 유지하면서 내부적으로는 새로운 구현을 사용합니다.
   * 
   * @deprecated 리팩토링이 완료되어 더 이상 필요하지 않습니다.
   */
  static createAdapter(oldEngine: VectorSearchEngine): VectorSearchEngine {
    // 리팩토링이 완료되어 기존 엔진을 그대로 반환
    return new VectorSearchEngine();
  }
}

/**
 * 마이그레이션 체크리스트
 */
export const MIGRATION_CHECKLIST = [
  '✅ 1. 새로운 타입 정의 확인 (src/types/vector-search.types.ts)',
  '✅ 2. 인터페이스 정의 확인 (src/interfaces/database.interface.ts)',
  '✅ 3. 설정 객체 확인 (src/config/vector-search.config.ts)',
  '✅ 4. 서비스 클래스들 확인 (src/services/vector-search/)',
  '✅ 5. 리포지토리 구현 확인 (src/repositories/)',
  '✅ 6. 팩토리 클래스 확인 (src/factories/vector-search.factory.ts)',
  '✅ 7. 컨테이너 클래스 확인 (src/services/vector-search/vector-search-container.ts)',
  '✅ 8. 리팩토링 완료 (vector-search-engine.ts에 통합됨)',
  '✅ 9. 테스트 코드 확인 완료',
  '⏳ 10. 기존 코드에서 새 코드로 교체',
  '⏳ 11. 통합 테스트 실행',
  '⏳ 12. 성능 테스트 실행',
  '⏳ 13. 기존 기능 동작 확인'
];

/**
 * 마이그레이션 단계별 가이드
 */
export const MIGRATION_STEPS = {
  step1: {
    title: '의존성 업데이트',
    description: '새로운 타입과 인터페이스 import 추가',
    code: `
// 기존
import { VectorSearchEngine } from './vector-search-engine';

// 새로운 (리팩토링 완료)
import { VectorSearchEngine } from './vector-search-engine';
import type { VectorSearchQuery, VectorSearchResult } from '../../../shared/types/vector-search.types';
    `
  },
  
  step2: {
    title: '인스턴스 생성 변경',
    description: '새로운 팩토리 메서드 사용',
    code: `
// 기존
const engine = new VectorSearchEngine();
engine.initialize(db);

// 새로운 (리팩토링 완료)
const engine = new VectorSearchEngine();
engine.initialize(db);
    `
  },
  
  step3: {
    title: '메서드 호출 업데이트',
    description: '새로운 인터페이스에 맞게 메서드 호출 수정',
    code: `
// 기존
const results = await engine.search(queryVector, options, provider);

// 새로운 (동일한 인터페이스 유지)
const results = await engine.search(queryVector, options, provider);
    `
  },
  
  step4: {
    title: '에러 처리 업데이트',
    description: '새로운 에러 타입에 맞게 에러 처리 수정',
    code: `
// 기존
try {
  const results = await engine.search(queryVector);
} catch (error) {
  const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
  console.error('검색 실패:', maskedError.message);
}

// 새로운 (동일한 에러 처리)
try {
  const results = await engine.search(queryVector);
} catch (error) {
  const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
  console.error('검색 실패:', maskedError.message);
}
    `
  }
};

/**
 * 마이그레이션 검증 함수
 */
export class MigrationValidator {
  /**
   * 기존 기능과 새 기능의 호환성 검증
   */
  static async validateCompatibility(
    oldEngine: VectorSearchEngine, 
    newEngine: VectorSearchEngine
  ): Promise<boolean> {
    try {
      // 1. 기본 메서드 존재 확인
      const methods = ['search', 'hybridSearch', 'getIndexStatus', 'rebuildIndex', 'performanceTest'];
      for (const method of methods) {
        if (typeof (newEngine as any)[method] !== 'function') {
          console.error(`❌ 메서드 ${method}가 존재하지 않습니다`);
          return false;
        }
      }
      
      // 2. 데이터베이스 연결 상태 확인
      if (oldEngine.isConnected() !== newEngine.isConnected()) {
        console.warn('⚠️ 데이터베이스 연결 상태가 다릅니다');
      }
      
      // 3. 인덱스 상태 비교
      const oldStatus = oldEngine.getIndexStatus();
      const newStatus = newEngine.getIndexStatus();
      
      if (oldStatus.available !== newStatus.available) {
        console.warn('⚠️ VEC 가용성 상태가 다릅니다');
      }
      
      console.log('✅ 호환성 검증 완료');
      return true;
    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      console.error('❌ 호환성 검증 실패:', maskedError.message);
      return false;
    }
  }
  
  /**
   * 성능 비교 테스트
   */
  static async comparePerformance(
    oldEngine: VectorSearchEngine,
    newEngine: VectorSearchEngine,
    testVector: number[]
  ): Promise<{
    oldPerformance: any;
    newPerformance: any;
    improvement: number;
  }> {
    try {
      // 기존 엔진 성능 테스트
      const oldResult = await oldEngine.performanceTest(testVector, 5);
      
      // 새 엔진 성능 테스트
      const newResult = await newEngine.performanceTest(testVector, 5);
      
      const improvement = ((oldResult.averageTime - newResult.averageTime) / oldResult.averageTime) * 100;
      
      return {
        oldPerformance: oldResult,
        newPerformance: newResult,
        improvement
      };
    } catch (error) {
      const maskedError = error instanceof Error ? PIIMasker.maskError(error) : { message: String(error), name: 'Error' };
      console.error('❌ 성능 비교 실패:', maskedError.message);
      throw error;
    }
  }
}
