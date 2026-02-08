/**
 * MCP Tools 공통 타입 정의
 */

import { z } from 'zod';
import type Database from 'better-sqlite3';
import type { SearchEngine } from '../domains/search/algorithms/search-engine.js';
import type { HybridSearchEngine } from '../domains/search/algorithms/hybrid-search-engine.js';
import type { MemoryEmbeddingService } from '../domains/memory/services/memory-embedding-service.js';
import type { ForgettingPolicyService } from '../domains/forgetting/services/forgetting-policy-service.js';
import type { DatabaseOptimizer } from '../infrastructure/database/database-optimizer.js';
import type { ErrorLoggingService } from '../domains/monitoring/services/error-logging-service.js';
import type { PerformanceAlertService } from '../domains/monitoring/services/performance-alert-service.js';
import type { ConsolidationScoreService } from '../infrastructure/consolidation-score-service.js';
import type { WriteCoalescingManager } from '../shared/utils/write-coalescing.js';
import type { AnchorManager } from '../domains/anchor/services/anchor/anchor-manager.js';
import type { RelationGraph } from '../domains/relation/services/relation-graph.js';
import type { FailureDetector } from '../domains/monitoring/services/failure-detector.js';
import type { ReflexionWorker } from '../infrastructure/reflexion-worker.js';
import type { MetaMemoryService } from '../domains/memory/services/meta-memory-service.js';
import { getPerformanceMonitor } from '../domains/monitoring/services/performance-monitor.js';

export interface ToolDefinition {
  name: string;
  description: string;
  // 하위 호환성을 위해 JSON Schema 형식도 허용
  // 향후 모든 도구를 Zod 스키마로 마이그레이션 예정
  inputSchema: z.ZodTypeAny | Record<string, unknown>;
  handler: ToolHandler;
}

/**
 * MCP 도구 실행 컨텍스트
 * 
 * 모든 서비스는 optional로 정의되어 있어 하위 호환성을 보장합니다.
 * 부트스트랩 함수를 통해 초기화된 서비스들이 포함됩니다.
 */
export interface ToolContext {
  /** 데이터베이스 인스턴스 */
  db: Database.Database;
  /** 다중 에이전트 시 현재 에이전트/소유자 식별자 (미설정 시 remember/recall 기본값 사용) */
  agentId?: string;
  /** Memori Attribution: 프로세스(에이전트/프로그램) 식별자 (Issue #87) */
  processId?: string;
  /** Memori Attribution: 세션(작업 흐름) 식별자 (Issue #87) */
  sessionId?: string;
  services: {
    /** 기본 텍스트 검색 엔진 */
    searchEngine?: SearchEngine;
    /** 하이브리드 검색 엔진 (텍스트 + 벡터) */
    hybridSearchEngine?: HybridSearchEngine;
    /** 메모리 임베딩 서비스 */
    embeddingService?: MemoryEmbeddingService;
    /** 망각 정책 서비스 */
    forgettingPolicyService?: ForgettingPolicyService;
    /** 성능 모니터링 서비스 (싱글톤) */
    performanceMonitor?: ReturnType<typeof getPerformanceMonitor>;
    /** 데이터베이스 최적화 서비스 */
    databaseOptimizer?: DatabaseOptimizer;
    /** 에러 로깅 서비스 */
    errorLoggingService?: ErrorLoggingService;
    /** 성능 알림 서비스 */
    performanceAlertService?: PerformanceAlertService;
    /** 성능 모니터링 통합 서비스 (주석 처리됨, 향후 사용 예정) */
    performanceMonitoringIntegration?: unknown; // 향후 타입 정의 예정
    /** 통합 점수 서비스 (기능 플래그에 따라 초기화) */
    consolidationScoreService?: ConsolidationScoreService;
    /** 쓰기 결합 관리자 (기능 플래그에 따라 초기화) */
    writeCoalescingManager?: WriteCoalescingManager;
    /** 앵커 관리자 서비스 */
    anchorManager?: AnchorManager;
    /** 관계 그래프 서비스 */
    relationGraph?: RelationGraph;
    /** 실패 감지 서비스 (Phase 2) */
    failureDetector?: FailureDetector;
    /** Reflexion Worker 서비스 (Phase 2) */
    reflexionWorker?: ReflexionWorker;
    /** 메타 메모리 통계 서비스 */
    metaMemoryService?: MetaMemoryService;
  };
}

export type ToolHandler = (params: unknown, context: ToolContext) => Promise<ToolResult>;

export interface ToolResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  [key: string]: unknown; // 추가 필드들을 허용 (Record<string, unknown>과 동일)
}

export interface ToolError {
  error: string;
  message?: string;
  details?: string;
}

/**
 * 공통 스키마 정의
 */
export const CommonSchemas = {
  MemoryId: z.string().min(1, 'Memory ID cannot be empty'),
  Content: z.string().min(1, 'Content cannot be empty').optional(), // optional로 변경
  Query: z.string().min(1, 'Query cannot be empty'),
  MemoryType: z.enum(['working', 'episodic', 'semantic', 'procedural', 'core', 'vault']),
  PrivacyScope: z.enum(['private', 'team', 'public']),
  Importance: z.number().min(0).max(1),
  Limit: z.number().min(1).max(50).default(10),
  Tags: z.array(z.string()).optional(),
  Source: z.string().optional(),
  HardDelete: z.boolean().default(false),
  DryRun: z.boolean().default(false).optional(),
  Analyze: z.boolean().default(false).optional(),
  CreateIndexes: z.boolean().default(false).optional(),
  // Core Memory / Knowledge Vault용 필드
  Key: z.string().min(1, 'Key cannot be empty'),
  Value: z.string().min(1, 'Value cannot be empty'),
  AlwaysLoad: z.boolean().default(false).optional(),
  Immutable: z.boolean().default(true).optional(),
  // Procedural Memory용 필드
  TaskGoal: z.string().optional(),
  Steps: z.string().optional(), // JSON 배열 문자열
  ReflectionNotes: z.string().nullable().optional(), // JSON 객체 문자열 (null 허용)
  // Procedural Memory Enhancement (v7.0) 필드
  WorkflowName: z.string().optional(),
  SkillName: z.string().optional(),
  TriggerConditions: z.string().optional(), // JSON 객체 문자열
  UpdateMode: z.enum(['replace', 'incremental', 'versioned']).optional(),
  // AriGraph Pipeline 필드
  EnableTripleExtraction: z.boolean().default(true).optional(), // Triple 추출 활성화 여부 (기본값: true)
};

