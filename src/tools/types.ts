/**
 * MCP Tools 공통 타입 정의
 */

import { z } from 'zod';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: any;
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
  db: any;
  services: {
    /** 기본 텍스트 검색 엔진 */
    searchEngine?: any;
    /** 하이브리드 검색 엔진 (텍스트 + 벡터) */
    hybridSearchEngine?: any;
    /** 메모리 임베딩 서비스 */
    embeddingService?: any;
    /** 망각 정책 서비스 */
    forgettingPolicyService?: any;
    /** 성능 모니터링 서비스 (싱글톤) */
    performanceMonitor?: any;
    /** 데이터베이스 최적화 서비스 */
    databaseOptimizer?: any;
    /** 에러 로깅 서비스 */
    errorLoggingService?: any;
    /** 성능 알림 서비스 */
    performanceAlertService?: any;
    /** 성능 모니터링 통합 서비스 (주석 처리됨, 향후 사용 예정) */
    performanceMonitoringIntegration?: any;
    /** 통합 점수 서비스 (기능 플래그에 따라 초기화) */
    consolidationScoreService?: any;
    /** 쓰기 결합 관리자 (기능 플래그에 따라 초기화) */
    writeCoalescingManager?: any;
  };
}

export type ToolHandler = (params: any, context: ToolContext) => Promise<any>;

export interface ToolResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  [key: string]: any; // 추가 필드들을 허용
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
  ReflectionNotes: z.string().optional(), // JSON 객체 문자열
};

