/**
 * 벡터 성능 테스트 서비스
 * 단일 책임 원칙(SRP) 적용 - 성능 테스트만 담당
 */

import type { PerformanceTestResult } from '../../shared/types/vector-search.types';
import type { VectorPerformanceRepository } from '../../shared/interfaces/database.interface';
import { VECTOR_SEARCH_DEFAULTS } from '../../shared/config/vector-search.config';

export class VectorPerformanceTester {
  constructor(private repository: VectorPerformanceRepository) {}

  /**
   * 성능 테스트 실행
   */
  async runPerformanceTest(
    queryVector: number[],
    iterations: number = VECTOR_SEARCH_DEFAULTS.PERFORMANCE_ITERATIONS
  ): Promise<PerformanceTestResult> {
    this.validateTestParameters(queryVector, iterations);
    
    try {
      return await this.repository.runPerformanceTest(queryVector, iterations);
    } catch (error) {
      console.error('성능 테스트 실패:', error);
      return {
        averageTime: 0,
        minTime: 0,
        maxTime: 0,
        results: 0,
        successRate: 0
      };
    }
  }

  /**
   * 벡터 차원 검증
   */
  private validateTestParameters(queryVector: number[], iterations: number): void {
    if (!queryVector || queryVector.length !== VECTOR_SEARCH_DEFAULTS.DIMENSIONS) {
      throw new Error(`벡터 차원 불일치: 예상 ${VECTOR_SEARCH_DEFAULTS.DIMENSIONS}, 실제 ${queryVector?.length || 0}`);
    }

    if (iterations < 1 || iterations > 100) {
      throw new Error('반복 횟수는 1-100 사이여야 합니다');
    }
  }

  /**
   * 성능 테스트 결과 분석
   */
  analyzeResults(result: PerformanceTestResult): {
    performance: 'excellent' | 'good' | 'fair' | 'poor';
    recommendations: string[];
  } {
    const recommendations: string[] = [];
    let performance: 'excellent' | 'good' | 'fair' | 'poor' = 'good';

    if (result.averageTime < 10) {
      performance = 'excellent';
    } else if (result.averageTime < 50) {
      performance = 'good';
    } else if (result.averageTime < 100) {
      performance = 'fair';
      recommendations.push('인덱스 최적화를 고려하세요');
    } else {
      performance = 'poor';
      recommendations.push('인덱스 재구성이 필요합니다');
      recommendations.push('데이터베이스 성능 튜닝을 고려하세요');
    }

    if (result.successRate < 0.9) {
      recommendations.push('시스템 안정성 검토가 필요합니다');
    }

    return { performance, recommendations };
  }

  /**
   * 성능 테스트 리포트 생성
   */
  generateReport(result: PerformanceTestResult): string {
    const analysis = this.analyzeResults(result);
    
    return `
벡터 검색 성능 테스트 리포트
============================
평균 응답 시간: ${result.averageTime.toFixed(2)}ms
최소 응답 시간: ${result.minTime}ms
최대 응답 시간: ${result.maxTime}ms
검색 결과 수: ${result.results}개
성공률: ${(result.successRate * 100).toFixed(1)}%
성능 등급: ${analysis.performance.toUpperCase()}

권장사항:
${analysis.recommendations.map(rec => `- ${rec}`).join('\n')}
    `.trim();
  }
}
