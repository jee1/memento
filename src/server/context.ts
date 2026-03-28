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
 * Phase 7.3: 오버로드 추가로 (db, services) 형태 지원
 * 
 * @overload
 * @param serverContext 서버 컨텍스트
 * @returns ToolContext
 * 
 * @overload
 * @param db 데이터베이스 인스턴스
 * @param services 초기화된 서비스 집합
 * @returns ToolContext
 */
export function createToolContext(serverContext: ServerContext): ToolContext;
export function createToolContext(db: Database.Database, services: ServerServices): ToolContext;
export function createToolContext(
  serverContextOrDb: ServerContext | Database.Database,
  services?: ServerServices
): ToolContext {
  // When: (db, services) 형태로 호출된 경우
  if (services !== undefined) {
    const db = serverContextOrDb as Database.Database;
    const serverContext = createServerContext(db, services);
    return createToolContextFromServerContext(serverContext);
  }
  
  // When: (serverContext) 형태로 호출된 경우
  const serverContext = serverContextOrDb as ServerContext;
  return createToolContextFromServerContext(serverContext);
}

/**
 * ServerContext로부터 ToolContext 생성 (내부 헬퍼 함수)
 * 
 * @param serverContext 서버 컨텍스트
 * @returns ToolContext
 */
function createToolContextFromServerContext(serverContext: ServerContext): ToolContext {
  return {
    db: serverContext.db,
    services: {
      searchEngine: serverContext.services.searchEngine,
      hybridSearchEngine: serverContext.services.hybridSearchEngine,
      vectorSearchEngine: serverContext.services.vectorSearchEngine,
      embeddingService: serverContext.services.embeddingService,
      forgettingPolicyService: serverContext.services.forgettingPolicyService,
      performanceMonitor: serverContext.services.performanceMonitor,
      databaseOptimizer: serverContext.services.databaseOptimizer,
      errorLoggingService: serverContext.services.errorLoggingService,
      performanceAlertService: serverContext.services.performanceAlertService,
      consolidationScoreService: serverContext.services.consolidationScoreService,
      writeCoalescingManager: serverContext.services.writeCoalescingManager,
      anchorManager: serverContext.services.anchorManager,
      failureDetector: serverContext.services.failureDetector,
      reflexionWorker: serverContext.services.reflexionWorker,
      metaMemoryService: serverContext.services.metaMemoryService,
      batchScheduler: serverContext.services.batchScheduler,
      introspectionScanCache: serverContext.services.introspectionScanCache
    }
  };
}

