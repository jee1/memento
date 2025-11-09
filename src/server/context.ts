/**
 * 서버 컨텍스트 모듈
 * 공통 서비스 접근 및 컨텍스트 관리를 위한 모듈
 * Phase 0: 공통 모듈 설계
 */

import type Database from 'better-sqlite3';
import type { ServerServices } from './bootstrap.js';
import type { ToolContext } from '../tools/types.js';

/**
 * 서버 컨텍스트 인터페이스
 * 서버에서 공통으로 사용하는 서비스 및 데이터베이스 접근
 */
export interface ServerContext {
  /** 데이터베이스 인스턴스 */
  db: Database.Database;
  /** 초기화된 서비스 집합 */
  services: ServerServices;
}

/**
 * 서버 컨텍스트 생성 함수
 * 
 * @param db 데이터베이스 인스턴스
 * @param services 초기화된 서비스 집합
 * @returns 서버 컨텍스트
 */
export function createServerContext(
  db: Database.Database,
  services: ServerServices
): ServerContext {
  return {
    db,
    services
  };
}

/**
 * ToolContext 생성 함수
 * ServerServices를 기반으로 ToolContext 생성
 * Phase 5.1과 통합: ToolContext 생성 팩토리
 * 
 * @param serverContext 서버 컨텍스트
 * @returns ToolContext
 */
export function createToolContext(serverContext: ServerContext): ToolContext {
  return {
    db: serverContext.db,
    services: {
      searchEngine: serverContext.services.searchEngine,
      hybridSearchEngine: serverContext.services.hybridSearchEngine,
      embeddingService: serverContext.services.embeddingService,
      forgettingPolicyService: serverContext.services.forgettingPolicyService,
      performanceMonitor: serverContext.services.performanceMonitor,
      databaseOptimizer: serverContext.services.databaseOptimizer,
      errorLoggingService: serverContext.services.errorLoggingService,
      performanceAlertService: serverContext.services.performanceAlertService,
      consolidationScoreService: serverContext.services.consolidationScoreService,
      writeCoalescingManager: serverContext.services.writeCoalescingManager,
      anchorManager: serverContext.services.anchorManager
    }
  };
}

